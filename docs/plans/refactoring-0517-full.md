# Refactoring plan — 2026-05-17 (full)

Companion to the morning's review (`review-0517.md`, fixed in Waves 28
& 29). This plan covers everything that's left from the thorough audit:
the remaining clean-code findings, the naming-convention pass across
the schema, and the completeness gaps that prevent the DB from being
the single source of truth for "everything interesting in your save".

Waves are ordered so the cheap cleanups land first (they make later
work easier), naming lands next (rename surface area only grows over
time), and completeness features come last (most expensive, biggest
unknown).

---

## Wave 30 — Architecture cleanup

Small, mostly mechanical fixes to close the audit's clean-code findings.

### 30.1 Move `CHORE_META` into the source of truth

**Where:** `src/web/app.js:31-48` defines `CHORE_META` (domain, abbr,
order per chore group). The `label` comes from the API via
`chore_group_names`, but the styling/ordering metadata lives only in
the FE — invisible to the MCP plugin.

**Fix:** Add `domain`, `abbr`, `order` to each entry in `src/chore_groups.js`
`CHORE_GROUP_NAMES`. Project these into the existing `chore_group_names`
table (add columns), serve via `/api/status` payload, consume in
`app.js`. MCP plugin can now JOIN against it too.

### 30.2 Try/finally in `writeDatabase()`

**Where:** `src/db.js:319-358`. If `stmt.run()` throws (and it can — we
explicitly re-throw at line 343-352 with added context), `db.close()`
at line 357 never runs. The handle leaks until GC.

**Fix:** Wrap the body in try/finally so `db.close()` always runs.
Two-line change.

### 30.3 Dedupe `ROMAN` array

**Where:** `src/ui.js:143` and `src/web/app.js:157`. Both define
`["I","II","III","IV","V"]` for skill-level rendering.

**Fix:** Export `ROMAN_NUMERALS` from `src/skills.js`; ui.js imports
it directly; FE receives it via the API payload (since app.js can't
import server code).

### 30.4 Extract `serveStatus` enrichment

**Where:** `src/web.js:173-338`. The function is ~165 lines; the
skills/effects/focus enrichment (lines ~193-228) and the lookup-table
serialization (lines ~285-318) are the two extractable chunks.

**Fix:** Pull enrichment into `enrichDupes(db, dupes)` helper and
lookup serialization into `serveLookups(db)` helper. Target: reduce
`serveStatus` to ~80 lines.

### 30.5 Document `oni_priorities` in SKILL.md

**Where:** `oni-vision-plugin/skills/oni-vision/SKILL.md`. The tool is
registered in `mcp/server.js` but absent from the skill's tool list.

**Fix:** Add an `oni_priorities` section with input schema, example
output, and a one-line "use this for chore-priority questions".

### 30.6 Document FE threshold-defaults lifecycle

**Where:** `src/web/app.js:70-78`. The defaults are immediately
overwritten by `/api/status` data. Comment doesn't make this obvious.

**Fix:** Add a 1-line comment: "Defaults used only for the first paint
before /api/status returns. Real values come from server."

---

## Wave 31 — Testing gaps

Real holes the current suite doesn't cover.

### 31.1 Daemon-loop parse-recovery test

**Where:** Missing. `test/` has no test that imports `chokidar` or
exercises the busy/queued logic in `src/index.js`.

**Fix:** Two options:
- **A (cheap):** factor the parse-with-recovery body of `runOnce()`
  into an exported `safeBuildOutputs(savePath, outputDir)` in
  `pipeline.js`; test it directly against a corrupt save file
  (random bytes) and assert it logs + returns without throwing.
- **B (full):** spawn the daemon as a child process, drop a corrupt
  save into a temp watch dir, verify it logs and recovers; drop a
  valid save, verify it parses.

Recommend A — same coverage, much faster, no flaky child-process
plumbing. The chokidar layer is thin and stable.

### 31.2 SSE delivery test

**Where:** `test/web.test.js:204-214` tests that `notifyClients()`
doesn't throw with a connected client, but doesn't verify the client
actually receives the `parse` event.

**Fix:** Open an SSE connection, await `notifyClients()`, read from
the body stream, assert the `event: parse` line arrives.

### 31.3 Empty-DB shape test for `/api/status`

**Where:** Missing. `web.test.js` tests with a full FAKE_SAVE; no test
covers a colony with 0 dupes, 0 geysers, 0 storage.

**Fix:** Add a test that builds a minimal `tables` object with all
arrays empty, writes the DB, requests `/api/status`, asserts the
response has the expected shape (empty arrays, not nulls or 500s).

---

## Wave 32 — Naming convention cleanup

The lookup-table suffixes are inconsistent: `element_names`,
`geyser_type_names`, `food_meta`, `effect_labels`, `skill_labels`,
`chore_group_names` — five different suffix conventions for the same
kind of thing.

### 32.1 Standardize lookup-table names

Rename the lookup tables to a single convention: **plural noun, no
suffix**. The per-instance tables already follow this pattern
(`duplicants`, `buildings`, `geysers`, `critters`).

| Old | New |
|-----|-----|
| `element_names` | `elements` |
| `geyser_type_names` | `geyser_types` |
| `food_meta` | `foods` |
| `effect_labels` | `effects` |
| `skill_labels` | `skills` |
| `chore_group_names` | `chore_groups` |

Note the conflict-free design: per-instance tables prefixed
`duplicant_*` (`duplicant_effects`, `duplicant_skills`) make the
short names unambiguous — `effects` is the static catalog,
`duplicant_effects` is "this dupe has these effects".

**Surface area to update:**
- `src/db.js` — CREATE TABLE statements + TABLE_COLUMNS
- `src/pipeline.js` — `tables.X = …` assignments
- `src/web.js` — `/api/status` queries (LEFT JOIN against renamed tables)
- `oni-vision-plugin/lib/queries.js` — all JOINs in geysers(), resources(), food(), priorities(), status()
- `CLAUDE.md` — lookup-tables section
- `docs/data-model.md`
- `oni-vision-plugin/skills/oni-vision/SKILL.md` — schema crib
- All test files in `test/` and `oni-vision-plugin/test/`
- `test/helpers.js` — `buildFakeTables()`

**Response-field renames in `/api/status`:** Keep the response field
names matching the new table names (`elements`, `geyser_types`, etc.)
so the FE/MCP stay consistent. `src/web/app.js` consumers updated to
match.

### 32.2 Audit other potentially confusing names

Reviewed and decided:
- `world_objects` — keep. Distinct from `buildings` (placed) and
  `game_objects` (catch-all index). The "loose stuff on the map"
  semantic is captured well.
- `storage_contents.owner_id` — keep. Already documented in CLAUDE.md
  that it joins to either buildings or world_objects.
- `object_groups` — keep. Mirrors ONI's internal `objectGroups`.
- `duplicant_amounts` — keep. Mirrors ONI's `MinionModifiers.amounts`.

---

## Wave 33 — Completeness: diseases (germ tracking)

**ONI concept:** Every cell, object, and dupe can carry germ
contamination — `diseaseIdx` + `diseaseCount` + `elapsedTime`. The
main diseases are Slimelung, Food Poisoning, Zombie Spores,
Floral Scents. Currently we extract neither the disease catalog nor
per-object germ counts.

### 33.1 Add disease catalog (`diseases` lookup table)

- New `src/diseases.js` with the small fixed list:
  Slimelung, FoodPoisoning, ZombieSpores, FloralScents, SunburnEffect
  (and any others ONI defines). SimHash IDs from the wiki.
- `src/db.js` adds `diseases(disease_id INTEGER PK, name TEXT)`
- `src/pipeline.js` projects from `src/diseases.js`
- `assertLookupTablesPopulated` includes `diseases`

### 33.2 Extract germ contamination per object

- `src/extractors.js` reads each game object's `PrimaryElement.diseaseID`
  + `diseaseCount`. Add `disease_id` and `disease_count` columns to
  `buildings`, `world_objects`, `storage_contents`.
- MCP tool `oni_germs({ minCount? })` returns objects with germ
  contamination, JOINed against `diseases` for names.

### 33.3 Tests

- Extractor unit test against a fixture with germy objects
- `test/db.test.js` — schema includes new columns
- Plugin test — `oni_germs` returns expected rows

---

## Wave 34 — Completeness: plant growth state

**ONI concept:** Plants (Bristle Blossom, Mealwood, etc.) are
`world_objects` with a `Growing` behavior carrying growth %, wilting
state, and a `Harvestable` behavior. Players ask "what's ready to
harvest?" and "what's wilting?" all the time; we currently force them
to dig into the generic `behaviors` table.

### 34.1 Typed `plants` table

- `plants(game_object_id, prefab_id, position_x, position_y, growth_pct, wilting_reason, harvestable, temperature)`
- Extractor lifts `Growing` + `Harvestable` + `WiltCondition` data
  from the existing world_object behaviors

### 34.2 Plant species catalog

- `src/plants.js` — prefab_id → species name, ideal temp range,
  ideal atmosphere, output kg/cycle, water-needed
- `plants_meta` lookup table (using new naming convention from Wave 32)
- MCP tool `oni_plants({ wilting?, ready? })` returns plants with
  state, joined against catalog

### 34.3 Tests

- Plant extractor unit test
- MCP plant tool test

---

## Wave 35 — Completeness: research progress

**ONI concept:** The tech tree state lives in `gameData` (not
`gameObjects`); each tech has a `complete` flag and a `progress` value
toward unlock. Currently we don't extract any of it.

### 35.1 Research extractor

- Walk `gameData.Research`/`ResearchPoints` (exact path TBD by save
  inspection)
- New `research(tech_id, complete, progress, prerequisites)` table

### 35.2 Tech catalog

- `src/research.js` — static tech tree: id → name, tier, type
  (basic/advanced/medicine/space/etc.)
- `research_meta` lookup table
- MCP tool `oni_research()` returns the unlocked-and-in-progress
  picture

### 35.3 Tests

Same shape as 34.3.

**Risk:** Tech tree paths/schemas vary across DLC. May require a real
ONI save to inspect first; flag as needs-investigation if FAKE_SAVE
extension isn't sufficient.

---

## Wave 36 — Completeness: schedules

**ONI concept:** Schedules define when dupes work/sleep/eat/bathe.
Each dupe is assigned to a schedule by index. Currently invisible.

### 36.1 Schedules extractor

- `schedules(schedule_id, name, blocks_json)` — block list per
  schedule (work/sleep/eat in order)
- `duplicants` gains a `schedule_id` column

### 36.2 Tests

- Extractor pulls schedule definitions and dupe→schedule assignments
- MCP tool `oni_schedules()` returns all schedules with their dupe
  rosters

**Risk:** Schedule data location in the save — likely in
`gameData.Schedules`. Investigate first.

---

## Wave 37 — Completeness: power network metrics

**ONI concept:** Buildings consume or generate power. The grid has
batteries (capacity, charge), wires (transformers, type), generators
(coal, manual, hydrogen, solar). Players ask "am I generating enough?"
and "where's my power going?"

### 37.1 Power-typed view of buildings

No new table — compose from `buildings` + `behaviors`.
`src/extractors.js` lifts `EnergyGenerator`/`EnergyConsumer` data
(generation_w, consumption_w, current_watts) into new columns on
`buildings`.

### 37.2 Power building catalog

- `src/power_buildings.js` — prefab_id → category (generator /
  consumer / transformer / battery), nameplate rating
- `power_buildings` lookup table (using Wave-32 naming)
- MCP tool `oni_power()` aggregates by category + returns the grid
  snapshot

### 37.3 Tests

Same shape.

---

## Wave 37.5 — README architecture overview

### Goal

The top-level `README.md` describes how to install and run oni-vision
but doesn't quickly answer "how is this thing actually wired up?"
Add a concise **Architecture** section near the top of the README
that's friendly to a new contributor or AI agent.

### Content

Bullet breakdown covering:
- The save → parser → extractors → SQLite → consumers pipeline
- The three consumers (CLI banner, web dashboard, MCP plugin) and
  what each one is for
- The knowledge-module pattern: each `src/*.js` knowledge file →
  one SQLite lookup table → JOINed by every consumer
- The atomic-write guarantee (write to `.tmp`, rename(2) into place)
- The two-process model: oni-vision daemon writes, everything else
  reads read-only

A small ASCII diagram of the data flow if it fits naturally.

### Deliverable

- `README.md`: new "Architecture" section after "Features" or before
  "Build". 30–60 lines. Bullets, no prose paragraphs.

---

## Wave 38 — Completeness: rockets and planetoid clusters (DLC)

**ONI concept:** Spaced Out DLC. Multiple asteroids, rockets with
modules, destinations, fuel. Currently reachable only through
generic `behaviors` query.

### 38.1 Typed `rockets`, `rocket_modules`, `planetoids` tables

Investigate save format first — DLC content is opt-in and FAKE_SAVE
doesn't include it. May need a real Spaced Out save to develop
against.

**Risk:** High investigation cost. Defer until at least one user
requests it explicitly, or until we have a DLC save to inspect.

---

## Sequencing summary

| Wave | Theme | Risk | Time |
|------|-------|------|------|
| 30 | Architecture cleanup | low | 1h |
| 31 | Testing gaps | low | 1h |
| 32 | Naming convention | low (mechanical, surface-wide) | 1h |
| 33 | Diseases | low | 1h |
| 34 | Plants | medium (need to find behaviors in save) | 2h |
| 35 | Research | medium-high (gameData paths unknown) | 2h |
| 36 | Schedules | medium | 1.5h |
| 37 | Power metrics | medium | 1.5h |
| 37.5 | README architecture | low | 30min |
| 38 | Rockets / DLC | high (needs DLC save) | deferred |

Waves 30–32 ship now. Waves 33+ require investigation of real-save
behavior data; can ship incrementally as each is verified against an
actual save.
