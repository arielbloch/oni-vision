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
      `SELECT dp.chore_group, cg.label, dp.priority
       FROM duplicant_priorities dp
       LEFT JOIN chore_groups cg ON cg.name = dp.chore_group
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
              dp.chore_group, cg.label,
              dp.priority
       FROM duplicant_priorities dp
       JOIN duplicants d ON d.game_object_id = dp.duplicant_id
       LEFT JOIN chore_groups cg ON cg.name = dp.chore_group
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
  // LEFT JOIN geyser_types (written by pipeline from src/geyser_types.js)
  // so each row carries a human-readable type name alongside the numeric hash.
  const rows = db
    .prepare(
      `SELECT g.prefab_id, g.type_id,
              COALESCE(gtn.name, 'hash:' || g.type_id) AS type_name,
              g.position_x, g.position_y,
              ROUND(g.rate_roll, 3) AS rate_roll,
              ROUND(g.year_percent_roll, 3) AS year_percent_roll
       FROM geysers g
       LEFT JOIN geyser_types gtn ON gtn.type_id = g.type_id
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
  // Each branch wraps an aggregation and LEFT JOINs elements so Claude
  // gets human-readable names alongside the raw SimHash IDs.
  let sql;
  if (location === "storage") {
    sql = `
      SELECT agg.element_id, en.name AS element_name,
             SUM(agg.units) AS raw_units, COUNT(*) AS items
      FROM storage_contents agg
      LEFT JOIN elements en ON en.element_id = agg.element_id
      WHERE agg.element_id IS NOT NULL
      GROUP BY agg.element_id
      ORDER BY raw_units DESC LIMIT ?`;
  } else if (location === "world") {
    sql = `
      SELECT agg.element_id, en.name AS element_name,
             SUM(agg.units) AS raw_units, COUNT(*) AS items
      FROM world_objects agg
      LEFT JOIN elements en ON en.element_id = agg.element_id
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
      LEFT JOIN elements en ON en.element_id = sub.element_id
      GROUP BY sub.element_id
      ORDER BY raw_units DESC LIMIT ?`;
  }
  return db.prepare(sql).all(limit).map((r) => ({
    element_id: r.element_id,
    // Resolve element_id to a human-readable name via the lookup table written
    // by the pipeline (src/elements.js → elements). Falls back to the raw
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
 * Food items currently in storage, joined with foods for display names,
 * kcal values, and morale bonus. Grouped by prefab_id, sorted by stack count.
 *
 * Items whose prefab_id isn't in foods (e.g. new DLC food) still appear;
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
     LEFT JOIN foods fm ON fm.prefab_id = sc.item_prefab_id
     WHERE sc.item_prefab_id IS NOT NULL
       AND sc.element_id IS NULL
     GROUP BY sc.item_prefab_id
     ORDER BY qty DESC
     LIMIT ?`
  ).all(limit).map((r) => ({ ...r }));
}

// ---------------------------------------------------------------------------
// Research progress
// ---------------------------------------------------------------------------

/**
 * Tech-tree snapshot from the singleton `Research` behavior. Returns the
 * active/target tech, the global research-point inventory (basic, advanced,
 * space, nuclear, orbital), counts of completed vs incomplete techs, and
 * the list of techs that have accrued some points but aren't yet finished.
 *
 * Returns `null` if the save has no Research behavior (very early game).
 */
export function research(db) {
  const row = db.prepare(
    `SELECT
        json_extract(template_data, '$.saveData.activeResearchId') AS active_tech,
        json_extract(template_data, '$.saveData.targetResearchId') AS target_tech,
        json_extract(template_data, '$.globalPointInventory.PointsByTypeID') AS points_json,
        json_extract(template_data, '$.saveData.techs') AS techs_json
     FROM behaviors WHERE name = 'Research' LIMIT 1`
  ).get();
  if (!row) return null;

  let points = {};
  try {
    points = Object.fromEntries(JSON.parse(row.points_json ?? "[]"));
  } catch { /* malformed JSON — treat as empty */ }

  let techs = [];
  try {
    techs = JSON.parse(row.techs_json ?? "[]");
  } catch { /* malformed — treat as empty */ }

  const completed = techs.filter(t => t.complete).map(t => t.techId);
  const in_progress = techs
    .filter(t => !t.complete && (t.inventoryValues ?? []).some(v => v > 0))
    .map(t => ({
      tech_id: t.techId,
      progress: Object.fromEntries((t.inventoryIDs ?? []).map((id, i) => [id, t.inventoryValues?.[i] ?? 0])),
    }));

  return {
    active_tech: row.active_tech,
    target_tech: row.target_tech,
    points,
    techs_completed: completed.length,
    techs_total: techs.length,
    completed,
    in_progress,
  };
}

// ---------------------------------------------------------------------------
// Schedules
// ---------------------------------------------------------------------------

/**
 * Colony schedules from the singleton `ScheduleManager` behavior. Each
 * schedule has a 24-block timetable (Work / Downtime / Bedtime, with a
 * GroupId for sub-categorisation) and a list of assigned-dupe instance_ids.
 *
 * Returns `[]` if the save has no ScheduleManager (shouldn't happen on a
 * real colony, but defensive).
 */
export function schedules(db) {
  const row = db.prepare(
    `SELECT template_data FROM behaviors WHERE name = 'ScheduleManager' LIMIT 1`
  ).get();
  if (!row) return [];

  let data = {};
  try { data = JSON.parse(row.template_data ?? "{}"); } catch { return []; }

  return (data.schedules ?? []).map((s) => {
    const blocks = (s.blocks ?? []).map(b => b.name);
    // Compact block summary: count consecutive runs.
    // "Work×18, Downtime×2, Bedtime×4" is more useful than the raw 24 entries.
    const runs = [];
    let last = null;
    let count = 0;
    for (const name of blocks) {
      if (name === last) {
        count++;
      } else {
        if (last) runs.push(`${last}×${count}`);
        last = name;
        count = 1;
      }
    }
    if (last) runs.push(`${last}×${count}`);

    return {
      name: s.name ?? null,
      summary: runs.join(", "),
      assigned_instance_ids: (s.assigned ?? []).map(a => a.id).filter(Boolean),
    };
  });
}

// ---------------------------------------------------------------------------
// Power network
// ---------------------------------------------------------------------------

/**
 * Power-related buildings grouped by category. Walks `behaviors` looking
 * for `EnergyGenerator`, `EnergyConsumer`, and `PowerTransformer`,
 * joining back to `buildings` to surface prefab_id + position.
 *
 * Returns three buckets: generators, consumers, transformers — each with
 * the building's prefab and count. Useful for "what's drawing power" and
 * "what generates my electricity" questions without forcing oni_query.
 */
export function power(db) {
  const aggregate = (behaviorName) =>
    db.prepare(
      `SELECT b.prefab_id, COUNT(*) AS n
       FROM behaviors beh
       JOIN buildings b ON b.game_object_id = beh.game_object_id
       WHERE beh.name = ?
       GROUP BY b.prefab_id
       ORDER BY n DESC, b.prefab_id`
    ).all(behaviorName).map(r => ({ ...r }));

  return {
    generators: aggregate("EnergyGenerator"),
    consumers: aggregate("EnergyConsumer"),
    transformers: aggregate("PowerTransformer"),
  };
}

// ---------------------------------------------------------------------------
// Plants
// ---------------------------------------------------------------------------

/**
 * Plants currently on the map — every world_object that has a `Growing`
 * behavior — with their grow/wilt/harvest state pulled from sibling
 * behaviors (`WiltCondition`, `Harvestable`). The species name is the
 * raw prefab_id (the catalog of human-readable plant names would be a
 * future Wave; in the meantime, prefab_ids like "BristleBlossom",
 * "MealwoodFood", "SwampLily" are themselves descriptive).
 *
 * @param {object} opts
 * @param {boolean} [opts.wiltingOnly=false]  only return wilting plants
 * @param {boolean} [opts.readyOnly=false]    only return harvestable plants
 * @param {number}  [opts.limit=50]
 */
export function plants(db, { wiltingOnly = false, readyOnly = false, limit = 50 } = {}) {
  return db.prepare(
    `SELECT
        wo.prefab_id,
        wo.position_x, wo.position_y,
        wo.temperature,
        json_extract(MAX(CASE WHEN beh.name = 'WiltCondition' THEN beh.template_data END), '$.wilting')      AS wilting,
        json_extract(MAX(CASE WHEN beh.name = 'WiltCondition' THEN beh.template_data END), '$.goingToWilt') AS going_to_wilt,
        json_extract(MAX(CASE WHEN beh.name = 'Harvestable'   THEN beh.template_data END), '$.canBeHarvested') AS harvestable,
        json_extract(MAX(CASE WHEN beh.name = 'Harvestable'   THEN beh.template_data END), '$.numberOfUses')   AS uses_remaining
     FROM behaviors beh
     JOIN world_objects wo ON wo.game_object_id = beh.game_object_id
     WHERE beh.game_object_id IN (
       SELECT DISTINCT game_object_id FROM behaviors WHERE name = 'Growing'
     )
     GROUP BY wo.game_object_id
     HAVING (? = 0 OR wilting = 1)
        AND (? = 0 OR harvestable = 1)
     ORDER BY wo.prefab_id, wo.position_y DESC
     LIMIT ?`
  ).all(wiltingOnly ? 1 : 0, readyOnly ? 1 : 0, limit).map(r => ({ ...r }));
}

// ---------------------------------------------------------------------------
// Germ contamination
// ---------------------------------------------------------------------------

/**
 * Objects carrying germ contamination, sorted by germ count. Unions across
 * buildings, world_objects, and storage_contents (the three tables that
 * carry disease_id/disease_count columns). JOINs against `diseases` for
 * a human-readable disease name; unknown disease_ids fall back to `hash:N`.
 *
 * @param {object} opts
 * @param {number} [opts.minCount=1000]  ignore rows below this germ count
 *                                       (1000 is the rough threshold below
 *                                       which germs don't really matter)
 * @param {number} [opts.limit=20]
 */
export function germs(db, { minCount = 1000, limit = 20 } = {}) {
  return db.prepare(
    `WITH germy AS (
       SELECT 'building' AS source, prefab_id, disease_id, disease_count, position_x, position_y
         FROM buildings WHERE disease_id IS NOT NULL AND disease_count >= ?
       UNION ALL
       SELECT 'world_object' AS source, prefab_id, disease_id, disease_count, position_x, position_y
         FROM world_objects WHERE disease_id IS NOT NULL AND disease_count >= ?
       UNION ALL
       SELECT 'storage' AS source, item_prefab_id AS prefab_id, disease_id, disease_count,
              NULL AS position_x, NULL AS position_y
         FROM storage_contents WHERE disease_id IS NOT NULL AND disease_count >= ?
     )
     SELECT g.source, g.prefab_id,
            g.disease_id,
            COALESCE(d.name, 'hash:' || g.disease_id) AS disease_name,
            g.disease_count,
            g.position_x, g.position_y
     FROM germy g
     LEFT JOIN diseases d ON d.disease_id = g.disease_id
     ORDER BY g.disease_count DESC
     LIMIT ?`
  ).all(minCount, minCount, minCount, limit).map((r) => ({ ...r }));
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

  const top_dupes = dupes(db, { sort: "name", fields: ["name", "stress", "current_role"], limit: dupeLimit });
  // LEFT JOIN geyser_types so the MCP oni_status response includes
  // human-readable geyser names alongside the raw SimHash type_id.
  const geyser_types = db
    .prepare(
      `SELECT g.type_id, COALESCE(gtn.name, 'hash:' || g.type_id) AS type_name,
              COUNT(*) AS count
       FROM geysers g
       LEFT JOIN geyser_types gtn ON gtn.type_id = g.type_id
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
