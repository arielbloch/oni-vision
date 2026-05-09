// Human-friendly smoke run. Prints what the extractor produces from the
// shared test fixture, then runs a handful of representative queries
// against the resulting SQLite. For automated regression checks, see
// `npm test` (test/*.test.js use the same fixture).

import { extractAll } from "./src/extractors.js";
import { writeDatabase } from "./src/db.js";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FAKE_SAVE } from "./test/fixture.js";

const tables = extractAll(FAKE_SAVE);
tables.save_meta.push({ key: "parsed_at", value: new Date().toISOString() });
tables.save_meta.push({ key: "source_file", value: "<smoke-test>" });

console.log("Row counts:");
for (const [k, v] of Object.entries(tables)) console.log(`  ${k}: ${v.length}`);

const dir = mkdtempSync(join(tmpdir(), "oni-smoke-"));
const dbPath = join(dir, "smoke.sqlite");
writeDatabase(dbPath, tables);
console.log(`Wrote ${dbPath}`);

const db = new DatabaseSync(dbPath);
const queries = [
  "SELECT key, value FROM save_meta WHERE key IN ('numberOfCycles','numberOfDuplicants','baseName','parsed_at')",
  "SELECT name, ROUND(stress,2) AS stress, current_role FROM duplicants",
  "SELECT trait FROM duplicant_traits",
  "SELECT skill FROM duplicant_skills",
  "SELECT attribute, level FROM duplicant_attributes",
  "SELECT type_id, position_x, position_y FROM geysers",
  "SELECT prefab_id, element_id, units FROM buildings",
  "SELECT prefab_id, element_id, units FROM world_objects",
  "SELECT owner_id, item_prefab_id, element_id, units FROM storage_contents",
  "SELECT prefab_id, calories, age FROM critters",
  "SELECT element_id, total_units FROM v_resources_in_storage",
  "SELECT element_id, total_units FROM v_world_objects_by_element",
  "SELECT type_id, count FROM v_geysers_summary",
];
for (const q of queries) {
  console.log(`\nQ: ${q}`);
  for (const row of db.prepare(q).all()) console.log("  ", row);
}
