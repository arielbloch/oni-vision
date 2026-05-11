// Pure query layer. All tools defined in mcp/server.js delegate to the
// functions here so we can unit-test them without standing up an MCP
// server. Every function takes a DatabaseSync handle and returns plain
// JSON (objects/arrays/scalars).

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HOME = homedir();

/**
 * Find the path to the oni-watcher's current.sqlite. Reads
 * ~/.oni-watcher/config.json (same convention as the watcher itself)
 * and falls back to ~/.oni-watcher/output/current.sqlite.
 */
export function resolveDbPath() {
  const candidates = [
    join(HOME, ".oni-watcher", "config.json"),
    join(HOME, ".config", "oni-watcher", "config.json"),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const raw = JSON.parse(readFileSync(path, "utf8"));
      const clean = {};
      for (const [k, v] of Object.entries(raw)) {
        if (!k.startsWith("_")) clean[k] = v;
      }
      if (typeof clean.outputDir === "string") {
        return join(clean.outputDir, "current.sqlite");
      }
    } catch {
      // fall through
    }
  }
  return join(HOME, ".oni-watcher", "output", "current.sqlite");
}

/** Headline facts from save_meta. */
export function saveMeta(db) {
  const rows = db.prepare("SELECT key, value FROM save_meta").all();
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  return {
    base_name: out.baseName ?? null,
    cycle: out.numberOfCycles != null ? Number(out.numberOfCycles) : null,
    duplicant_count: out.numberOfDuplicants != null ? Number(out.numberOfDuplicants) : null,
    save_version: out.saveVersion ?? null,
    parsed_at: out.parsed_at ?? null,
    source_file: out.source_file ?? null,
  };
}

/**
 * Seconds since `parsed_at`. Returns null if parsed_at is missing.
 * The MCP layer uses this to tell the model whether to nudge the user
 * to run the watcher.
 */
export function freshness(db) {
  const meta = saveMeta(db);
  if (!meta.parsed_at) return { parsed_at: null, age_seconds: null };
  const age = Math.max(0, Math.floor((Date.now() - new Date(meta.parsed_at).getTime()) / 1000));
  return { parsed_at: meta.parsed_at, age_seconds: age };
}

/**
 * Duplicant rows with optional sort/limit.
 *
 * SQL safety: the `sort` argument is interpolated into the query
 * (SQLite doesn't allow column names as bound parameters), so we
 * validate it against an allowlist BEFORE interpolation. Anything
 * not in `allowed` falls back to the default sort key — so an
 * adversarial caller passing `sort: "DROP TABLE; --"` gets stress
 * sort instead of a SQL injection.
 */
export function dupes(db, { sort = "stress", limit = 50 } = {}) {
  const allowed = new Set([
    "stress", "calories", "stamina", "bladder", "breath",
    "hp", "decor", "immune", "body_temperature", "name",
  ]);
  const col = allowed.has(sort) ? sort : "stress";
  const direction = col === "name" ? "ASC" : "DESC";
  // Project every column the SKILL.md advertises as a sort key. Without
  // this, sorting by `decor` would silently work but the user couldn't
  // see the values driving the sort order in the result rows.
  const sql = `
    SELECT name, gender, current_role, target_role,
           ROUND(stress, 2) AS stress,
           ROUND(calories, 0) AS calories,
           ROUND(stamina, 1) AS stamina,
           ROUND(bladder, 1) AS bladder,
           ROUND(breath, 1) AS breath,
           ROUND(hp, 1) AS hp,
           ROUND(decor, 1) AS decor,
           ROUND(immune, 1) AS immune,
           ROUND(body_temperature, 2) AS body_temperature
    FROM duplicants
    ORDER BY ${col} IS NULL, ${col} ${direction}
    LIMIT ?`;
  return db.prepare(sql).all(limit).map((r) => ({ ...r }));
}

/** Geyser list. */
export function geysers(db) {
  const rows = db
    .prepare(
      `SELECT prefab_id, type_id,
              position_x, position_y,
              rate_roll, year_percent_roll
       FROM geysers
       ORDER BY type_id, prefab_id`
    )
    .all();
  return rows.map((r) => ({ ...r }));
}

/**
 * Aggregate elements by mass, in storage / on the floor / both.
 * `location` ∈ "storage" | "world" | "both".
 */
export function resources(db, { location = "both", limit = 25 } = {}) {
  let sql;
  if (location === "storage") {
    sql = `
      SELECT element_id, ROUND(SUM(units), 2) AS total_units, COUNT(*) AS items
      FROM storage_contents
      WHERE element_id IS NOT NULL
      GROUP BY element_id
      ORDER BY total_units DESC LIMIT ?`;
  } else if (location === "world") {
    sql = `
      SELECT element_id, ROUND(SUM(units), 2) AS total_units, COUNT(*) AS items
      FROM world_objects
      WHERE element_id IS NOT NULL
      GROUP BY element_id
      ORDER BY total_units DESC LIMIT ?`;
  } else {
    sql = `
      SELECT element_id,
             ROUND(SUM(total_units), 2) AS total_units,
             SUM(items) AS items
      FROM (
        SELECT element_id, SUM(units) AS total_units, COUNT(*) AS items
        FROM world_objects WHERE element_id IS NOT NULL GROUP BY element_id
        UNION ALL
        SELECT element_id, SUM(units) AS total_units, COUNT(*) AS items
        FROM storage_contents WHERE element_id IS NOT NULL GROUP BY element_id
      )
      GROUP BY element_id
      ORDER BY total_units DESC LIMIT ?`;
  }
  return db.prepare(sql).all(limit).map((r) => ({ ...r }));
}

/**
 * Run a free-form SELECT. Refuses anything that isn't a single SELECT
 * statement so a confused or adversarial caller can't DROP/UPDATE/
 * ATTACH/DETACH/PRAGMA the DB.
 *
 * `params` is bound as positional `?` parameters. We must spread it into
 * the all() call — node:sqlite's all() takes varargs, so passing the
 * array directly would try to bind the array as a single value (which
 * fails with "Unknown named parameter '0'").
 */
export function query(db, sql, params = []) {
  const trimmed = String(sql).trim().replace(/;$/, "");
  // Multiple statements not allowed (a stray ; in the middle would be
  // caught by sqlite anyway, but reject explicitly for clarity).
  if (trimmed.includes(";")) {
    throw new Error("Only a single SELECT statement is allowed.");
  }
  // First non-comment word must be SELECT or WITH (a CTE-prefixed SELECT).
  const head = trimmed.replace(/^\s*(--[^\n]*\n|\/\*[\s\S]*?\*\/)\s*/g, "").slice(0, 16).toUpperCase();
  if (!head.startsWith("SELECT") && !head.startsWith("WITH")) {
    throw new Error("Only SELECT (or WITH … SELECT) statements are allowed.");
  }
  // PRAGMA, ATTACH, DETACH could in principle appear after WITH, but
  // sqlite parses them as separate statements; the single-statement
  // check above covers it.
  const paramList = Array.isArray(params) ? params : [params];
  return db.prepare(trimmed).all(...paramList).map((r) => ({ ...r }));
}
