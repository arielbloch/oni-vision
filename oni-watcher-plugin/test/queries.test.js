// Unit tests for the pure query layer in lib/queries.js.
// Builds a SQLite from the parent project's FAKE_SAVE fixture, runs each
// helper, and asserts the shape + content of the returned JSON.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { extractAll } from "../../src/extractors.js";
import { writeDatabase } from "../../src/db.js";
import { FAKE_SAVE } from "../../test/fixture.js";
import {
  saveMeta,
  freshness,
  dupes,
  geysers,
  resources,
  query,
} from "../lib/queries.js";

function buildDb() {
  const tables = extractAll(FAKE_SAVE);
  tables.save_meta.push({ key: "parsed_at", value: new Date().toISOString() });
  tables.save_meta.push({ key: "source_file", value: "/tmp/fake.sav" });

  const dir = mkdtempSync(join(tmpdir(), "oni-mcp-test-"));
  const dbPath = join(dir, "test.sqlite");
  writeDatabase(dbPath, tables);
  return new DatabaseSync(dbPath);
}

describe("saveMeta", () => {
  test("returns headline facts with normalized keys", () => {
    const db = buildDb();
    const meta = saveMeta(db);
    assert.equal(meta.base_name, "Test Base");
    assert.equal(meta.cycle, 312);
    assert.equal(meta.duplicant_count, 3);
    assert.equal(meta.save_version, "7.26");
    assert.match(meta.parsed_at, /^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("freshness", () => {
  test("computes age_seconds from parsed_at", () => {
    const db = buildDb();
    const f = freshness(db);
    assert.ok(f.parsed_at);
    assert.ok(f.age_seconds >= 0 && f.age_seconds < 60);
  });
});

describe("dupes", () => {
  test("returns duplicants sorted by stress desc by default", () => {
    const db = buildDb();
    const rows = dupes(db);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, "Meep");
    assert.equal(rows[0].current_role, "Digger");
    assert.equal(rows[0].stress, 12.5);
  });

  test("ignores invalid sort key (falls back to stress)", () => {
    const db = buildDb();
    const rows = dupes(db, { sort: "DROP TABLE; --" });
    assert.equal(rows.length, 1); // didn't blow up
    assert.equal(rows[0].name, "Meep");
  });
});

describe("geysers", () => {
  test("returns both steam and BigVolcano", () => {
    const db = buildDb();
    const rows = geysers(db);
    const types = rows.map((r) => r.type_id).sort();
    assert.deepEqual(types, ["big_volcano", "steam"]);
  });
});

describe("resources", () => {
  test("location='storage' returns only storage_contents totals", () => {
    const db = buildDb();
    const rows = resources(db, { location: "storage" });
    const elements = rows.map((r) => r.element_id).sort();
    assert.deepEqual(elements, ["Algae", "Water"]);
    const algae = rows.find((r) => r.element_id === "Algae");
    assert.equal(algae.total_units, 500);
  });

  test("location='world' returns only world_objects totals", () => {
    const db = buildDb();
    const rows = resources(db, { location: "world" });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].element_id, "Algae");
    assert.equal(rows[0].total_units, 750);
  });

  test("location='both' sums across storage_contents and world_objects", () => {
    const db = buildDb();
    const rows = resources(db, { location: "both" });
    const algae = rows.find((r) => r.element_id === "Algae");
    assert.equal(algae.total_units, 1250); // 500 (storage) + 750 (world)
  });
});

describe("query (SELECT-only)", () => {
  test("accepts a normal SELECT", () => {
    const db = buildDb();
    const rows = query(db, "SELECT name, stress FROM duplicants");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, "Meep");
  });

  test("accepts a WITH … SELECT", () => {
    const db = buildDb();
    const rows = query(
      db,
      "WITH stressed AS (SELECT name FROM duplicants WHERE stress > 10) SELECT * FROM stressed"
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, "Meep");
  });

  test("binds positional params correctly (regression: array was being passed as a single value)", () => {
    const db = buildDb();
    const rows = query(db, "SELECT name FROM duplicants WHERE name = ?", ["Meep"]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, "Meep");
  });

  test("supports multiple positional params", () => {
    const db = buildDb();
    const rows = query(
      db,
      "SELECT name FROM duplicants WHERE stress > ? AND stress < ?",
      [10, 100]
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, "Meep");
  });

  test("rejects DROP", () => {
    const db = buildDb();
    assert.throws(() => query(db, "DROP TABLE duplicants"), /Only SELECT/);
  });

  test("rejects INSERT", () => {
    const db = buildDb();
    assert.throws(() => query(db, "INSERT INTO duplicants(name) VALUES ('x')"), /Only SELECT/);
  });

  test("rejects PRAGMA", () => {
    const db = buildDb();
    assert.throws(() => query(db, "PRAGMA writable_schema=ON"), /Only SELECT/);
  });

  test("rejects multiple statements", () => {
    const db = buildDb();
    assert.throws(
      () => query(db, "SELECT 1; SELECT 2"),
      /single SELECT/
    );
  });
});
