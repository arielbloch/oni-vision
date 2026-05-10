# oni-watcher

A small daemon that watches your **Oxygen Not Included** save folder, parses the latest `.sav` file, and writes a SQLite database (plus a JSON sidecar) that **Claude Code** can query token-efficiently.

Based on https://github.com/RoboPhred/oni-save-parser

## Requirements

- Node.js **22.5+** (uses the built-in `node:sqlite` module — no native compilation, no `better-sqlite3`).
- macOS, Linux, or Windows. See *Configuration* below for the per-platform save path.

## Install

```bash
cd oni-watcher
npm install
```

## Configuration

**The first run usually needs no config.** On startup, if no config file is present, the watcher probes a list of well-known locations for a `cloud_save_files` or `save_files` folder containing a `.sav`, and picks the most recent one. You'll see a line like:

```
[watcher] auto-detected save dir: /Users/you/Library/Application Support/unity.Klei.Oxygen Not Included/abc123/save_files
[watcher]   newest save: .../my_colony.sav (2026-05-09T17:32:11.000Z)
```

If discovery finds nothing, the daemon prints the candidate paths it tried and falls back to the platform default. At that point you'll want a config file.

The watcher reads a single JSON config file. Drop one at `~/.oni-watcher/config.json` (preferred) or `~/.config/oni-watcher/config.json`. All keys are optional; missing keys fall back to platform defaults from `src/paths.js`. There is **no env-var override** — if you want a non-default value, put it in the file.

A pre-configured example lives at [`.config-example.json`](.config-example.json). To use it: copy, then replace `<USERNAME>` with your home folder name.

```bash
mkdir -p ~/.oni-watcher
cp .config-example.json ~/.oni-watcher/config.json
$EDITOR ~/.oni-watcher/config.json
```

The full sample (a copy of `.config-example.json`):

```json
{
  "_comment": "Copy this file to ~/.oni-watcher/config.json (or ~/.config/oni-watcher/config.json) and edit. All keys are optional — any you omit fall back to the platform defaults in src/paths.js. JSON has no comments, so keys starting with '_' are documentation and are ignored at runtime.",

  "_comment_saveDir": "Path to ONI's save_files directory. Recent Steam installs on macOS use the unity.Klei path below — replace <USERNAME> with your home folder name. Older Klei installs on macOS use ~/Library/Application Support/Klei/OxygenNotIncluded/save_files. Windows: %USERPROFILE%/Documents/Klei/OxygenNotIncluded/save_files. Linux: ~/.config/unity3d/Klei/Oxygen Not Included/save_files.",
  "saveDir": "/Users/<USERNAME>/Library/Application Support/unity.Klei.Oxygen Not Included",

  "_comment_outputDir": "Where current.sqlite, current.json, and current.sav land. Defaults to ~/.oni-watcher/output, which is fine for most setups. Override only if you want the parsed outputs somewhere else (a project folder, a synced drive, etc.). Path must be absolute.",
  "outputDir": "/Users/<USERNAME>/.oni-watcher/output",

  "_comment_includeAutoSaves": "If true, the watcher reparses every auto_save (ONI auto-saves every cycle by default — that's noisy). Default false: only manual saves trigger a reparse.",
  "includeAutoSaves": false,

  "_comment_debounceMs": "How long to wait (ms) after the last write to a .sav file before reparsing. Stops us from racing the game while it's still writing. Default 1500 ms is comfortable for save files up to ~10 MB; bump it if you see truncated-file parse errors.",
  "debounceMs": 1500
}
```

Key reference:

| Key                | Type    | Default                                                              |
|--------------------|---------|----------------------------------------------------------------------|
| `saveDir`          | string  | platform-dependent — see *Save path by platform* below               |
| `outputDir`        | string  | `~/.oni-watcher/output`                                              |
| `includeAutoSaves` | boolean | `false` (skip files under `auto_save/`)                              |
| `debounceMs`       | number  | `1500` (wait this long after the last write before parsing)          |

**Save path by platform:**
- macOS (recent Steam installs, all users): `/Users/<USERNAME>/Library/Application Support/unity.Klei.Oxygen Not Included`
- macOS (older Klei layout): `~/Library/Application Support/Klei/OxygenNotIncluded/save_files`
- Windows: `%USERPROFILE%/Documents/Klei/OxygenNotIncluded/save_files/`
- Linux: `~/.config/unity3d/Klei/Oxygen Not Included/save_files/`

## Run the watcher

```bash
npm start
```

You'll see something like:

```
[watcher] save dir:   /Users/you/Library/Application Support/Klei/OxygenNotIncluded/save_files
[watcher] output dir: /Users/you/.oni-watcher/output
[watcher] (startup) latest save: .../my_colony.sav (3.81 MB)
[pipeline]   parsed in 480 ms (cycle 312, dupes 12)
[pipeline]   extracted 184302 rows across 14 tables in 220 ms
[pipeline]   wrote outputs to /Users/you/.oni-watcher/output in 410 ms (total 1110 ms)
[watcher] running. Ctrl-C to stop.
```

Now, every time the game saves (manual or auto if you opt in), the watcher re-parses and overwrites `current.sqlite` and `current.json` atomically.

## One-shot mode

If you don't want a daemon:

```bash
npm run parse                         # parse the newest .sav under saveDir
node src/parse-once.js path/to.sav    # parse a specific file
```

## Quick status

After a parse has happened (daemon or one-shot), `npm run status` prints a human-readable snapshot of the colony — base name, cycle, dupe stress bars, geyser breakdown, top stored elements:

```bash
npm run status
```

```
═══ Cosmic Conundrum · cycle 312 ═══════════════════════════════════════

12 duplicants · 4 critters · 7 geysers · 184 buildings
Parsed 23s ago from my_colony.sav

Geysers
  steam                    ×2   chlorine_vent           ×1   …

Stockpile (top elements by mass)
  Algae               12.4 Tkg   in 8 places
  Water                8.3 Tkg   in 3 places
  …

Dupes (sorted by stress)
  Meep         ████████░░ 76.0%   Digger
  Stinky       ███░░░░░░░ 32.0%   Chef
  …
```

The daemon prints the same block automatically after every save.

## Where output lands

```
~/.oni-watcher/output/
├── current.sqlite     # query this
├── current.json       # header / settings / non-tabular bits
└── current.sav        # copy of the parsed source save (handy for re-runs)
```

## Tests and smoke run

The regression test suite uses Node's built-in test runner against a hand-built fake save in `test/fixture.js`:

```bash
npm test
```

It covers extractor classification (dupes vs critters vs buildings vs world objects), schema-shape consistency between extractors and `db.js`, and end-to-end DB queries.

For a human-readable look at what the extractor produces, `npm run smoke` runs the same fixture through the pipeline and prints row counts plus a handful of representative queries.

Both run in CI on every push (see `.github/workflows/ci.yml`).

## Querying from Claude Code

Two paths, depending on how heavyweight you want to go:

**Drop-in `CLAUDE.md` (lightweight).** Drop the contents of `CLAUDE.md` into your project's `CLAUDE.md` (or somewhere Claude reads). It tells Claude where the DB lives and how to query it raw via the `sqlite3` CLI:

```bash
sqlite3 ~/.oni-watcher/output/current.sqlite \
  "SELECT name, stress, calories FROM duplicants ORDER BY stress DESC"
```

```bash
sqlite3 ~/.oni-watcher/output/current.sqlite \
  "SELECT type_id, COUNT(*) FROM geysers GROUP BY type_id"
```

**MCP plugin (full-fat).** [`oni-watcher-plugin/`](./oni-watcher-plugin) is a Claude Code / Cowork plugin that wraps this DB behind an MCP server. Six typed tools (`oni_save_meta`, `oni_freshness`, `oni_dupes`, `oni_geysers`, `oni_resources`) plus a SELECT-only `oni_query` escape hatch, plus a SKILL.md that teaches the model when to reach for which tool. Read-only, single-statement-only, no need to write SQL by hand. See the plugin's own README for install instructions.

## Schema overview

Specialized tables (use these first — they're indexed and ergonomic):

| Table                    | What                                                                       |
|--------------------------|----------------------------------------------------------------------------|
| `save_meta`              | Cycle, base name, dupe count, save version, **plus `parsed_at` and `source_file`** for staleness checks. Key/value pairs. |
| `duplicants`             | One row per dupe — name, gender, role, stress/calories/HP/breath/...       |
| `duplicant_traits`       | dupe → trait id (e.g. `Trait_Sociable`).                                   |
| `duplicant_skills`       | dupe → mastered skill id.                                                  |
| `duplicant_attributes`   | dupe → attribute level + experience.                                       |
| `duplicant_effects`      | dupe → status effect id + time remaining.                                  |
| `duplicant_amounts`      | dupe → every "amount" (Stress, Calories, ...) in case you want raw access. |
| `buildings`              | **Placed structures only** (objects with a `BuildingComplete` behavior). Element, units (mass), temperature. |
| `world_objects`          | Loose stuff with mass/temp — debris, food, plants, eggs, raw materials lying on the map. Same column shape as `buildings`. |
| `storage_contents`       | Items inside a `buildings`/`world_objects` row's `Storage` behavior. `owner_id` joins to either table's `game_object_id`. |
| `geysers`                | All geyser/vent/volcano objects. Classification is by the `Geyser` behavior, not prefab name, so volcanoes and DLC variants are caught too. **Note: `*_roll` columns are 0–1 percentiles, not kg/s** — resolving to actual rates requires the library's geyser const-data. |
| `critters`               | Anything that has a `MinionModifiers` behavior and isn't a Minion — covers all critter species, eggs, and babies, including ones added in future updates. |

Generic fallback (full faith access to anything the parser understands):

| Table          | What                                                                              |
|----------------|-----------------------------------------------------------------------------------|
| `object_groups`| One row per prefab type with a count.                                             |
| `game_objects` | One row per game object with position/scale/folder.                               |
| `behaviors`    | One row per behavior; `template_data` and `extra_data` are stringified JSON.      |

Convenience views:

- `v_resources_in_storage` — element_id → item count + total units across all storage.
- `v_world_objects_by_element` — element_id → loose-pile count + total units lying on the map.
- `v_geysers_summary` — geyser type → count.
- `v_buildings_by_prefab` — prefab → building count.

Print the live schema:

```bash
sqlite3 ~/.oni-watcher/output/current.sqlite ".schema"
```

## Caveats

- `oni-save-parser@14.x` should handle recent ONI saves, but the upstream README is stale (still mentions Automation Innovation, save 7.17). If a brand-new ONI patch breaks parsing, file an issue at https://github.com/RoboPhred/oni-save-parser and bump the package once it's released.
- Tile/element-by-cell map data is not exposed in tabular form — that's millions of cells. Material/temperature questions about the *map* go through `current.json`'s world section; questions about *placed buildings* go through the `buildings` table; questions about *loose debris and resources* go through `world_objects`.
- The `behaviors.template_data` and `behaviors.extra_data` columns are stringified JSON. Prefer the typed tables when they cover what you need; reach for `json_extract(template_data, '$.field')` for fields the typed tables don't lift.
- Geyser output is exposed as the *configuration rolls* (0–1 percentiles), not resolved kg/s rates. Computing actual rates requires looking up the geyser type's base ranges from the library's const-data; not done here yet.
- DLC content like rockets, planetoids, and clusters (Spaced Out) is reachable through the generic `behaviors` table but does not have its own typed extractor.

## Project layout

```
oni-watcher/
├── src/
│   ├── index.js         # daemon entry (chokidar watcher inline)
│   ├── parse-once.js    # one-shot parse CLI
│   ├── pipeline.js      # parse → extract → write (atomic rename for all outputs)
│   ├── parser.js        # wraps oni-save-parser
│   ├── extractors.js    # SaveGame → row arrays (uses behavior constants from oni-save-parser)
│   ├── db.js            # node:sqlite schema + bulk insert via named-parameter binding
│   ├── find-latest.js   # newest .sav in tree
│   ├── discover.js      # zero-config save-dir auto-detection
│   ├── paths.js         # platform-aware defaults + user config + discovery fallback
│   ├── ui.js            # human-readable status renderer
│   ├── utils.js         # shared JSON serialization helpers
│   └── cli/
│       └── status.js    # `npm run status` entry point
├── test/
│   ├── fixture.js       # synthetic SaveGame used by tests + smoke run
│   ├── discover.test.js
│   ├── extractors.test.js
│   ├── db.test.js
│   └── ui.test.js
├── .github/workflows/ci.yml
├── smoke.mjs            # human-friendly demo run
├── config.example.json
├── CLAUDE.md
├── LICENSE              # MIT
├── README.md
└── package.json
```

## License

MIT — see `LICENSE`.
