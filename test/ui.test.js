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
  renderDupes,
  renderFood,
  renderOxygen,
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
      // 3 buildings (Headquarters + BatterySmart + StorageLocker). Algae pile
      // is a world_object.
      assert.match(out, /1 duplicants/);
      assert.match(out, /2 critters/);
      assert.match(out, /2 geysers/);
      assert.match(out, /3 buildings/);
    });
  });
});

describe("renderGeysers", () => {
  test("groups by resource and shows % location + direction from the pod", () => {
    withDb((db) => {
      const out = renderGeysers(db);
      // FAKE_SAVE: worldWidth=200, worldHeight=100, Headquarters (pod) at
      // (10,10). Steam Vent at (50,60) -> 25%/60%, far above + right of pod.
      // BigVolcano at (70,80) -> 35%/80%, far above + right of pod (same
      // phrase — both sit up-and-right of the pod). Groups sort by
      // resource: "Magma" before "Steam".
      const magmaIdx = out.indexOf("Magma");
      const steamGroupIdx = out.indexOf("\n  Steam");
      const volcanoIdx = out.indexOf("Volcano");
      const steamVentIdx = out.indexOf("Steam Vent");
      assert.ok(magmaIdx >= 0 && steamGroupIdx >= 0, "both resource groups present");
      assert.ok(magmaIdx < volcanoIdx, "Volcano listed under the Magma group");
      assert.ok(steamGroupIdx < steamVentIdx, "Steam Vent listed under the Steam group");
      assert.match(out, /25% \/ 60%/);
      assert.match(out, /35% \/ 80%/);
      assert.match(out, /Far above and right of pod/);
    });
  });

  test("omits the relative-to-pod text when the pod isn't in the save", () => {
    const tables = buildFakeTables();
    tables.buildings = tables.buildings.filter((b) => b.prefab_id !== "Headquarters");
    const dir = mkdtempSync(join(tmpdir(), "oni-ui-nopod-"));
    const dbPath = join(dir, "test.sqlite");
    writeDatabase(dbPath, tables);
    const db = new DatabaseSync(dbPath);
    try {
      const out = renderGeysers(db, { color: false });
      assert.doesNotMatch(out, /pod/, "no pod in the save -> no relative-location text");
      assert.match(out, /25% \/ 60%/, "percent location still renders without the pod");
    } finally {
      db.close();
    }
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

describe("renderOxygen", () => {
  test("renders breathability bar and balance bar", () => {
    withDb((db) => {
      const out = renderOxygen(db, { color: false });
      // Should have section header and two lines
      assert.match(out, /O₂/);
      assert.match(out, /Breathability/);
      assert.match(out, /O₂ Gen/);
    });
  });

  test("color=false produces no ANSI escapes", () => {
    withDb((db) => {
      const out = renderOxygen(db, { color: false });
      assert.doesNotMatch(out, /\x1b\[/);
    });
  });

  test("color=true produces ANSI escapes", () => {
    withDb((db) => {
      const out = renderOxygen(db, { color: true });
      assert.match(out, /\x1b\[/);
    });
  });
});

describe("renderFood", () => {
  test("returns dim 'none' line when storage is empty", () => {
    withDb((db) => {
      // FAKE_SAVE has no food items (only element-based storage contents).
      const out = renderFood(db, { color: false });
      assert.match(out, /none/);
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
      // Dupes section
      assert.match(out, /Dupes/);
      // Oxygen section
      assert.match(out, /O₂/);
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
