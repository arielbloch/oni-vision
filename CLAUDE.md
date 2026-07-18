# Oxygen Not Included save data

Parsed save data lives at `~/.oni-vision/output/current.sqlite` (a SQLite DB) with a `current.json` sidecar in the same directory for non-tabular bits. The `oni-vision` daemon refreshes both files atomically every time the game writes a save. Always prefer SQL queries over reading the JSON.

## Querying

Use the `sqlite3` CLI (preinstalled on macOS). Paths in your output are stable; you do not need to confirm them every turn.

```bash
sqlite3 ~/.oni-vision/output/current.sqlite "SELECT ..."
```

For one-off ad-hoc questions, prefer narrow projections (`SELECT col1, col2`) and aggregations (`COUNT/SUM/AVG`) over `SELECT *`. SQLite's output mode `-json` or `-csv` is helpful when you want to feed results back into reasoning.

## Tables you'll reach for first

- `save_meta(key, value)` — cycle count, base name, dupe count, save version, plus `parsed_at` (ISO timestamp of last parse), `source_file` (which `.sav` was parsed), and `worldWidth`/`worldHeight` (map size in cells — divide `position_x`/`position_y` by these to get percent-of-map). `SELECT key, value FROM save_meta` is a good first move; check `parsed_at` if you suspect the data is stale.
- `duplicants(game_object_id, name, gender, current_role, stress, calories, stamina, breath, hp, decor, immune, body_temperature, ...)` — one row per dupe.
- `duplicant_traits(duplicant_id, trait)` — join to `duplicants.game_object_id`.
- `duplicant_skills(duplicant_id, skill)` — mastered skills only.
- `duplicant_attributes(duplicant_id, attribute, level, experience)`.
- `duplicant_effects(duplicant_id, effect, time_remaining)` — active status effects.
- `buildings(game_object_id, prefab_id, position_x, position_y, element_id, units, temperature, ...)` — **placed structures only** (objects with `BuildingComplete`). Querying counts here gives you "how many of building X exist", not polluted by debris. The printing pod is `prefab_id = 'Headquarters'`, not anything containing "pod"/"telepad" — it's gone from this table if the player deconstructed it.
- `world_objects(game_object_id, prefab_id, ...)` — same column shape as `buildings`. Loose stuff lying on the map: dropped resources, food items, plants, eggs, raw materials. Reach for this when the user asks about *resources on the floor* or *plants*; reach for `buildings` when they ask about *what they've built*.
- `storage_contents(owner_id, item_prefab_id, element_id, units, temperature, ...)` — items inside a building's or world object's `Storage` behavior. `owner_id` joins to either `buildings.game_object_id` or `world_objects.game_object_id`.
- `geysers(game_object_id, prefab_id, type_id, rate_roll, year_percent_roll, position_x, position_y, scaled_year_length_s, scaled_year_percent, ...)`. **The `*_roll` columns are 0–1 percentiles, not kg/s.** Don't quote them as flow rates. `scaled_year_length_s`/`scaled_year_percent` are the game's own resolved per-instance dormancy-cycle stats (length in seconds, % active) — divide `scaled_year_length_s` by 600 for days. There's no persisted field for *where* a geyser currently sits in that cycle, so don't try to derive a live "time until next eruption."
- `critters(game_object_id, prefab_id, age, calories, hp, happiness, temperature, ...)`.

## Generic fallback

If you need data that isn't lifted into a typed table, query `behaviors`:

```sql
SELECT name, template_data
FROM behaviors
WHERE game_object_id = ? AND name = 'SomeBehaviorName';
```

`template_data` and `extra_data` are stringified JSON; use SQLite's `json_extract(template_data, '$.fieldName')` to pull out specific fields without parsing in your head:

```sql
-- example: every BuildingComplete object's construction-related fields
SELECT b.game_object_id,
       json_extract(b.template_data, '$.builderName') AS built_by
FROM behaviors b
WHERE b.name = 'BuildingComplete'
LIMIT 20;
```

## Useful starting queries

```sql
-- High-level: cycle, dupe count, base name
SELECT key, value FROM save_meta WHERE key IN ('numberOfCycles','numberOfDuplicants','baseName');

-- Dupes ranked by stress
SELECT name, ROUND(stress,1) AS stress, current_role
FROM duplicants
ORDER BY stress DESC;

-- Geysers on the asteroid, with resource produced and expected yield
SELECT gt.name, gt.element, gt.lifetime_avg_kg_cycle, g.position_x, g.position_y
FROM geysers g
JOIN geyser_types gt ON gt.type_id = g.type_id
ORDER BY gt.name;

-- Total stored mass per element (inside containers)
SELECT element_id, ROUND(SUM(units),0) AS total_units, COUNT(*) AS items
FROM storage_contents
WHERE element_id IS NOT NULL
GROUP BY element_id
ORDER BY total_units DESC
LIMIT 20;

-- Loose materials lying around the map (NOT in storage)
SELECT element_id, ROUND(SUM(units),0) AS total_units, COUNT(*) AS piles
FROM world_objects
WHERE element_id IS NOT NULL
GROUP BY element_id
ORDER BY total_units DESC
LIMIT 20;

-- Placed building counts by type
SELECT prefab_id, COUNT(*) AS n FROM buildings GROUP BY prefab_id ORDER BY n DESC LIMIT 30;

-- Is the parsed data fresh?
SELECT value AS parsed_at FROM save_meta WHERE key = 'parsed_at';

-- A specific dupe's traits + skills
SELECT trait FROM duplicant_traits  WHERE duplicant_id = (SELECT game_object_id FROM duplicants WHERE name='Meep');
SELECT skill  FROM duplicant_skills WHERE duplicant_id = (SELECT game_object_id FROM duplicants WHERE name='Meep');
```

## Lookup tables

Seven static tables written once per parse let you resolve SimHash integers to human-readable names in any query:

| Table | Key column | Name column | Use for |
|-------|-----------|-------------|---------|
| `elements(element_id, name)` | `element_id` (INTEGER) | `name` | elements in `world_objects`, `storage_contents`, `buildings` |
| `geyser_types(type_id, name, element, output_temp_c, yield_min_kg_cycle, yield_max_kg_cycle, lifetime_avg_kg_cycle, dlc, disease)` | `type_id` (INTEGER) | `name`, `element` | geysers — `element` is the resource produced, `lifetime_avg_kg_cycle` is the long-run average output |
| `foods(prefab_id, name, kcal, morale)` | `prefab_id` (TEXT) | `name` | food in `storage_contents` |
| `effects(effect, label, severity)` | `effect` (TEXT) | `label` | dupe status effects |
| `skills(branch, label)` | `branch` (TEXT) | `label` | skill branches |
| `chore_groups(hash, name, label, domain, abbr, sort_order)` | `name` (TEXT) | `label` | chore priorities |
| `diseases(disease_id, name)` | `disease_id` (INTEGER) | `name` | disease SimHashes on `world_objects`, `storage_contents`, `buildings` |

`duplicant_priorities(duplicant_id, chore_group, priority)` is a data table (not a lookup) — join it with `chore_groups` to see each dupe's task priorities, or filter `WHERE priority >= 5` to find boosted roles.

**Example — elements by mass with human-readable names:**

```sql
SELECT en.name, ROUND(SUM(sc.units), 0) AS total_kg
FROM storage_contents sc
JOIN elements en ON en.element_id = sc.element_id
GROUP BY sc.element_id
ORDER BY total_kg DESC
LIMIT 10;
```

Without the JOIN you get raw SimHash integers like `1836671383` (= Water). Always JOIN against the lookup table for readable output.

## When to fall back to JSON

`current.json` has the save header (`gameInfo` — cycle, base name, version), `settings` (game/sandbox state), and a stripped `gameData` (with the giant binary blobs replaced by markers). Read it only when the question is clearly about save metadata or game settings.

## When oni-vision isn't running

If the file is stale or missing, ask the user to start it: `npm start` from the `oni-vision/` directory. For a one-off parse without the daemon: `npm run parse`.
