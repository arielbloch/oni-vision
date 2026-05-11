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

### `oni_query({ sql, params?, format? })`
SELECT-only escape hatch over the whole DB schema. Reject any non-SELECT statement; multiple statements aren't allowed either. Use `format: "tsv"` for large tabular returns.

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
| `geysers(game_object_id, prefab_id, type_id, rate_roll, year_percent_roll, position_x, position_y, ...)` | |
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

**"What's my cycle?"**
1. `oni_save_meta()` — return cycle and base_name; that's a one-shot answer.

## Error handling

If a tool returns `Error: oni-vision database not found...`, oni-vision hasn't run yet. Tell the user:

> Your oni-vision daemon hasn't produced any data yet. Run `npm start` in your oni-vision repo while ONI is open, save the game, then ask again.

Don't keep retrying.
