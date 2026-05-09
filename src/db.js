// SQLite writer using node:sqlite (built into Node 22.5+, no native build).
// Schema is intentionally flat and indexed on the columns Claude is most
// likely to filter by.

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
     body_temperature REAL
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
     disease_id TEXT,
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
     disease_id TEXT,
     disease_count INTEGER
   )`,
  `CREATE INDEX idx_wo_prefab ON world_objects(prefab_id)`,
  `CREATE INDEX idx_wo_element ON world_objects(element_id)`,
  `CREATE TABLE storage_contents (
     building_id INTEGER NOT NULL,
     item_prefab_id TEXT,
     element_id TEXT,
     units REAL,
     temperature REAL,
     disease_id TEXT,
     disease_count INTEGER
   )`,
  `CREATE INDEX idx_sc_building ON storage_contents(building_id)`,
  `CREATE INDEX idx_sc_element ON storage_contents(element_id)`,
  `CREATE TABLE geysers (
     game_object_id INTEGER PRIMARY KEY,
     prefab_id TEXT NOT NULL,
     type_id TEXT,
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

const INSERTS = {
  save_meta: `INSERT INTO save_meta(key, value) VALUES (?, ?)`,
  object_groups: `INSERT INTO object_groups(prefab_id, count) VALUES (?, ?)`,
  game_objects: `INSERT INTO game_objects(id, instance_id, prefab_id, position_x, position_y, position_z, scale_x, scale_y, folder) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  behaviors: `INSERT INTO behaviors(id, game_object_id, name, template_data, extra_data) VALUES (?, ?, ?, ?, ?)`,
  duplicants: `INSERT INTO duplicants(game_object_id, instance_id, name, gender, arrival_time, voice_idx, current_role, target_role, total_experience, position_x, position_y, stress, calories, stamina, bladder, breath, hp, decor, immune, temperature_dupe, body_temperature) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  duplicant_traits: `INSERT INTO duplicant_traits(duplicant_id, trait) VALUES (?, ?)`,
  duplicant_skills: `INSERT INTO duplicant_skills(duplicant_id, skill) VALUES (?, ?)`,
  duplicant_attributes: `INSERT INTO duplicant_attributes(duplicant_id, attribute, level, experience) VALUES (?, ?, ?, ?)`,
  duplicant_effects: `INSERT INTO duplicant_effects(duplicant_id, effect, time_remaining) VALUES (?, ?, ?)`,
  duplicant_amounts: `INSERT INTO duplicant_amounts(duplicant_id, amount_name, value) VALUES (?, ?, ?)`,
  buildings: `INSERT INTO buildings(game_object_id, prefab_id, position_x, position_y, element_id, units, temperature, disease_id, disease_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  world_objects: `INSERT INTO world_objects(game_object_id, prefab_id, position_x, position_y, element_id, units, temperature, disease_id, disease_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  storage_contents: `INSERT INTO storage_contents(building_id, item_prefab_id, element_id, units, temperature, disease_id, disease_count) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  geysers: `INSERT INTO geysers(game_object_id, prefab_id, type_id, rate_roll, iteration_length_roll, iteration_percent_roll, year_length_roll, year_percent_roll, position_x, position_y) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  critters: `INSERT INTO critters(game_object_id, prefab_id, position_x, position_y, age, calories, hp, happiness, temperature) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
};

// Maps the column order in INSERTS to the row-object keys produced by extractors.
const COLUMNS = {
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
    "building_id", "item_prefab_id", "element_id", "units",
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
};

/** Build a fresh SQLite DB at `path`, populated from extractor output. */
export function writeDatabase(path, tables) {
  const db = new DatabaseSync(path);
  // Speed: bulk inserts inside a transaction with WAL off (we're rebuilding).
  db.exec("PRAGMA journal_mode = MEMORY");
  db.exec("PRAGMA synchronous = OFF");
  db.exec("BEGIN");
  for (const stmt of SCHEMA) db.exec(stmt);

  for (const [tableName, rows] of Object.entries(tables)) {
    if (!rows?.length) continue;
    const sql = INSERTS[tableName];
    const cols = COLUMNS[tableName];
    if (!sql || !cols) {
      throw new Error(`No insert defined for table ${tableName}`);
    }
    const stmt = db.prepare(sql);
    for (const row of rows) {
      stmt.run(...cols.map((c) => normalize(row[c])));
    }
  }

  db.exec("COMMIT");
  db.close();
}

function normalize(value) {
  if (value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "bigint") return value.toString();
  return value;
}
