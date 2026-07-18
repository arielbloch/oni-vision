// Unit tests for src/extractors.js, exercised against the synthetic save in
// test/fixture.js. Run with `npm test`.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { extractAll } from "../src/extractors.js";
import { FAKE_SAVE } from "./fixture.js";

const tables = extractAll(FAKE_SAVE);

describe("save_meta", () => {
  test("includes header gameInfo as key/value rows", () => {
    const byKey = Object.fromEntries(tables.save_meta.map((r) => [r.key, r.value]));
    assert.equal(byKey.numberOfCycles, "312");
    assert.equal(byKey.numberOfDuplicants, "3");
    assert.equal(byKey.baseName, "Test Base");
  });

  test("includes saveVersion derived from save.version", () => {
    const byKey = Object.fromEntries(tables.save_meta.map((r) => [r.key, r.value]));
    assert.equal(byKey.saveVersion, "7.26");
  });
});

describe("classification", () => {
  test("Minion goes to duplicants and not to critters", () => {
    assert.equal(tables.duplicants.length, 1);
    assert.equal(tables.duplicants[0].name, "Meep");
    assert.ok(
      !tables.critters.some((c) => c.prefab_id === "Minion"),
      "Minion should never land in critters"
    );
  });

  test("Hatch is classified as a critter (has MinionModifiers)", () => {
    assert.ok(tables.critters.some((c) => c.prefab_id === "Hatch"));
  });

  test("Pip is classified as a critter via the heuristic, despite never being in any hardcoded list", () => {
    const pip = tables.critters.find((c) => c.prefab_id === "Pip");
    assert.ok(pip, "Pip should be in critters");
    assert.equal(pip.calories, 50000);
    assert.equal(pip.age, 30);
  });

  test("GeyserGeneric_steam goes to geysers", () => {
    // type_id is now stored as a SimHash integer extracted from { hash: N }.
    // -899515856 is the SDBM hash of "steam".
    const steam = tables.geysers.find((g) => g.type_id === -899515856);
    assert.ok(steam, "steam geyser should be in geysers");
    assert.equal(steam.rate_roll, 0.5);
  });

  test("BigVolcano goes to geysers via behavior detection (prefab name doesn't start with 'Geyser')", () => {
    // -1592417549 is the SDBM hash of "big_volcano".
    const volcano = tables.geysers.find((g) => g.type_id === -1592417549);
    assert.ok(volcano, "BigVolcano should be classified as a geyser");
    assert.equal(volcano.prefab_id, "BigVolcano");
    assert.equal(volcano.rate_roll, 0.7);
  });

  test("BuildingComplete + PrimaryElement -> buildings", () => {
    const battery = tables.buildings.find((b) => b.prefab_id === "BatterySmart");
    assert.ok(battery, "BatterySmart should be in buildings");
    assert.equal(battery.element_id, "RefinedMetal");
    assert.equal(battery.units, 200);
  });

  test("PrimaryElement WITHOUT BuildingComplete -> world_objects, not buildings", () => {
    const algaePile = tables.world_objects.find((w) => w.prefab_id === "Algae");
    assert.ok(algaePile, "loose Algae pile should land in world_objects");
    assert.equal(algaePile.element_id, "Algae");
    assert.equal(algaePile.units, 750);
    assert.ok(
      !tables.buildings.some((b) => b.prefab_id === "Algae"),
      "loose Algae must NOT pollute buildings"
    );
  });
});

describe("duplicant detail tables", () => {
  test("traits are populated", () => {
    const traits = tables.duplicant_traits.map((t) => t.trait).sort();
    assert.deepEqual(traits, ["Trait_Loud", "Trait_Sociable"]);
  });

  test("only mastered skills are recorded", () => {
    const skills = tables.duplicant_skills.map((s) => s.skill);
    assert.deepEqual(skills, ["Mining1"]);
    assert.ok(!skills.includes("Mining2"), "Mining2 was not mastered");
  });

  test("attributes carry level and experience", () => {
    const digging = tables.duplicant_attributes.find((a) => a.attribute === "Digging");
    assert.equal(digging.level, 5);
    assert.equal(digging.experience, 200);
  });

  test("amounts unpack into named columns AND raw rows", () => {
    const dupe = tables.duplicants[0];
    assert.equal(dupe.stress, 12.5);
    assert.equal(dupe.calories, 4000);
    assert.equal(dupe.hp, 100);

    const amounts = tables.duplicant_amounts.map((a) => a.amount_name).sort();
    assert.deepEqual(amounts, ["Calories", "HitPoints", "Stamina", "Stress"]);
  });

  test("active effects include time remaining", () => {
    const eff = tables.duplicant_effects.find((e) => e.effect === "FullBladder");
    assert.ok(eff);
    assert.equal(eff.time_remaining, 30);
  });
});

describe("storage extraction", () => {
  test("StorageLocker contents land in storage_contents and reference the owner's game_object_id", () => {
    const locker = tables.buildings.find((b) => b.prefab_id === "StorageLocker");
    const contents = tables.storage_contents.filter((c) => c.owner_id === locker.game_object_id);
    assert.equal(contents.length, 2);
    const byElement = Object.fromEntries(contents.map((c) => [c.element_id, c]));
    assert.equal(byElement.Algae.units, 500);
    // disease_id is the SimHash integer extracted from { hash: N }.
    // 1918712348 = SDBM hash of "FoodPoisoning".
    assert.equal(byElement.Algae.disease_id, 1918712348);
    assert.equal(byElement.Water.units, 250);
    assert.equal(byElement.Water.disease_id, 0); // hash 0 = no disease
  });
});

describe("generic fallback tables", () => {
  test("every game object emits a row in game_objects", () => {
    // 9 groups, 1 object each in this fixture.
    assert.equal(tables.game_objects.length, 9);
  });

  test("behaviors are JSON-stringified into the behaviors table", () => {
    const minionBehaviors = tables.behaviors.filter((b) => b.game_object_id === 1);
    assert.ok(minionBehaviors.some((b) => b.name === "MinionIdentity"));
    const identity = minionBehaviors.find((b) => b.name === "MinionIdentity");
    assert.match(identity.template_data, /Meep/);
  });
});
