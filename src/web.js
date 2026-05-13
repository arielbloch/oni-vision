// In-process HTTP server for the oni-vision web dashboard.
//
// Runs alongside chokidar inside the daemon when config.web.enabled is true.
// Localhost-only by default (no auth: anyone with shell access to this box
// already has the SQLite). Two endpoints:
//
//   GET /             → static dashboard HTML
//   GET /api/status   → JSON snapshot of the colony state
//
// The status JSON is the same data structure as the MCP plugin's
// statusObject() — one source of truth between the web UI and the
// Claude-facing tool. See docs/web-ui-plan.md (Design B) for context.

import http from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { DatabaseSync } from "node:sqlite";

import { statusObject } from "../oni-vision-plugin/lib/queries.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(HERE, "web");

/**
 * Start the HTTP server. Returns a Promise resolving to the server handle
 * once it's actually listening, so callers can wire shutdown logic.
 *
 * @param {object} opts
 * @param {number} [opts.port=8080]      port to bind
 * @param {string} [opts.host="127.0.0.1"] host/interface to bind
 * @param {string} opts.outputDir        directory containing current.sqlite
 */
export function startWeb({ port = 8080, host = "127.0.0.1", outputDir }) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = req.url ?? "/";
      if (url === "/api/status") return serveStatus(res, outputDir);
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

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const addr = server.address();
      const realPort = typeof addr === "object" && addr ? addr.port : port;
      console.log(`[web] listening on http://${host}:${realPort}`);
      resolve(server);
    });
  });
}

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
    const payload = statusObject(db);
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
