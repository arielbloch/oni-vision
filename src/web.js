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
import { THRESHOLDS } from "./thresholds.js";
import { oxygenStats } from "./oxygen.js";
import { reportStats } from "./report.js";
import { GENERATOR_SPECS } from "./generators.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(HERE, "web");

// ── SSE client registry ───────────────────────────────────────────────────────

/** Timestamp of this server process start — sent with every SSE connect so
 *  tabs can detect a restart and do a full page reload to pick up new code. */
const SERVER_START_TS = Date.now();

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
      if (req.method !== "GET") {
        res.writeHead(405, { "Content-Type": "text/plain", "Allow": "GET" });
        res.end("method not allowed");
        return;
      }
      // Strip query string so /api/status?t=1 routes correctly.
      const url = (req.url ?? "/").split("?")[0];
      if (url === "/api/events")  return serveEvents(res);
      if (url === "/api/status")  return serveStatus(res, outputDir);
      if (url === "/" || url === "/index.html") return serveStatic(res, "index.html");
      if (url === "/app.js")    return serveStatic(res, "app.js");
      if (url === "/styles.css") return serveStatic(res, "styles.css");
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

  return tryListen(server, host, port);
}

/**
 * Attempt to bind on `port`; if EADDRINUSE, retry on port+1 up to
 * PORT_FALLBACK_LIMIT attempts. Resolves with the bound server.
 */
async function tryListen(server, host, port) {
  for (let attempt = 0; attempt <= PORT_FALLBACK_LIMIT; attempt++) {
    const p = port + attempt;
    const bound = await new Promise((resolve, reject) => {
      function onError(err) {
        server.removeListener("error", onError);
        if (err.code === "EADDRINUSE" && attempt < PORT_FALLBACK_LIMIT) {
          /* port in use, try next */
          resolve(false);
        } else {
          reject(err);
        }
      }
      server.once("error", onError);
      server.listen(p, host, () => {
        server.removeListener("error", onError);
        resolve(true);
      });
    });
    if (bound) {
      const addr = server.address();
      const realPort = typeof addr === "object" && addr ? addr.port : p;
      server.on("error", (err) => console.error(`oni-vision: server error — ${err.message}`));
      return server;
    }
  }
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
  const contentType =
    filename.endsWith(".html") ? "text/html; charset=utf-8" :
    filename.endsWith(".js")   ? "application/javascript; charset=utf-8" :
    filename.endsWith(".css")  ? "text/css; charset=utf-8" :
    "text/plain; charset=utf-8";
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
  // Send a reload event with this server's start timestamp. The tab compares
  // it against the last-seen timestamp stored in sessionStorage: if different,
  // it does a full page reload (picks up new JS/CSS); if same, just refreshes
  // data. This prevents reload loops while ensuring stale tabs update on restart.
  res.write(`event: reload\ndata: ${JSON.stringify({ ts: SERVER_START_TS })}\n\n`);

  sseClients.add(res);

  // Remove from the set when the client closes the connection.
  res.on("close", () => sseClients.delete(res));
}

/**
 * Add per-dupe skills, morale_cost, active effects, and boosted focus
 * (priority > 3) into the existing dupes array in place. Four bulk queries
 * keyed by dupe name (names are unique within a colony per ONI rules).
 */
function enrichDupes(db, dupes) {
  const skillsByName = new Map();
  for (const row of db.prepare(
    `SELECT d.name, GROUP_CONCAT(ds.skill, ',') AS skills
     FROM duplicants d
     LEFT JOIN duplicant_skills ds ON ds.duplicant_id = d.game_object_id
     GROUP BY d.game_object_id`
  ).all()) {
    skillsByName.set(row.name, row.skills ?? null);
  }

  const moraleCostByName = new Map();
  for (const row of db.prepare(`SELECT name, morale_cost FROM duplicants`).all()) {
    moraleCostByName.set(row.name, row.morale_cost ?? 0);
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

  const focusByName = new Map();
  for (const row of db.prepare(
    `SELECT d.name, dp.chore_group, COALESCE(cg.label, dp.chore_group) AS label, dp.priority
     FROM duplicant_priorities dp
     JOIN duplicants d ON d.game_object_id = dp.duplicant_id
     LEFT JOIN chore_groups cg ON cg.name = dp.chore_group
     WHERE dp.priority > 3
     ORDER BY dp.priority DESC, dp.chore_group`
  ).all()) {
    if (!focusByName.has(row.name)) focusByName.set(row.name, []);
    focusByName.get(row.name).push({ group: row.chore_group, label: row.label, priority: row.priority });
  }

  for (const dupe of dupes) {
    dupe.skills      = skillsByName.get(dupe.name)      ?? null;
    dupe.effects     = effectsByName.get(dupe.name)     ?? [];
    dupe.focus       = focusByName.get(dupe.name)       ?? [];
    dupe.morale_cost = moraleCostByName.get(dupe.name)  ?? 0;
  }
}

/**
 * Read the pinned resource list from WorldInventory, enriched with total
 * quantities from storage and world objects. Each entry: { name, hash,
 * total_units, is_element }. is_element=true means the hash is an element_id
 * and units are kg; false means a prefab item (seed, fabric, etc.) and units
 * are a raw count/mass from storage_contents.
 */
function readPinnedResources(db) {
  const row = db.prepare(
    `SELECT template_data FROM behaviors WHERE name = 'WorldInventory' LIMIT 1`
  ).get();
  if (!row) return [];
  let pinned;
  try {
    pinned = JSON.parse(row.template_data || "{}").pinnedResources ?? [];
  } catch { return []; }

  if (pinned.length === 0) return [];

  // Batch-query element totals (storage + world objects).
  const hashes = pinned.map(r => r.hash);
  const placeholders = hashes.map(() => "?").join(",");
  const elementTotals = new Map();
  for (const r of db.prepare(
    `SELECT CAST(element_id AS INTEGER) AS eid, SUM(units) AS total FROM (
       SELECT element_id, units FROM storage_contents WHERE CAST(element_id AS INTEGER) IN (${placeholders})
       UNION ALL
       SELECT element_id, units FROM world_objects   WHERE CAST(element_id AS INTEGER) IN (${placeholders}) AND units IS NOT NULL
     ) GROUP BY eid`
  ).all(...hashes, ...hashes)) {
    elementTotals.set(Number(r.eid), r.total ?? 0);
  }

  // Batch-query non-element prefab totals from storage_contents.
  const names = pinned.map(r => r.name);
  const namePlaceholders = names.map(() => "?").join(",");
  const prefabTotals = new Map();
  for (const r of db.prepare(
    `SELECT item_prefab_id, SUM(units) AS total
     FROM storage_contents WHERE item_prefab_id IN (${namePlaceholders})
     GROUP BY item_prefab_id`
  ).all(...names)) {
    prefabTotals.set(r.item_prefab_id, r.total ?? 0);
  }
  // Also count loose prefab world objects (seeds on the floor, etc.).
  for (const r of db.prepare(
    `SELECT prefab_id, COUNT(*) AS total
     FROM world_objects WHERE prefab_id IN (${namePlaceholders}) AND element_id IS NULL
     GROUP BY prefab_id`
  ).all(...names)) {
    prefabTotals.set(r.prefab_id, (prefabTotals.get(r.prefab_id) ?? 0) + r.total);
  }

  return pinned.map(r => {
    const elemTotal = elementTotals.get(Number(r.hash));
    if (elemTotal != null) {
      return { name: r.name, hash: r.hash, total_units: elemTotal, is_element: true };
    }
    return { name: r.name, hash: r.hash, total_units: prefabTotals.get(r.name) ?? 0, is_element: false };
  });
}

/**
 * Read the union of element hashes accepted by any TreeFilterable behaviour
 * (storage buildings). Used by the FE as the default stockpile filter.
 */
function readStockpileFilters(db) {
  const hashes = new Set();
  for (const row of db.prepare(
    `SELECT template_data FROM behaviors WHERE name = 'TreeFilterable'`
  ).all()) {
    try {
      const parsed = JSON.parse(row.template_data || "{}");
      for (const tag of parsed.acceptedTagSet ?? []) {
        if (tag.hash != null) hashes.add(tag.hash);
      }
    } catch { /* malformed JSON, skip */ }
  }
  return [...hashes];
}

/**
 * Serialize all lookup tables from current.sqlite for the FE. These are the
 * single source of truth (populated from src/*.js during buildOutputs); the
 * frontend never hardcodes a copy.
 */
function serveLookups(db) {
  const toMap = (rows, keyCol, valCol) =>
    Object.fromEntries(rows.map((r) => [String(r[keyCol]), r[valCol]]));

  return {
    elements: toMap(
      db.prepare("SELECT element_id, name FROM elements").all(),
      "element_id", "name"
    ),
    geyser_types: toMap(
      db.prepare("SELECT type_id, name FROM geyser_types").all(),
      "type_id", "name"
    ),
    foods: Object.fromEntries(
      db.prepare("SELECT prefab_id, name, kcal, morale FROM foods").all()
        .map((r) => [r.prefab_id, { name: r.name, kcal: r.kcal, morale: r.morale }])
    ),
    effects: Object.fromEntries(
      db.prepare("SELECT effect, label, severity FROM effects").all()
        .map((r) => [r.effect, { label: r.label, cls: r.severity }])
    ),
    skills: toMap(
      db.prepare("SELECT branch, label FROM skills").all(),
      "branch", "label"
    ),
    diseases: toMap(
      db.prepare("SELECT disease_id, name FROM diseases").all(),
      "disease_id", "name"
    ),
    // Chore groups indexed by `name` since duplicant_priorities joins on the
    // internal string. Carries full display metadata for the FE focus chips.
    chore_groups: Object.fromEntries(
      db.prepare("SELECT hash, name, label, domain, abbr, sort_order FROM chore_groups").all()
        .map((r) => [r.name, { hash: r.hash, label: r.label, domain: r.domain, abbr: r.abbr, sort_order: r.sort_order }])
    ),
  };
}

/**
 * Status endpoint. Returns a single JSON payload with the colony summary
 * (statusObject) plus per-dupe enrichment, per-geyser detail, food/resources
 * aggregates, in-game stockpile filters, all lookup tables, and the FE
 * thresholds. The FE consumes this on every refresh.
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
    // If the pipeline is mid-COMMIT, SQLite throws SQLITE_BUSY immediately.
    // Tell it to wait and retry automatically for up to 2 seconds.
    db.exec("PRAGMA busy_timeout = 2000");
    const payload = statusObject(db, { dupeLimit: 50 });

    enrichDupes(db, payload.top_dupes);

    // Per-geyser quality rolls. statusObject's grouped `geyser_types` is
    // discarded — the FE wants per-instance detail, not by-type counts.
    delete payload.geyser_types;
    payload.geysers = db.prepare(
      `SELECT type_id, rate_roll, year_percent_roll
       FROM geysers
       ORDER BY type_id, rate_roll DESC`
    ).all();

    // Food in storage sorted by morale DESC (best food first); includes name,
    // kcal, morale from the lookup so the FE can compute days without a
    // second JOIN against the FOOD map it holds in memory.
    // Exclude items in cooking buildings (ingredients being processed, not ready to eat)
    // and raw animal products that ONI doesn't count as available food stock.
    const COOKING_BUILDINGS  = `'CookingStation','GasGrill','ElectricGrill','MicrobeMusher','GasRange','FoodProcessor'`;
    const RAW_ANIMAL_ITEMS   = `'Meat','RawEgg','Mushroom'`;
    payload.food = db.prepare(
      `SELECT src.pid AS item_prefab_id, fm.name, fm.kcal, fm.morale, SUM(src.cnt) AS qty
       FROM (
         SELECT sc.item_prefab_id AS pid, COALESCE(SUM(sc.units), 0) AS cnt
         FROM storage_contents sc
         LEFT JOIN buildings b ON b.game_object_id = sc.owner_id
         WHERE (b.prefab_id IS NULL OR b.prefab_id NOT IN (${COOKING_BUILDINGS}))
           AND sc.item_prefab_id NOT IN (${RAW_ANIMAL_ITEMS})
         GROUP BY sc.item_prefab_id
         UNION ALL
         SELECT prefab_id AS pid, COALESCE(SUM(units), 0) AS cnt
         FROM world_objects
         WHERE prefab_id NOT IN (${RAW_ANIMAL_ITEMS})
         GROUP BY prefab_id
       ) src
       JOIN foods fm ON fm.prefab_id = src.pid
       GROUP BY src.pid
       HAVING qty > 0
       ORDER BY fm.morale DESC, (fm.kcal * SUM(src.cnt)) DESC
       LIMIT 30`
    ).all();

    // Every stored element (containers + loose), sorted by total mass. The
    // client filters this down to the user's selection or in-game filter.
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

    payload.stockpile_filters  = readStockpileFilters(db);
    payload.pinned_resources   = readPinnedResources(db);
    Object.assign(payload, serveLookups(db));
    payload.thresholds = THRESHOLDS;
    payload.generator_specs = GENERATOR_SPECS;
    payload.oxygen = oxygenStats(db);
    const rs = reportStats(db);
    payload.oxygen.report = rs.oxygen;
    payload.report = rs;

    // Discover active generator types and their current fuel elements directly
    // from storage_contents.  Generators idle because the battery is full still
    // have fuel in their internal storage, so they appear here.  The frontend
    // joins this against generator_specs (j_per_kg) to compute runway.
    const generatorFuels = db.prepare(
      `SELECT b.prefab_id AS generator_prefab,
              sc.element_id,
              sc.item_prefab_id AS fuel_prefab,
              SUM(sc.units)     AS stored_kg
       FROM buildings b
       JOIN behaviors beh ON beh.game_object_id = b.game_object_id
                         AND beh.name = 'EnergyGenerator'
       JOIN storage_contents sc ON sc.owner_id = b.game_object_id
       WHERE sc.element_id IS NOT NULL
       GROUP BY b.prefab_id, sc.element_id`
    ).all();

    // Warn server-side for any generator type not covered by GENERATOR_SPECS
    // so the operator knows to add a j_per_kg entry.
    for (const gf of generatorFuels) {
      if (!GENERATOR_SPECS[gf.generator_prefab]) {
        console.warn(
          `[power] Unknown generator "${gf.generator_prefab}" ` +
          `(fuel element_id ${gf.element_id} / prefab "${gf.fuel_prefab}") — ` +
          `add it to src/generators.js`
        );
      }
    }
    payload.generator_fuels = generatorFuels;

    payload.server_ts = SERVER_START_TS;

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
