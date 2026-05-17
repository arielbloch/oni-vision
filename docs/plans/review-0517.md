# Review plan — 2026-05-17

Post-Wave-27 review. The headline finding is that `src/ui.js` carries a
hardcoded geyser-name map that diverged from `src/geyser_types.js` (the
source of truth), causing the CLI status renderer to show wrong or
missing names for the majority of geyser types. Everything else is
minor. Waves are ordered by impact.

---

## Wave 28 — Fix stale GEYSER_NAMES in `src/ui.js` (critical)

### Problem

`src/ui.js` contains a hardcoded `GEYSER_NAMES` Map (20 entries) that
is out of sync with `src/geyser_types.js` (26 entries, the DB source of
truth). The divergence:

- **9 wrong hashes** — the SimHash IDs for Hydrogen Vent, Leaky Oil
  Fissure, and all seven metal volcanoes (Copper, Gold, Iron, Tungsten,
  Cobalt, Aluminum, Niobium) are stale. The CLI prints
  `hash:-1046145888` instead of "Hydrogen Vent" for any colony with
  these geysers.
- **14 types absent** — Polluted Water Vent, Cool Salt Slush Geyser,
  CO₂ Vent, Hot Polluted O₂ Vent, Infectious PO₂ Vent, plus the
  correct hashes for the nine wrong-hash entries above.
- **2 name mismatches** — `1280790313` is "Slush Geyser" in ui.js but
  "Cool Slush Geyser" in geyser_types.js; `1483840464` is "Chlorine
  Vent" vs "Chlorine Gas Vent".

### Fix

**`src/ui.js`**
- Remove the hardcoded `GEYSER_NAMES` Map.
- Import `GEYSER_TYPE_NAMES` from `./geyser_types.js`.
- Derive the Map at module load:
  ```js
  import { GEYSER_TYPE_NAMES } from "./geyser_types.js";
  const GEYSER_NAMES = new Map(GEYSER_TYPE_NAMES.map(e => [e.type_id, e.name]));
  ```
- The `geyserName()` function remains unchanged.

**`test/ui.test.js`** (or a new `test/geyser-names.test.js`)
- Add a test that asserts `GEYSER_NAMES` Map has the same size as
  `GEYSER_TYPE_NAMES` and that every `type_id` in
  `GEYSER_TYPE_NAMES` resolves to a non-`hash:…` string via
  `geyserName()`. This guards against future drift.

### Deliverables

| File | Change |
|------|--------|
| `src/ui.js` | Remove `GEYSER_NAMES` literal; derive from import |
| `test/ui.test.js` | Add geyser-name consistency guard |

---

## Wave 29 — Minor correctness & code quality fixes

Four small independent fixes. Commit together.

### 29.1 Auto-save path guard in `src/index.js`

**Problem:** `AUTO_SAVE_SEGMENT = /[\\/]auto_save[\\/]/` requires a
slash on both sides. A path ending at `auto_save` (no trailing slash)
is not matched. In practice chokidar fires on files *inside* the
folder, so a save file will always have a slash after `auto_save`. But
a directory-level event could slip through.

**Fix:** Change to `/[\\/]auto_save(?:[\\/]|$)/` so it also matches
at the end of a string. One-liner.

### 29.2 Loose equality in `src/extractors.js`

**Problem:** Line 250 uses `== null` while the rest of the file uses
strict `=== null` / `=== undefined`.

**Fix:** Replace `if (hash == null || priority == null)` with
`if (hash == null || priority == null)` — actually these *are* fine as
written (loose null-check catches both null and undefined, which is the
intent), so add a comment explaining this is intentional. Or convert to
`?? ` pattern consistently. Decision: add comment, no logic change.

### 29.3 HTTP 405 for non-GET requests in `src/web.js`

**Problem:** Any `POST`/`DELETE` to `/api/status` returns 404. Correct
status is 405 Method Not Allowed.

**Fix:** In the request handler, after matching the path, check
`req.method !== "GET"` and respond 405 before the query. Small change.

### 29.4 Port-fallback recursion → loop in `src/web.js`

**Problem:** `tryListen()` calls itself recursively on EADDRINUSE. The
10-attempt cap prevents a real stack overflow, but a loop is clearer.

**Fix:** Rewrite as a `for` loop with `await`ed promise inside.

### Deliverables

| File | Change |
|------|--------|
| `src/index.js` | Tighten AUTO_SAVE_SEGMENT regex |
| `src/extractors.js` | Comment the intentional loose null-check |
| `src/web.js` | 405 for non-GET; convert tryListen to iterative |

---

## Open / not worth fixing

- **DB path `join(outputDir, "current.sqlite")` repeated in three
  files** — the plugin copy is intentional (standalone, no parent
  imports). The status.js and web.js copies could share a helper, but
  the pattern is two lines and the abstraction isn't worth it.
- **Missing JSDoc on some exported functions** — the code is readable.
  Skip.
- **Config schema versioning** — hypothetical future issue; tackle if/when a
  breaking config change lands.
