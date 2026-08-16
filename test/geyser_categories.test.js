import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { categorizeGeyser } from "../src/geyser_categories.js";

describe("categorizeGeyser", () => {
  test("Water section runs cold to hot: Water, Polluted Water, Salt Water, Steam, Hot Steam", () => {
    const water = categorizeGeyser("Water");
    const dirty = categorizeGeyser("Dirty Water");
    const salt = categorizeGeyser("Salt Water");
    const steam = categorizeGeyser("Steam", "Steam Vent");
    const hotSteam = categorizeGeyser("Steam", "Hot Steam Vent");
    for (const c of [water, dirty, salt, steam, hotSteam]) assert.equal(c.section, "Water");
    assert.ok(water.order < dirty.order);
    assert.ok(dirty.order < salt.order);
    assert.ok(salt.order < steam.order);
    assert.ok(steam.order < hotSteam.order);
  });

  test("Salt Water and Brine share the 'Salt Water' category", () => {
    assert.equal(categorizeGeyser("Salt Water").label, "Salt Water");
    assert.equal(categorizeGeyser("Brine").label, "Salt Water");
  });

  test("fuel types are distinct categories under the Power section, in Natural Gas, Crude Oil, Hydrogen order", () => {
    const gas = categorizeGeyser("Methane");
    const oil = categorizeGeyser("Crude Oil");
    const hydrogen = categorizeGeyser("Hydrogen");
    assert.equal(gas.label, "Natural Gas");
    assert.equal(oil.label, "Crude Oil");
    assert.equal(hydrogen.label, "Hydrogen");
    for (const c of [gas, oil, hydrogen]) assert.equal(c.section, "Power");
    assert.ok(gas.order < oil.order);
    assert.ok(oil.order < hydrogen.order);
  });

  test("every molten metal is 'Metals', in the Metals section", () => {
    for (const el of ["Molten Iron", "Molten Copper", "Molten Gold", "Molten Aluminum", "Molten Cobalt", "Molten Tungsten", "Molten Niobium"]) {
      const c = categorizeGeyser(el);
      assert.equal(c.label, "Metals", el);
      assert.equal(c.section, "Metals", el);
    }
  });

  test("unrecognized elements fall into 'Other' (Other section), sorted after every named category", () => {
    const other = categorizeGeyser("Magma");
    const metals = categorizeGeyser("Molten Iron");
    assert.equal(other.label, "Other");
    assert.equal(other.section, "Other");
    assert.ok(other.order > metals.order);
    // Also covers rare/unmapped substances like Liq. Sulfur, Polluted Brine,
    // Carbon Dioxide, Polluted O₂.
    assert.equal(categorizeGeyser("Liq. Sulfur").label, "Other");
    assert.equal(categorizeGeyser("Polluted Brine").label, "Other");
  });

  test("Chlorine is its own category (not lumped into 'Other' with Magma/Volcano), though both share the Other section", () => {
    const chlorine = categorizeGeyser("Chlorine");
    const volcano = categorizeGeyser("Magma");
    assert.equal(chlorine.label, "Chlorine");
    assert.notEqual(chlorine.label, volcano.label);
    assert.equal(chlorine.section, "Other");
    assert.equal(volcano.section, "Other");
  });

  test("Hot Steam Vent is split from Steam Vent despite sharing the Steam element", () => {
    const steamVent = categorizeGeyser("Steam", "Steam Vent");
    const coolSteamVent = categorizeGeyser("Steam", "Cool Steam Vent");
    const hotSteamVent = categorizeGeyser("Steam", "Hot Steam Vent");
    assert.equal(steamVent.label, "Steam");
    assert.equal(coolSteamVent.label, "Steam");
    assert.equal(hotSteamVent.label, "Hot Steam");
    assert.ok(hotSteamVent.order > steamVent.order);
  });

  test("sectionOrder places Water < Power < Metals < Other", () => {
    const water = categorizeGeyser("Water");
    const power = categorizeGeyser("Methane");
    const metals = categorizeGeyser("Molten Iron");
    const other = categorizeGeyser("Magma");
    assert.ok(water.sectionOrder < power.sectionOrder);
    assert.ok(power.sectionOrder < metals.sectionOrder);
    assert.ok(metals.sectionOrder < other.sectionOrder);
  });

  test("categorizeGeyser without a typeName still works (backward compatible)", () => {
    assert.equal(categorizeGeyser("Steam").label, "Steam");
  });
});
