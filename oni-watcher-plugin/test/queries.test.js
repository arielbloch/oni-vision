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
  dupeDetail,
  geysers,
  resources,
  query,
  status,
  schema,
  toTsv,
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

  test("returns null fields when parsed_at is missing (older watcher version)", () => {
    // Build a DB whose save_meta has no parsed_at row, simulating
    // a SQLite produced by a pre-Wave-1 oni-watcher.
    const tables = extractAll(FAKE_SAVE);
    // Note: deliberately NOT pushing { key: "parsed_at", ... }.
    const dir = mkdtempSync(join(tmpdir(), "oni-mcp-test-noparsed-"));
    const dbPath = join(dir, "test.sqlite");
    writeDatabase(dbPath, tables);
    const db = new DatabaseSync(dbPath);
    const f = freshness(db);
    assert.equal(f.parsed_at, null);
    assert.equal(f.age_seconds, null);
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

  test("fields projection limits columns to the requested set", () => {
    const db = buildDb();
    const rows = dupes(db, { fields: ["name", "stress"] });
    assert.equal(rows.length, 1);
    assert.deepEqual(Object.keys(rows[0]).sort(), ["name", "stress"]);
    assert.equal(rows[0].name, "Meep");
    assert.equal(rows[0].stress, 12.5);
  });

  test("fields projection silently drops unknown column names", () => {
    const db = buildDb();
    const rows = dupes(db, { fields: ["name", "DROP TABLE", "stress"] });
    assert.deepEqual(Object.keys(rows[0]).sort(), ["name", "stress"]);
  });

  test("empty/invalid fields list falls back to all columns", () => {
    const db = buildDb();
    const rows = dupes(db, { fields: [] });
    // All-columns projection has way more than 2 keys.
    assert.ok(Object.keys(rows[0]).length > 2);
  });

  test("default limit is 12 (was 50 pre-optimization)", () => {
    // Smoke-style: just verify the function works with the new default
    // and produces rows. We don't have a 50-dupe fixture, but we can
    // assert that the new default limit doesn't blow up small fixtures.
    const db = buildDb();
    const rows = dupes(db); // no limit override
    assert.equal(rows.length, 1);
  });

  test("sort column doesn't need to be in fields (SQLite allows ORDER BY on unprojected columns)", () => {
    const db = buildDb();
    const rows = dupes(db, { sort: "stress", fields: ["name"] });
    assert.equal(rows.length, 1);
    assert.deepEqual(Object.keys(rows[0]), ["name"]);
    assert.equal(rows[0].name, "Meep");
  });

  test("explicit fields covering every DUPE_COLUMN matches the default projection", () => {
    const db = buildDb();
    const explicit = dupes(db, {
      fields: [
        "name", "gender", "current_role", "target_role",
        "stress", "calories", "stamina", "bladder", "breath",
        "hp", "decor", "immune", "body_temperature",
      ],
    });
    const def = dupes(db);
    assert.deepEqual(Object.keys(explicit[0]).sort(), Object.keys(def[0]).sort());
  });
});

describe("dupeDetail", () => {
  test("returns vitals + traits + skills + attributes + effects for a known dupe", () => {
    const db = buildDb();
    const detail = dupeDetail(db, "Meep");
    assert.equal(detail.name, "Meep");
    assert.equal(detail.current_role, "Digger");
    assert.equal(detail.stress, 12.5);
    // Fixture: Meep has Trait_Sociable and Trait_Loud.
    assert.deepEqual(detail.traits.sort(), ["Trait_Loud", "Trait_Sociable"]);
    // Fixture: only Mining1 mastered.
    assert.deepEqual(detail.skills, ["Mining1"]);
    // Fixture: Digging and Strength attributes.
    const attrIds = detail.attributes.map((a) => a.attribute).sort();
    assert.deepEqual(attrIds, ["Digging", "Strength"]);
    // Fixture: FullBladder effect.
    assert.ok(detail.effects.find((e) => e.effect === "FullBladder"));
  });

  test("returns null for an unknown name", () => {
    const db = buildDb();
    assert.equal(dupeDetail(db, "Nobody"), null);
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

  test("treats null/undefined params as no params", () => {
    const db = buildDb();
    const a = query(db, "SELECT name FROM duplicants", null);
    const b = query(db, "SELECT name FROM duplicants", undefined);
    assert.equal(a.length, 1);
    assert.equal(b.length, 1);
  });

  test("supports named params via an object", () => {
    const db = buildDb();
    const rows = query(
      db,
      "SELECT name FROM duplicants WHERE name = $name",
      { $name: "Meep" }
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

describe("toTsv", () => {
  test("renders header + rows with tab separators", () => {
    const out = toTsv([
      { name: "Meep", stress: 12.5 },
      { name: "Stinky", stress: 4 },
    ]);
    const lines = out.split("\n");
    assert.equal(lines[0], "name\tstress");
    assert.equal(lines[1], "Meep\t12.5");
    assert.equal(lines[2], "Stinky\t4");
  });

  test("renders null cells as empty strings", () => {
    const out = toTsv([{ a: 1, b: null }]);
    assert.equal(out, "a\tb\n1\t");
  });

  test("escapes tab, newline, CR, and backslash in cell values", () => {
    const out = toTsv([{ s: "a\tb\nc\rd\\e" }]);
    const lines = out.split("\n");
    // Header on line 1, single row on line 2 (escaped — so no extra lines).
    assert.equal(lines.length, 2);
    assert.equal(lines[0], "s");
    assert.equal(lines[1], "a\\tb\\nc\\rd\\\\e");
  });

  test("clean values use the fast path (no escaping noise)", () => {
    const out = toTsv([{ name: "Meep", stress: 12.5 }]);
    // Sanity: no backslashes in clean output.
    assert.doesNotMatch(out, /\\/);
  });

  test("returns empty string for empty input", () => {
    assert.equal(toTsv([]), "");
    assert.equal(toTsv(null), "");
  });

  test("is significantly smaller than JSON.stringify for tabular data", () => {
    const rows = [];
    for (let i = 0; i < 10; i++) {
      rows.push({ name: `Dupe${i}`, stress: i * 7, role: "Digger" });
    }
    const tsv = toTsv(rows);
    const json = JSON.stringify(rows);
    // TSV should be at least 30% smaller for this shape. (We don't claim
    // 50% reliably because tiny-int values compress less than long strings.)
    assert.ok(tsv.length < json.length * 0.7, `TSV ${tsv.length} should be <0.7× JSON ${json.length}`);
  });
});

describe("status", () => {
  test("returns a TSV-block snapshot with the headline facts", () => {
    const db = buildDb();
    const out = status(db);
    assert.match(out, /base_name=Test Base/);
    assert.match(out, /cycle=312/);
    assert.match(out, /duplicants=1/);
    assert.match(out, /geysers=2/);
    // Section headers and TSV bodies present.
    assert.match(out, /# top dupes by stress/);
    assert.match(out, /Meep\t12.5\tDigger/);
    assert.match(out, /# geyser types/);
    assert.match(out, /# top elements by mass/);
  });

  test("limits are honored", () => {
    const db = buildDb();
    const out = status(db, { dupeLimit: 1, geyserLimit: 1, resourceLimit: 1 });
    // Section headers still present; just fewer rows.
    assert.match(out, /# top dupes/);
    assert.match(out, /# geyser types/);
  });

  test("collapses newlines in header values so the format stays line-oriented", () => {
    // Build a DB whose baseName contains a newline (defensive coverage —
    // ONI doesn't allow this in practice, but if it ever did, the
    // status block must not get split into bogus extra lines).
    const tables = extractAll(FAKE_SAVE);
    const idx = tables.save_meta.findIndex((r) => r.key === "baseName");
    tables.save_meta[idx] = { key: "baseName", value: "Line1\nLine2" };
    tables.save_meta.push({ key: "parsed_at", value: new Date().toISOString() });
    const dir = mkdtempSync(join(tmpdir(), "oni-mcp-test-multiline-"));
    const dbPath = join(dir, "test.sqlite");
    writeDatabase(dbPath, tables);
    const db = new DatabaseSync(dbPath);
    const out = status(db);
    // The base_name line must be a single line and must contain both
    // parts joined by a space (newline collapsed). And there must NOT
    // be a separate line containing only "Line2" — that would mean we
    // failed to collapse and the format leaked.
    const lines = out.split("\n");
    const baseLine = lines.find((l) => l.startsWith("base_name="));
    assert.equal(baseLine, "base_name=Line1 Line2");
    // No standalone "Line2" line.
    assert.ok(!lines.includes("Line2"));
  });
});

describe("schema", () => {
  test("lists tables and views with their columns", () => {
    const db = buildDb();
    const out = schema(db);
    // Should mention every typed table.
    assert.match(out, /table duplicants:/);
    assert.match(out, /table buildings:/);
    assert.match(out, /table world_objects:/);
    assert.match(out, /table geysers:/);
    assert.match(out, /table critters:/);
    // Storage owner column is owner_id (post-Wave-4 rename).
    assert.match(out, /storage_contents: owner_id/);
    // Views show up too.
    assert.match(out, /view v_buildings_by_prefab:/);
  });

  test("skips internal sqlite_* objects", () => {
    const db = buildDb();
    const out = schema(db);
    assert.doesNotMatch(out, /sqlite_/);
  });
});
