# Oxygen Not Included save data

Parsed save data lives at `~/.oni-watcher/output/current.sqlite` (a SQLite DB) with a `current.json` sidecar in the same directory for non-tabular bits. The `oni-watcher` daemon refreshes both files atomically every time the game writes a save. Always prefer SQL queries over reading the JSON.

## Querying

Use the `sqlite3` CLI (preinstalled on macOS). Paths in your output are stable; you do not need to confirm them every turn.

```bash
sqlite3 ~/.oni-watcher/output/current.sqlite "SELECT ..."
```

For one-off ad-hoc questions, prefer narrow projections (`SELECT col1, col2`) and aggregations (`COUNT/SUM/AVG`) over `SELECT *`. SQLite's output mode `-json` or `-csv` is helpful when you want to feed results back into reasoning.

## Tables you'll reach for first

- `save_meta(key, value)` — cycle count, base name, dupe count, save version. `SELECT key, value FROM save_meta` is a good first move.
- `duplicants(game_object_id, name, gender, current_role, stress, calories, stamina, breath, hp, decor, immune, body_temperature, ...)` — one row per dupe.
- `duplicant_traits(duplicant_id, trait)` — join to `duplicants.game_object_id`.
- `duplicant_skills(duplicant_id, skill)` — mastered skills only.
- `duplicant_attributes(duplicant_id, attribute, level, experience)`.
- `duplicant_effects(duplicant_id, effect, time_remaining)` — active status effects.
- `buildings(game_object_id, prefab_id, position_x, position_y, element_id, units, temperature, ...)` — every placed object with a `PrimaryElement`.
- `storage_contents(building_id, item_prefab_id, element_id, units, temperature, ...)` — inventories.
- `geysers(game_object_id, prefab_id, type_id, rate_roll, year_percent_roll, position_x, position_y, ...)`.
- `critters(game_object_id, prefab_id, age, calories, hp, happiness, temperature, ...)`.

## Generic fallback

If you need data that isn't lifted into a typed table, query `behaviors`:

```sql
SELECT name, template_data
FROM behaviors
WHERE game_object_id = ? AND name = 'SomeBehaviorName';
```

`template_data` and `extra_data` are stringified JSON; use SQLite's `json_extract(template_data, '$.fieldName')` to reach into them.

## Useful starting queries

```sql
-- High-level: cycle, dupe count, base name
SELECT key, value FROM save_meta WHERE key IN ('numberOfCycles','numberOfDuplicants','baseName');

-- Dupes ranked by stress
SELECT name, ROUND(stress,1) AS stress, current_role
FROM duplicants
ORDER BY stress DESC;

-- Geysers on the asteroid
SELECT type_id, position_x, position_y FROM geysers ORDER BY type_id;

-- Total stored mass per element
SELECT element_id, ROUND(SUM(units),0) AS total_units, COUNT(*) AS items
FROM storage_contents
WHERE element_id IS NOT NULL
GROUP BY element_id
ORDER BY total_units DESC
LIMIT 20;

-- Building counts by type
SELECT prefab_id, COUNT(*) AS n FROM buildings GROUP BY prefab_id ORDER BY n DESC LIMIT 30;

-- A specific dupe's traits + skills
SELECT trait FROM duplicant_traits  WHERE duplicant_id = (SELECT game_object_id FROM duplicants WHERE name='Meep');
SELECT skill  FROM duplicant_skills WHERE duplicant_id = (SELECT game_object_id FROM duplicants WHERE name='Meep');
```

## When to fall back to JSON

`current.json` has the save header (`gameInfo` — cycle, base name, version), `settings` (game/sandbox state), and a stripped `gameData` (with the giant binary blobs replaced by markers). Read it only when the question is clearly about save metadata or game settings.

## When the watcher isn't running

If the file is stale or missing, ask the user to start it: `npm start` from the `oni-watcher/` directory. For a one-off parse without the daemon: `npm run parse`.
