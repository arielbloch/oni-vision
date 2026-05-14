# oni-vision — feature plan

This document is the design north star for oni-vision. Each section is a self-contained mini-design: what we want, the rough shape of the solution, what ships, and what we still need to decide.

> **Status (post Wave 23):** Features 1–4 are implemented and committed. Feature 5 (zero-config experience) is the active design goal. This doc is kept as living design rationale; the §"Open questions" notes capture calls made during implementation.

---

## Design principle: zero-config

**A user should be able to clone the repo, run `npm start`, and have a live browser dashboard of their colony — with no config file, no flag, no copy-paste.**

This is the north star for every new feature. Concretely it means:

- **Save-file discovery is automatic.** (✅ done, Wave 6.) The daemon probes known platform paths and picks the most-recently-written save.
- **The web dashboard is on by default.** No `web.enabled: true` required. Port 8080, localhost-only, starts with the daemon.
- **The browser opens automatically** on first start (or when the dashboard isn't already open). One fewer step the user has to remember.
- **The daemon auto-starts on login.** After a one-time `npm run setup`, it runs silently in the background. The user never has to remember `npm start` again.

Config file (`~/.oni-vision/config.json`) is still supported for overrides — a different port, a different save dir, disabling the web UI — but it is never *required*.

The test for this principle: hand the repo to someone who plays ONI and has Node ≥ 22, and count the steps to a working dashboard. The target is two: `npm install` → `npm run setup`. Everything else is automatic.

---

## 1. Zero-config save-dir discovery — ✅ implemented (Wave 6)

### Goal
A first-time user should be able to run `npm start` with no config file and have the daemon figure out which save folder to watch. No copy-paste from the README, no `<USERNAME>` substitution. If we find a save, we use it; if we find none, we print a clear error with the candidate paths we tried.

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
- Should we surface the auto-detected path back into `~/.oni-vision/config.json` automatically? My instinct is no — magical config-rewriting is surprising. Better to print "to lock this in, copy to ~/.oni-vision/config.json" and let the user decide.

---

## 2. UX: world summary — ✅ implemented (Wave 7)

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
- `src/cli/status.js` — entry point for `npm run status`; opens `~/.oni-vision/output/current.sqlite` (or a `--db` arg), invokes `ui.render(db)`, prints.
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

## 3. MCP plugin for Claude Code / Cowork — ✅ implemented (Wave 8)

### Goal
Ship oni-vision as a Claude plugin so any Claude session (Cowork or Claude Code) can answer "what's going on in my colony" without the user manually piping `sqlite3` queries. The plugin bundles an MCP server that exposes typed tools and a SKILL.md that teaches the model how to use them.

### Plugin contents

```
oni-vision-plugin/
├── plugin.json                # plugin manifest (name, version, author, mcps[], skills[])
├── mcp/
│   └── server.js              # node MCP server (tools below)
├── skills/
│   └── oni-vision/
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
- Discovery: the server reads its own config from `~/.oni-vision/config.json` to find `outputDir`. No second source of truth.
- Errors when `current.sqlite` is missing return a structured "daemon hasn't run yet" payload, not an exception, so the model can handle it gracefully.

### SKILL.md
Modeled on the existing `CLAUDE.md` but reframed for tool use rather than raw SQL. It tells the model: when the user asks colony questions, prefer typed tools (`oni_dupes`, `oni_geysers`, etc.) over `oni_query`; only reach for `oni_query` when the typed tools don't cover what's needed; always check `oni_freshness` if a question is time-sensitive.

### Distribution
- Publish under the user's GitHub `arielbloch/oni-vision-plugin` (or as a subfolder of this repo).
- Once functional, submit to the Cowork plugin marketplace.

### Open questions
- Should the MCP server bundle the oni-vision daemon or assume it's running separately? Bundle: simpler for users; separate: respects the existing project boundary. My vote: separate — the plugin only reads what oni-vision writes, and the user runs the daemon however they want (`npm start`, launchctl, etc.).
- Read-only SQL safety on `oni_query`: parse the query and reject any non-SELECT statement, or use a separate connection with `PRAGMA query_only = ON`. Both are fine.

---

## 4. Professional ONI architect skill — ✅ implemented (Wave 9)

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

## 5. Zero-config experience — 🔜 next

### Goal

`npm install && npm run setup` is the complete installation. After that, every time the user launches ONI the dashboard is already waiting at `http://localhost:8080`. No terminal, no config file, no `npm start`.

### The three gaps

#### 5a. Web on by default

Right now the web server only starts when `config.web.enabled === true`. Flip the default: the server starts unless the user explicitly sets `"web": { "enabled": false }`.

- **`src/paths.js` `buildDefaults()`**: add `web: { enabled: true, port: 8080 }`.
- **Port conflict**: if 8080 is busy, try 8081, 8082, … up to 8090. Log the actual URL so the user knows where to look.
- No new dependency — already using `node:http`.

Open question: should we print a one-time "Dashboard running at http://localhost:8080 — add `web.enabled: false` to config to turn this off" notice? Probably yes, on first run only (detect by absence of config file).

#### 5b. Auto-open browser on first start

After `startWeb()` resolves and the current.sqlite is fresh (parsed within the last 60 s), open the dashboard in the default browser. Do this only if:

1. No browser is already polling `/api/status` (detect via a simple flag file `~/.oni-vision/browser-opened`).
2. A TTY is attached (non-interactive use, e.g. cron/launchctl, should stay silent).

Platform open commands:
- macOS: `open http://localhost:<port>`
- Windows: `start http://localhost:<port>`
- Linux: `xdg-open http://localhost:<port>`

All via `child_process.spawn` with `{ detached: true, stdio: 'ignore' }` — fire and forget, don't wait.

Deliverable: `src/browser.js` — `openBrowser(url)` export. Called from `src/index.js` after the first successful `buildOutputs` while the web server is up.

#### 5c. Auto-start on login: `npm run setup`

A one-shot command that installs a platform-appropriate background service so the daemon starts on login and stays running silently.

**macOS — LaunchAgent** (preferred, standard, no root required):

```xml
<!-- ~/Library/LaunchAgents/com.oni-vision.daemon.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" …>
<plist version="1.0">
<dict>
  <key>Label</key>           <string>com.oni-vision.daemon</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/path/to/oni-vision/src/index.js</string>
  </array>
  <key>RunAtLoad</key>       <true/>
  <key>KeepAlive</key>       <true/>
  <key>StandardOutPath</key> <string>~/.oni-vision/daemon.log</string>
  <key>StandardErrorPath</key><string>~/.oni-vision/daemon.log</string>
</dict>
</plist>
```

After writing the plist: `launchctl load ~/Library/LaunchAgents/com.oni-vision.daemon.plist`.

**Linux — systemd user service**:

```ini
# ~/.config/systemd/user/oni-vision.service
[Unit]
Description=oni-vision save watcher

[Service]
ExecStart=node /path/to/oni-vision/src/index.js
Restart=on-failure
StandardOutput=append:%h/.oni-vision/daemon.log
StandardError=append:%h/.oni-vision/daemon.log

[Install]
WantedBy=default.target
```

After writing: `systemctl --user enable --now oni-vision`.

**Windows — Task Scheduler** (via `schtasks /create`): lower priority, implement after macOS/Linux.

Deliverable: `src/cli/setup.js` — detects platform, writes the appropriate service file, registers it, prints a confirmation. Wired to `"setup": "node src/cli/setup.js"` in `package.json`.

Companion: `src/cli/uninstall.js` / `npm run uninstall` — removes the service file and unregisters it cleanly.

### What doesn't change

- Config file still works as before. Any key present in `~/.oni-vision/config.json` overrides the default.
- The daemon is still stoppable with `Ctrl-C` (or `launchctl unload` / `systemctl --user stop`).
- The web server still binds to `127.0.0.1` only — no exposure to the network.

### Deliverables summary

| File | What it does |
|---|---|
| `src/paths.js` | `web.enabled` defaults to `true`; port-fallback logic |
| `src/browser.js` | `openBrowser(url)` — cross-platform, fire-and-forget |
| `src/index.js` | call `openBrowser` after first parse while web is up |
| `src/cli/setup.js` | write + register platform service; `npm run setup` |
| `src/cli/uninstall.js` | remove + unregister; `npm run uninstall` |
| `package.json` | add `setup` and `uninstall` scripts |
| `README.md` | replace "Configuration" section with two-step install |

---

## Sequencing

A reasonable order, roughly increasing scope:

1. **Zero-config discovery** — ✅ Wave 6
2. **UX status command** — ✅ Wave 7
3. **MCP plugin** — ✅ Wave 8
4. **ONI architect skill** — ✅ Wave 9
5. **Zero-config experience** — 🔜 next: web on by default (5a), browser auto-open (5b), login auto-start (5c)
