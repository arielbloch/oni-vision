// Groups geyser_types.element values into the coarse, game-relevant
// buckets a player actually plans around — not always the exact resource
// name (e.g. every molten metal shares one "Metals" card).
//
// Order here is the display order for the web dashboard's geyser cards.

const CATEGORIES = [
  { label: "Water",          elements: ["Water"] },
  { label: "Steam",          elements: ["Steam"] },
  { label: "Polluted Water", elements: ["Dirty Water"] },
  { label: "Salt Water",     elements: ["Salt Water", "Brine"] },
  { label: "Natural Gas",    elements: ["Methane"] },
  { label: "Crude Oil",      elements: ["Crude Oil"] },
  { label: "Hydrogen",       elements: ["Hydrogen"] },
  { label: "Metals",         elements: [
    "Molten Iron", "Molten Copper", "Molten Gold", "Molten Aluminum",
    "Molten Cobalt", "Molten Tungsten", "Molten Niobium",
  ] },
];

const OTHER_LABEL = "Other";

const ELEMENT_TO_CATEGORY = new Map();
CATEGORIES.forEach((cat, order) => {
  for (const el of cat.elements) ELEMENT_TO_CATEGORY.set(el, { label: cat.label, order });
});

/**
 * Classify a geyser's produced resource into a display category.
 * Unrecognized/rare elements (CO₂, Chlorine, Polluted O₂, Magma,
 * Liq. Sulfur, Polluted Brine, ...) fall into "Other", sorted last.
 *
 * @param {string} element
 * @returns {{label: string, order: number}}
 */
export function categorizeGeyser(element) {
  return ELEMENT_TO_CATEGORY.get(element) ?? { label: OTHER_LABEL, order: CATEGORIES.length };
}
