import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { categorizeGeyser } from "../src/geyser_categories.js";

describe("categorizeGeyser", () => {
  test("Water and Steam are separate categories, Water first", () => {
    const water = categorizeGeyser("Water");
    const steam = categorizeGeyser("Steam");
    assert.equal(water.label, "Water");
    assert.equal(steam.label, "Steam");
    assert.ok(water.order < steam.order);
  });

  test("Dirty Water is its own category, ordered after Water and Steam", () => {
    const steam = categorizeGeyser("Steam");
    const dirty = categorizeGeyser("Dirty Water");
    assert.equal(dirty.label, "Polluted Water");
    assert.ok(dirty.order > steam.order);
  });

  test("Salt Water and Brine share the 'Salt Water' category", () => {
    assert.equal(categorizeGeyser("Salt Water").label, "Salt Water");
    assert.equal(categorizeGeyser("Brine").label, "Salt Water");
  });

  test("each fuel type gets its own card under its common name", () => {
    assert.equal(categorizeGeyser("Methane").label, "Natural Gas");
    assert.equal(categorizeGeyser("Crude Oil").label, "Crude Oil");
    assert.equal(categorizeGeyser("Hydrogen").label, "Hydrogen");
    // All three are distinct categories, not lumped together.
    const orders = new Set([
      categorizeGeyser("Methane").order,
      categorizeGeyser("Crude Oil").order,
      categorizeGeyser("Hydrogen").order,
    ]);
    assert.equal(orders.size, 3);
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
