# Web UI plan

A small browser dashboard for oni-vision. Three design options, ordered from "smallest first cut" to "nicest experience". All three serve the same content; they differ in how the page is delivered and how it refreshes.

## What it shows

The minimum viable surface, captured in `npm run status` already:

- **Header.** Colony name (big), cycle number (big).
- **Status strip.** "Parsed N seconds ago from `<save-file>`" plus a "live" indicator (green when oni-vision is running, dim when stale).
- **Headline counts.** Duplicants / critters / geysers / buildings.
- **Top stressed dupes.** Name, stress bar, role. 5 rows.
- **Geyser type counts.** `steam ×2`, `chlorine_vent ×1`, etc.
- **Stockpile.** Top 5 elements by mass.
- **Source file.** Full path on hover, in case the user has multiple colonies and wants to confirm.

A future tab/section can add per-dupe detail, trait/skill lookups, building inventory — but the v1 should fit on one screen.

## Wireframe (~480 px wide)

```
┌──────────────────────────────────────────────────┐
│  🪐 Cosmic Conundrum               Cycle 312     │
├──────────────────────────────────────────────────┤
│  ● Live · parsed 23s ago from my_colony.sav      │
├────────┬────────┬────────┬───────────────────────┤
│ Dupes  │ Geys.  │ Critt. │ Buildings             │
│   12   │   7    │   4    │     184               │
├────────┴────────┴────────┴───────────────────────┤
│ Top stressed dupes                               │
│   Meep   ████████░░ 76%  Digger                  │
│   Stinky █████░░░░░ 52%  Chef                    │
│   Liam   ███░░░░░░░ 28%  Operator                │
│   Mae    █░░░░░░░░░  8%  Researcher              │
│   …                                              │
├──────────────────────┬───────────────────────────┤
│ Geyser types         │ Stockpile (by mass)       │
│   steam       ×2     │   Algae       12.4 t      │
│   chlorine    ×1     │   Water        8.3 t      │
│   hot_water   ×1     │   Sandstone    4.1 t      │
│   …                  │   …                       │
└──────────────────────┴───────────────────────────┘
```

Dark mode by default. Monospace for the bars and numbers. No JavaScript libraries — the existing project ethos.

---

## Design A: Static HTML + JSON sidecar (smallest)

**How it works.** The daemon writes one additional file alongside `current.sqlite`: `current.status.json`, a small structured blob with everything the UI needs. The UI is a single static HTML file (`web/index.html`) that fetches `current.status.json` over `fetch()` every N seconds.

**Serving.** Open the HTML via `file://` in a browser — except that browsers block `file://` → `file://` fetch for security. So we need *some* HTTP server. The lightest:

```bash
npx http-server ~/.oni-vision/output -p 8080
# or:
python3 -m http.server -d ~/.oni-vision/output 8080
```

The user opens `http://localhost:8080/index.html` (the daemon writes the index.html there too on first run, or it's copied from `web/`).

**Refresh.** `setInterval(fetchStatus, 5000)`. The daemon updates the JSON atomically; the browser reads it atomically.

**Pros.**
- Zero new daemon logic except writing one extra file. ~30 lines added to `pipeline.js`.
- The HTML is fully static — easy to inspect, copy, tweak.
- Works in any browser, no SSE / WebSocket support needed.

**Cons.**
- Requires the user to start a separate HTTP server.
- Polling means up to N seconds stale even when nothing has changed.
- Two processes to remember to start.

---

## Design B: In-daemon HTTP server with polling (recommended MVP)

**How it works.** The oni-vision daemon process starts a tiny HTTP server on `localhost:8080` (configurable) alongside chokidar. The server has two endpoints:

- `GET /` — serves the static HTML page.
- `GET /api/status` — opens `current.sqlite` read-only, runs the same query set as `npm run status`, returns JSON.

**Refresh.** Same polling as Design A, but the server is in the same process as the daemon, so a user runs **one** command (`npm start --web`) and gets both. The HTTP server is `node:http`-based — no Express, no dependency churn.

**Pros.**
- Single process, single command. Best user experience.
- The status endpoint reuses the existing `lib/queries.js` and `ui.js` (or the plugin's `status()` function — both work).
- No new dependencies. Built-in `node:http` is enough.

**Cons.**
- Daemon now has two responsibilities. Not a big deal — the HTTP layer is ~100 lines.
- If the daemon is run on a remote/headless machine, the user has to forward the port. Easy with ssh.

**Wiring sketch:**

```js
// src/web.js (new)
import http from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { status as renderStatus } from "../oni-vision-plugin/lib/queries.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function startWeb({ port, outputDir }) {
  const server = http.createServer(async (req, res) => {
    if (req.url === "/api/status") {
      try {
        const db = new DatabaseSync(join(outputDir, "current.sqlite"), { readOnly: true });
        try {
          const payload = renderStatus(db);
          res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
          res.end(payload);
        } finally { db.close(); }
      } catch (err) {
        res.writeHead(503, { "Content-Type": "text/plain" });
        res.end(`oni-vision hasn't produced data yet: ${err.message}`);
      }
      return;
    }
    if (req.url === "/" || req.url === "/index.html") {
      const html = await readFile(join(__dirname, "web/index.html"));
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }
    res.writeHead(404); res.end("not found");
  });
  server.listen(port);
  return server;
}
```

`src/index.js` adds:

```js
if (config.web?.enabled) startWeb({ port: config.web.port ?? 8080, outputDir: config.outputDir });
```

And `.config-example.json` grows a `web: { enabled: true, port: 8080 }` block.

---

## Design C: SSE live dashboard (nicest UX)

**How it works.** Builds on Design B but adds a third endpoint:

- `GET /api/events` — Server-Sent Events stream. The daemon's `pipeline.js` fires an event after every successful parse; the SSE handler broadcasts to all open clients.

The HTML uses `new EventSource("/api/events")` to subscribe; on each `parsed` event it re-fetches `/api/status` and updates the DOM. No polling — the page reflects the save the instant the daemon finishes parsing it.

**Pros.**
- Feels alive. The "Parsed 0s ago" indicator counts up; flashes back to 0 when the game saves.
- No wasted requests when the colony isn't being saved.
- SSE is one-directional and trivially implementable in vanilla node:http — no `ws` dependency.

**Cons.**
- More moving parts (event broadcaster, connection management, heartbeat to prevent timeouts).
- A bit more code to maintain.

**Wiring sketch (additions only):**

```js
// pipeline.js, at the end of buildOutputs, after the trailing render:
events.emit("parsed", { savePath, parsedAt: new Date().toISOString() });

// web.js, additions:
import { EventEmitter } from "node:events";
export const events = new EventEmitter();

// inside the request handler:
if (req.url === "/api/events") {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const send = (data) => res.write(`event: parsed\ndata: ${JSON.stringify(data)}\n\n`);
  events.on("parsed", send);
  req.on("close", () => events.off("parsed", send));
  // heartbeat every 15s so proxies don't time out
  const hb = setInterval(() => res.write(": heartbeat\n\n"), 15000);
  req.on("close", () => clearInterval(hb));
  return;
}
```

---

## My recommendation

**Start with Design B.** Single-process, single-command UX matters more than the extra polish of SSE. Design B is ~150 LOC total (server + HTML) and ships value immediately. Upgrading to Design C is purely additive — same server, same endpoints, just a new `/api/events` route — so we don't lose anything by deferring it.

Design A is interesting only if we anticipate users wanting the UI on a different machine from the daemon, or wanting to host it via a CDN-style setup. Neither is a real use case today.

## Implementation plan if we go with Design B

1. **New module `src/web.js`** — `startWeb({ port, outputDir })` returns the http.Server.
2. **New static asset `src/web/index.html`** — single page, embedded CSS + JS (no build step), polls `/api/status` every 5 s. Renders the wireframe above.
3. **`src/index.js`** — call `startWeb()` when `config.web?.enabled` is truthy. Wire the server into the SIGINT shutdown so it closes cleanly.
4. **`.config-example.json`** — add the `web` block with documentation lines (`_comment_web`, `_comment_web_port`).
5. **`README.md`** — new short section: "Web dashboard. Add `web: { enabled: true }` to your config; visit `http://localhost:8080` while the daemon runs."
6. **Tests.** A spawn-based smoke test isn't necessary — the renderer and queries are already covered. We could add a unit test that hits the server via a localhost socket; nice-to-have but skip for v1.
7. **Plugin reuse.** The server's `/api/status` is the same data as the MCP `oni_status` tool. Importing it from the plugin's `lib/queries.js` makes the web UI a thin presentation layer over the same query layer the model uses. One source of truth.

Total: ~200 LOC across two new files and three small edits. About a half-day of work.

## Non-goals (for the first version)

- Authentication. The server binds to `127.0.0.1` only — anyone with shell access to the machine already has the SQLite anyway.
- Multi-colony switching. We watch one save dir at a time today. Multi-colony is a separate feature.
- Charts / time-series. The DB is a snapshot, not a history. Add a `history/` mode in `pipeline.js` first if we want trend charts.
- Editing / write-back. The UI is read-only. ONI saves are not something we ever want to write to.
- Building it as a separate npm package. Lives in this repo, ships in this repo. The plugin is the user-installable thing; the web UI is a local-machine convenience.
