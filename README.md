# oni-watcher

A small Node.js daemon that watches your **Oxygen Not Included** save folder, parses the latest `.sav` file, and writes a SQLite database (plus a JSON sidecar) that Claude — or any tool that speaks SQL — can query token-efficiently.

A 4 MB ONI save expands to 30–80 MB of JSON. Reading that into Claude's context is wasteful; a focused SQL query against the same data is ~200 tokens. That's what this tool exists to do.

## Acknowledgment

Save-file decoding is done by [`oni-save-parser`](https://github.com/RoboPhred/oni-save-parser) by RoboPhred — `oni-watcher` is a watcher + extractor + SQLite writer sitting on top of it. None of the binary-format reverse engineering is mine. If parsing breaks on a brand-new ONI patch, the fix usually lives there first.

## Features

- **Zero-config startup.** Probes per-platform well-known locations for `cloud_save_files` / `save_files` and picks the most-recent `.sav`. No setup file required for typical Steam-on-Mac/Windows/Linux installs.
- **Atomic refresh.** Every save event reparses and atomically renames `current.sqlite`, `current.json`, and `current.sav` into place — readers never see a half-written file.
- **One DB schema, indexed for the common questions.** Typed tables for duplicants (plus traits/skills/attributes/effects), buildings, world objects, storage contents, geysers, critters; plus a generic-fallback `behaviors` table with stringified JSON for anything we haven't lifted.
- **Cross-platform.** macOS (recent Steam + older Klei layouts), Windows, Linux.
- **Human-readable status.** `npm run status` prints a one-screen snapshot (cycle, dupe stress bars, geyser breakdown, top stored elements). The daemon prints the same block after every save.
- **Claude Code / Cowork plugin.** [`oni-watcher-plugin/`](./oni-watcher-plugin) ships an MCP server with typed read-only tools (`oni_status`, `oni_dupe`, `oni_dupes`, `oni_geysers`, `oni_resources`, `oni_save_meta`, `oni_freshness`, `oni_schema`, `oni_query`) plus two skills: `oni-watcher` (data access) and `oni-architect` (ONI strategy / design advice grounded in your actual save). Responses default to compact JSON; tabular tools support `format: "tsv"` for further token savings.
- **No native compilation.** Uses Node 22.5+'s built-in `node:sqlite` module — no `better-sqlite3`, no rebuild on `nvm install`.
- **Tested.** ~107 tests across the main project and plugin, run on Node 22.x and 24.x in CI.
- **MIT licensed.**

## Requirements

- Node.js **22.5 or newer** (for built-in `node:sqlite`).
- macOS, Linux, or Windows.

## Build

```bash
git clone git@github.com:ArielBloch/oni-watcher.git
cd oni-watcher
npm install
```

There's no compile step — the project is plain JavaScript ESM.

## Use

**Run as a daemon.** Reparses every time the game saves:

```bash
npm start
```

You'll see something like:

```
[watcher] auto-detected save dir: /Users/you/Library/Application Support/unity.Klei.Oxygen Not Included/abc123/save_files
[watcher]   newest save: my_colony.sav (2026-05-09T17:32:11.000Z)
[pipeline] parsed in 480 ms (cycle 312, dupes 12)
[pipeline]   extracted 184302 rows across 14 tables
[pipeline]   wrote outputs to ~/.oni-watcher/output in 410 ms

═══ Cosmic Conundrum · cycle 312 ════════════════════════════════════════
12 duplicants · 4 critters · 7 geysers · 184 buildings
Parsed 0s ago from my_colony.sav
…
```

**One-shot parse.** No daemon, just reparse the latest save once:

```bash
npm run parse                         # newest .sav under saveDir
node src/parse-once.js path/to.sav    # a specific file
```

**Print the colony status.** Reads the already-parsed SQLite — does not reparse:

```bash
npm run status
```

**Query from the shell.** Output lives at `~/.oni-watcher/output/`:

```bash
sqlite3 ~/.oni-watcher/output/current.sqlite \
  "SELECT name, ROUND(stress,1) AS stress, current_role FROM duplicants ORDER BY stress DESC"
```

**Query from Claude.** Two integration paths:

- **Lightweight.** Drop the contents of [`CLAUDE.md`](./CLAUDE.md) into your project's `CLAUDE.md`. Claude then writes raw `sqlite3` queries against the DB.
- **Full-fat.** Install the [`oni-watcher-plugin/`](./oni-watcher-plugin) into Claude Code or Cowork. Typed read-only tools + skills, no raw SQL needed for typical questions. See the plugin's own README.

## Configuration

Most users don't need any. If you do — to override the save folder or the output location — drop a JSON config file at one of:

- `~/.oni-watcher/config.json` (preferred), or
- `~/.config/oni-watcher/config.json`

Copy and edit the pre-configured sample at [`.config-example.json`](./.config-example.json):

```bash
mkdir -p ~/.oni-watcher
cp .config-example.json ~/.oni-watcher/config.json
$EDITOR ~/.oni-watcher/config.json   # replace <USERNAME> etc.
```

Keys: `saveDir` (string), `outputDir` (string, default `~/.oni-watcher/output`), `includeAutoSaves` (boolean, default `false`), `debounceMs` (number, default `1500`). All are optional; missing keys fall back to platform defaults. There is no env-var override — config file is the only knob.

## Output

```
~/.oni-watcher/output/
├── current.sqlite     # query this
├── current.json       # header / settings / non-tabular bits
└── current.sav        # copy of the parsed source save
```

For a full schema description (tables, indexes, convenience views) see [`CLAUDE.md`](./CLAUDE.md).

## Tests

```bash
npm test          # full suite: extractors, db, discovery, ui, utils, plugin queries
npm run smoke     # human-readable run against a synthetic fake save
```

CI runs `npm ci && npm test` on Node 22.x and 24.x for every push.

## Caveats

- Tile/element-by-cell map data is not exposed in tabular form — that's millions of cells. Use `current.json`'s world section, or the `buildings` / `world_objects` tables for material/temperature questions on placed objects.
- Geyser output is exposed as the *configuration rolls* (0–1 percentiles), not resolved kg/s rates. Resolving requires the library's geyser const-data; not lifted yet. See `oni-watcher-plugin/skills/oni-architect/references/geysers.md` for the formula.
- DLC content (rockets, planetoids, clusters) is reachable through the generic `behaviors` table but doesn't yet have its own typed extractor.
- If parsing fails on a brand-new ONI patch, the fix typically lands in [`oni-save-parser`](https://github.com/RoboPhred/oni-save-parser) first; bump the dependency once it's released.

## License

MIT — see [`LICENSE`](./LICENSE). The bundled `oni-save-parser` dependency is also MIT-licensed.
