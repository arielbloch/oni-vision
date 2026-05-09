// Round-trip tests for src/db.js: build a DB from extractor output, then
// query it. Includes a schema-shape test that catches the "extractor added
// a field but db.js didn't" class of bug.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { extractAll } from "../src/extractors.js";
import { writeDatabase, TABLE_COLUMNS } from "../src/db.js";
import { FAKE_SAVE } from "./fixture.js";

function buildDb() {
  const tables = extractAll(FAKE_SAVE);
  // Mirror the parsed_at stamp that pipeline.js adds, so save_meta has it
  // when tests query for it (without forcing tests to import the pipeline).
  tables.save_meta.push({ key: "parsed_at", value: new Date().toISOString() });

  const dir = mkdtempSync(join(tmpdir(), "oni-db-test-"));
  const dbPath = join(dir, "test.sqlite");
  writeDatabase(dbPath, tables);
  return { db: new DatabaseSync(dbPath), tables };
}

describe("schema shape", () => {
  test("every table the extractors produce has matching TABLE_COLUMNS, and every row's keys are a subset of those columns", () => {
    const tables = extractAll(FAKE_SAVE);
    for (const [tableName, rows] of Object.entries(tables)) {
      const cols = TABLE_COLUMNS[tableName];
      assert.ok(
        cols,
        `extractors emit table "${tableName}" but db.js has no TABLE_COLUMNS entry`
      );
      const colSet = new Set(cols);
      for (const row of rows) {
        for (const k of Object.keys(row)) {
          assert.ok(
            colSet.has(k),
            `row in "${tableName}" has unknown column "${k}". ` +
              `Either add "${k}" to TABLE_COLUMNS.${tableName} (and the CREATE TABLE) ` +
              `or stop emitting it from extractors.`
          );
        }
      }
    }
  });
});

describe("round-trip queries", () => {
  test("save_meta carries parsed_at and base name", () => {
    const { db } = buildDb();
    const rows = db
      .prepare("SELECT key, value FROM save_meta WHERE key IN ('baseName','parsed_at')")
      .all();
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    assert.equal(byKey.baseName, "Test Base");
    assert.match(byKey.parsed_at, /^\d{4}-\d{2}-\d{2}T/);
  });

  test("duplicants table is queryable with named columns", () => {
    const { db } = buildDb();
    const dupes = db.prepare("SELECT name, stress, current_role FROM duplicants").all();
    assert.equal(dupes.length, 1);
    assert.equal(dupes[0].name, "Meep");
    assert.equal(dupes[0].stress, 12.5);
  });

  test("buildings table excludes loose elemental piles", () => {
    const { db } = buildDb();
    const prefabs = db
      .prepare("SELECT prefab_id FROM buildings ORDER BY prefab_id")
      .all()
      .map((r) => r.prefab_id);
    assert.deepEqual(prefabs, ["BatterySmart", "StorageLocker"]);
  });

  test("world_objects table contains the loose Algae pile", () => {
    const { db } = buildDb();
    const piles = db
      .prepare("SELECT prefab_id, units FROM world_objects")
      .all();
    assert.equal(piles.length, 1);
    assert.equal(piles[0].prefab_id, "Algae");
    assert.equal(piles[0].units, 750);
  });

  test("storage_contents joins via building_id", () => {
    const { db } = buildDb();
    const rows = db
      .prepare(
        `SELECT b.prefab_id AS owner, sc.element_id, sc.units
         FROM buildings b
         JOIN storage_contents sc ON sc.building_id = b.game_object_id`
      )
      .all();
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => r.owner === "StorageLocker"));
  });

  test("convenience views aggregate as expected", () => {
    const { db } = buildDb();
    // node:sqlite returns null-prototype rows; spread to plain objects so
    // deepEqual against object literals succeeds.
    const inStorage = db
      .prepare("SELECT element_id, total_units FROM v_resources_in_storage ORDER BY element_id")
      .all()
      .map((r) => ({ ...r }));
    assert.deepEqual(inStorage, [
      { element_id: "Algae", total_units: 500 },
      { element_id: "Water", total_units: 250 },
    ]);
    const looseByElement = db
      .prepare("SELECT element_id, total_units FROM v_world_objects_by_element")
      .all()
      .map((r) => ({ ...r }));
    assert.deepEqual(looseByElement, [{ element_id: "Algae", total_units: 750 }]);
  });

  test("critters include species not in any hardcoded list (Pip)", () => {
    const { db } = buildDb();
    const species = db.prepare("SELECT prefab_id FROM critters ORDER BY prefab_id").all().map((r) => r.prefab_id);
    assert.deepEqual(species, ["Hatch", "Pip"]);
  });
});
