// Shared test helpers. Builds the standard FAKE_SAVE tables, optionally
// with lookup tables and parse metadata, so every test suite exercises
// the same schema without copy-pasting setup code.

import { extractAll } from "../src/extractors.js";
import { ELEMENT_NAMES } from "../src/elements.js";
import { GEYSER_TYPE_NAMES } from "../src/geyser_types.js";
import { FOOD_META } from "../src/food.js";
import { EFFECT_LABELS } from "../src/effects.js";
import { SKILL_LABELS } from "../src/skills.js";
import { FAKE_SAVE } from "./fixture.js";

/**
 * Build the standard extractor output used across the test suite.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.includeParsedAt=true]  push parsed_at / source_file rows
 * @param {boolean} [opts.includeLookupTables=true] populate element_names, geyser_type_names, food_meta, effect_labels, skill_labels
 * @returns {object} tables object suitable for writeDatabase()
 */
export function buildFakeTables({ includeParsedAt = true, includeLookupTables = true } = {}) {
  const tables = extractAll(FAKE_SAVE);

  if (includeParsedAt) {
    tables.save_meta.push({ key: "parsed_at", value: new Date().toISOString() });
    tables.save_meta.push({ key: "source_file", value: "/tmp/fake.sav" });
  }

  if (includeLookupTables) {
    tables.element_names = [...ELEMENT_NAMES.entries()].map(([element_id, name]) => ({ element_id, name }));
    tables.geyser_type_names = GEYSER_TYPE_NAMES;
    tables.food_meta = FOOD_META;
    tables.effect_labels = EFFECT_LABELS;
    tables.skill_labels = SKILL_LABELS;
  }

  return tables;
}
