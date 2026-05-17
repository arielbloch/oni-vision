// Shared test helpers. Builds the standard FAKE_SAVE tables, optionally
// with lookup tables and parse metadata, so every test suite exercises
// the same schema without copy-pasting setup code.

import { extractAll } from "../src/extractors.js";
import { ELEMENT_NAMES } from "../src/elements.js";
import { GEYSER_TYPE_NAMES } from "../src/geyser_types.js";
import { FOOD_META } from "../src/food.js";
import { EFFECT_LABELS } from "../src/effects.js";
import { SKILL_LABELS } from "../src/skills.js";
import { CHORE_GROUP_NAMES } from "../src/chore_groups.js";
import { FAKE_SAVE } from "./fixture.js";

/**
 * Build the standard extractor output used across the test suite.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.includeParsedAt=true]  push parsed_at / source_file rows
 * @param {boolean} [opts.includeLookupTables=true] populate elements, geyser_types, foods, effects, skills, chore_groups
 * @returns {object} tables object suitable for writeDatabase()
 */
export function buildFakeTables({ includeParsedAt = true, includeLookupTables = true } = {}) {
  const tables = extractAll(FAKE_SAVE);

  if (includeParsedAt) {
    tables.save_meta.push({ key: "parsed_at", value: new Date().toISOString() });
    tables.save_meta.push({ key: "source_file", value: "/tmp/fake.sav" });
  }

  if (includeLookupTables) {
    addLookupTables(tables);
  }

  return tables;
}

/**
 * Build an empty-colony `tables` object: zero dupes / buildings / geysers /
 * critters / storage, but with parse metadata and lookup tables populated
 * (which the pipeline always writes). Used to verify the API and CLI
 * handle zero-row paths without 500s or NPEs.
 */
export function buildEmptyTables() {
  const tables = {
    save_meta: [
      { key: "baseName",          value: "Empty Colony" },
      { key: "numberOfCycles",    value: "1" },
      { key: "numberOfDuplicants", value: "0" },
      { key: "saveVersion",       value: "7.26" },
      { key: "parsed_at",         value: new Date().toISOString() },
      { key: "source_file",       value: "/tmp/empty.sav" },
    ],
    object_groups: [],
    game_objects: [],
    behaviors: [],
    duplicants: [],
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
  };
  addLookupTables(tables);
  return tables;
}

function addLookupTables(tables) {
  tables.elements     = [...ELEMENT_NAMES.entries()].map(([element_id, name]) => ({ element_id, name }));
  tables.geyser_types = GEYSER_TYPE_NAMES;
  tables.foods        = FOOD_META;
  tables.effects      = EFFECT_LABELS;
  tables.skills       = SKILL_LABELS;
  tables.chore_groups = CHORE_GROUP_NAMES;
}
