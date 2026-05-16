// SQLite writer using node:sqlite (built into Node 22.5+, no native build).
// Schema is intentionally flat and indexed on the columns Claude is most
// likely to filter by.
//
// Insert SQL is generated from the column lists in TABLE_COLUMNS, and rows
// are bound by name (`@col`) — so adding a column means updating exactly
// one place (the schema CREATE TABLE) and one place (the columns array).
// We never have to keep INSERT SQL and column order in sync by hand.

import { DatabaseSync } from "node:sqlite";

const SCHEMA = [
  `CREATE TABLE save_meta (
     key TEXT PRIMARY KEY,
     value TEXT
   )`,
  `CREATE TABLE object_groups (
     prefab_id TEXT PRIMARY KEY,
     count INTEGER
   )`,
  `CREATE TABLE game_objects (
     id INTEGER PRIMARY KEY,
     instance_id INTEGER,
     prefab_id TEXT NOT NULL,
     position_x REAL,
     position_y REAL,
     position_z REAL,
     scale_x REAL,
     scale_y REAL,
     folder INTEGER
   )`,
  `CREATE INDEX idx_go_prefab ON game_objects(prefab_id)`,
  `CREATE INDEX idx_go_instance ON game_objects(instance_id)`,
  `CREATE TABLE behaviors (
     id INTEGER PRIMARY KEY,
     game_object_id INTEGER NOT NULL,
     name TEXT NOT NULL,
     template_data TEXT,
     extra_data TEXT
   )`,
  `CREATE INDEX idx_b_go ON behaviors(game_object_id)`,
  `CREATE INDEX idx_b_name ON behaviors(name)`,
  `CREATE TABLE duplicants (
     game_object_id INTEGER PRIMARY KEY,
     instance_id INTEGER,
     name TEXT,
     gender TEXT,
     arrival_time REAL,
     voice_idx INTEGER,
     current_role TEXT,
     target_role TEXT,
     total_experience REAL,
     position_x REAL,
     position_y REAL,
     stress REAL,
     calories REAL,
     stamina REAL,
     bladder REAL,
     breath REAL,
     hp REAL,
     decor REAL,
     immune REAL,
     temperature_dupe REAL,
     body_temperature REAL,
     morale_cost INTEGER
   )`,
  `CREATE TABLE duplicant_traits (
     duplicant_id INTEGER NOT NULL,
     trait TEXT NOT NULL
   )`,
  `CREATE INDEX idx_dt_dupe ON duplicant_traits(duplicant_id)`,
  `CREATE TABLE duplicant_skills (
     duplicant_id INTEGER NOT NULL,
     skill TEXT NOT NULL
   )`,
  `CREATE INDEX idx_ds_dupe ON duplicant_skills(duplicant_id)`,
  `CREATE TABLE duplicant_attributes (
     duplicant_id INTEGER NOT NULL,
     attribute TEXT NOT NULL,
     level REAL,
     experience REAL
   )`,
  `CREATE INDEX idx_da_dupe ON duplicant_attributes(duplicant_id)`,
  `CREATE TABLE duplicant_effects (
     duplicant_id INTEGER NOT NULL,
     effect TEXT NOT NULL,
     time_remaining REAL
   )`,
  `CREATE INDEX idx_de_dupe ON duplicant_effects(duplicant_id)`,
  `CREATE TABLE duplicant_amounts (
     duplicant_id INTEGER NOT NULL,
     amount_name TEXT NOT NULL,
     value REAL
   )`,
  `CREATE INDEX idx_dam_dupe ON duplicant_amounts(duplicant_id)`,
  `CREATE TABLE buildings (
     game_object_id INTEGER PRIMARY KEY,
     prefab_id TEXT NOT NULL,
     position_x REAL,
     position_y REAL,
     element_id TEXT,
     units REAL,
     temperature REAL,
     disease_id INTEGER,
     disease_count INTEGER
   )`,
  `CREATE INDEX idx_b_prefab ON buildings(prefab_id)`,
  `CREATE INDEX idx_b_element ON buildings(element_id)`,
  // world_objects: anything with PrimaryElement that isn't a placed building,
  // dupe, critter, or geyser. Captures dropped debris, food, plants, eggs,
  // raw materials, etc. — separate from `buildings` so building counts are
  // not polluted by every loose lump of algae on the map.
  `CREATE TABLE world_objects (
     game_object_id INTEGER PRIMARY KEY,
     prefab_id TEXT NOT NULL,
     position_x REAL,
     position_y REAL,
     element_id TEXT,
     units REAL,
     temperature REAL,
     disease_id INTEGER,
     disease_count INTEGER
   )`,
  `CREATE INDEX idx_wo_prefab ON world_objects(prefab_id)`,
  `CREATE INDEX idx_wo_element ON world_objects(element_id)`,
  // owner_id references either buildings.game_object_id or
  // world_objects.game_object_id — whichever object owned the Storage
  // behavior. It used to be called building_id, but after Wave 1 split
  // out world_objects from buildings the name was lying.
  `CREATE TABLE storage_contents (
     owner_id INTEGER NOT NULL,
     item_prefab_id TEXT,
     element_id TEXT,
     units REAL,
     temperature REAL,
     disease_id INTEGER,
     disease_count INTEGER
   )`,
  `CREATE INDEX idx_sc_owner ON storage_contents(owner_id)`,
  `CREATE INDEX idx_sc_element ON storage_contents(element_id)`,
  `CREATE TABLE geysers (
     game_object_id INTEGER PRIMARY KEY,
     prefab_id TEXT NOT NULL,
     type_id INTEGER,
     rate_roll REAL,
     iteration_length_roll REAL,
     iteration_percent_roll REAL,
     year_length_roll REAL,
     year_percent_roll REAL,
     position_x REAL,
     position_y REAL
   )`,
  `CREATE INDEX idx_g_type ON geysers(type_id)`,
  `CREATE TABLE critters (
     game_object_id INTEGER PRIMARY KEY,
     prefab_id TEXT NOT NULL,
     position_x REAL,
     position_y REAL,
     age REAL,
     calories REAL,
     hp REAL,
     happiness REAL,
     temperature REAL
   )`,
  `CREATE INDEX idx_c_prefab ON critters(prefab_id)`,

  // ── Static lookup tables ─────────────────────────────────────────────────
  // Populated once per build from the source-of-truth JS files in src/.
  // Written here so both the web frontend and MCP plugin can JOIN against them
  // without maintaining separate hardcoded copies.

  `CREATE TABLE element_names (
     element_id INTEGER PRIMARY KEY,
     name       TEXT NOT NULL
   )`,
  `CREATE TABLE geyser_type_names (
     type_id INTEGER PRIMARY KEY,
     name    TEXT NOT NULL
   )`,
  `CREATE TABLE food_meta (
     prefab_id TEXT PRIMARY KEY,
     name      TEXT NOT NULL,
     kcal      REAL NOT NULL,
     morale    INTEGER NOT NULL
   )`,
  `CREATE TABLE effect_labels (
     effect   TEXT PRIMARY KEY,
     label    TEXT NOT NULL,
     severity TEXT NOT NULL
   )`,
  `CREATE TABLE skill_labels (
     branch TEXT PRIMARY KEY,
     label  TEXT NOT NULL
   )`,
  `CREATE TABLE chore_group_names (
     hash  INTEGER PRIMARY KEY,
     name  TEXT NOT NULL,
     label TEXT NOT NULL
   )`,
  `CREATE TABLE duplicant_priorities (
     duplicant_id INTEGER NOT NULL,
     chore_group  TEXT NOT NULL,
     priority     INTEGER NOT NULL
   )`,
  `CREATE INDEX idx_dp_dupe ON duplicant_priorities(duplicant_id)`,

  // Convenience views.
  `CREATE VIEW v_resources_in_storage AS
     SELECT element_id, COUNT(*) AS items, SUM(units) AS total_units
     FROM storage_contents
     WHERE element_id IS NOT NULL
     GROUP BY element_id`,
  `CREATE VIEW v_geysers_summary AS
     SELECT type_id, COUNT(*) AS count
     FROM geysers
     GROUP BY type_id`,
  `CREATE VIEW v_buildings_by_prefab AS
     SELECT prefab_id, COUNT(*) AS count
     FROM buildings
     GROUP BY prefab_id`,
  `CREATE VIEW v_world_objects_by_element AS
     SELECT element_id, COUNT(*) AS items, ROUND(SUM(units), 2) AS total_units
     FROM world_objects
     WHERE element_id IS NOT NULL
     GROUP BY element_id`,
];

// Authoritative column lists. Insert SQL is generated from these so adding a
// new column means editing exactly two places: the CREATE TABLE in SCHEMA
// above, and the array below.
export const TABLE_COLUMNS = {
  save_meta: ["key", "value"],
  object_groups: ["prefab_id", "count"],
  game_objects: [
    "id", "instance_id", "prefab_id",
    "position_x", "position_y", "position_z",
    "scale_x", "scale_y", "folder",
  ],
  behaviors: ["id", "game_object_id", "name", "template_data", "extra_data"],
  duplicants: [
    "game_object_id", "instance_id", "name", "gender",
    "arrival_time", "voice_idx", "current_role", "target_role",
    "total_experience", "position_x", "position_y",
    "stress", "calories", "stamina", "bladder", "breath",
    "hp", "decor", "immune", "temperature_dupe", "body_temperature",
    "morale_cost",
  ],
  duplicant_traits: ["duplicant_id", "trait"],
  duplicant_skills: ["duplicant_id", "skill"],
  duplicant_attributes: ["duplicant_id", "attribute", "level", "experience"],
  duplicant_effects: ["duplicant_id", "effect", "time_remaining"],
  duplicant_amounts: ["duplicant_id", "amount_name", "value"],
  buildings: [
    "game_object_id", "prefab_id", "position_x", "position_y",
    "element_id", "units", "temperature", "disease_id", "disease_count",
  ],
  world_objects: [
    "game_object_id", "prefab_id", "position_x", "position_y",
    "element_id", "units", "temperature", "disease_id", "disease_count",
  ],
  storage_contents: [
    "owner_id", "item_prefab_id", "element_id", "units",
    "temperature", "disease_id", "disease_count",
  ],
  geysers: [
    "game_object_id", "prefab_id", "type_id",
    "rate_roll", "iteration_length_roll", "iteration_percent_roll",
    "year_length_roll", "year_percent_roll",
    "position_x", "position_y",
  ],
  critters: [
    "game_object_id", "prefab_id", "position_x", "position_y",
    "age", "calories", "hp", "happiness", "temperature",
  ],
  // Lookup tables (static, populated from JS source files during build).
  element_names:    ["element_id", "name"],
  geyser_type_names: ["type_id", "name"],
  food_meta:        ["prefab_id", "name", "kcal", "morale"],
  effect_labels:    ["effect", "label", "severity"],
  skill_labels:     ["branch", "label"],
  chore_group_names:     ["hash", "name", "label"],
  duplicant_priorities:  ["duplicant_id", "chore_group", "priority"],
};

function buildInsertSql(tableName, cols) {
  const colList = cols.join(", ");
  const params = cols.map((c) => `@${c}`).join(", ");
  return `INSERT INTO ${tableName}(${colList}) VALUES (${params})`;
}

// Lookup tables that must always be non-empty after a complete pipeline run.
// An empty row set means the source JS module was accidentally cleared —
// fail loudly rather than silently writing a DB where every JOIN returns NULL.
const REQUIRED_LOOKUP_TABLES = [
  "element_names",
  "geyser_type_names",
  "food_meta",
  "effect_labels",
  "skill_labels",
  "chore_group_names",
];

/**
 * Throw if any required lookup table is absent or empty in `tables`.
 * Call this in pipeline.js after all lookup tables have been projected.
 */
export function assertLookupTablesPopulated(tables) {
  for (const name of REQUIRED_LOOKUP_TABLES) {
    if (!tables[name]?.length) {
      throw new Error(
        `Required lookup table "${name}" is empty or missing. ` +
        `Check the corresponding src/${name}.js export.`
      );
    }
  }
}

/** Build a fresh SQLite DB at `path`, populated from extractor output. */
export function writeDatabase(path, tables) {
  const db = new DatabaseSync(path);
  // Speed pragmas for bulk insert. SAFETY NOTE: journal_mode=MEMORY +
  // synchronous=OFF means a process kill mid-COMMIT can leave the DB
  // file inconsistent. Pipeline.js mitigates this by writing to a temp
  // path and atomically rename()-ing into place only after this function
  // returns; readers never see the temp file. So a crash here just
  // strands an abandoned tmp file, which is fine.
  db.exec("PRAGMA journal_mode = MEMORY");
  db.exec("PRAGMA synchronous = OFF");
  db.exec("BEGIN");
  for (const stmt of SCHEMA) db.exec(stmt);

  for (const [tableName, rows] of Object.entries(tables)) {
    if (!rows?.length) continue;
    const cols = TABLE_COLUMNS[tableName];
    if (!cols) {
      throw new Error(`No column list defined for table ${tableName}`);
    }
    const stmt = db.prepare(buildInsertSql(tableName, cols));
    for (const row of rows) {
      const bound = toBindObject(row, cols);
      try {
        stmt.run(bound);
      } catch (err) {
        // node:sqlite gives us "Provided value cannot be bound to SQLite
        // parameter N" with no hint of which table/column N corresponds
        // to. Surface enough context to debug it.
        throw new Error(
          `Insert into "${tableName}" failed: ${err.message}. ` +
          `Bound row: ${diagnosticRowDump(bound, cols)}`,
          { cause: err }
        );
      }
    }
  }

  db.exec("COMMIT");
  db.close();
}

/**
 * Build a {@col: value} object suitable for named-parameter binding,
 * normalizing types that node:sqlite can't bind directly.
 */
function toBindObject(row, cols) {
  const out = {};
  for (const c of cols) out[c] = normalize(row[c]);
  return out;
}

/**
 * Coerce arbitrary JS values into something node:sqlite can bind.
 *
 * SQLite can bind null, number, string, BigInt (with caveats), and
 * Uint8Array. Everything else needs translation:
 *   - undefined → null
 *   - boolean → 0/1 (SQLite has no native bool type)
 *   - bigint → string (we don't want to surface int-vs-bigint quirks
 *     downstream; a string preserves the value losslessly for keys)
 *   - Symbol → its description, or the Symbol's stringified form
 *   - Date → ISO timestamp
 *   - function → null (shouldn't happen but be defensive)
 *   - any other object/array (e.g. a Map or DLC-shaped composite value
 *     that leaked through an extractor) → JSON-stringified, so the row
 *     loads as a TEXT cell instead of crashing the whole pipeline.
 *
 * This is intentionally permissive: if an extractor accidentally emits
 * a non-primitive value for a column that should be scalar, the insert
 * still succeeds and the table is queryable. The downstream cost is
 * the column may carry a JSON string instead of the expected type —
 * better than losing 300k rows because of one weird save.
 */
function normalize(value) {
  if (value === undefined || value === null) return null;
  const t = typeof value;
  if (t === "number" || t === "string") return value;
  if (t === "boolean") return value ? 1 : 0;
  if (t === "bigint") return value.toString();
  if (t === "symbol") return value.description ?? String(value);
  if (t === "function") return null;
  if (value instanceof Date) return value.toISOString();
  // Object, array, Map, Set, etc. JSON.stringify handles arrays and
  // plain objects; Map/Set become "{}" by default, so convert first.
  try {
    if (value instanceof Map) return JSON.stringify(Object.fromEntries(value));
    if (value instanceof Set) return JSON.stringify([...value]);
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Format up to 6 fields of a bound row for an error message. */
function diagnosticRowDump(bound, cols) {
  const preview = cols.slice(0, 12).map((c) => {
    const v = bound[c];
    let s = v === null ? "null" : typeof v === "string" ? JSON.stringify(v.slice(0, 60)) : String(v);
    if (s.length > 80) s = s.slice(0, 77) + "...";
    return `${c}=${s} (${typeof v})`;
  });
  return `{ ${preview.join(", ")}${cols.length > 12 ? ", ..." : ""} }`;
}
