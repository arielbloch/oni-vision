// In-process HTTP server for the oni-vision web dashboard.
//
// Runs alongside chokidar inside the daemon when config.web.enabled is true.
// Localhost-only by default (no auth: anyone with shell access to this box
// already has the SQLite). Endpoints:
//
//   GET /             → static dashboard HTML
//   GET /api/status   → JSON snapshot of the colony state (enriched for the UI)
//   GET /api/events   → Server-Sent Events stream; pushes a "parse" event
//                       whenever the daemon finishes processing a new save

import http from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { DatabaseSync } from "node:sqlite";

import { statusObject } from "../oni-vision-plugin/lib/queries.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(HERE, "web");

// ── SSE client registry ───────────────────────────────────────────────────────

/** Set of active SSE response objects. */
const sseClients = new Set();

/**
 * Push a "parse" event to all connected SSE clients. Called by index.js
 * immediately after buildOutputs() completes so the browser refreshes
 * without waiting for the next poll cycle.
 */
export function notifyClients() {
  if (sseClients.size === 0) return;
  const msg = `event: parse\ndata: {}\n\n`;
  for (const res of sseClients) {
    try { res.write(msg); } catch { /* client disconnected */ }
  }
}

// ── server factory ────────────────────────────────────────────────────────────

/**
 * Start the HTTP server. Returns a Promise resolving to the server handle
 * once it's actually listening, so callers can wire shutdown logic.
 *
 * If the requested port is already in use, automatically tries the next
 * port up to PORT_FALLBACK_LIMIT times before giving up. This makes the
 * default-on web server resilient to another process sitting on 8080.
 *
 * @param {object} opts
 * @param {number} [opts.port=8080]        first port to try
 * @param {string} [opts.host="127.0.0.1"] host/interface to bind
 * @param {string} opts.outputDir          directory containing current.sqlite
 */
const PORT_FALLBACK_LIMIT = 10;

export function startWeb({ port = 8080, host = "127.0.0.1", outputDir }) {
  const server = http.createServer(async (req, res) => {
    try {
      // Strip query string so /api/status?t=1 routes correctly.
      const url = (req.url ?? "/").split("?")[0];
      if (url === "/api/events")  return serveEvents(res);
      if (url === "/api/status")  return serveStatus(res, outputDir);
      if (url === "/" || url === "/index.html") return serveStatic(res, "index.html");
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("not found");
    } catch (err) {
      console.error(`[web] ${req.method} ${req.url}: ${err.stack || err.message}`);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain" });
      }
      // Avoid leaking internal paths in the response body.
      res.end("internal server error");
    }
  });

  return tryListen(server, host, port, 0);
}

/**
 * Attempt to bind on `port`; if EADDRINUSE, retry on port+1 up to
 * PORT_FALLBACK_LIMIT attempts. Resolves with the bound server.
 */
function tryListen(server, host, port, attempt) {
  return new Promise((resolve, reject) => {
    server.once("error", (err) => {
      if (err.code === "EADDRINUSE" && attempt < PORT_FALLBACK_LIMIT) {
        server.removeAllListeners("error");
        console.warn(`[web] port ${port} in use, trying ${port + 1}…`);
        resolve(tryListen(server, host, port + 1, attempt + 1));
      } else {
        reject(err);
      }
    });
    server.listen(port, host, () => {
      const addr = server.address();
      const realPort = typeof addr === "object" && addr ? addr.port : port;
      console.log(`[web] listening on http://${host}:${realPort}`);
      resolve(server);
    });
  });
}

// ── route handlers ────────────────────────────────────────────────────────────

async function serveStatic(res, filename) {
  const path = join(WEB_ROOT, filename);
  if (!existsSync(path)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end(`not found: ${filename}`);
    return;
  }
  const body = await readFile(path);
  const contentType = filename.endsWith(".html") ? "text/html; charset=utf-8" : "text/plain; charset=utf-8";
  res.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-cache" });
  res.end(body);
}

/** Server-Sent Events: keep the connection alive; push events via notifyClients(). */
function serveEvents(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    // Allow the browser to reconnect after the daemon restarts.
    "Retry": "3000",
  });
  // Send an immediate comment so the browser knows it's connected.
  res.write(": connected\n\n");

  sseClients.add(res);

  // Remove from the set when the client closes the connection.
  res.on("close", () => sseClients.delete(res));
}

/**
 * Status endpoint. Wraps statusObject() and enriches the payload with:
 *   - per-dupe mastered skills (from duplicant_skills)
 *   - per-dupe active effects/diseases (from duplicant_effects)
 *   - individual geyser quality rolls (replaces the grouped geyser_types)
 *   - food in storage by type (from storage_contents)
 *   - all stored elements and in-game stockpile filter settings
 *   - lookup tables (element_names, geyser_type_names, food_meta,
 *     effect_labels, skill_labels) queried from DB so the frontend
 *     needs no hardcoded copies
 */
function serveStatus(res, outputDir) {
  const dbPath = join(outputDir, "current.sqlite");
  if (!existsSync(dbPath)) {
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      error: "no parse yet",
      message: "oni-vision hasn't produced a current.sqlite. Has the daemon parsed a save?",
      db_path: "current.sqlite",
    }));
    return;
  }
  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const payload = statusObject(db, { dupeLimit: 50 });

    // ── Dupe enrichment: skills + active effects ──────────────────────────────
    // Two bulk queries keyed by dupe name (unique within a colony per ONI rules).

    const skillsByName = new Map();
    for (const row of db.prepare(
      `SELECT d.name, GROUP_CONCAT(ds.skill, ',') AS skills
       FROM duplicants d
       LEFT JOIN duplicant_skills ds ON ds.duplicant_id = d.game_object_id
       GROUP BY d.game_object_id`
    ).all()) {
      skillsByName.set(row.name, row.skills ?? null);
    }

    const effectsByName = new Map();
    for (const row of db.prepare(
      `SELECT d.name, de.effect
       FROM duplicant_effects de
       JOIN duplicants d ON d.game_object_id = de.duplicant_id
       WHERE de.time_remaining > 0 OR de.time_remaining IS NULL`
    ).all()) {
      if (!effectsByName.has(row.name)) effectsByName.set(row.name, []);
      effectsByName.get(row.name).push(row.effect);
    }

    // Per-dupe boosted priorities (chore_group priority > 3 only).
    const focusByName = new Map();
    for (const row of db.prepare(
      `SELECT d.name, dp.chore_group, COALESCE(cgn.label, dp.chore_group) AS label, dp.priority
       FROM duplicant_priorities dp
       JOIN duplicants d ON d.game_object_id = dp.duplicant_id
       LEFT JOIN chore_group_names cgn ON cgn.name = dp.chore_group
       WHERE dp.priority > 3
       ORDER BY dp.priority DESC, dp.chore_group`
    ).all()) {
      if (!focusByName.has(row.name)) focusByName.set(row.name, []);
      focusByName.get(row.name).push({ group: row.chore_group, label: row.label, priority: row.priority });
    }

    // Per-dupe unspent skill points.
    // ONI formula: cumulative XP threshold for n points = 1000*n*(n+1)/2
    // → n = floor((-1 + sqrt(1 + 8*xp/1000)) / 2)
    // Spent = number of mastered skills; available = max(0, earned - spent).
    const skillPtsByName = new Map();
    for (const row of db.prepare(
      `SELECT d.name,
              MAX(0, CAST((-1 + SQRT(1 + 8.0 * d.total_experience / 1000)) / 2 AS INTEGER)
                  - COUNT(ds.skill)) AS skill_points
       FROM duplicants d
       LEFT JOIN duplicant_skills ds ON ds.duplicant_id = d.game_object_id
       GROUP BY d.game_object_id`
    ).all()) {
      skillPtsByName.set(row.name, row.skill_points ?? 0);
    }

    for (const dupe of payload.top_dupes) {
      dupe.skills       = skillsByName.get(dupe.name)   ?? null;
      dupe.effects      = effectsByName.get(dupe.name)  ?? [];
      dupe.focus        = focusByName.get(dupe.name)    ?? [];
      dupe.skill_points = skillPtsByName.get(dupe.name) ?? 0;
    }

    // ── Geysers: individual rows with quality rolls ───────────────────────────
    // Replace the grouped geyser_types from statusObject with per-geyser data.
    payload.geyser_types = db.prepare(
      `SELECT type_id, rate_roll, year_percent_roll
       FROM geysers
       ORDER BY type_id, rate_roll DESC`
    ).all();

    // ── Food by type in storage ───────────────────────────────────────────────
    // Counts stacks of each food item across all storage buildings.
    // The client maps item_prefab_id → { name, kcal, morale } for display.
    payload.food = db.prepare(
      `SELECT item_prefab_id, COUNT(*) AS qty
       FROM storage_contents
       WHERE item_prefab_id IS NOT NULL AND element_id IS NULL
       GROUP BY item_prefab_id
       ORDER BY qty DESC
       LIMIT 30`
    ).all();

    // ── All stored elements (for the user-configurable stockpile picker) ──────
    // Returns every element found in containers or loose in the world, sorted
    // by total mass. The client filters this down to the user's selection.
    payload.all_resources = db.prepare(
      `SELECT element_id, SUM(units) AS total_units
       FROM (
         SELECT element_id, units FROM storage_contents WHERE element_id IS NOT NULL
         UNION ALL
         SELECT element_id, units FROM world_objects   WHERE element_id IS NOT NULL
       )
       GROUP BY element_id
       ORDER BY total_units DESC`
    ).all();

    // ── In-game storage filter settings (TreeFilterable) ─────────────────────
    // Union of all element hashes accepted by any storage building. Used as
    // the default stockpile display in the UI before the user customises it.
    const stockpileFilters = new Set();
    for (const row of db.prepare(
      `SELECT template_data FROM behaviors WHERE name = 'TreeFilterable'`
    ).all()) {
      try {
        const parsed = JSON.parse(row.template_data || "{}");
        for (const tag of parsed.acceptedTagSet ?? []) {
          if (tag.hash != null) stockpileFilters.add(tag.hash);
        }
      } catch { /* malformed JSON, skip */ }
    }
    payload.stockpile_filters = [...stockpileFilters];

    // ── Lookup tables from DB (single source of truth) ────────────────────────
    // These are populated into current.sqlite during buildOutputs() from the
    // src/*.js source files. Serving them here lets the frontend drop all its
    // hardcoded JS tables and always stay in sync with the parser.
    const toMap = (rows, keyCol, valCol) =>
      Object.fromEntries(rows.map((r) => [String(r[keyCol]), r[valCol]]));

    payload.element_names = toMap(
      db.prepare("SELECT element_id, name FROM element_names").all(),
      "element_id", "name"
    );
    payload.geyser_type_names = toMap(
      db.prepare("SELECT type_id, name FROM geyser_type_names").all(),
      "type_id", "name"
    );
    payload.food_meta = Object.fromEntries(
      db.prepare("SELECT prefab_id, name, kcal, morale FROM food_meta").all()
        .map((r) => [r.prefab_id, { name: r.name, kcal: r.kcal, morale: r.morale }])
    );
    payload.effect_labels = Object.fromEntries(
      db.prepare("SELECT effect, label, severity FROM effect_labels").all()
        .map((r) => [r.effect, { label: r.label, cls: r.severity }])
    );
    payload.skill_labels = toMap(
      db.prepare("SELECT branch, label FROM skill_labels").all(),
      "branch", "label"
    );

    res.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
    });
    res.end(JSON.stringify(payload));
  } catch (err) {
    console.error(`[web] serveStatus: ${err.stack || err.message}`);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
    }
    res.end(JSON.stringify({ error: "internal server error" }));
  } finally {
    if (db) {
      try { db.close(); } catch { /* ignore */ }
    }
  }
}
