# oni-watcher — feature plan

This document is the design north star for the next round of features after Wave 5 (config-file-only). Each section is a self-contained mini-design: what we want, the rough shape of the solution, what ships, and what we still need to decide. Pick them up in any order; #1 is the natural next step because it pays off for every other feature.

## 1. Zero-config save-dir discovery

### Goal
A first-time user should be able to run `npm start` with no config file and have the watcher figure out which save folder to watch. No copy-paste from the README, no `<USERNAME>` substitution. If we find a save, we use it; if we find none, we print a clear error with the candidate paths we tried.

### What to probe
The save-files directory varies by platform, by Steam vs. standalone, by Cloud Save vs. local, and by ONI patch. Modern installs have either `save_files` (local) or `cloud_save_files` (Steam Cloud sync) under one of these roots, depending on the install:

**macOS**
- `~/Library/Application Support/unity.Klei.Oxygen Not Included/<colony-id>/` (recent Steam)
- `~/Library/Application Support/Klei/OxygenNotIncluded/` (older Klei layout)

**Windows**
- `%USERPROFILE%/Documents/Klei/OxygenNotIncluded/`
- `%LOCALAPPDATA%/Klei/Oxygen Not Included/`

**Linux**
- `~/.config/unity3d/Klei/Oxygen Not Included/`
- `~/.local/share/Klei/Oxygen Not Included/`

For each root we look for two child folder names: `cloud_save_files` first (Steam Cloud is more likely up-to-date), then `save_files`. If both exist, prefer whichever has the more-recent `.sav`.

### Algorithm
1. Build the candidate-roots list for the current `process.platform`.
2. For each root, recursively look for any folder named `cloud_save_files` or `save_files` (depth-limited; we don't want to crawl the whole `~/Library`).
3. For each match, run `findLatestSave()` (we already have it) on the folder.
4. Pick the candidate with the most-recent `.sav`. That's our `saveDir`.
5. If we found nothing, fail with a list of every path we probed and a one-liner pointing at `.config-example.json`.

### Deliverables
- `src/discover.js` — the probing logic, pure function, takes a list of roots, returns `{saveDir, sourceFile, mtimeMs} | null`.
- `src/paths.js` — when `loadUserConfig()` returns no `saveDir`, fall back to discovery before returning the platform default.
- `src/index.js` — log "auto-detected save dir: …" or "no save dir found, tried: …" instead of the current FATAL.
- New tests in `test/discover.test.js` — fixture filesystems via `mkdtempSync` to assert the prefer-newer and prefer-cloud logic.

### Open questions
- Should we cache the discovered dir somewhere so we don't re-probe every startup? Probably not — it's cheap, and the source of truth changes if you reinstall.
- Should we surface the auto-detected path back into `~/.oni-watcher/config.json` automatically? My instinct is no — magical config-rewriting is surprising. Better to print "to lock this in, copy to ~/.oni-watcher/config.json" and let the user decide.

---

## 2. UX: world summary

### Goal
Right now `npm start` prints log lines. After "wrote outputs" we should print a human-readable snapshot of the parsed save: the world name, cycle, dupe count, top stressors, geyser types, etc. The same view should be available as a one-shot CLI (`npm run status`) that reads `current.sqlite` without re-parsing.

### Layout (rough)

```
═══ Cosmic Conundrum · cycle 312 ═══

12 duplicants · 4 critters · 7 geysers
Hottest: Meep (calories 4000, stress 12.5%)

Geysers
  steam ×2          Cool Steam Vent x1          Hydrogen Vent x1
  Chlorine Vent x1  Oil Reservoir x1            Salt Water Geyser x1

Stockpile (top elements by mass)
  Algae        12,400 kg   in 8 piles
  Water         8,250 kg   in 3 reservoirs
  Sandstone     4,100 kg   in 12 piles

Dupes (sorted by stress)
  Meep        ████████░░ 12.5%   Digger
  Stinky      ███░░░░░░░  4.0%   Chef
  Liam        ░░░░░░░░░░  0.0%   Operator
  …
```

### Deliverables
- `src/ui.js` — pure formatting functions, take a SQLite handle and a width hint, return strings.
- `src/cli/status.js` — entry point for `npm run status`; opens `~/.oni-watcher/output/current.sqlite` (or a `--db` arg), invokes `ui.render(db)`, prints.
- `src/pipeline.js` — at the end of `buildOutputs`, print the same summary so the daemon shows it after every save.
- `package.json` — add `"status": "node --no-warnings=ExperimentalWarning src/cli/status.js"`.
- Tests under `test/ui.test.js` — snapshot the rendered text against the FAKE_SAVE fixture.

### Width / color
- 80-col safe by default. `process.stdout.columns` if a TTY.
- Colors only when `stdout.isTTY` is truthy and `NO_COLOR` is not set.
- ASCII-only blocks for the bars (`█░`) — no nerd-font emoji.

### Later (interactive)
A second pass turns the static print into a `blessed` or `ink`-driven TUI: arrow-key navigation between dupes, sort-by-column, filter geysers by type, export selection to clipboard. Out of scope for the first cut.

---

## 3. MCP plugin for Claude Code / Cowork

### Goal
Ship oni-watcher as a Claude plugin so any Claude session (Cowork or Claude Code) can answer "what's going on in my colony" without the user manually piping `sqlite3` queries. The plugin bundles an MCP server that exposes typed tools and a SKILL.md that teaches the model how to use them.

### Plugin contents

```
oni-watcher-plugin/
├── plugin.json                # plugin manifest (name, version, author, mcps[], skills[])
├── mcp/
│   └── server.js              # node MCP server (tools below)
├── skills/
│   └── oni-watcher/
│       └── SKILL.md           # how-to for the model
└── README.md
```

### MCP tools (first cut)

- `oni_status()` → world summary block (same content as `npm run status`).
- `oni_query({sql})` → arbitrary SELECT against `current.sqlite`. Refuses anything that isn't a SELECT.
- `oni_dupes({sort?, limit?})` → typed `duplicants`-table query with optional sort by stress / calories / hp / breath / decor.
- `oni_geysers()` → list with type + position + roll percentiles.
- `oni_resources({location?})` → aggregate from `v_resources_in_storage` / `v_world_objects_by_element`. `location` ∈ `"storage" | "world" | "both"`.
- `oni_save_meta()` → cycle count, base name, version, parsed_at staleness check.
- `oni_freshness()` → seconds since `parsed_at`. The model can decide whether to nudge the user to run `npm start`.

### Lifecycle
- The MCP server opens `current.sqlite` in read-only mode each call. Stateless.
- Discovery: the server reads its own config from `~/.oni-watcher/config.json` to find `outputDir`. No second source of truth.
- Errors when `current.sqlite` is missing return a structured "watcher hasn't run yet" payload, not an exception, so the model can handle it gracefully.

### SKILL.md
Modeled on the existing `CLAUDE.md` but reframed for tool use rather than raw SQL. It tells the model: when the user asks colony questions, prefer typed tools (`oni_dupes`, `oni_geysers`, etc.) over `oni_query`; only reach for `oni_query` when the typed tools don't cover what's needed; always check `oni_freshness` if a question is time-sensitive.

### Distribution
- Publish under the user's GitHub `arielbloch/oni-watcher-plugin` (or as a subfolder of this repo).
- Once functional, submit to the Cowork plugin marketplace.

### Open questions
- Should the MCP server bundle the watcher daemon or assume it's running separately? Bundle: simpler for users; separate: respects the existing project boundary. My vote: separate — the plugin only reads what oni-watcher writes, and the user runs the daemon however they want (`npm start`, launchctl, etc.).
- Read-only SQL safety on `oni_query`: parse the query and reject any non-SELECT statement, or use a separate connection with `PRAGMA query_only = ON`. Both are fine.

---

## 4. Professional ONI architect skill

### Goal
A SKILL.md that turns the model into a colony-design-and-debugging copilot for Oxygen Not Included. The data plumbing (Feature 3) tells the model what's in your colony; this skill tells the model what to *do* with that information.

### What goes in
A non-exhaustive list of subject areas, sourced from the official Klei wiki and well-maintained community guides. Each entry is a few hundred tokens of curated reference, not a wiki dump.

#### Resource & throughput math
- Oxygen production rates: Algae Terrarium (40 g/s), Algae Deoxidizer (500 g/s consuming 550 g/s algae + 1 kg/s water), Electrolyzer (888 g/s O2 + 112 g/s H2 from 1 kg/s water).
- Food math: kcal/cycle per dupe (1000), morale-adjusted; calories of every cookable + raw food.
- Power: wattage of common buildings, battery throughput, transformer limits, wire types and their max throughput (1 kW / 2 kW / 20 kW / 50 kW).
- Heat: SHC (Specific Heat Capacity) of common materials, why igneous rock is your friend, why polluted water is your enemy, thermo-aquatuner / steam turbine setpoints (95 °C, 125 °C, 200 °C).

#### Geysers, vents, volcanoes
- Output ranges (kg/s), eruption duty cycles, dormancy, output temperature.
- Tameability: how to compute average output and decide whether to wall it in, cool it down, or skip it.
- Roll percentiles → real kg/s formula (this is the same const-data table we'll need to lift into the schema for typed `geyser_kg_per_s`).

#### Duplicants
- Trait quick reference (positive vs. negative, when to keep / dispatch).
- Skill build order for early/mid/late game.
- Stress sources (overcrowding, dark room, low decor, poor food) and fixes.

#### Plants & critters
- Optimal temperature/atmosphere for every farmable plant.
- Critter ranching: hatch, drecko, pacu, puft, dreco — input/output, ranching density.

#### Common asks the skill should handle well
- "Am I on track for cycle 100?" — checks dupe count, stress, food reserves, oxygen, power buffer.
- "Why is my power grid browning out?" — looks at the buildings table for current draw vs. battery capacity.
- "Where should I put my next research lab?" — needs decor, oxygen, power proximity.
- "Are any of my dupes about to break?" — high stress, missing morale meal, stuck assignments.

### Deliverable
- `skills/oni-architect/SKILL.md` (lives alongside the MCP plugin; same plugin can ship multiple skills).
- A `references/` subfolder with separate curated markdown files per subject area, loaded by the skill on demand (Anthropic's progressive-disclosure pattern).
- A `tests/` set of canned questions (for the skill-creator eval framework, if we go that route) covering the "common asks" list.

### Open questions
- How much of this should be hard-coded const data vs. asked of `oni_query`? The skill works best when the math is pre-computed and the data lookups are scoped. Numbers like "Electrolyzer outputs 888 g/s O2" never change between patches; "your Electrolyzer is at 95 °C and consuming 1.2 kg/s water" comes from the DB.
- Versioning: ONI patches change numbers occasionally (rare). Tag the skill with the patch range it was authored against and add a "verify against current patch notes" caveat.

---

## Sequencing

A reasonable order, roughly increasing scope:

1. **Zero-config discovery** — small, contained, makes the daemon usable for new users out of the box. Unblocks every other feature because the MCP plugin and CLI status assume a working `current.sqlite`.
2. **UX status command** — gives us something to show users beyond log lines. Same rendering powers Feature 3's `oni_status` MCP tool, so the work is reused.
3. **MCP plugin** — wraps the data we already have for Claude clients. Depends on Feature 2's renderer.
4. **ONI architect skill** — biggest content task; sit it on top of the plumbing once the plumbing is solid.
