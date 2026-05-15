// Pure query layer. All tools defined in mcp/server.js delegate to the
// functions here so we can unit-test them without standing up an MCP
// server. Every function takes a DatabaseSync handle and returns plain
// JSON (objects/arrays/scalars) or — for the aggregators — a pre-rendered
// TSV-block string.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HOME = homedir();

/**
 * Find the path to the oni-vision's current.sqlite. Reads
 * ~/.oni-vision/config.json (same convention as the daemon itself)
 * and falls back to ~/.oni-vision/output/current.sqlite.
 *
 * NOTE: this intentionally duplicates the JSON-parsing / _-key-stripping
 * logic in ../../src/paths.js rather than importing from it. The plugin
 * is designed to be installable on its own — it must not depend on any
 * parent-repo source at runtime. If the config schema ever changes, both
 * places need to update.
 */
export function resolveDbPath() {
  const candidates = [
    join(HOME, ".oni-vision", "config.json"),
    join(HOME, ".config", "oni-vision", "config.json"),
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
  return join(HOME, ".oni-vision", "output", "current.sqlite");
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Render an array of plain objects as a TSV block: tab-separated values,
 * one row per line, header line first.
 *
 * Token efficiency vs JSON-array-of-objects: ~50% fewer tokens because
 * column names appear once in the header instead of repeating per row.
 *
 * Cell values that contain tabs, newlines, or carriage returns are
 * escaped (`\t`, `\n`, `\r`, `\\`) so the format stays parseable. Most
 * of our columns (names, prefab IDs, element IDs) never need escaping;
 * the edge cases that do are `oni_query` results (`behaviors.template_data`
 * is JSON-stringified and may contain newlines) and user-supplied free
 * text (colony base name, theoretically).
 */
export function toTsv(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return "";
  // Use the first row's key order so we get a stable, predictable header.
  // Callers can shape the header by controlling field order in the SELECT.
  const cols = Object.keys(rows[0]);
  const header = cols.join("\t");
  const body = rows
    .map((r) => cols.map((c) => escapeTsv(r[c])).join("\t"))
    .join("\n");
  return `${header}\n${body}`;
}

/** Collapse newlines/CRs in a value for single-line contexts. */
function oneLine(v) {
  if (v == null) return "";
  return String(v).replace(/[\r\n]+/g, " ");
}

/** Stringify a cell value for TSV output, escaping format-breaking chars. */
function escapeTsv(v) {
  if (v == null) return "";
  const s = typeof v === "number" ? String(v) : String(v);
  if (s.indexOf("\\") < 0 && s.indexOf("\t") < 0 && s.indexOf("\n") < 0 && s.indexOf("\r") < 0) {
    return s; // fast path — the vast majority of cells are clean
  }
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\t/g, "\\t")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
}

// ---------------------------------------------------------------------------
// Headline facts
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Duplicants
// ---------------------------------------------------------------------------

// Every column the model can project / sort by. SQLite can't bind column
// names as parameters, so we validate against this allowlist before
// interpolating into the query (any name not here falls back to default).
const DUPE_COLUMNS = [
  "name", "gender", "current_role", "target_role",
  "stress", "calories", "stamina", "bladder", "breath",
  "hp", "decor", "immune", "body_temperature",
];

/**
 * Duplicant rows.
 *
 * @param {object} opts
 * @param {string}   [opts.sort="stress"]   sort key (DUPE_COLUMNS allowlist)
 * @param {string[]} [opts.fields]          project only these columns; default = all
 * @param {number}   [opts.limit=12]        row cap (was 50 pre-optimization; 12 covers a full colony)
 *
 * SQL safety: `sort` and `fields` are interpolated. Both go through the
 * DUPE_COLUMNS allowlist first — anything outside the allowlist is
 * dropped (sort falls back to "stress"; fields contributes nothing).
 */
export function dupes(db, { sort = "stress", fields, limit = 12 } = {}) {
  const sortCol = DUPE_COLUMNS.includes(sort) ? sort : "stress";
  const direction = sortCol === "name" ? "ASC" : "DESC";

  // Project either the user-requested fields (intersected with the allowlist)
  // or the full set if `fields` was omitted / empty / had nothing valid.
  const projected = Array.isArray(fields)
    ? fields.filter((f) => DUPE_COLUMNS.includes(f))
    : [];
  const cols = projected.length > 0 ? projected : DUPE_COLUMNS;
  const select = cols.map(columnSelectExpr).join(", ");

  const sql = `
    SELECT ${select}
    FROM duplicants
    ORDER BY ${sortCol} IS NULL, ${sortCol} ${direction}
    LIMIT ?`;
  return db.prepare(sql).all(limit).map((r) => ({ ...r }));
}

/**
 * Per-column SELECT expression. Numeric fields are rounded so we don't
 * leak float noise into responses (12.500000001 → 12.5).
 */
function columnSelectExpr(col) {
  switch (col) {
    case "stress":
    case "stamina":
    case "bladder":
    case "breath":
    case "hp":
    case "decor":
    case "immune":
      return `ROUND(${col}, 1) AS ${col}`;
    case "calories":
      return `ROUND(${col}, 0) AS ${col}`; // calories are kcal — integers are fine
    case "body_temperature":
      return `ROUND(${col}, 2) AS ${col}`; // Kelvin, 2 decimals
    default:
      return col;
  }
}

/**
 * Everything we know about one duplicant in a single payload: vitals,
 * traits, mastered skills, attribute levels, active effects. Replaces
 * ~4 separate tool calls.
 */
export function dupeDetail(db, name) {
  const dupe = db
    .prepare(
      `SELECT game_object_id, name, gender, current_role, target_role,
              ROUND(stress, 1) AS stress,
              ROUND(calories, 0) AS calories,
              ROUND(stamina, 1) AS stamina,
              ROUND(bladder, 1) AS bladder,
              ROUND(breath, 1) AS breath,
              ROUND(hp, 1) AS hp,
              ROUND(decor, 1) AS decor,
              ROUND(immune, 1) AS immune,
              ROUND(body_temperature, 2) AS body_temperature
       FROM duplicants
       WHERE name = ?`
    )
    .get(name);
  if (!dupe) return null;

  const id = dupe.game_object_id;
  const traits = db
    .prepare("SELECT trait FROM duplicant_traits WHERE duplicant_id = ? ORDER BY trait")
    .all(id)
    .map((r) => r.trait);
  const skills = db
    .prepare("SELECT skill FROM duplicant_skills WHERE duplicant_id = ? ORDER BY skill")
    .all(id)
    .map((r) => r.skill);
  const attributes = db
    .prepare(
      `SELECT attribute, level, ROUND(experience, 1) AS experience
       FROM duplicant_attributes WHERE duplicant_id = ? ORDER BY attribute`
    )
    .all(id)
    .map((r) => ({ ...r }));
  const effects = db
    .prepare(
      `SELECT effect, ROUND(time_remaining, 1) AS time_remaining
       FROM duplicant_effects WHERE duplicant_id = ? ORDER BY effect`
    )
    .all(id)
    .map((r) => ({ ...r }));

  const priorities = db
    .prepare(
      `SELECT dp.chore_group, cgn.label, dp.priority
       FROM duplicant_priorities dp
       LEFT JOIN chore_group_names cgn ON cgn.name = dp.chore_group
       WHERE dp.duplicant_id = ?
       ORDER BY dp.priority DESC, dp.chore_group`
    )
    .all(id)
    .map((r) => ({ ...r }));

  return { ...dupe, traits, skills, attributes, effects, priorities };
}

// ---------------------------------------------------------------------------
// Priorities for all dupes
// ---------------------------------------------------------------------------

/**
 * Chore group priorities for every dupe. Returns one row per (dupe, group)
 * pair where priority != 3 (i.e., non-default). Default priority (3) is
 * omitted to keep the response compact; callers should treat a missing group
 * as priority 3.
 */
export function priorities(db) {
  return db
    .prepare(
      `SELECT d.name AS dupe_name,
              dp.chore_group, cgn.label,
              dp.priority
       FROM duplicant_priorities dp
       JOIN duplicants d ON d.game_object_id = dp.duplicant_id
       LEFT JOIN chore_group_names cgn ON cgn.name = dp.chore_group
       WHERE dp.priority != 3
       ORDER BY d.name, dp.priority DESC, dp.chore_group`
    )
    .all()
    .map((r) => ({ ...r }));
}

// ---------------------------------------------------------------------------
// Geysers
// ---------------------------------------------------------------------------

/** Geyser list. */
export function geysers(db) {
  // LEFT JOIN geyser_type_names (written by pipeline from src/geyser_types.js)
  // so each row carries a human-readable type name alongside the numeric hash.
  const rows = db
    .prepare(
      `SELECT g.prefab_id, g.type_id,
              COALESCE(gtn.name, 'hash:' || g.type_id) AS type_name,
              g.position_x, g.position_y,
              ROUND(g.rate_roll, 3) AS rate_roll,
              ROUND(g.year_percent_roll, 3) AS year_percent_roll
       FROM geysers g
       LEFT JOIN geyser_type_names gtn ON gtn.type_id = g.type_id
       ORDER BY g.type_id, g.prefab_id`
    )
    .all();
  return rows.map((r) => ({ ...r }));
}

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

/**
 * Aggregate elements by mass, in storage / on the floor / both.
 * `location` ∈ "storage" | "world" | "both".
 *
 * Default limit lowered to 10 (was 25). Totals >= 100 kg are reported as
 * integers — the 2-decimal precision on bulk mass aggregates is noise.
 */
export function resources(db, { location = "both", limit = 10 } = {}) {
  // Each branch wraps an aggregation and LEFT JOINs element_names so Claude
  // gets human-readable names alongside the raw SimHash IDs.
  let sql;
  if (location === "storage") {
    sql = `
      SELECT agg.element_id, en.name AS element_name,
             SUM(agg.units) AS raw_units, COUNT(*) AS items
      FROM storage_contents agg
      LEFT JOIN element_names en ON en.element_id = agg.element_id
      WHERE agg.element_id IS NOT NULL
      GROUP BY agg.element_id
      ORDER BY raw_units DESC LIMIT ?`;
  } else if (location === "world") {
    sql = `
      SELECT agg.element_id, en.name AS element_name,
             SUM(agg.units) AS raw_units, COUNT(*) AS items
      FROM world_objects agg
      LEFT JOIN element_names en ON en.element_id = agg.element_id
      WHERE agg.element_id IS NOT NULL
      GROUP BY agg.element_id
      ORDER BY raw_units DESC LIMIT ?`;
  } else {
    sql = `
      SELECT sub.element_id, en.name AS element_name,
             SUM(sub.raw_units) AS raw_units,
             SUM(sub.items) AS items
      FROM (
        SELECT element_id, SUM(units) AS raw_units, COUNT(*) AS items
        FROM world_objects WHERE element_id IS NOT NULL GROUP BY element_id
        UNION ALL
        SELECT element_id, SUM(units) AS raw_units, COUNT(*) AS items
        FROM storage_contents WHERE element_id IS NOT NULL GROUP BY element_id
      ) sub
      LEFT JOIN element_names en ON en.element_id = sub.element_id
      GROUP BY sub.element_id
      ORDER BY raw_units DESC LIMIT ?`;
  }
  return db.prepare(sql).all(limit).map((r) => ({
    element_id: r.element_id,
    // Resolve element_id to a human-readable name via the lookup table written
    // by the pipeline (src/elements.js → element_names). Falls back to the raw
    // hash if the element isn't in the table (e.g. unknown DLC element).
    element_name: r.element_name ?? `id:${r.element_id}`,
    total_units: r.raw_units >= 100 ? Math.round(r.raw_units) : Number(r.raw_units.toFixed(2)),
    items: r.items,
  }));
}

// ---------------------------------------------------------------------------
// Food in storage
// ---------------------------------------------------------------------------

/**
 * Food items currently in storage, joined with food_meta for display names,
 * kcal values, and morale bonus. Grouped by prefab_id, sorted by stack count.
 *
 * Items whose prefab_id isn't in food_meta (e.g. new DLC food) still appear;
 * name/kcal/morale are null for those rows so callers can handle gracefully.
 *
 * @param {object} opts
 * @param {number} [opts.limit=20]
 */
export function food(db, { limit = 20 } = {}) {
  return db.prepare(
    `SELECT sc.item_prefab_id AS prefab_id,
            fm.name,
            fm.kcal,
            fm.morale,
            COUNT(*) AS qty
     FROM storage_contents sc
     LEFT JOIN food_meta fm ON fm.prefab_id = sc.item_prefab_id
     WHERE sc.item_prefab_id IS NOT NULL
       AND sc.element_id IS NULL
     GROUP BY sc.item_prefab_id
     ORDER BY qty DESC
     LIMIT ?`
  ).all(limit).map((r) => ({ ...r }));
}

// ---------------------------------------------------------------------------
// Free-form SELECT
// ---------------------------------------------------------------------------

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
  let paramList;
  if (params == null) paramList = [];
  else if (Array.isArray(params)) paramList = params;
  else paramList = [params]; // object → named-param binding, scalar → bind as the first ?
  return db.prepare(trimmed).all(...paramList).map((r) => ({ ...r }));
}

// ---------------------------------------------------------------------------
// Pre-aggregated single-call status
// ---------------------------------------------------------------------------

/**
 * Compact, human-readable colony snapshot in a single string. Combines
 * the most-asked-for slices: header facts + top stressed dupes + geyser
 * type counts + top elements by mass.
 *
 * Returns a TSV-block string ("key=value" lines for headers, then
 * named TSV tables separated by blank lines). Token efficiency: one
 * tool call replaces 4-5 separate ones plus their envelopes.
 */
export function status(db, opts = {}) {
  const o = statusObject(db, opts);
  return formatStatusBlock(o);
}

/**
 * Same data as `status()` but as a structured object for non-TSV consumers
 * (the web UI's /api/status endpoint, future GUIs, etc.). Returns:
 *
 *   {
 *     base_name, cycle, save_version, parsed_at, age_seconds, source_file,
 *     counts: { duplicants, critters, geysers, buildings },
 *     top_dupes: [{ name, stress, current_role }, ...],
 *     geyser_types: [{ type_id, type_name, count }, ...],
 *     top_resources: [{ element_id, element_name, total_units, items }, ...],
 *   }
 */
export function statusObject(db, { dupeLimit = 5, geyserLimit = 10, resourceLimit = 5 } = {}) {
  const meta = saveMeta(db);
  const fresh = freshness(db);

  const counts = {
    duplicants: db.prepare("SELECT COUNT(*) AS n FROM duplicants").get().n,
    critters: db.prepare("SELECT COUNT(*) AS n FROM critters").get().n,
    geysers: db.prepare("SELECT COUNT(*) AS n FROM geysers").get().n,
    buildings: db.prepare("SELECT COUNT(*) AS n FROM buildings").get().n,
  };

  const top_dupes = dupes(db, { sort: "stress", fields: ["name", "stress", "current_role"], limit: dupeLimit });
  // LEFT JOIN geyser_type_names so the MCP oni_status response includes
  // human-readable geyser names alongside the raw SimHash type_id.
  const geyser_types = db
    .prepare(
      `SELECT g.type_id, COALESCE(gtn.name, 'hash:' || g.type_id) AS type_name,
              COUNT(*) AS count
       FROM geysers g
       LEFT JOIN geyser_type_names gtn ON gtn.type_id = g.type_id
       GROUP BY g.type_id
       ORDER BY count DESC, g.type_id
       LIMIT ?`
    )
    .all(geyserLimit)
    .map((r) => ({ ...r }));
  const top_resources = resources(db, { location: "both", limit: resourceLimit });

  return {
    base_name: meta.base_name,
    cycle: meta.cycle,
    save_version: meta.save_version,
    parsed_at: meta.parsed_at,
    age_seconds: fresh.age_seconds,
    source_file: meta.source_file,
    counts,
    top_dupes,
    geyser_types,
    top_resources,
  };
}

/** Render a statusObject() result as the TSV-block format used by oni_status. */
function formatStatusBlock(o) {
  const sections = [];
  // Header lines are key=value. Escape any newline/CR in the value side
  // so a multi-line value (an unlikely-but-possible base name) can't
  // break the format by introducing a stray newline mid-block.
  const kv = (k, v) => `${k}=${oneLine(v)}`;
  sections.push(kv("base_name", o.base_name ?? ""));
  sections.push(kv("cycle", o.cycle ?? ""));
  sections.push(kv("save_version", o.save_version ?? ""));
  sections.push(kv("duplicants", o.counts.duplicants));
  sections.push(kv("critters", o.counts.critters));
  sections.push(kv("geysers", o.counts.geysers));
  sections.push(kv("buildings", o.counts.buildings));
  if (o.age_seconds != null) {
    sections.push(`parsed_at_age_seconds=${o.age_seconds}`);
  }

  if (o.top_dupes.length > 0) {
    sections.push("");
    sections.push("# top dupes by stress");
    sections.push(toTsv(o.top_dupes));
  }
  if (o.geyser_types.length > 0) {
    sections.push("");
    sections.push("# geyser types");
    sections.push(toTsv(o.geyser_types));
  }
  if (o.top_resources.length > 0) {
    sections.push("");
    sections.push("# top elements by mass");
    sections.push(toTsv(o.top_resources));
  }

  return sections.join("\n");
}

// ---------------------------------------------------------------------------
// Schema introspection
// ---------------------------------------------------------------------------

/**
 * Compact list of every queryable table/view with its column names.
 * Lets the model compose oni_query() calls without needing CLAUDE.md
 * baked into its system prompt.
 */
export function schema(db) {
  // List tables and views in alphabetical order, with their columns.
  // Filtered to skip internal sqlite_* tables.
  const objects = db
    .prepare(
      `SELECT name, type FROM sqlite_master
       WHERE type IN ('table', 'view')
         AND name NOT LIKE 'sqlite_%'
       ORDER BY type, name`
    )
    .all();

  // Validate name before interpolating into PRAGMA — sqlite_master names
  // come from our own schema, but we guard anyway in case of corruption.
  const SAFE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
  const lines = [];
  for (const obj of objects) {
    if (!SAFE_NAME.test(obj.name)) continue; // skip any malformed name
    const cols = db
      .prepare(`PRAGMA table_info("${obj.name}")`)
      .all()
      .map((c) => c.name);
    lines.push(`${obj.type} ${obj.name}: ${cols.join(", ")}`);
  }
  return lines.join("\n");
}
