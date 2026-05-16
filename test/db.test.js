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
import { buildFakeTables } from "./helpers.js";
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

function withDb(fn) {
  const { db, tables } = buildDb();
  try {
    return fn(db, tables);
  } finally {
    db.close();
  }
}

describe("normalize / writeDatabase value coercion", () => {
  // Build a minimal in-memory tables object that lets us exercise normalize()
  // indirectly by writing weird values and reading them back.
  function writeAndRead(saveMetaRows) {
    const dir = mkdtempSync(join(tmpdir(), "oni-db-normalize-"));
    const dbPath = join(dir, "test.sqlite");
    const tables = {
      save_meta: saveMetaRows,
      object_groups: [], game_objects: [], behaviors: [],
      duplicants: [], duplicant_traits: [], duplicant_skills: [],
      duplicant_attributes: [], duplicant_effects: [], duplicant_amounts: [],
      buildings: [], world_objects: [], storage_contents: [],
      geysers: [], critters: [],
    };
    writeDatabase(dbPath, tables);
    const db = new DatabaseSync(dbPath);
    try {
      return db.prepare("SELECT key, value FROM save_meta").all();
    } finally {
      db.close();
    }
  }

  test("undefined and null both store as SQL NULL", () => {
    const rows = writeAndRead([
      { key: "u", value: undefined },
      { key: "n", value: null },
    ]);
    assert.equal(rows.find((r) => r.key === "u").value, null);
    assert.equal(rows.find((r) => r.key === "n").value, null);
  });

  test("booleans become 0/1", () => {
    const rows = writeAndRead([
      { key: "t", value: true },
      { key: "f", value: false },
    ]);
    // save_meta.value is TEXT — SQLite may render a bound number as
    // "1" or "1.0" depending on its affinity rules. parseFloat
    // collapses both to the integer we care about.
    assert.equal(parseFloat(rows.find((r) => r.key === "t").value), 1);
    assert.equal(parseFloat(rows.find((r) => r.key === "f").value), 0);
  });

  test("bigint stringifies losslessly", () => {
    const rows = writeAndRead([{ key: "big", value: 9007199254740993n }]);
    assert.equal(rows.find((r) => r.key === "big").value, "9007199254740993");
  });

  test("Date becomes an ISO string", () => {
    const rows = writeAndRead([{ key: "d", value: new Date("2026-01-02T03:04:05Z") }]);
    assert.equal(rows.find((r) => r.key === "d").value, "2026-01-02T03:04:05.000Z");
  });

  test("Symbol uses its description", () => {
    const rows = writeAndRead([{ key: "s", value: Symbol("hello") }]);
    assert.equal(rows.find((r) => r.key === "s").value, "hello");
  });

  test("plain object is JSON-stringified (rather than crashing the insert)", () => {
    const rows = writeAndRead([{ key: "o", value: { foo: 1, bar: "x" } }]);
    assert.equal(rows.find((r) => r.key === "o").value, '{"foo":1,"bar":"x"}');
  });

  test("Map becomes JSON of its entries (defensive against extractor leaks)", () => {
    const m = new Map([["a", 1], ["b", 2]]);
    const rows = writeAndRead([{ key: "m", value: m }]);
    assert.equal(rows.find((r) => r.key === "m").value, '{"a":1,"b":2}');
  });

  test("Set becomes JSON of its values", () => {
    const rows = writeAndRead([{ key: "set", value: new Set([1, 2, 3]) }]);
    assert.equal(rows.find((r) => r.key === "set").value, "[1,2,3]");
  });

  test("function silently becomes null (shouldn't happen but defensive)", () => {
    const rows = writeAndRead([{ key: "fn", value: () => 42 }]);
    assert.equal(rows.find((r) => r.key === "fn").value, null);
  });
});

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
    withDb((db) => {
      const rows = db
        .prepare("SELECT key, value FROM save_meta WHERE key IN ('baseName','parsed_at')")
        .all();
      const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));
      assert.equal(byKey.baseName, "Test Base");
      assert.match(byKey.parsed_at, /^\d{4}-\d{2}-\d{2}T/);
    });
  });

  test("duplicants table is queryable with named columns", () => {
    withDb((db) => {
      const dupes = db.prepare("SELECT name, stress, current_role FROM duplicants").all();
      assert.equal(dupes.length, 1);
      assert.equal(dupes[0].name, "Meep");
      assert.equal(dupes[0].stress, 12.5);
    });
  });

  test("buildings table excludes loose elemental piles", () => {
    withDb((db) => {
      const prefabs = db
        .prepare("SELECT prefab_id FROM buildings ORDER BY prefab_id")
        .all()
        .map((r) => r.prefab_id);
      assert.deepEqual(prefabs, ["BatterySmart", "StorageLocker"]);
    });
  });

  test("world_objects table contains the loose Algae pile", () => {
    withDb((db) => {
      const piles = db
        .prepare("SELECT prefab_id, units FROM world_objects")
        .all();
      assert.equal(piles.length, 1);
      assert.equal(piles[0].prefab_id, "Algae");
      assert.equal(piles[0].units, 750);
    });
  });

  test("storage_contents joins via owner_id (against either buildings or world_objects)", () => {
    withDb((db) => {
      const rows = db
        .prepare(
          `SELECT b.prefab_id AS owner, sc.element_id, sc.units
           FROM buildings b
           JOIN storage_contents sc ON sc.owner_id = b.game_object_id`
        )
        .all();
      assert.equal(rows.length, 2);
      assert.ok(rows.every((r) => r.owner === "StorageLocker"));
    });
  });

  test("convenience views aggregate as expected", () => {
    withDb((db) => {
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
  });

  test("critters include species not in any hardcoded list (Pip)", () => {
    withDb((db) => {
      const species = db.prepare("SELECT prefab_id FROM critters ORDER BY prefab_id").all().map((r) => r.prefab_id);
      assert.deepEqual(species, ["Hatch", "Pip"]);
    });
  });

  test("duplicants table includes morale_cost computed from mastered skills", () => {
    withDb((db) => {
      const row = db.prepare("SELECT name, morale_cost FROM duplicants WHERE name = 'Meep'").get();
      assert.ok(row, "Meep should be in duplicants");
      // Meep has Mining1 mastered (tier 1) → morale_cost = 1
      assert.equal(row.morale_cost, 1);
    });
  });
});

describe("lookup-table round-trips", () => {
  function buildLookupDb() {
    const tables = buildFakeTables({ includeLookupTables: true });
    const dir = mkdtempSync(join(tmpdir(), "oni-lookup-test-"));
    const dbPath = join(dir, "lookup.sqlite");
    writeDatabase(dbPath, tables);
    return new DatabaseSync(dbPath);
  }

  function withLookupDb(fn) {
    const db = buildLookupDb();
    try { return fn(db); } finally { db.close(); }
  }

  test("element_names resolves Water SimHash (1836671383) to 'Water'", () => {
    withLookupDb((db) => {
      const row = db.prepare("SELECT name FROM element_names WHERE element_id = 1836671383").get();
      assert.ok(row, "element_names should contain Water's SimHash");
      assert.equal(row.name, "Water");
    });
  });

  test("geyser_type_names resolves Steam Vent hash (-899515856) to 'Steam Vent'", () => {
    withLookupDb((db) => {
      const row = db.prepare("SELECT name FROM geyser_type_names WHERE type_id = -899515856").get();
      assert.ok(row, "geyser_type_names should contain Steam Vent hash");
      assert.equal(row.name, "Steam Vent");
    });
  });

  test("JOIN geyser_type_names against geysers resolves geyser names", () => {
    withLookupDb((db) => {
      const rows = db.prepare(
        `SELECT g.type_id, gtn.name
         FROM geysers g
         JOIN geyser_type_names gtn ON gtn.type_id = g.type_id
         ORDER BY g.type_id`
      ).all();
      assert.ok(rows.length > 0, "JOIN should return at least one geyser row");
      for (const r of rows) {
        assert.ok(r.name, `type_id ${r.type_id} should resolve to a geyser name`);
      }
      // FAKE_SAVE has -899515856 (Steam Vent) and -1592417549 (Volcano)
      const steam = rows.find(r => r.type_id === -899515856);
      assert.ok(steam, "Steam Vent should be in the JOIN result");
      assert.equal(steam.name, "Steam Vent");
    });
  });

  test("skill_labels covers the 'mining' branch", () => {
    withLookupDb((db) => {
      const row = db.prepare("SELECT label FROM skill_labels WHERE branch = 'mining'").get();
      assert.ok(row, "skill_labels should include 'mining'");
      assert.equal(row.label, "Miner");
    });
  });
});
