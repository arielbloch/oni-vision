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
      const url = req.url ?? "/";
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
      res.end(`internal error: ${err.message}`);
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
 */
function serveStatus(res, outputDir) {
  const dbPath = join(outputDir, "current.sqlite");
  if (!existsSync(dbPath)) {
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      error: "no parse yet",
      message: "oni-vision hasn't produced a current.sqlite. Has the daemon parsed a save?",
      db_path: dbPath,
    }));
    return;
  }
  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const payload = statusObject(db, { dupeLimit: 9999 });

    // Enrich top_dupes with mastered skills. We re-query by name (names are
    // unique within a colony — ONI enforces this at the game level).
    const skillStmt = db.prepare(
      `SELECT GROUP_CONCAT(ds.skill, ',') AS skills
       FROM duplicants d
       LEFT JOIN duplicant_skills ds ON ds.duplicant_id = d.game_object_id
       WHERE d.name = ?
       GROUP BY d.game_object_id`
    );
    for (const dupe of payload.top_dupes) {
      const row = skillStmt.get(dupe.name);
      dupe.skills = row?.skills ?? null;
    }

    res.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
    });
    res.end(JSON.stringify(payload));
  } finally {
    if (db) {
      try { db.close(); } catch { /* ignore */ }
    }
  }
}
