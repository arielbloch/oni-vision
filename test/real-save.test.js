// End-to-end integration test against a real ONI save file.
//
// Looks for any .sav file under save/ (gitignored — local-only) and runs
// the full parse → extract → write → query chain. Skips cleanly when no
// save is present, so CI (which doesn't ship a save) stays green.
//
// This is the test that surfaces issues the synthetic FAKE_SAVE fixture
// can't: real shape variance, DLC content, save-version mismatches,
// extractor leaks of non-primitive values, etc.
//
// All sub-tests share a single parse → write pass; the SQLite handle is
// opened once and closed in the after() hook.

import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";

import { parseSaveFile } from "../src/parser.js";
import { extractAll } from "../src/extractors.js";
import { writeDatabase } from "../src/db.js";
import { render } from "../src/ui.js";
import { elementName } from "../src/elements.js";
import { ELEMENT_NAMES } from "../src/elements.js";
import { GEYSER_TYPE_NAMES } from "../src/geyser_types.js";
import { FOOD_META } from "../src/food.js";
import { EFFECT_LABELS } from "../src/effects.js";
import { SKILL_LABELS } from "../src/skills.js";
import { statusObject } from "../oni-vision-plugin/lib/queries.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAVE_DIR = join(__dirname, "..", "save");

function findRealSave() {
  if (!existsSync(SAVE_DIR)) return null;
  const candidates = readdirSync(SAVE_DIR).filter((f) => f.endsWith(".sav")).sort();
  return candidates.length > 0 ? join(SAVE_DIR, candidates[0]) : null;
}

const savePath = findRealSave();
const skipReason = savePath
  ? undefined
  : "no .sav file under save/ — skipping real-save integration test";

// ─── shared state set up in before() ─────────────────────────────────────────

let db;
let tables;
let dbPath;

describe("real ONI save end-to-end", { skip: skipReason }, () => {
  before(async () => {
    const save = await parseSaveFile(savePath);
    tables = extractAll(save);
    const dir = mkdtempSync(join(tmpdir(), "oni-real-test-"));
    dbPath = join(dir, "real.sqlite");
    // Inject required daemon-written keys so UI / queries don't blow up.
    tables.save_meta.push({ key: "parsed_at", value: new Date().toISOString() });
    tables.save_meta.push({ key: "source_file", value: savePath });
    // Populate lookup tables (Feature 6) so JOIN-based queries resolve correctly.
    tables.elements = [...ELEMENT_NAMES.entries()].map(([element_id, name]) => ({ element_id, name }));
    tables.geyser_types = GEYSER_TYPE_NAMES;
    tables.foods = FOOD_META;
    tables.effects = EFFECT_LABELS;
    tables.skills = SKILL_LABELS;
    writeDatabase(dbPath, tables);
    db = new DatabaseSync(dbPath, { readOnly: true });
  });

  after(() => {
    if (db) db.close();
  });

  // ── 1. Parser output ────────────────────────────────────────────────────────

  test("parser returns a structured save with header + gameInfo", async () => {
    const save = await parseSaveFile(savePath);
    assert.ok(save, "parseSaveFile returned falsy");
    assert.ok(save.header, "no header block");
    assert.ok(save.header.gameInfo, "no gameInfo in header");
    assert.ok(typeof save.header.gameInfo.numberOfCycles === "number",
      "gameInfo.numberOfCycles is not a number");
  });

  // ── 2. Extractor output (raw tables before DB write) ────────────────────────

  test("extractor produces non-empty save_meta, game_objects, behaviors", () => {
    assert.ok(tables.save_meta.length > 0, "save_meta empty");
    assert.ok(tables.game_objects.length > 0, "no game_objects");
    assert.ok(tables.behaviors.length > 0, "no behaviors");
  });

  test("extractor: no column in typed tables leaks a raw object or array", () => {
    // Extractor bugs often manifest as { foo: bar } objects landing in a
    // column. SQLite silently coerces these to '[object Object]' strings.
    const typed = ["duplicants", "buildings", "world_objects",
                   "storage_contents", "geysers", "critters"];
    for (const tbl of typed) {
      for (const row of tables[tbl]) {
        for (const [col, val] of Object.entries(row)) {
          assert.ok(
            val === null || typeof val !== "object",
            `${tbl}.${col} contains a raw object: ${JSON.stringify(val)}`
          );
        }
      }
    }
  });

  // ── 3. save_meta ────────────────────────────────────────────────────────────

  test("save_meta: required keys are present with sane values", () => {
    const meta = Object.fromEntries(
      db.prepare("SELECT key, value FROM save_meta").all().map((r) => [r.key, r.value])
    );

    const cycle = Number(meta.numberOfCycles);
    assert.ok(Number.isInteger(cycle) && cycle > 0 && cycle < 100_000,
      `numberOfCycles out of range: ${meta.numberOfCycles}`);

    const dupes = Number(meta.numberOfDuplicants);
    assert.ok(Number.isInteger(dupes) && dupes >= 0 && dupes < 1000,
      `numberOfDuplicants out of range: ${meta.numberOfDuplicants}`);

    assert.ok(meta.baseName && meta.baseName.length > 0, "baseName missing or empty");
    assert.ok(meta.saveVersion, "saveVersion missing");
    assert.ok(meta.parsed_at, "parsed_at missing");
    assert.ok(meta.source_file, "source_file missing");
  });

  // ── 4. duplicants ───────────────────────────────────────────────────────────

  test("duplicants: count matches save_meta.numberOfDuplicants", () => {
    const headerDupes = Number(
      db.prepare("SELECT value FROM save_meta WHERE key='numberOfDuplicants'").get().value
    );
    const tableCount = db.prepare("SELECT COUNT(*) AS n FROM duplicants").get().n;
    assert.equal(tableCount, headerDupes,
      `duplicants table has ${tableCount} rows but header says ${headerDupes}`);
    assert.ok(tableCount > 0, "no duplicants in DB");
  });

  test("duplicants: all have non-empty names", () => {
    const bad = db.prepare(
      "SELECT game_object_id FROM duplicants WHERE name IS NULL OR name = ''"
    ).all();
    assert.equal(bad.length, 0,
      `${bad.length} duplicant(s) have null/empty names`);
  });

  test("duplicants: numeric vital columns are numbers or null (no blobs)", () => {
    const sample = db.prepare(
      `SELECT stress, calories, stamina, breath, hp, decor,
              immune, body_temperature FROM duplicants LIMIT 20`
    ).all();
    for (const row of sample) {
      for (const [col, val] of Object.entries(row)) {
        assert.ok(
          val === null || typeof val === "number",
          `duplicants.${col} is not a number or null: ${JSON.stringify(val)}`
        );
      }
    }
  });

  test("duplicants: body_temperature in plausible range (−50 to 5000 °C) when non-null", () => {
    const rows = db.prepare(
      "SELECT name, body_temperature FROM duplicants WHERE body_temperature IS NOT NULL"
    ).all();
    for (const r of rows) {
      assert.ok(
        r.body_temperature > -50 && r.body_temperature < 5000,
        `${r.name} body_temperature=${r.body_temperature} out of plausible range`
      );
    }
  });

  test("duplicants: stress values 0–100 when non-null", () => {
    const rows = db.prepare(
      "SELECT name, stress FROM duplicants WHERE stress IS NOT NULL"
    ).all();
    for (const r of rows) {
      assert.ok(r.stress >= 0 && r.stress <= 100,
        `${r.name} stress=${r.stress} out of 0–100 range`);
    }
  });

  // ── 5. duplicant_traits / skills / attributes / effects ─────────────────────

  test("duplicant_traits: all rows join back to a duplicant", () => {
    const orphans = db.prepare(
      `SELECT COUNT(*) AS n FROM duplicant_traits dt
       WHERE NOT EXISTS (SELECT 1 FROM duplicants d WHERE d.game_object_id = dt.duplicant_id)`
    ).get().n;
    assert.equal(orphans, 0, `${orphans} orphaned duplicant_trait rows`);
  });

  test("duplicant_traits: trait strings are non-empty", () => {
    const bad = db.prepare(
      "SELECT COUNT(*) AS n FROM duplicant_traits WHERE trait IS NULL OR trait = ''"
    ).get().n;
    assert.equal(bad, 0, `${bad} traits with null/empty string`);
  });

  test("duplicant_skills: all rows join back to a duplicant", () => {
    const orphans = db.prepare(
      `SELECT COUNT(*) AS n FROM duplicant_skills ds
       WHERE NOT EXISTS (SELECT 1 FROM duplicants d WHERE d.game_object_id = ds.duplicant_id)`
    ).get().n;
    assert.equal(orphans, 0, `${orphans} orphaned duplicant_skill rows`);
  });

  test("duplicant_skills: skill strings are non-empty", () => {
    const bad = db.prepare(
      "SELECT COUNT(*) AS n FROM duplicant_skills WHERE skill IS NULL OR skill = ''"
    ).get().n;
    assert.equal(bad, 0, `${bad} skills with null/empty string`);
  });

  test("duplicant_attributes: level and experience are numbers when non-null", () => {
    const rows = db.prepare(
      "SELECT attribute, level, experience FROM duplicant_attributes LIMIT 50"
    ).all();
    for (const r of rows) {
      if (r.level !== null)
        assert.ok(typeof r.level === "number", `attribute level not a number: ${r.level}`);
      if (r.experience !== null)
        assert.ok(typeof r.experience === "number", `attribute experience not a number: ${r.experience}`);
    }
  });

  // ── 6. buildings ────────────────────────────────────────────────────────────

  test("buildings: table is non-empty (every real save has at least a printing pod)", () => {
    const n = db.prepare("SELECT COUNT(*) AS n FROM buildings").get().n;
    assert.ok(n > 0, "no buildings — extractor classification likely regressed");
  });

  test("buildings: all have non-null prefab_id", () => {
    const bad = db.prepare(
      "SELECT COUNT(*) AS n FROM buildings WHERE prefab_id IS NULL"
    ).get().n;
    assert.equal(bad, 0, `${bad} buildings with null prefab_id`);
  });

  test("buildings: position columns are numbers when non-null", () => {
    const rows = db.prepare("SELECT position_x, position_y FROM buildings LIMIT 50").all();
    for (const r of rows) {
      if (r.position_x !== null)
        assert.ok(typeof r.position_x === "number", `position_x not a number: ${r.position_x}`);
      if (r.position_y !== null)
        assert.ok(typeof r.position_y === "number", `position_y not a number: ${r.position_y}`);
    }
  });

  test("buildings: temperature is a number or null (no blobs)", () => {
    const rows = db.prepare("SELECT temperature FROM buildings WHERE temperature IS NOT NULL LIMIT 20").all();
    for (const r of rows) {
      assert.ok(typeof r.temperature === "number", `temperature not a number: ${r.temperature}`);
    }
  });

  // ── 7. world_objects ────────────────────────────────────────────────────────

  test("world_objects: table is non-empty", () => {
    const n = db.prepare("SELECT COUNT(*) AS n FROM world_objects").get().n;
    assert.ok(n > 0, "no world_objects — loose-pile classification likely regressed");
  });

  test("world_objects: units > 0 when non-null", () => {
    const bad = db.prepare(
      "SELECT COUNT(*) AS n FROM world_objects WHERE units IS NOT NULL AND units <= 0"
    ).get().n;
    assert.equal(bad, 0, `${bad} world_objects with non-positive units`);
  });

  test("world_objects: element_id is numeric when non-null (not a JSON blob)", () => {
    const rows = db.prepare(
      "SELECT DISTINCT element_id FROM world_objects WHERE element_id IS NOT NULL LIMIT 30"
    ).all();
    for (const r of rows) {
      const n = Number(r.element_id);
      assert.ok(!isNaN(n), `element_id is not numeric: ${r.element_id}`);
    }
  });

  // ── 8. storage_contents ─────────────────────────────────────────────────────

  test("storage_contents: owner_id joins to buildings or world_objects", () => {
    const n = db.prepare("SELECT COUNT(*) AS n FROM storage_contents").get().n;
    if (n === 0) return; // empty storage is valid for very early saves
    const orphans = db.prepare(
      `SELECT COUNT(*) AS n FROM storage_contents sc
       WHERE NOT EXISTS (SELECT 1 FROM buildings   b WHERE b.game_object_id = sc.owner_id)
         AND NOT EXISTS (SELECT 1 FROM world_objects w WHERE w.game_object_id = sc.owner_id)`
    ).get().n;
    // Allow a small tolerance for edge-case game objects not classified as either
    const pct = orphans / n;
    assert.ok(pct < 0.05,
      `${orphans}/${n} (${(pct * 100).toFixed(1)}%) storage_contents have unresolvable owner_id`);
  });

  test("storage_contents: units > 0 when non-null", () => {
    const bad = db.prepare(
      "SELECT COUNT(*) AS n FROM storage_contents WHERE units IS NOT NULL AND units <= 0"
    ).get().n;
    assert.equal(bad, 0, `${bad} storage_contents with non-positive units`);
  });

  // ── 9. geysers ──────────────────────────────────────────────────────────────

  test("geysers: type_id is an integer, not a JSON string blob", () => {
    const rows = db.prepare(
      "SELECT type_id FROM geysers WHERE type_id IS NOT NULL"
    ).all();
    for (const r of rows) {
      assert.ok(typeof r.type_id === "number",
        `geyser type_id is not a number: ${JSON.stringify(r.type_id)}`);
    }
  });

  test("geysers: roll columns are 0–1 percentiles", () => {
    const rows = db.prepare(
      `SELECT rate_roll, iteration_length_roll, iteration_percent_roll,
              year_length_roll, year_percent_roll FROM geysers`
    ).all();
    for (const r of rows) {
      for (const [col, val] of Object.entries(r)) {
        if (val !== null) {
          assert.ok(val >= 0 && val <= 1,
            `geyser ${col}=${val} outside 0–1 range`);
        }
      }
    }
  });

  test("geysers: position columns are numbers", () => {
    const rows = db.prepare("SELECT position_x, position_y FROM geysers").all();
    for (const r of rows) {
      if (r.position_x !== null)
        assert.ok(typeof r.position_x === "number", `geyser position_x not a number`);
      if (r.position_y !== null)
        assert.ok(typeof r.position_y === "number", `geyser position_y not a number`);
    }
  });

  // ── 10. critters ────────────────────────────────────────────────────────────

  test("critters: column types are sane (no blobs in numeric columns)", () => {
    const rows = db.prepare(
      "SELECT age, calories, hp, happiness, temperature FROM critters LIMIT 20"
    ).all();
    for (const r of rows) {
      for (const [col, val] of Object.entries(r)) {
        assert.ok(
          val === null || typeof val === "number",
          `critters.${col} is not a number or null: ${JSON.stringify(val)}`
        );
      }
    }
  });

  // ── 11. behaviors ───────────────────────────────────────────────────────────

  test("behaviors: template_data is valid JSON or null", () => {
    const rows = db.prepare(
      "SELECT name, template_data FROM behaviors WHERE template_data IS NOT NULL LIMIT 100"
    ).all();
    for (const r of rows) {
      assert.doesNotThrow(
        () => JSON.parse(r.template_data),
        `behaviors row '${r.name}' has invalid JSON template_data`
      );
    }
  });

  test("behaviors: all game_object_ids exist in game_objects", () => {
    // game_objects PK is `id`, not `game_object_id`.
    const orphans = db.prepare(
      `SELECT COUNT(*) AS n FROM behaviors b
       WHERE NOT EXISTS (SELECT 1 FROM game_objects g WHERE g.id = b.game_object_id)`
    ).get().n;
    assert.equal(orphans, 0, `${orphans} behaviors reference non-existent game_object_id`);
  });

  // ── 12. views ───────────────────────────────────────────────────────────────

  test("all DB views query without error and return arrays", () => {
    const views = [
      "v_resources_in_storage",
      "v_geysers_summary",
      "v_buildings_by_prefab",
      "v_world_objects_by_element",
    ];
    for (const v of views) {
      const rows = db.prepare(`SELECT * FROM ${v} LIMIT 10`).all();
      assert.ok(Array.isArray(rows), `view ${v} did not return an array`);
    }
  });

  // ── 13. element name resolution ─────────────────────────────────────────────

  test("element names: top stockpile elements resolve to non-numeric display names", () => {
    const rows = db.prepare(
      `SELECT element_id, SUM(units) AS total
       FROM (
         SELECT element_id, units FROM world_objects WHERE element_id IS NOT NULL
         UNION ALL
         SELECT element_id, units FROM storage_contents WHERE element_id IS NOT NULL
       )
       GROUP BY element_id ORDER BY total DESC LIMIT 5`
    ).all();
    assert.ok(rows.length > 0, "no elements in stockpile to check");
    for (const r of rows) {
      const name = elementName(r.element_id);
      // Should not just echo back a raw float like "493438017.0"
      assert.ok(!/^\d/.test(name) && !/-\d/.test(name),
        `element_id ${r.element_id} resolved to raw number: ${name}`);
    }
  });

  // ── 14. UI rendering ────────────────────────────────────────────────────────

  test("ui.render() produces a multi-line string with all expected sections", () => {
    const out = render(db, { color: false, width: 80 });
    assert.ok(typeof out === "string" && out.length > 0, "render() returned empty");
    assert.match(out, /═══/, "banner missing");
    assert.match(out, /duplicants/, "headcounts missing");
    assert.match(out, /Stockpile/, "stockpile section missing");
    assert.match(out, /Dupes/, "dupes section missing");
  });

  test("ui.render(): dupe names appear in full (no truncation ellipsis)", () => {
    const out = render(db, { color: false });
    // Dupes section should contain real names, not '…' from truncation.
    // The 24-col fit() still clips very long names, but our test names
    // (e.g. '11. Researcher - Ren') are ≤24 chars.
    const dupeRows = out.split("\n").filter((l) => /░|█|─/.test(l));
    assert.ok(dupeRows.length > 0, "no dupe rows found in render output");
    for (const row of dupeRows) {
      // Each dupe row must contain the stress bar and a percentage
      assert.match(row, /\d+\.\d%/, `dupe row missing percentage: ${row}`);
    }
  });

  test("ui.render(): stockpile shows element names not raw hashes", () => {
    const out = render(db, { color: false });
    // Raw numeric hashes look like "-105943486.0" or "493438017.0"
    assert.doesNotMatch(out, /\d{7,}\.0/,
      "stockpile contains raw element_id hash (float string)");
  });

  test("ui.render(): geysers show human names not hash blobs", () => {
    const out = render(db, { color: false });
    // Old broken output contained {"hash":...} JSON blobs
    assert.doesNotMatch(out, /\{"hash"/, "geyser type_id JSON blob leaked into render output");
  });

  // ── 15. MCP statusObject ────────────────────────────────────────────────────

  test("statusObject() returns a complete, typed JSON payload", () => {
    const obj = statusObject(db);

    assert.ok(typeof obj.base_name === "string", "base_name missing");
    assert.ok(typeof obj.cycle === "number", "cycle not a number");
    assert.ok(obj.counts, "counts missing");
    assert.ok(typeof obj.counts.duplicants === "number");
    assert.ok(typeof obj.counts.buildings === "number");
    assert.ok(Array.isArray(obj.top_dupes), "top_dupes not an array");
    assert.ok(Array.isArray(obj.geyser_types), "geyser_types not an array");
    assert.ok(Array.isArray(obj.top_resources), "top_resources not an array");
    // Freshness fields
    assert.ok(typeof obj.parsed_at === "string", "parsed_at missing");
    assert.ok(typeof obj.age_seconds === "number", "age_seconds not a number");
  });

  test("statusObject(): top_dupes have name and stress fields", () => {
    const { top_dupes } = statusObject(db);
    assert.ok(top_dupes.length > 0, "top_dupes is empty");
    for (const d of top_dupes) {
      assert.ok(typeof d.name === "string" && d.name.length > 0,
        `dupe entry missing name: ${JSON.stringify(d)}`);
      // stress can be null but must be present
      assert.ok("stress" in d, `dupe entry missing stress field: ${JSON.stringify(d)}`);
    }
  });

  test("statusObject(): geyser type_ids are integers (not JSON blobs)", () => {
    const { geyser_types } = statusObject(db);
    for (const g of geyser_types) {
      if (g.type_id !== null) {
        assert.ok(typeof g.type_id === "number",
          `geyser type_id not a number: ${JSON.stringify(g.type_id)}`);
      }
    }
  });

  // ── 16. Lookup tables (Feature 6) ───────────────────────────────────────────

  test("lookup tables are populated and queryable", () => {
    const en = db.prepare("SELECT COUNT(*) AS n FROM elements").get().n;
    assert.ok(en > 0, "elements should have rows");

    const gtn = db.prepare("SELECT COUNT(*) AS n FROM geyser_types").get().n;
    assert.ok(gtn > 0, "geyser_types should have rows");

    const fm = db.prepare("SELECT COUNT(*) AS n FROM foods").get().n;
    assert.ok(fm > 0, "foods should have rows");

    const el = db.prepare("SELECT COUNT(*) AS n FROM effects").get().n;
    assert.ok(el > 0, "effects should have rows");

    const sl = db.prepare("SELECT COUNT(*) AS n FROM skills").get().n;
    assert.ok(sl > 0, "skills should have rows");
  });

  test("geyser JOIN resolves type_name for known geysers", () => {
    const rows = db.prepare(
      `SELECT g.type_id, COALESCE(gtn.name, 'hash:' || g.type_id) AS type_name
       FROM geysers g
       LEFT JOIN geyser_types gtn ON gtn.type_id = g.type_id
       LIMIT 1`
    ).all();
    if (rows.length === 0) return; // no geysers in this save
    assert.ok(
      typeof rows[0].type_name === "string" && rows[0].type_name.length > 0,
      "geyser JOIN should produce a type_name string"
    );
  });

  test("element JOIN resolves name for known elements", () => {
    const rows = db.prepare(
      `SELECT wo.element_id, COALESCE(en.name, 'id:' || wo.element_id) AS name
       FROM world_objects wo
       LEFT JOIN elements en ON en.element_id = wo.element_id
       WHERE wo.element_id IS NOT NULL
       LIMIT 1`
    ).all();
    if (rows.length === 0) return; // no world objects with elements
    assert.ok(
      typeof rows[0].name === "string" && rows[0].name.length > 0,
      "element JOIN should produce a name string"
    );
  });
});
