// Unit tests for parser-level utilities:
//   - ONI SimHash computation (SDBM)
//   - elementName() display-name lookup and edge cases
//   - extractAll() smoke check (shape of output from FAKE_SAVE)

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { ELEMENT_NAMES, elementName } from "../src/elements.js";
import { extractAll } from "../src/extractors.js";
import { FAKE_SAVE } from "./fixture.js";

// ── SimHash (SDBM) ────────────────────────────────────────────────────────────

/**
 * Replicate ONI's Hash.SDBMLower in JS so we can assert that the hash
 * constants baked into elements.js are computed correctly.
 */
function simhash(name) {
  let h = 0;
  for (const c of name.toLowerCase()) {
    h = Math.imul(65599, h) + c.charCodeAt(0) | 0;
  }
  return h;
}

describe("SimHash (SDBM)", () => {
  test("Water element hash matches elements.js constant", () => {
    assert.equal(simhash("Water"), 1836671383);
    assert.equal(ELEMENT_NAMES.get(1836671383), "Water");
  });

  test("Steam element hash matches elements.js constant", () => {
    assert.equal(simhash("Steam"), -899515856);
    assert.equal(ELEMENT_NAMES.get(-899515856), "Steam");
  });

  test("Oxygen element hash matches elements.js constant", () => {
    assert.equal(simhash("Oxygen"), -1528777920);
    assert.equal(ELEMENT_NAMES.get(-1528777920), "Oxygen");
  });

  test("Iron element hash matches elements.js constant", () => {
    assert.equal(simhash("Iron"), 1306370440);
    assert.equal(ELEMENT_NAMES.get(1306370440), "Iron");
  });

  test("Methane element hash matches elements.js constant", () => {
    // Also cross-checks that geyser type 'methane' and element 'Methane' share a hash.
    assert.equal(simhash("Methane"), -841236436);
    assert.equal(ELEMENT_NAMES.get(-841236436), "Methane");
  });
});

// ── elementName() ────────────────────────────────────────────────────────────

describe("elementName()", () => {
  test("resolves a known integer element_id", () => {
    assert.equal(elementName(1836671383), "Water");
    assert.equal(elementName(-1528777920), "Oxygen");
  });

  test("resolves a SQLite REAL string (e.g. '1836671383.0')", () => {
    // SQLite stores SimHash integers as REAL; they arrive as float strings.
    assert.equal(elementName("1836671383.0"), "Water");
    assert.equal(elementName("-1528777920.0"), "Oxygen");
  });

  test("falls back to the raw value for unknown element IDs", () => {
    // Integer input → String(integer)
    assert.equal(elementName(99999999), "99999999");
    // Float string input → String(original string) — the raw input is preserved.
    assert.equal(elementName("12345.0"), "12345.0");
  });

  test("returns '?' for null", () => {
    assert.equal(elementName(null), "?");
  });

  test("returns '?' for undefined", () => {
    assert.equal(elementName(undefined), "?");
  });

  test("handles negative SimHash values correctly", () => {
    // Hydrogen is a negative hash; ensure the integer math is correct.
    assert.equal(elementName(-1046145888), "Hydrogen");
    assert.equal(elementName("-1046145888.0"), "Hydrogen");
  });
});

// ── extractAll() smoke check ──────────────────────────────────────────────────

describe("extractAll(FAKE_SAVE)", () => {
  const tables = extractAll(FAKE_SAVE);

  test("returns an object with the expected table keys", () => {
    const required = [
      "save_meta", "duplicants", "duplicant_traits", "duplicant_skills",
      "duplicant_attributes", "duplicant_effects",
      "buildings", "world_objects", "storage_contents",
      "geysers", "critters", "behaviors",
    ];
    for (const key of required) {
      assert.ok(key in tables, `missing table: ${key}`);
    }
  });

  test("save_meta has numberOfCycles = 312", () => {
    const row = tables.save_meta.find((r) => r.key === "numberOfCycles");
    assert.ok(row, "missing numberOfCycles in save_meta");
    assert.equal(String(row.value), "312");
  });

  test("save_meta has baseName = 'Test Base'", () => {
    const row = tables.save_meta.find((r) => r.key === "baseName");
    assert.ok(row, "missing baseName in save_meta");
    assert.equal(row.value, "Test Base");
  });

  test("duplicants has exactly one dupe named 'Meep'", () => {
    assert.equal(tables.duplicants.length, 1);
    assert.equal(tables.duplicants[0].name, "Meep");
  });

  test("geysers has two rows (steam geyser + big volcano)", () => {
    assert.equal(tables.geysers.length, 2);
  });

  test("geysers rate_roll and year_percent_roll are in [0, 1]", () => {
    for (const g of tables.geysers) {
      assert.ok(g.rate_roll >= 0 && g.rate_roll <= 1,
        `rate_roll out of range: ${g.rate_roll}`);
      assert.ok(g.year_percent_roll >= 0 && g.year_percent_roll <= 1,
        `year_percent_roll out of range: ${g.year_percent_roll}`);
    }
  });

  test("critters has at least one row", () => {
    assert.ok(tables.critters.length >= 1);
  });

  test("buildings array is non-empty (has at least one placed building)", () => {
    assert.ok(tables.buildings.length >= 1);
  });

  test("storage_contents are present for placed storage buildings", () => {
    // At least one storage_contents row should exist.
    assert.ok(tables.storage_contents.length >= 1);
  });
});
