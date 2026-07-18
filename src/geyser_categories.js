// Groups geyser_types.element values into the coarse, game-relevant
// buckets a player actually plans around — not the exact resource name.
// A Hot Water Geyser and a Steam Vent both solve "clean water," so they
// belong in the same bucket even though their `element` strings differ.
//
// Order here is the display order for the web dashboard's geyser cards.

const CATEGORIES = [
  { label: "Water / Steam",  elements: ["Water", "Steam"] },
  { label: "Polluted Water", elements: ["Dirty Water"] },
  { label: "Salt Water",     elements: ["Salt Water", "Brine"] },
  { label: "Fuel",           elements: ["Methane", "Crude Oil", "Hydrogen"] },
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
