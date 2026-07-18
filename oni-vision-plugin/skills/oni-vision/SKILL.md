---
name: oni-vision
description: Query the user's live Oxygen Not Included colony save. Use whenever the user asks about their dupes, geysers, resources, cycle, base name, or anything else about their current ONI save state. Has typed tools for the most common asks plus a SELECT-only SQL escape hatch for everything else.
---

# Oxygen Not Included colony queries

This skill exposes read-only access to a freshly-parsed ONI save via the `oni-vision` MCP server. The oni-vision daemon (GitHub: `arielbloch/oni-vision`) reparses the user's save into SQLite every time the game writes one.

## When to use

Trigger this skill any time the user asks about:
- Their current colony / base / world / asteroid
- Specific duplicants (stress, calories, stamina, breath, bladder, decor, HP, traits, skills, role)
- Geysers / vents / volcanoes (locations, types, output rolls)
- Stored resources, food, building counts
- Cycle count or save metadata
- Anything that would otherwise require reading their .sav file

If the user is asking general ONI strategy questions ("what should I build next?"), pair this skill with `oni-architect` if available.

## Minimal-token patterns (read this first)

Three habits keep responses cheap:

1. **`oni_status()` answers most general questions in one call.** Returns a compact TSV-block snapshot of cycle, dupe count, top stressed dupes, geyser types, and top elements. Use it for "how's my colony?", "summarize my save", "what should I worry about?" — anything that would otherwise chain `oni_save_meta` + `oni_dupes` + `oni_geysers` + `oni_resources`.
2. **`oni_dupes({ fields: [...] })` over a bare `oni_dupes()`.** Project just the columns you need. `["name","stress","current_role"]` is typically enough for stress questions and is ~10× smaller than the default projection.
3. **`format: "tsv"`** on tabular tools (`oni_dupes`, `oni_geysers`, `oni_resources`, `oni_query`) is ~50% smaller than JSON. Use it for >5 rows; it's lossless and the model parses tab-separated values without trouble.

For "tell me everything about Meep" specifically, use `oni_dupe({ name: "Meep" })` — it returns vitals + traits + skills + attributes + effects in one call (~150 tokens) instead of 4 chained tool calls.

## Tool reference

Prefer the typed tools below over `oni_query`. Reach for `oni_query` only when the typed tools don't cover the ask.

### `oni_save_meta()`
Headline facts. Always cheap — start here when in doubt:
```json
{"base_name":"Cosmic Conundrum","cycle":312,"duplicant_count":12,"save_version":"7.26","parsed_at":"2026-05-09T17:32:11.000Z","source_file":"/Users/…/my_colony.sav"}
```

### `oni_freshness()`
Seconds since `parsed_at`. Use this when the user's question is time-sensitive ("are my dupes ok *right now*?"). If `age_seconds` is large (e.g. > 600) or the field is null, mention it in your answer and suggest the user run `npm start` in their oni-vision repo.

### `oni_status({ dupeLimit?, geyserLimit?, resourceLimit? })`
**Preferred entry point.** Compact TSV-block snapshot covering cycle/dupe-count/critters/geyser-count, top stressed dupes, geyser type counts, top elements by mass, parse staleness. Default limits are tuned for "give me a one-screen overview". Bump them only when needed.

### `oni_schema()`
List of tables and views with their columns. ~200 tokens; call once at the start if you'll be composing `oni_query` calls and don't already know the schema.

### `oni_dupes({ sort?, fields?, limit?, format? })`
One row per dupe. Sort by any of: `stress` (default), `calories`, `stamina`, `bladder`, `breath`, `hp`, `decor`, `immune`, `body_temperature`, `gender`, `current_role`, `target_role`, `name`. Default limit is 12 (covers a full colony).
- **`fields`**: array of column names to project. Unknown names are silently dropped.
- **`format`**: `"json"` (default) or `"tsv"`. TSV is ~50% smaller.

### `oni_dupe({ name })`
Single-dupe deep dive: vitals + traits + skills + attributes + effects in one payload. Use this instead of chaining oni_dupes + oni_query for a named dupe.

### `oni_geysers({ format? })`
Every geyser/vent/volcano with prefab_id, type_id, position, and `rate_roll` / `year_percent_roll`. **The `*_roll` fields are 0..1 percentiles against the geyser type's base range — NOT kg/s.** Don't quote them as flow rates.

### `oni_resources({ location?, limit?, format? })`
Element totals across containers, the floor, or both:
- `"storage"` — only inside Storage behaviors (containers, refrigerators, conveyor receptacles, etc.)
- `"world"` — only loose piles on the map
- `"both"` — default; sums across everything

Totals ≥100 kg are reported as integers (rounding noise stripped). Default limit is 10.

### `oni_food({ limit?, format? })`
Food items currently in colony storage, sorted by morale bonus (best food first). Returns display name, kcal per item, morale bonus, and stack count. Joins the `foods` lookup table so results are human-readable. Unknown food items (new DLC) appear with null name/kcal/morale. Default limit is 20.

To compute days of food remaining per type: `days = (qty × kcal) / 1000 / dupe_count`. The denominator 1000 is the assumed kcal/dupe/day. Get `dupe_count` from `oni_save_meta().duplicant_count`.

### `oni_research()`
Tech-tree snapshot from the singleton `Research` behavior: active and target tech, the global research-point inventory (basic / advanced / space / nuclear / orbital), counts of completed-vs-incomplete techs, and the list of techs that have accrued partial progress. Returns `null` on a brand-new save with no Research yet.

### `oni_schedules()`
Colony schedules with each schedule's 24-block timetable compacted into `Work×N, Downtime×N, Bedtime×N` runs, plus the list of assigned-dupe instance_ids. Use for "who's on which schedule?" / "what does Shift 30 look like?" questions.

### `oni_power()`
Power-related buildings grouped by category: `generators`, `consumers`, `transformers`. Each entry has `prefab_id` and instance count. For per-instance detail (current watts, battery charge), JOIN `buildings` with the `EnergyGenerator` / `EnergyConsumer` behaviors via `oni_query`.

### `oni_plants({ wiltingOnly?, readyOnly?, limit? })`
Every plant on the map (world_objects with a `Growing` behaviour) with `prefab_id`, position, wilting state, and harvest readiness. Use `wiltingOnly` for triage ("what's dying?") and `readyOnly` for "what's ready to harvest?" Species naming is the raw prefab_id (BristleBlossom, Mealwood, SwampLily, …); the catalog of human-readable names is a future Wave.

### `oni_germs({ minCount?, limit? })`
Objects with germ contamination (Slimelung, Food Poisoning, etc.). Unions across `buildings`, `world_objects`, and `storage_contents`, joined against the `diseases` lookup so the disease name is human-readable. Use for "where's my Slimelung?" and "what's contaminated?" questions. Default `minCount` is 1000 (below that germs are usually noise — bump down to surface low-level contamination).

### `oni_priorities()`
One row per (dupe, chore_group) pair where priority differs from the default (3). Returns `dupe_name`, `chore_group` (internal string), `label` (display name from the game UI), and `priority` (1-5). Use this for "which dupes are specialising in what" questions — much cheaper than chaining `oni_dupe` for every dupe. A missing `(dupe, group)` row means priority is at the default 3.

### `oni_query({ sql, params?, format? })`
SELECT-only escape hatch over the whole DB schema. Reject any non-SELECT statement; multiple statements aren't allowed either. **Caveat:** a trailing semicolon is silently stripped, but an interior semicolon anywhere in the string is rejected (so `WHERE name = ';'` will fail — avoid interior semicolons entirely). Use `format: "tsv"` for large tabular returns.

### Lookup tables

Six static tables resolve SimHash integers and short strings to human-readable values. Always JOIN against them when querying ID columns:

| Table | Key → value |
|-------|------------|
| `elements(element_id, name)` | SimHash → element name (Water, Algae, …) |
| `geyser_types(type_id, name, element, output_temp_c, yield_min_kg_cycle, yield_max_kg_cycle, lifetime_avg_kg_cycle, dlc, disease)` | SimHash → geyser name, produced resource, output temp, yield (kg/cycle) |
| `foods(prefab_id, name, kcal, morale)` | prefab → food display name + nutrition |
| `effects(effect, label, severity)` | effect string → readable label + severity |
| `skills(branch, label)` | branch prefix → display name |
| `chore_groups(hash, name, label, domain, abbr, sort_order)` | chore group → display label + FE styling metadata |
| `diseases(disease_id, name)` | SimHash → disease name (Slimelung, Food Poisoning, …) |

**Example — stored resources with readable names:**

```sql
SELECT en.name, ROUND(SUM(sc.units), 0) AS kg
FROM storage_contents sc
JOIN elements en ON en.element_id = sc.element_id
GROUP BY sc.element_id ORDER BY kg DESC LIMIT 10;
```

Without the JOIN, `element_id` returns raw integers like `1836671383` that the model cannot interpret.

### Schema crib for `oni_query`

| Table | Key columns |
|-------|-------------|
| `save_meta(key, value)` | parsed_at, source_file, baseName, numberOfCycles, numberOfDuplicants, saveVersion |
| `duplicants(game_object_id, name, gender, current_role, target_role, stress, calories, stamina, bladder, breath, hp, decor, immune, body_temperature)` | one per dupe |
| `duplicant_traits(duplicant_id, trait)` | join via `duplicants.game_object_id` |
| `duplicant_skills(duplicant_id, skill)` | mastered skills only |
| `duplicant_attributes(duplicant_id, attribute, level, experience)` | |
| `duplicant_effects(duplicant_id, effect, time_remaining)` | active status effects |
| `buildings(game_object_id, prefab_id, position_x, position_y, element_id, units, temperature, ...)` | placed structures only |
| `world_objects(...)` | loose stuff with mass/temp; same column shape as `buildings` |
| `storage_contents(owner_id, item_prefab_id, element_id, units, temperature, ...)` | items in a Storage behavior; `owner_id` joins to `buildings` or `world_objects` |
| `geysers(game_object_id, prefab_id, type_id, rate_roll, year_percent_roll, position_x, position_y, scaled_year_length_s, scaled_year_percent, ...)` | `scaled_year_length_s`/`scaled_year_percent` are the resolved per-instance dormancy-cycle length (seconds, ÷600 for days) and active %. No live "time until next eruption" — the save doesn't persist current cycle phase. |
| `critters(game_object_id, prefab_id, age, calories, hp, happiness, temperature, ...)` | hatches, dreckos, pufts, etc. + their eggs/babies |
| `behaviors(id, game_object_id, name, template_data, extra_data)` | generic fallback; `template_data` and `extra_data` are stringified JSON — use `json_extract(template_data, '$.field')` to drill in |

Convenience views: `v_resources_in_storage`, `v_world_objects_by_element`, `v_geysers_summary`, `v_buildings_by_prefab`.

## Patterns

**"How are my dupes doing?"**
1. `oni_status()` — usually answers the whole question in one call.
2. If the user wants per-dupe detail: `oni_dupe({ name })` for the worst-stressed one.
3. For a stress sweep over all dupes: `oni_dupes({ fields: ["name","stress","current_role"], format: "tsv" })`.

**"What geysers do I have?"**
1. `oni_geysers()` — group by type_id in your reply.
2. Caveat about roll percentiles vs. real kg/s.

**"How much algae do I have?"**
1. `oni_resources({ location: "both", limit: 50 })`, look for `Algae`.
2. Mention the storage-vs-floor split if relevant.

**"What food do I have?"**
1. `oni_food()` — returns stored food sorted by morale (best first), with name, kcal, morale, and qty.
2. Compute days per type: `days = (qty × kcal) / 1000 / dupe_count`. Present as "X.X days".
3. If the user wants a specific item: filter the results or ask follow-up.

**"What's my cycle?"**
1. `oni_save_meta()` — return cycle and base_name; that's a one-shot answer.

## Daily report — the authoritative per-cycle accounting

The game stores its own end-of-cycle report directly in the save file inside the `ReportManager` behavior. This is the **ground truth for per-cycle stats** — far more reliable than anything derived from building uptime data.

```sql
SELECT json_extract(template_data, '$.dailyReports[#-1]') AS last_report
FROM behaviors WHERE name = 'ReportManager' LIMIT 1
```

The report is a JSON object with `day` (cycle number) and `reportEntries` — an array of typed entries. Each entry has:
- `reportType` — integer identifying the stat (see table below)
- `accPositive` — total positive accumulation for the cycle (e.g. O₂ generated, kcal harvested)
- `accNegative` — total negative accumulation (e.g. O₂ consumed, kcal eaten)
- `accumulate` — net (`accPositive + accNegative`)
- `contextEntries.elements` — optional per-source breakdown (e.g. per-dupe O₂ consumption)

### Known reportType values

| reportType | Stat | Units | Notes |
|-----------|------|-------|-------|
| 1 | Calories | kcal (×1000 internally) | accPositive = harvested, accNegative = eaten |
| 2 | Stress | % | per-dupe in contextEntries |
| 4 | Skill points | points | per-dupe in contextEntries |
| 7 | Chore completions | count | broken down by chore type in contextEntries |
| 10 | Distance traveled (tiles) | tiles | per-dupe |
| 11 | Distance traveled (tiles) | tiles | per-dupe, second metric |
| 12 | Calories burned | kcal | per-dupe |
| 18 | **Oxygen** | **kg** | accPositive = generated, accNegative = consumed |
| 19 | Power | Wh | accPositive = generated, accNegative = consumed |
| 20 | Unknown loss | — | negative only |
| 22 | Critter count | count | broken down by species |

### Oxygen accounting (reportType 18) — key facts

- `accPositive` = total O₂ produced by **buildings** that cycle (Algae Deoxidizers, Deodorizers, Electrolyzers, etc.)
- `accNegative` = total O₂ consumed by dupes (per-dupe breakdown in `contextEntries`)
- **Oxylite sublimating from storage or debris is NOT counted** — only building output registers. This is a known Klei quirk (reported on the forums) and means the game's own "insufficient oxygen" warning can fire even with tons of Oxylite in bins.
- The production total has no per-building breakdown in the report — just one aggregate `accPositive`.

### Querying oxygen for the previous cycle

```sql
SELECT
  json_extract(e.value, '$.reportType')   AS report_type,
  json_extract(e.value, '$.accPositive')  AS produced_kg,
  json_extract(e.value, '$.accNegative')  AS consumed_kg,
  json_extract(e.value, '$.accumulate')   AS net_kg
FROM behaviors,
  json_each(json_extract(template_data, '$.dailyReports[#-1].reportEntries')) AS e
WHERE name = 'ReportManager'
  AND json_extract(e.value, '$.reportType') = 18
```

### Why not use building uptime (Operational.uptimeData)?

The `Operational` behavior on each building stores `uptimeData` — an array of 5 recent per-cycle uptime fractions (0..1). These can be used to estimate throughput: `uptime × rate_g_s × 600`. However, they significantly undercount actual production because:
1. The fractions track time the machine was *able* to run, not actual element output ticks
2. They misalign with cycle boundaries depending on when the save was written
3. They have no equivalent for natural sources (tile outgassing, etc.)

In practice, uptimeData estimates came in ~35–45% below the daily report figure. **Always prefer `ReportManager.dailyReports` for per-cycle production/consumption questions.**

### "How much oxygen did my colony produce last cycle?"

```sql
SELECT
  ROUND(json_extract(e.value, '$.accPositive'), 1) AS produced_kg,
  ROUND(ABS(json_extract(e.value, '$.accNegative')), 1) AS consumed_kg,
  ROUND(json_extract(e.value, '$.accumulate'), 1) AS net_kg
FROM behaviors,
  json_each(json_extract(template_data, '$.dailyReports[#-1].reportEntries')) AS e
WHERE name = 'ReportManager'
  AND json_extract(e.value, '$.reportType') = 18
```

## Error handling

If a tool returns `Error: oni-vision database not found...`, oni-vision hasn't run yet. Tell the user:

> Your oni-vision daemon hasn't produced any data yet. Run `npm start` in your oni-vision repo while ONI is open, save the game, then ask again.

Don't keep retrying.
