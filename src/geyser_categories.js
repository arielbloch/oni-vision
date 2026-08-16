// Groups geyser_types.element values into the coarse, game-relevant
// buckets a player actually plans around — not always the exact resource
// name (e.g. every molten metal shares one "Metals" card).
//
// Categories nest under four dashboard sections — Water, Power, Metals,
// Other — in that order. Within Water, categories run cold to hot
// (Water 95°C sits first per design call, then Polluted Water, Salt Water,
// Steam 110°C, Hot Steam 500°C last) so a glance at the row shows escalating
// heat-management difficulty. Within Power, order follows how commonly each
// fuel gets burned (Natural Gas, Crude Oil, then Hydrogen).
//
// `order` is the flat display position (section-major, category-minor)
// used to sort cards inside a section; `section`/`sectionOrder` group cards
// into their row.

const SECTIONS = ["Water", "Power", "Metals", "Other"];

const CATEGORIES = [
  { label: "Water",          section: "Water",  elements: ["Water"] },
  { label: "Polluted Water", section: "Water",  elements: ["Dirty Water"] },
  { label: "Salt Water",     section: "Water",  elements: ["Salt Water", "Brine"] },
  { label: "Steam",          section: "Water",  elements: ["Steam"] },
  // Not element-driven — see TYPE_NAME_OVERRIDES. Steam Vent/Cool Steam Vent
  // both output at 110°C; Hot Steam Vent runs at 500°C, a different design
  // problem (needs heat-tolerant piping/exchange, not just a boiler), so it
  // gets its own card instead of being buried in "Steam" by shared element.
  { label: "Hot Steam",      section: "Water",  elements: [] },
  { label: "Natural Gas",    section: "Power",  elements: ["Methane"] },
  { label: "Crude Oil",      section: "Power",  elements: ["Crude Oil"] },
  { label: "Hydrogen",       section: "Power",  elements: ["Hydrogen"] },
  { label: "Metals",         section: "Metals", elements: [
    "Molten Iron", "Molten Copper", "Molten Gold", "Molten Aluminum",
    "Molten Cobalt", "Molten Tungsten", "Molten Niobium",
  ] },
  // Its own card rather than being merged into a generic "Other" bucket —
  // Chlorine is a common, plannable resource (disease-immune pipe
  // transport) and shouldn't read as the same thing as rare/no-plan-around
  // elements like Magma, even though both land in the "Other" section.
  { label: "Chlorine",       section: "Other",  elements: ["Chlorine"] },
];

const OTHER_LABEL = "Other";
const OTHER_SECTION = "Other";

const ELEMENT_TO_CATEGORY = new Map();
CATEGORIES.forEach((cat, order) => {
  const sectionOrder = SECTIONS.indexOf(cat.section);
  for (const el of cat.elements) {
    ELEMENT_TO_CATEGORY.set(el, { label: cat.label, order, section: cat.section, sectionOrder });
  }
});
const LABEL_TO_ENTRY = new Map(CATEGORIES.map((cat, order) => [
  cat.label, { order, section: cat.section, sectionOrder: SECTIONS.indexOf(cat.section) },
]));

// Keyed by geyser_types.name, not element — for the cases where two type
// names share an element but shouldn't share a card.
const TYPE_NAME_OVERRIDES = new Map([
  ["Hot Steam Vent", "Hot Steam"],
]);

const OTHER_ENTRY = {
  label: OTHER_LABEL,
  order: CATEGORIES.length,
  section: OTHER_SECTION,
  sectionOrder: SECTIONS.indexOf(OTHER_SECTION),
};

/**
 * Classify a geyser's produced resource into a display category + section.
 * Unrecognized/rare elements (CO₂, Polluted O₂, Magma, Liq. Sulfur,
 * Polluted Brine, ...) fall into "Other" (Other section), sorted last.
 *
 * @param {string} element
 * @param {string} [typeName] - geyser_types.name; disambiguates types that
 *   share an element but need separate cards (e.g. Hot Steam Vent).
 * @returns {{label: string, order: number, section: string, sectionOrder: number}}
 */
export function categorizeGeyser(element, typeName) {
  const overrideLabel = typeName && TYPE_NAME_OVERRIDES.get(typeName);
  if (overrideLabel) {
    const { order, section, sectionOrder } = LABEL_TO_ENTRY.get(overrideLabel);
    return { label: overrideLabel, order, section, sectionOrder };
  }
  return ELEMENT_TO_CATEGORY.get(element) ?? OTHER_ENTRY;
}
