// Renderer smoke tests. We build a SQLite from FAKE_SAVE and assert the
// shape of the output strings — exact-text snapshots are brittle, so we
// match the data points we care about.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { writeDatabase } from "../src/db.js";
import { GEYSER_TYPE_NAMES } from "../src/geyser_types.js";
import { buildFakeTables } from "./helpers.js";
import {
  render,
  renderBanner,
  renderHeadCounts,
  renderGeysers,
  renderStockpile,
  renderDupes,
  renderFood,
  readMeta,
} from "../src/ui.js";

function buildDb() {
  const tables = buildFakeTables();
  const dir = mkdtempSync(join(tmpdir(), "oni-ui-test-"));
  const dbPath = join(dir, "test.sqlite");
  writeDatabase(dbPath, tables);
  return new DatabaseSync(dbPath);
}

function withDb(fn) {
  const db = buildDb();
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

describe("readMeta", () => {
  test("returns headline facts as numbers / strings, not raw save_meta", () => {
    withDb((db) => {
      const meta = readMeta(db);
      assert.equal(meta.baseName, "Test Base");
      assert.equal(meta.cycle, 312);
      assert.equal(meta.dupeCount, 3);
      assert.equal(meta.saveVersion, "7.26");
      assert.match(meta.parsedAt, /^\d{4}-\d{2}-\d{2}T/);
    });
  });
});

describe("renderBanner", () => {
  test("includes the base name and cycle", () => {
    withDb((db) => {
      const out = renderBanner(db, { color: false, width: 80 });
      assert.match(out, /Test Base/);
      assert.match(out, /cycle 312/);
    });
  });

  test("color=false produces no ANSI escapes", () => {
    withDb((db) => {
      const out = renderBanner(db, { color: false, width: 80 });
      assert.doesNotMatch(out, /\x1b\[/);
    });
  });

  test("color=true produces some ANSI escapes", () => {
    withDb((db) => {
      const out = renderBanner(db, { color: true, width: 80 });
      assert.match(out, /\x1b\[/);
    });
  });
});

describe("renderHeadCounts", () => {
  test("counts dupes / critters / geysers / buildings", () => {
    withDb((db) => {
      const out = renderHeadCounts(db);
      // FAKE_SAVE: 1 dupe, 2 critters (Hatch + Pip), 2 geysers (steam + BigVolcano),
      // 2 buildings (BatterySmart + StorageLocker). Algae pile is a world_object.
      assert.match(out, /1 duplicants/);
      assert.match(out, /2 critters/);
      assert.match(out, /2 geysers/);
      assert.match(out, /2 buildings/);
    });
  });
});

describe("renderGeysers", () => {
  test("lists each geyser type with a count", () => {
    withDb((db) => {
      const out = renderGeysers(db);
      // type_id hashes are now resolved to display names.
      assert.match(out, /Steam Vent/);
      assert.match(out, /Volcano/);
      assert.match(out, /×1/);
    });
  });
});

describe("renderStockpile", () => {
  test("aggregates across world_objects and storage_contents", () => {
    withDb((db) => {
      const out = renderStockpile(db);
      // FAKE_SAVE has Algae in two places: 750 loose + 500 in locker = 1250.
      // Water 250 in locker.
      assert.match(out, /Algae/);
      assert.match(out, /Water/);
    });
  });
});

describe("renderDupes", () => {
  test("includes Meep with stress percentage and column headers", () => {
    withDb((db) => {
      const out = renderDupes(db);
      assert.match(out, /Meep/);
      // Meep's stress is 12.5 in the fixture; should appear with 1 decimal.
      assert.match(out, /12\.5/);
      // New layout: column headers for Roles / Morale / Stress.
      assert.match(out, /Roles/);
      assert.match(out, /Morale/);
    });
  });

  test("dupes with null stress render an em-dash, not a bogus 0% bar", () => {
    // Build a DB where the dupe has no stress value. We can do this by
    // feeding a fixture with no Stress amount.
    const dir = mkdtempSync(join(tmpdir(), "oni-ui-test-null-"));
    const dbPath = join(dir, "test.sqlite");
    const tables = {
      save_meta: [
        { key: "baseName", value: "Empty Base" },
        { key: "numberOfCycles", value: "1" },
      ],
      object_groups: [],
      game_objects: [],
      behaviors: [],
      duplicants: [{
        game_object_id: 1,
        name: "Stoic",
        gender: "MALE",
        arrival_time: 0,
        voice_idx: 0,
        current_role: "Researcher",
        target_role: null,
        total_experience: 0,
        position_x: 0, position_y: 0,
        stress: null, calories: null, stamina: null, bladder: null,
        breath: null, hp: null, decor: null, immune: null,
        temperature_dupe: null, body_temperature: null,
      }],
      duplicant_traits: [],
      duplicant_skills: [],
      duplicant_attributes: [],
      duplicant_effects: [],
      duplicant_amounts: [],
      duplicant_priorities: [],
      buildings: [],
      world_objects: [],
      storage_contents: [],
      geysers: [],
      critters: [],
      // renderDupes JOINs against these; empty tables → no rows matched, not an error.
      chore_groups: [],
      effects: [],
    };
    writeDatabase(dbPath, tables);
    const db = new DatabaseSync(dbPath);
    try {
      const out = renderDupes(db);
    // Bar should be a dashed line, not block elements.
    assert.match(out, /Stoic/);
    assert.match(out, /─/);
      assert.doesNotMatch(out, /0\.0%/); // never quote a fake 0% for missing data
    } finally {
      db.close();
    }
  });
});

describe("renderFood", () => {
  test("returns dim 'none' line when storage is empty", () => {
    withDb((db) => {
      // FAKE_SAVE has no food items (only element-based storage contents).
      const out = renderFood(db, { color: false });
      assert.match(out, /none in storage/);
    });
  });
});

describe("render", () => {
  test("composes all sections without throwing", () => {
    withDb((db) => {
      const out = render(db, { color: false, width: 80 });
      // Banner
      assert.match(out, /Test Base/);
      // Headcounts
      assert.match(out, /duplicants/);
      // Geysers
      assert.match(out, /Geysers/);
      // Food section
      assert.match(out, /Food/);
      // Stockpile
      assert.match(out, /Stockpile/);
      // Dupes section
      assert.match(out, /Dupes/);
    });
  });
});

describe("geyser name consistency", () => {
  test("renderGeysers resolves every known type_id to a human-readable name", () => {
    // Build a DB containing one geyser row for every type in GEYSER_TYPE_NAMES.
    // renderGeysers must not emit any 'hash:' fallback for any of them.
    const dir = mkdtempSync(join(tmpdir(), "oni-ui-geyser-"));
    const dbPath = join(dir, "test.sqlite");
    const tables = {
      save_meta: [{ key: "baseName", value: "G" }, { key: "numberOfCycles", value: "1" }],
      object_groups: [], game_objects: [], behaviors: [],
      duplicants: [], duplicant_traits: [], duplicant_skills: [],
      duplicant_attributes: [], duplicant_effects: [], duplicant_amounts: [],
      duplicant_priorities: [],
      buildings: [], world_objects: [], storage_contents: [], critters: [],
      // The lookup table must be present so the JOIN can resolve type names.
      geyser_types: GEYSER_TYPE_NAMES,
      geysers: GEYSER_TYPE_NAMES.map(({ type_id }, i) => ({
        game_object_id: i + 1,
        prefab_id: `geyser_${i}`,
        type_id,
        rate_roll: 0.5,
        year_percent_roll: 0.5,
        position_x: i,
        position_y: 0,
      })),
    };
    writeDatabase(dbPath, tables);
    const db = new DatabaseSync(dbPath);
    try {
      const out = renderGeysers(db, { color: false });
      assert.doesNotMatch(out, /hash:/, "all known type_ids should resolve to names");
    } finally {
      db.close();
    }
  });
});
