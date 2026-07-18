import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { categorizeGeyser } from "../src/geyser_categories.js";

describe("categorizeGeyser", () => {
  test("Water and Steam share the 'Water / Steam' category", () => {
    assert.equal(categorizeGeyser("Water").label, "Water / Steam");
    assert.equal(categorizeGeyser("Steam").label, "Water / Steam");
    assert.equal(categorizeGeyser("Water").order, categorizeGeyser("Steam").order);
  });

  test("Dirty Water is its own category, ordered after Water / Steam", () => {
    const water = categorizeGeyser("Water");
    const dirty = categorizeGeyser("Dirty Water");
    assert.equal(dirty.label, "Polluted Water");
    assert.ok(dirty.order > water.order);
  });

  test("Salt Water and Brine share the 'Salt Water' category", () => {
    assert.equal(categorizeGeyser("Salt Water").label, "Salt Water");
    assert.equal(categorizeGeyser("Brine").label, "Salt Water");
  });

  test("Methane, Crude Oil, and Hydrogen are all 'Fuel'", () => {
    assert.equal(categorizeGeyser("Methane").label, "Fuel");
    assert.equal(categorizeGeyser("Crude Oil").label, "Fuel");
    assert.equal(categorizeGeyser("Hydrogen").label, "Fuel");
  });

  test("every molten metal is 'Metals'", () => {
    for (const el of ["Molten Iron", "Molten Copper", "Molten Gold", "Molten Aluminum", "Molten Cobalt", "Molten Tungsten", "Molten Niobium"]) {
      assert.equal(categorizeGeyser(el).label, "Metals", el);
    }
  });

  test("unrecognized elements fall into 'Other', sorted after every named category", () => {
    const other = categorizeGeyser("Magma");
    const metals = categorizeGeyser("Molten Iron");
    assert.equal(other.label, "Other");
    assert.ok(other.order > metals.order);
    // Also covers rare/unmapped substances like Liq. Sulfur, Polluted Brine,
    // Carbon Dioxide, Chlorine, Polluted O₂.
    assert.equal(categorizeGeyser("Liq. Sulfur").label, "Other");
    assert.equal(categorizeGeyser("Polluted Brine").label, "Other");
  });
});
