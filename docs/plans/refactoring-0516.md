# Refactoring plan — 2026-05-16

A consolidated review of the project as of post-Wave-22, covering four
dimensions: **knowledge centralization**, **clean code / architecture**,
**correctness**, and **documentation**. Each finding includes the
specific file and a recommended fix. Suggested wave structure at the
bottom.

The headline ask driving this: **game knowledge — enums, structure,
model — must live in code and DB, not only in the frontend**. We have
three consumers of the data (the web UI, the MCP plugin, and the
console renderer) and the data needs to flow from a single source to
all three.

---

## 1. Knowledge centralization

### What's already right

The pattern is set up well. Each slice of game knowledge owns its module
and gets projected into a SQLite table by `pipeline.js`:

| Module               | Table              | Consumers          |
|----------------------|--------------------|--------------------|
| `src/elements.js`    | `element_names`    | web, MCP, real-save test |
| `src/geyser_types.js`| `geyser_type_names`| web, MCP           |
| `src/food.js`        | `food_meta`        | web, MCP           |
| `src/effects.js`     | `effect_labels`    | web, MCP           |
| `src/chore_groups.js`| `chore_group_names`| web, MCP, extractors |

`test/helpers.js` imports from the same modules so tests exercise the
single-source-of-truth path.

### Leaks to fix

#### 1.1 `SKILL_LABELS` lives in `src/ui.js`

`src/ui.js:221` exports `SKILL_LABELS` as a `Map`. `pipeline.js:14`
imports it from `ui.js` to populate the `skill_labels` table, and
`test/helpers.js:9` does the same. That's a layering inversion: a
presentation module owns shared domain data, and the data has to be
re-shaped (`[...SKILL_LABELS.entries()].map(...)`) at projection time
because the other lookups are arrays-of-objects.

**Fix:**
- Create `src/skills.js` exporting `SKILL_LABELS` as
  `[{ branch, label }, ...]` matching the other modules' shape.
- `pipeline.js` and `test/helpers.js` import from `src/skills.js`.
- `src/ui.js` keeps its `formatSkills` helper but re-exports
  `SKILL_LABELS` from `src/skills.js` (or imports it inline) — no
  longer the *owner* of the data.

#### 1.2 `moraleCostOf()` is a game rule trapped in the frontend

`src/web/index.html:241` encodes "each mastered skill tier costs +N
morale" — a real ONI rule. The CLI renderer doesn't currently show
morale, and neither does the MCP, but they should be able to. If they
do, the rule gets reinvented.

**Recommended fix:**
- Add a `morale_cost` computed column to the `duplicants` table.
  Compute it once in the extractor (where the skill rows already are).
- The rule itself moves to `src/skills.js` so it's testable and
  reusable.
- The web FE keeps the bar widget but reads `dupe.morale_cost`
  directly — no client-side math.

This eliminates the rule from the FE entirely and gives the MCP a
typed column to surface.

#### 1.3 Thresholds and constants are FE-only

The following are hardcoded only in `src/web/index.html`:

| Constant            | Line | Meaning                          |
|---------------------|------|----------------------------------|
| `STALE_AFTER_S = 600` | 254 | "stale" threshold (10 min)     |
| `MORALE_BAR_MAX = 20` | 318 | bar scaling                    |
| `stress: v >= 60 / >= 30` | 288 | warn / bad threshold     |
| `quality: >= 70 / >= 40` | 369 | geyser quality threshold |
| `priority >= 5 → p5`    | 342 | boosted priority styling |

Two of these are also stated as facts in the architect skill:
`oni-vision-plugin/skills/oni-architect/SKILL.md:10` says "stale if
>10 minutes via `oni_freshness`" — that's the same 600.

**Fix:**
- Add a `thresholds` block to the `/api/status` payload — sourced from
  a new `src/thresholds.js` module (or as part of `src/skills.js` for
  morale). The FE reads from `data.thresholds`; the SKILL.md becomes
  documentation about an API contract rather than a magic number.
- Consider exposing the same `thresholds` block in the MCP
  `oni_status` tool so the model can self-check ("is 78 stress red?").

#### 1.4 `fmtMass` and `fmtAge` are duplicated across runtimes

The Node CLI and the browser UI both format mass (`kg → t → kt`) and
age (`Ns / Nm / Nh / Nd`). They live in `src/ui.js` (`formatMass`,
inline `fmtAge` body inside `renderFreshness`) and `src/web/index.html`
(`fmtMass`, `fmtAge`). Same thresholds, same suffixes today — by
coincidence, not by contract.

**Fix:** since the two runtimes don't share code at runtime (Node vs.
browser), pick one of:

- **(a) Contract test.** Add a test that runs both implementations
  against a fixed inputs table and asserts equal output. Cheap, locks
  the duplication.
- **(b) Shared module.** Move the formatters to `src/format.js` and
  serve a minimal `src/web/format.js` static asset that the FE
  `<script>`s. Slightly more setup, but eliminates the duplication
  entirely.

Recommended: (a) for v1, (b) when we also split the HTML into separate
files (see §2.2).

#### 1.5 MCP doesn't tell the model about lookup tables

`oni_status` returns the bare colony state (intentionally — token
efficiency). When the model wants to compose `oni_query`, the
`oni_schema` tool lists every table including the lookups, but the
`oni-vision` SKILL.md doesn't say "JOIN against `element_names` to
get human-readable names." Result: a model writes
`SELECT element_id FROM world_objects` and gets back raw SimHash
integers like `1836671383`.

**Fix:** add a 4-line "Lookup tables" section to
`oni-vision-plugin/skills/oni-vision/SKILL.md` with a worked JOIN
example. Also update `CLAUDE.md` (the drop-in lightweight path) to
mention the lookup tables — currently it doesn't.

---

## 2. Clean code / architecture

### 2.1 `src/ui.js` is a kitchen sink (316 lines)

It currently owns: ANSI paint helpers, the `bar()` block-element
renderer, `fit/pad/lpad`, `formatMass`, every `renderX` composer,
`SKILL_LABELS` and `formatSkills`, and the inline age formatter inside
`renderFreshness`.

**Split:**
- `src/skills.js` — `SKILL_LABELS`, `formatSkills`, `moraleCostOf`
  (after §1.1/§1.2)
- `src/format.js` — `formatMass`, `formatAge`, `bar`, `paint`,
  `fit/pad/lpad`
- `src/ui.js` — just the `renderX` composers using the above

This is also a precondition for the contract test in §1.4(b).

### 2.2 `src/web/index.html` is 586 lines

~250 lines of `<style>`, ~330 of `<script>`+HTML. At this size, the
inline script is hard to lint and impossible to share with the backend.

**Split:**
- `src/web/index.html` — markup only
- `src/web/styles.css` — styles
- `src/web/app.js` — JS

The server's `serveStatic` already takes a `filename`; just extend the
Content-Type switch to handle `.js` and `.css`. Add `<link>` and
`<script src>` references in `index.html`. The web test continues to
work — and gains the ability to test `app.js` in isolation if we ever
import it under jsdom.

### 2.3 Three plugin manifest files

The `oni-vision-plugin/` directory contains:

- `oni-vision-plugin/plugin.json` — my original from Wave 8
- `oni-vision-plugin/.claude-plugin/plugin.json` — Claude Code's
  expected location (per docs)
- `oni-vision-plugin/.mcp.json` — a third config

This is at least one too many. The Claude Code plugin spec wants
`.claude-plugin/plugin.json` as canonical (verify against the docs).

**Fix:**
- Decide which is canonical, delete or stub the others.
- Add a one-liner in `oni-vision-plugin/README.md` explaining the
  layout.
- If `.mcp.json` is for per-project MCP registration (a different
  Claude Code concept), document that distinction.

### 2.4 `oni-vision-plugin/lib/queries.js` is 577 lines

12+ exports, all "query helpers over a DatabaseSync." Cohesion is fine
— no fix required now. Revisit if it crosses ~700.

### 2.5 `docs/` is bloated (1641 lines across 7 files)

Several docs describe shipped features:
- `docs/mcp-optimization.md` — shipped Wave 14
- `docs/web-ui-plan.md` — shipped Wave 20 (Plan B)
- `docs/frontend-design.md` — shipped (presumed)
- `docs/plan.md` — sections 1–4 shipped Waves 6–9 (status banner
  says "post Wave 11", which is also stale)
- `docs/claude-code-mcp-plugin-plan.md` and
  `docs/kimi-code-mcp-plugin-plan.md` — purpose / status unclear

**Fix:**
- Create `docs/history/` and move shipped-feature plans there.
- Keep `docs/plan.md` as the live north star — rewrite the status
  banner to "post-Wave-22".
- Resolve the duplicate plugin-platform docs (Claude vs. Kimi) — keep
  whichever track is real.
- Add `docs/data-model.md` explaining the lookup-tables flow as the
  one-page architecture summary.

---

## 3. Correctness

### 3.1 Empty lookup tables get silently skipped

`src/db.js writeDatabase` has `if (!rows?.length) continue;`. Useful
for the typed game tables (a colony might have zero geysers), but for
*lookup* tables it's a footgun: a botched edit that empties
`GEYSER_TYPE_NAMES` would produce a DB with the `geyser_type_names`
table absent and downstream JOINs would become silent NULLs.

**Fix:** maintain a list of "lookup tables that must be non-empty" and
fail loudly when they are. Either special-case in `writeDatabase` with
a small allowlist, or add an explicit assertion in `pipeline.js` after
the projection step. Add a test.

### 3.2 No direct round-trip test for the lookup tables

`test/db.test.js` covers the typed game tables. `test/real-save.test.js`
exercises the full pipeline but doesn't isolate the lookup-resolution
case. `test/web.test.js` covers the API surface but only after the
backend has already formatted the data into the response.

**Fix:** add a focused test that writes a known fixture's lookup
tables, then asserts the SimHash → name JOIN resolves correctly for
canonical entries (Water `1836671383`, Steam Vent `-899515856`, etc.).
Pinning these SimHash values in a test catches regressions in
`elements.js` itself.

### 3.3 `tryListen` leaves the server without an error handler after binding

`src/web.js:87-105` retries on `EADDRINUSE` by attaching a one-shot
`error` handler, removing it on retry, and resolving on `listen`. After
the listen succeeds the server has no `error` listener. A later runtime
error (uncommon but possible — e.g. a TCP socket-level fault) would
crash the daemon with an unhandled `'error'` event.

**Fix:** after `server.listen(...)` succeeds, attach a permanent
`server.on("error", ...)` that just logs. Or simpler: keep the
`server.once("error", ...)` from the bind phase and replace it with a
logger inside the listen callback.

### 3.4 Port-fallback caveat undocumented

`PORT_FALLBACK_LIMIT = 10`. `8080 → 8089` is the actual range. The
README, `.config-example.json`, and SKILL.md all reference `:8080` as
if it's guaranteed. **Fix:** add a note in the README config section
("port 8080, or the next free port up to 8089"), and have the daemon
log the actual bound URL prominently. (It already does — just make sure
docs don't contradict.)

### 3.5 `current.json` includes the full source-file path

`pipeline.js` writes `sourceFile: savePath` into the JSON sidecar. On
the user's machine that's typically `/Users/<name>/Library/...`. Not
an exposure for a localhost-only tool, but worth a privacy note in the
README — and consider stripping to the basename for the daemon's
console output (it already does so in some places; inconsistent).

### 3.6 `current.json` sidecar atomicity

Already fixed in Wave 4 (atomic temp+rename). Just noting it's still
correct in the current `pipeline.js`.

---

## 4. Documentation

### 4.1 `CLAUDE.md` doesn't mention the lookup tables

The drop-in lightweight path tells a Claude session to use `sqlite3`
directly. Without the lookup tables documented, the model writes
`SELECT element_id FROM world_objects` and gets SimHash integers it
can't interpret. **Fix:** add a "Lookup tables" section with a
worked JOIN example showing how to resolve human-readable names.

### 4.2 Plugin install story is undocumented

Neither `README.md` nor `oni-vision-plugin/README.md` explains how a
user actually installs the plugin into Claude Code or Cowork. "Add this
directory to your plugin path" is too vague. **Fix:** spell out the
exact steps (CLI command or settings UI), file paths, and how to
verify it loaded.

### 4.3 `docs/plan.md` status is stale

Says "post Wave 11" near the top; we're past Wave 22. Either update or
move to `docs/history/`.

### 4.4 No `docs/data-model.md`

The lookup-tables architecture is the most distinctive piece of the
project and there's no single doc explaining it. A 50-line "knowledge
lives in `src/<name>.js`, projects into `<name>` tables, consumed by FE
/ MCP via SQL" document would orient anyone touching the schema.

### 4.5 `src/web/index.html` lacks a top-of-file comment

For a 586-line file embedding CSS and JS, a 10-line header would help
future-readers (what it renders, what `/api/status` shape it expects,
where the constants come from).

### 4.6 Architect skill references may have drifted

The references in `oni-vision-plugin/skills/oni-architect/references/`
were authored against the Frosty Planet era. The SKILL.md
disclaimers this. Worth re-verifying one or two specifics (geyser
ranges, recipe yields) against the user's current save the next time
the daemon is running, but not blocking.

---

## Suggested wave structure

A reasonable order, batched into self-contained commits:

### Wave 23 — knowledge unification (highest-impact)
- Extract `SKILL_LABELS` to `src/skills.js` as array-of-objects.
- Add `morale_cost` as a computed `duplicants` column in the extractor.
  Move the rule to `src/skills.js`.
- Add `src/thresholds.js` (stale, stress, geyser quality, morale bar
  max) and surface via `/api/status` in a `thresholds` block.
- Drop the corresponding FE constants — read from the API response.
- Add a "Lookup tables" section to both `CLAUDE.md` and the
  `oni-vision` SKILL.md with worked JOIN examples.
- Tests: lookup-table round-trip; thresholds delivered in the API.

### Wave 24 — clean-code split
- `src/ui.js` → `src/skills.js` + `src/format.js` + slimmer `src/ui.js`.
- `src/web/index.html` → `index.html` + `app.js` + `styles.css`.
- `src/web.js` `serveStatic` learns to serve `.js` and `.css`.
- Web test grows: assert `/styles.css` and `/app.js` resolve with
  correct Content-Type.

### Wave 25 — correctness & contract tests
- Fail-loudly check for empty lookup tables.
- Lookup-table round-trip assertions on canonical SimHashes.
- Contract test: backend `formatMass`/`formatAge` ↔ FE `fmtMass`/`fmtAge`
  match for a fixed input table.
- Fix `tryListen` post-bind error handling.
- Privacy note in README; consider basename-only source_file logging.

### Wave 26 — documentation
- `CLAUDE.md` lookup-tables section + JOIN example.
- `docs/data-model.md` — the architecture story.
- Move shipped plan docs to `docs/history/`.
- Rewrite `docs/plan.md` status banner.
- Plugin install instructions (per Claude Code / Cowork).
- Resolve duplicate plugin-platform plan docs.
- Top-of-file comment in `src/web/index.html`.

### Wave 27 (optional) — plugin manifest cleanup
- Decide canonical: `.claude-plugin/plugin.json` vs. top-level
  `plugin.json` vs. `.mcp.json`.
- Verify against current Claude Code plugin spec.
- Delete the redundant files; document the layout.

---

## Out of scope (intentional)

- **Architect-skill content refresh** — the references are good
  enough for the Frosty Planet era; refresh when there's actual
  drift to fix.
- **`oni-vision-plugin/lib/queries.js` split** — cohesion is still
  fine at 577 lines.
- **MCP token re-optimization** — already shipped (Wave 14). The
  new `morale_cost` column in §1.2 may shave a few more tokens off
  `oni_status` if we expose it; that's a bonus, not the goal.
