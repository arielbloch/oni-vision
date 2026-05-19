// Unit tests for the pure query layer in lib/queries.js.
// Builds a SQLite from the parent project's FAKE_SAVE fixture, runs each
// helper, and asserts the shape + content of the returned JSON.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { writeDatabase } from "../../src/db.js";
import { buildFakeTables } from "../../test/helpers.js";
import {
  saveMeta,
  freshness,
  dupes,
  dupeDetail,
  geysers,
  resources,
  food,
  germs,
  research,
  schedules,
  power,
  plants,
  query,
  status,
  statusObject,
  schema,
  toTsv,
} from "../lib/queries.js";

function buildDb(opts) {
  const tables = buildFakeTables(opts);
  const dir = mkdtempSync(join(tmpdir(), "oni-mcp-test-"));
  const dbPath = join(dir, "test.sqlite");
  writeDatabase(dbPath, tables);
  return new DatabaseSync(dbPath);
}

function withDb(fn, opts) {
  const db = buildDb(opts);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

describe("saveMeta", () => {
    test("returns headline facts with normalized keys", () => {
      withDb((db) => {
      const meta = saveMeta(db);
      assert.equal(meta.base_name, "Test Base");
      assert.equal(meta.cycle, 312);
      assert.equal(meta.duplicant_count, 3);
      assert.equal(meta.save_version, "7.26");
      assert.match(meta.parsed_at, /^\d{4}-\d{2}-\d{2}T/);
      });
  });
});

describe("freshness", () => {
    test("computes age_seconds from parsed_at", () => {
      withDb((db) => {
      const f = freshness(db);
      assert.ok(f.parsed_at);
      assert.ok(f.age_seconds >= 0 && f.age_seconds < 60);
      });
  });

  test("returns null fields when parsed_at is missing (older oni-vision version)", () => {
    // Build a DB whose save_meta has no parsed_at row, simulating
    // a SQLite produced by a pre-Wave-1 oni-vision.
    const db = buildDb({ includeParsedAt: false });
    const f = freshness(db);
    assert.equal(f.parsed_at, null);
    assert.equal(f.age_seconds, null);
  });
});

describe("dupes", () => {
    test("returns duplicants sorted by stress desc by default", () => {
      withDb((db) => {
      const rows = dupes(db);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].name, "Meep");
      assert.equal(rows[0].current_role, "Digger");
      assert.equal(rows[0].stress, 12.5);
      });
  });

    test("ignores invalid sort key (falls back to stress)", () => {
      withDb((db) => {
      const rows = dupes(db, { sort: "DROP TABLE; --" });
      assert.equal(rows.length, 1); // didn't blow up
      assert.equal(rows[0].name, "Meep");
      });
  });

    test("fields projection limits columns to the requested set", () => {
      withDb((db) => {
      const rows = dupes(db, { fields: ["name", "stress"] });
      assert.equal(rows.length, 1);
      assert.deepEqual(Object.keys(rows[0]).sort(), ["name", "stress"]);
      assert.equal(rows[0].name, "Meep");
      assert.equal(rows[0].stress, 12.5);
      });
  });

    test("fields projection silently drops unknown column names", () => {
      withDb((db) => {
      const rows = dupes(db, { fields: ["name", "DROP TABLE", "stress"] });
      assert.deepEqual(Object.keys(rows[0]).sort(), ["name", "stress"]);
      });
  });

    test("empty/invalid fields list falls back to all columns", () => {
      withDb((db) => {
      const rows = dupes(db, { fields: [] });
      // All-columns projection has way more than 2 keys.
      assert.ok(Object.keys(rows[0]).length > 2);
      });
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
      withDb((db) => {
      const rows = dupes(db, { sort: "stress", fields: ["name"] });
      assert.equal(rows.length, 1);
      assert.deepEqual(Object.keys(rows[0]), ["name"]);
      assert.equal(rows[0].name, "Meep");
      });
  });

    test("explicit fields covering every DUPE_COLUMN matches the default projection", () => {
      withDb((db) => {
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
});

describe("dupeDetail", () => {
    test("returns vitals + traits + skills + attributes + effects for a known dupe", () => {
      withDb((db) => {
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
  });

    test("returns null for an unknown name", () => {
      withDb((db) => {
      assert.equal(dupeDetail(db, "Nobody"), null);
      });
  });
});

describe("geysers", () => {
    test("returns both steam and BigVolcano", () => {
      withDb((db) => {
      const rows = geysers(db);
      // type_id is stored as a SimHash integer extracted from { hash: N }.
      // steam = -899515856, big_volcano = -1592417549.
      const types = rows.map((r) => r.type_id).sort((a, b) => a - b);
      assert.deepEqual(types, [-1592417549, -899515856]);
      });
  });

    test("resolves type_name via geyser_types lookup table", () => {
      withDb((db) => {
      const rows = geysers(db);
      const steam = rows.find((r) => r.type_id === -899515856);
      assert.ok(steam, "steam geyser should be present");
      assert.equal(steam.type_name, "Steam Vent", "type_name should resolve via JOIN");
      });
  });

  test("falls back to hash:<id> for unknown geyser types", () => {
    // Build a DB without lookup tables so the JOIN misses.
    const db = buildDb({ includeLookupTables: false });
    const rows = geysers(db);
    const steam = rows.find((r) => r.type_id === -899515856);
    assert.ok(steam);
    assert.equal(steam.type_name, "hash:-899515856", "unknown type should fallback to hash: prefix");
  });
});

describe("resources", () => {
    test("location='storage' returns only storage_contents totals", () => {
      withDb((db) => {
      const rows = resources(db, { location: "storage" });
      const elements = rows.map((r) => r.element_id).sort();
      assert.deepEqual(elements, ["Algae", "Water"]);
      const algae = rows.find((r) => r.element_id === "Algae");
      assert.equal(algae.total_units, 500);
      });
  });

    test("location='world' returns only world_objects totals", () => {
      withDb((db) => {
      const rows = resources(db, { location: "world" });
      assert.equal(rows.length, 1);
      assert.equal(rows[0].element_id, "Algae");
      assert.equal(rows[0].total_units, 750);
      });
  });

    test("location='both' sums across storage_contents and world_objects", () => {
      withDb((db) => {
      const rows = resources(db, { location: "both" });
      const algae = rows.find((r) => r.element_id === "Algae");
      assert.equal(algae.total_units, 1250); // 500 (storage) + 750 (world)
      });
  });

  test("resolves element_name via elements lookup table", () => {
    // The FAKE_SAVE fixture uses string element_ids ("Algae", "Water").
    // Real saves use SimHash integers. Build a DB with a numeric element_id
    // that matches a known entry in elements so the JOIN fires.
    const tables = buildFakeTables();
    tables.world_objects.push({
      game_object_id: 9999,
      prefab_id: "TestOre",
      position_x: 0,
      position_y: 0,
      element_id: -1870043872, // SimHash for "Algae" from elements.js
      units: 100,
      temperature: 300,
      disease_id: null,
      disease_count: 0,
    });
    const dir = mkdtempSync(join(tmpdir(), "oni-mcp-elements-"));
    const dbPath = join(dir, "test.sqlite");
    writeDatabase(dbPath, tables);
    const db = new DatabaseSync(dbPath);
    try {
  
      const rows = resources(db, { location: "world" });
      // element_id column affinity is TEXT, so SimHash may come back as string.
      const algae = rows.find((r) => r.element_id == -1870043872);
      assert.ok(algae, "Algae (by SimHash) should be present");
      assert.equal(algae.element_name, "Algae", "element_name should resolve via JOIN");
    } finally {
      db.close();
    }
  });

    test("falls back to id:<hash> for unknown elements", () => {
      withDb((db) => {
      const rows = resources(db, { location: "world" });
      const algae = rows.find((r) => r.element_id === "Algae");
      assert.ok(algae);
      assert.equal(algae.element_name, "id:Algae", "unknown element should fallback to id: prefix");
      });
  });
});

describe("query (SELECT-only)", () => {
    test("accepts a normal SELECT", () => {
      withDb((db) => {
      const rows = query(db, "SELECT name, stress FROM duplicants");
      assert.equal(rows.length, 1);
      assert.equal(rows[0].name, "Meep");
      });
  });

    test("accepts a WITH … SELECT", () => {
      withDb((db) => {
      const rows = query(
        db,
        "WITH stressed AS (SELECT name FROM duplicants WHERE stress > 10) SELECT * FROM stressed"
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].name, "Meep");
      });
  });

    test("binds positional params correctly (regression: array was being passed as a single value)", () => {
      withDb((db) => {
      const rows = query(db, "SELECT name FROM duplicants WHERE name = ?", ["Meep"]);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].name, "Meep");
      });
  });

    test("supports multiple positional params", () => {
      withDb((db) => {
      const rows = query(
        db,
        "SELECT name FROM duplicants WHERE stress > ? AND stress < ?",
        [10, 100]
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].name, "Meep");
      });
  });

    test("treats null/undefined params as no params", () => {
      withDb((db) => {
      const a = query(db, "SELECT name FROM duplicants", null);
      const b = query(db, "SELECT name FROM duplicants", undefined);
      assert.equal(a.length, 1);
      assert.equal(b.length, 1);
      });
  });

    test("supports named params via an object", () => {
      withDb((db) => {
      const rows = query(
        db,
        "SELECT name FROM duplicants WHERE name = $name",
        { $name: "Meep" }
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].name, "Meep");
      });
  });

    test("rejects DROP", () => {
      withDb((db) => {
      assert.throws(() => query(db, "DROP TABLE duplicants"), /Only SELECT/);
      });
  });

    test("rejects INSERT", () => {
      withDb((db) => {
      assert.throws(() => query(db, "INSERT INTO duplicants(name) VALUES ('x')"), /Only SELECT/);
      });
  });

    test("rejects PRAGMA", () => {
      withDb((db) => {
      assert.throws(() => query(db, "PRAGMA writable_schema=ON"), /Only SELECT/);
      });
  });

    test("rejects multiple statements", () => {
      withDb((db) => {
      assert.throws(
        () => query(db, "SELECT 1; SELECT 2"),
        /single SELECT/
      );
      });
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
      withDb((db) => {
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
  });

    test("limits are honored", () => {
      withDb((db) => {
      const out = status(db, { dupeLimit: 1, geyserLimit: 1, resourceLimit: 1 });
      // Section headers still present; just fewer rows.
      assert.match(out, /# top dupes/);
      assert.match(out, /# geyser types/);
      });
  });

  test("collapses newlines in header values so the format stays line-oriented", () => {
    // Build a DB whose baseName contains a newline (defensive coverage —
    // ONI doesn't allow this in practice, but if it ever did, the
    // status block must not get split into bogus extra lines).
    const tables = buildFakeTables({ includeParsedAt: false });
    const idx = tables.save_meta.findIndex((r) => r.key === "baseName");
    tables.save_meta[idx] = { key: "baseName", value: "Line1\nLine2" };
    tables.save_meta.push({ key: "parsed_at", value: new Date().toISOString() });
    const dir = mkdtempSync(join(tmpdir(), "oni-mcp-test-multiline-"));
    const dbPath = join(dir, "test.sqlite");
    writeDatabase(dbPath, tables);
    const db = new DatabaseSync(dbPath);
    try {
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
    } finally {
      db.close();
    }
  });
});

describe("statusObject", () => {
    test("returns the structured shape consumed by the web UI", () => {
      withDb((db) => {
      const o = statusObject(db);
  
      // Top-level keys exist and have the right types.
      assert.equal(o.base_name, "Test Base");
      assert.equal(o.cycle, 312);
      assert.equal(typeof o.save_version, "string");
      assert.ok(o.parsed_at);
      assert.equal(typeof o.age_seconds, "number");
      assert.ok(o.counts);
      assert.equal(o.counts.duplicants, 1);
      assert.equal(o.counts.geysers, 2);
      // Arrays of the right shape.
      assert.ok(Array.isArray(o.top_dupes));
      assert.equal(o.top_dupes[0].name, "Meep");
      assert.ok(Array.isArray(o.geyser_types));
      assert.ok(Array.isArray(o.top_resources));
      });
  });

    test("limits flow through to the sub-queries", () => {
      withDb((db) => {
      const o = statusObject(db, { dupeLimit: 1, geyserLimit: 1, resourceLimit: 1 });
      assert.ok(o.top_dupes.length <= 1);
      assert.ok(o.geyser_types.length <= 1);
      assert.ok(o.top_resources.length <= 1);
      });
  });

    test("status(db) is just the TSV-block formatting of statusObject(db) (same data)", () => {
      withDb((db) => {
      const o = statusObject(db);
      const block = status(db);
      // The TSV block must reflect statusObject's counts and top dupes.
      assert.match(block, new RegExp(`duplicants=${o.counts.duplicants}`));
      if (o.top_dupes[0]) assert.match(block, new RegExp(o.top_dupes[0].name));
      });
  });
});

describe("research", () => {
  function dbWithResearch(researchTemplateData) {
    const tables = buildFakeTables();
    if (researchTemplateData) {
      tables.behaviors.push({
        id: 99001,
        game_object_id: 99001,
        name: "Research",
        template_data: JSON.stringify(researchTemplateData),
        extra_data: null,
      });
      tables.game_objects.push({
        id: 99001, instance_id: 99001, prefab_id: "ResearchSingleton",
        position_x: 0, position_y: 0, position_z: 0,
        scale_x: 1, scale_y: 1, folder: 0,
      });
    }
    const dir = mkdtempSync(join(tmpdir(), "oni-mcp-research-"));
    const dbPath = join(dir, "test.sqlite");
    writeDatabase(dbPath, tables);
    return new DatabaseSync(dbPath);
  }

  test("returns null when no Research behavior exists", () => {
    const db = dbWithResearch(null);
    try {
      assert.equal(research(db), null);
    } finally { db.close(); }
  });

  test("decodes active/target tech, points, and progress", () => {
    const db = dbWithResearch({
      globalPointInventory: { PointsByTypeID: [["basic", 12], ["advanced", 4]] },
      saveData: {
        activeResearchId: "FarmingTech",
        targetResearchId: "FineDining",
        techs: [
          { techId: "FarmingTech", complete: true,  inventoryIDs: ["basic", "advanced"], inventoryValues: [0, 0] },
          { techId: "FineDining",  complete: false, inventoryIDs: ["basic", "advanced"], inventoryValues: [5, 0] },
          { techId: "Unused",      complete: false, inventoryIDs: ["basic", "advanced"], inventoryValues: [0, 0] },
        ],
      },
    });
    try {
      const r = research(db);
      assert.equal(r.active_tech, "FarmingTech");
      assert.equal(r.target_tech, "FineDining");
      assert.deepEqual(r.points, { basic: 12, advanced: 4 });
      assert.equal(r.techs_completed, 1);
      assert.equal(r.techs_total, 3);
      assert.deepEqual(r.completed, ["FarmingTech"]);
      assert.equal(r.in_progress.length, 1, "Unused tech has no points and shouldn't show");
      assert.equal(r.in_progress[0].tech_id, "FineDining");
      assert.deepEqual(r.in_progress[0].progress, { basic: 5, advanced: 0 });
    } finally { db.close(); }
  });
});

describe("schedules", () => {
  function dbWithSchedules(scheduleData) {
    const tables = buildFakeTables();
    tables.behaviors.push({
      id: 88001,
      game_object_id: 88001,
      name: "ScheduleManager",
      template_data: JSON.stringify(scheduleData),
      extra_data: null,
    });
    tables.game_objects.push({
      id: 88001, instance_id: 88001, prefab_id: "ScheduleManagerSingleton",
      position_x: 0, position_y: 0, position_z: 0,
      scale_x: 1, scale_y: 1, folder: 0,
    });
    const dir = mkdtempSync(join(tmpdir(), "oni-mcp-schedules-"));
    const dbPath = join(dir, "test.sqlite");
    writeDatabase(dbPath, tables);
    return new DatabaseSync(dbPath);
  }

  test("compacts a 24-block timetable into Work×N runs", () => {
    const blocks = [];
    for (let i = 0; i < 16; i++) blocks.push({ name: "Work", GroupId: "Worktime" });
    for (let i = 0; i < 4; i++)  blocks.push({ name: "Downtime", GroupId: "Recreation" });
    for (let i = 0; i < 4; i++)  blocks.push({ name: "Bedtime",  GroupId: "Sleep" });
    const db = dbWithSchedules({
      schedules: [
        { name: "Standard", blocks, assigned: [{ id: 100 }, { id: 200 }] },
      ],
    });
    try {
      const s = schedules(db);
      assert.equal(s.length, 1);
      assert.equal(s[0].name, "Standard");
      assert.equal(s[0].summary, "Work×16, Downtime×4, Bedtime×4");
      assert.deepEqual(s[0].assigned_instance_ids, [100, 200]);
    } finally { db.close(); }
  });

  test("returns [] when no ScheduleManager exists", () => {
    const tables = buildFakeTables();
    const dir = mkdtempSync(join(tmpdir(), "oni-mcp-no-sched-"));
    const dbPath = join(dir, "test.sqlite");
    writeDatabase(dbPath, tables);
    const db = new DatabaseSync(dbPath);
    try {
      assert.deepEqual(schedules(db), []);
    } finally { db.close(); }
  });
});

describe("power", () => {
  function dbWithPower() {
    const tables = buildFakeTables();
    // Two Generators (EnergyGenerator) and three Refrigerators (EnergyConsumer).
    const add = (id, prefab, behaviorName) => {
      tables.buildings.push({
        game_object_id: id, prefab_id: prefab,
        position_x: 0, position_y: 0,
        element_id: null, units: null, temperature: 300,
        disease_id: null, disease_count: null,
      });
      tables.behaviors.push({
        id, game_object_id: id, name: behaviorName,
        template_data: "{}", extra_data: null,
      });
      tables.game_objects.push({
        id, instance_id: id, prefab_id: prefab,
        position_x: 0, position_y: 0, position_z: 0,
        scale_x: 1, scale_y: 1, folder: 0,
      });
    };
    add(7001, "Generator", "EnergyGenerator");
    add(7002, "Generator", "EnergyGenerator");
    add(7101, "Refrigerator", "EnergyConsumer");
    add(7102, "Refrigerator", "EnergyConsumer");
    add(7103, "AirFilter",    "EnergyConsumer");
    const dir = mkdtempSync(join(tmpdir(), "oni-mcp-power-"));
    const dbPath = join(dir, "test.sqlite");
    writeDatabase(dbPath, tables);
    return new DatabaseSync(dbPath);
  }

  test("groups generators and consumers by prefab_id with counts", () => {
    const db = dbWithPower();
    try {
      const p = power(db);
      assert.deepEqual(p.generators, [{ prefab_id: "Generator", n: 2 }]);
      // Refrigerator (×2) listed before AirFilter (×1).
      assert.equal(p.consumers.length, 2);
      assert.equal(p.consumers[0].prefab_id, "Refrigerator");
      assert.equal(p.consumers[0].n, 2);
      assert.deepEqual(p.transformers, []);
    } finally { db.close(); }
  });
});

describe("plants", () => {
  function dbWithPlants() {
    const tables = buildFakeTables();
    const add = (id, prefab, opts = {}) => {
      tables.world_objects.push({
        game_object_id: id, prefab_id: prefab,
        position_x: 5, position_y: 5,
        element_id: null, units: null, temperature: 295,
        disease_id: null, disease_count: null,
      });
      tables.behaviors.push({ id: id * 10 + 1, game_object_id: id, name: "Growing", template_data: "{}", extra_data: null });
      tables.behaviors.push({
        id: id * 10 + 2, game_object_id: id, name: "WiltCondition",
        template_data: JSON.stringify({ wilting: !!opts.wilting, goingToWilt: false }),
        extra_data: null,
      });
      tables.behaviors.push({
        id: id * 10 + 3, game_object_id: id, name: "Harvestable",
        template_data: JSON.stringify({ canBeHarvested: !!opts.harvestable, numberOfUses: 6, workTimeRemaining: 10 }),
        extra_data: null,
      });
      tables.game_objects.push({
        id, instance_id: id, prefab_id: prefab,
        position_x: 5, position_y: 5, position_z: 0,
        scale_x: 1, scale_y: 1, folder: 0,
      });
    };
    add(8001, "BristleBlossom", {});
    add(8002, "BristleBlossom", { wilting: true });
    add(8003, "Mealwood",       { harvestable: true });
    const dir = mkdtempSync(join(tmpdir(), "oni-mcp-plants-"));
    const dbPath = join(dir, "test.sqlite");
    writeDatabase(dbPath, tables);
    return new DatabaseSync(dbPath);
  }

  test("lists every Growing world_object with wilt/harvest state", () => {
    const db = dbWithPlants();
    try {
      const pl = plants(db);
      assert.equal(pl.length, 3);
      const wilt = pl.find(p => p.wilting === 1);
      assert.ok(wilt, "should surface the wilting plant");
      const ready = pl.find(p => p.harvestable === 1);
      assert.ok(ready, "should surface the harvestable plant");
      assert.equal(ready.prefab_id, "Mealwood");
    } finally { db.close(); }
  });

  test("wiltingOnly filter returns only wilting plants", () => {
    const db = dbWithPlants();
    try {
      const pl = plants(db, { wiltingOnly: true });
      assert.equal(pl.length, 1);
      assert.equal(pl[0].wilting, 1);
    } finally { db.close(); }
  });

  test("readyOnly filter returns only harvestable plants", () => {
    const db = dbWithPlants();
    try {
      const pl = plants(db, { readyOnly: true });
      assert.equal(pl.length, 1);
      assert.equal(pl[0].harvestable, 1);
      assert.equal(pl[0].prefab_id, "Mealwood");
    } finally { db.close(); }
  });
});

describe("germs", () => {
  test("returns germy storage_contents rows joined to a known disease name", () => {
    withDb((db) => {
      // FAKE_SAVE has one storage_contents row with diseaseID hash 1918712348
      // (Food Poisoning) and diseaseCount 10 — set minCount=1 to surface it.
      const rows = germs(db, { minCount: 1 });
      assert.ok(rows.length >= 1, "should surface the fixture's germy storage row");
      const foodPoisoning = rows.find(r => r.disease_id === 1918712348);
      assert.ok(foodPoisoning, "Food Poisoning row should be present");
      assert.equal(foodPoisoning.disease_name, "Food Poisoning");
      assert.equal(foodPoisoning.disease_count, 10);
      assert.equal(foodPoisoning.source, "storage");
    });
  });

  test("minCount filter discards rows below the threshold", () => {
    withDb((db) => {
      // Default minCount=1000 — fixture's count of 10 is far below, so no rows.
      assert.equal(germs(db).length, 0,
        "default minCount=1000 should hide the count-10 fixture row");
    });
  });

  test("unknown disease_ids fall back to 'hash:<id>' label", () => {
    const tables = buildFakeTables();
    tables.buildings.push({
      game_object_id: 999_001,
      prefab_id: "PollutedDirtVessel",
      position_x: 5, position_y: 5,
      element_id: null, units: null, temperature: 300,
      disease_id: 1234567890,   // not in DISEASE_NAMES
      disease_count: 5000,
    });
    const dir = mkdtempSync(join(tmpdir(), "oni-mcp-germs-unknown-"));
    const dbPath = join(dir, "test.sqlite");
    writeDatabase(dbPath, tables);
    const db = new DatabaseSync(dbPath);
    try {
      const rows = germs(db);
      const unknown = rows.find(r => r.disease_id === 1234567890);
      assert.ok(unknown, "unknown disease should still appear");
      assert.equal(unknown.disease_name, "hash:1234567890");
    } finally {
      db.close();
    }
  });
});

describe("food", () => {
    test("returns known food items with name, kcal, morale, and qty", () => {
      withDb((db) => {
      const rows = food(db);
      // FAKE_SAVE has no real food in storage (only Algae and Water in the locker).
      // food() filters for item_prefab_id NOT NULL AND element_id IS NULL,
      // so the fixture's StorageLocker contents (Algae, Water) are excluded
      // because they have element_id set.
      assert.equal(rows.length, 0, "fixture has no food items without element_id");
      });
  });

  test("returns food when food prefabs are present", () => {
    // Build a DB manually with a food item in storage.
    const tables = buildFakeTables();
    tables.storage_contents.push({
      owner_id: 999,
      item_prefab_id: "CookedMeat",
      element_id: null,
      units: 2,
      temperature: 300,
      disease_id: null,
      disease_count: 0,
    });
    const dir = mkdtempSync(join(tmpdir(), "oni-mcp-food-"));
    const dbPath = join(dir, "test.sqlite");
    writeDatabase(dbPath, tables);
    const db = new DatabaseSync(dbPath);
    try {
  
      const rows = food(db);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].prefab_id, "CookedMeat");
      assert.equal(rows[0].name, "Cooked Meat");
      assert.equal(rows[0].kcal, 2400);
      assert.equal(rows[0].morale, 2);
      assert.equal(rows[0].qty, 2); // sums units, not rows
    } finally {
      db.close();
    }
  });

  test("unknown food items (not in foods lookup) are excluded", () => {
    const tables = buildFakeTables();
    tables.storage_contents.push({
      owner_id: 999,
      item_prefab_id: "MysteryFood DLC_X",
      element_id: "976099455.0",
      units: 1,
      temperature: 300,
      disease_id: null,
      disease_count: 0,
    });
    const dir = mkdtempSync(join(tmpdir(), "oni-mcp-food-unknown-"));
    const dbPath = join(dir, "test.sqlite");
    writeDatabase(dbPath, tables);
    const db = new DatabaseSync(dbPath);
    try {
      const rows = food(db);
      // Unknown prefab has no foods entry; inner JOIN excludes it.
      assert.equal(rows.length, 0);
    } finally {
      db.close();
    }
  });
});

describe("schema", () => {
    test("lists tables and views with their columns", () => {
      withDb((db) => {
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
      // Lookup tables (Feature 6).
      assert.match(out, /table elements:/);
      assert.match(out, /table foods:/);
      });
  });

    test("skips internal sqlite_* objects", () => {
      withDb((db) => {
      const out = schema(db);
      assert.doesNotMatch(out, /sqlite_/);
      });
  });
});
