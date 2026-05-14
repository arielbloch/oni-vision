// Smoke run: exercise the extractor + DB writer + a handful of
// representative queries against the shared FAKE_SAVE fixture.
//
// Two usage modes:
//   1. CLI (`npm run smoke`)            — prints row counts and query
//                                         output for human eyeballing.
//   2. Imported from a test             — runSmoke({ silent: true })
//                                         returns the row counts and
//                                         query results without printing,
//                                         and throws on any failure so
//                                         the test fails loudly.

import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { extractAll } from "./src/extractors.js";
import { writeDatabase } from "./src/db.js";
import { FAKE_SAVE } from "./test/fixture.js";

const QUERIES = [
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

/**
 * Run the end-to-end smoke pipeline. Returns the row counts and the
 * query result rows so callers can assert on them. Throws if any step
 * fails (extractor error, DB write error, SQLite error on a query).
 *
 * @param {object} [opts]
 * @param {boolean} [opts.silent=false]  suppress console output
 */
export function runSmoke({ silent = false } = {}) {
  const log = silent ? () => {} : (...args) => console.log(...args);

  const tables = extractAll(FAKE_SAVE);
  tables.save_meta.push({ key: "parsed_at", value: new Date().toISOString() });
  tables.save_meta.push({ key: "source_file", value: "<smoke-test>" });

  log("Row counts:");
  for (const [k, v] of Object.entries(tables)) log(`  ${k}: ${v.length}`);

  const dir = mkdtempSync(join(tmpdir(), "oni-smoke-"));
  const dbPath = join(dir, "smoke.sqlite");
  writeDatabase(dbPath, tables);
  log(`Wrote ${dbPath}`);

  const db = new DatabaseSync(dbPath);
  const results = [];
  try {
    for (const q of QUERIES) {
      const rows = db.prepare(q).all().map((r) => ({ ...r }));
      results.push({ query: q, rows });
      log(`\nQ: ${q}`);
      for (const row of rows) log("  ", row);
    }
  } finally {
    db.close();
  }

  return {
    rowCounts: Object.fromEntries(
      Object.entries(tables).map(([k, v]) => [k, v.length])
    ),
    queries: results,
    dbPath,
  };
}

// Run when invoked as a script (npm run smoke), not when imported.
const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  runSmoke({ silent: false });
}
