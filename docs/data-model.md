# oni-vision data model

A one-page summary of where knowledge lives, how it gets there, and who reads it.

---

## The big picture

```
src/<name>.js          ← single source of truth for each knowledge domain
      │
      │  (imported by pipeline.js at parse time)
      ▼
current.sqlite         ← written atomically after every ONI save
      │
      ├── web frontend  (served via /api/status)
      ├── MCP plugin    (read by oni_query / typed tools)
      └── sqlite3 CLI   (direct queries from CLAUDE.md / shell)
```

There are **three consumers** of the parsed data and **one source** for each domain. A model, a human at the shell, and the browser UI all query the same file.

---

## Knowledge modules (src/*.js → SQLite tables)

Each module is a plain JS file that exports structured data. `pipeline.js` projects those exports into SQLite tables after every parse. No consumer ever re-derives the values — they JOIN against the tables.

| Module | SQLite table | What it contains |
|--------|-------------|-----------------|
| `src/elements.js` | `elements(element_id, name)` | SimHash integer → element display name (Water, Algae, …) |
| `src/geyser_types.js` | `geyser_types(type_id, name)` | SimHash integer → geyser display name (Steam Vent, Volcano, …) |
| `src/food.js` | `foods(prefab_id, name, kcal, morale)` | Food item metadata — name, kcal per unit, morale bonus |
| `src/effects.js` | `effects(effect, label, severity)` | Status effect string → display label + severity tier |
| `src/skills.js` | `skills(branch, label)` | Skill branch prefix → display name (mining → Miner) |
| `src/chore_groups.js` | `chore_groups(hash, name, label, domain, abbr, sort_order)` | Chore-group SimHash → name, UI label, and FE display metadata (colour domain, abbreviation, column order) |
| `src/diseases.js` | `diseases(disease_id, name)` | Disease SimHash integer → display name (Food Poisoning, Slimelung, …) |

**Game rules that also live in `src/skills.js`:**
- `moraleCostOf(skillsCsv)` — sums the tier digits of mastered skills; result stored as `duplicants.morale_cost` (computed once by the extractor, not re-derived client-side).

**Constants that live in `src/thresholds.js`:**
- Surfaced in `/api/status` as `{ thresholds: { stale_after_s, stress_warn, stress_bad, … } }`.
- The web frontend reads from this API key rather than hardcoding the values.

---

## Typed game tables (src/extractors.js → SQLite)

The extractor walks every `gameObjects` group in the save and lifts well-known behaviors into typed rows:

| Table | Source behaviors | Typical use |
|-------|-----------------|------------|
| `duplicants` | `MinionIdentity`, `MinionResume`, `MinionModifiers` | Stress, calories, stamina, morale_cost |
| `duplicant_traits / skills / attributes / effects / amounts` | Linked by `duplicant_id` | Per-dupe detail |
| `duplicant_priorities` | `ChoreConsumer` / `Prioritizable` | Per-dupe per-chore-group priority (0–9); join with `chore_groups`; filter `priority >= 5` for boosted roles |
| `buildings` | `BuildingComplete` + `PrimaryElement` | Placed structures (count, material, temperature) |
| `world_objects` | `PrimaryElement` only (no BuildingComplete) | Loose debris, plants, dropped food |
| `storage_contents` | `Storage.extraData` | Items inside containers; `owner_id` joins to `buildings` or `world_objects` |
| `geysers` | `Geyser` behavior | type_id, rate_roll, year_percent_roll (percentiles, not kg/s) |
| `critters` | `MinionModifiers` (non-Minion prefab) | Calories, HP, happiness, age |
| `behaviors` | All behaviors, stringified JSON | Generic fallback — anything not lifted into a typed table |

---

## Lookup joins

Without a JOIN, `element_id` columns return raw SimHash integers like `1836671383`. Always join:

```sql
-- Element names
SELECT en.name, ROUND(SUM(sc.units), 0) AS kg
FROM storage_contents sc
JOIN elements en ON en.element_id = sc.element_id
GROUP BY sc.element_id ORDER BY kg DESC;

-- Geyser names
SELECT gt.name, rate_roll, year_percent_roll
FROM geysers g
JOIN geyser_types gt ON gt.type_id = g.type_id;
```

---

## Atomicity guarantees

- `pipeline.js` writes `current.sqlite` to `current.sqlite.tmp`, then `rename(2)` into place.
- Readers never see a partially-written database.
- `assertLookupTablesPopulated()` is called before `writeDatabase()`: if any source module accidentally exports an empty array, the pipeline fails loudly instead of silently writing a DB where every JOIN returns NULL.

---

## Consumer summary

| Consumer | How it accesses the data | Key file |
|----------|------------------------|---------|
| Web UI | `/api/status` JSON — thresholds and lookup tables included | `src/web.js` + `src/web/app.js` |
| MCP plugin | Opens `current.sqlite` read-only on each tool call | `oni-vision-plugin/lib/queries.js` |
| CLI renderer | Opens `current.sqlite` read-only | `src/ui.js` |
| Shell / Claude | `sqlite3` CLI queries directly | `CLAUDE.md` |
