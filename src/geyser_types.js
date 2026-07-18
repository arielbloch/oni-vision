// Geyser type SimHash → display name + yield/output metadata.
//
// SimHash is computed with ONI's SDBM algorithm applied to the lowercase
// internal type name (e.g. "steam", "hot_steam", "molten_copper"). These
// values are stable across game versions. Written into `geyser_types` in
// current.sqlite during buildOutputs().
//
// element/output_temp_c/yield_*_kg_cycle come from the game's own
// GeyserGeneric config data (cross-checked by recomputing the SDBM hash of
// each config's internal id and matching it against the type_id values
// already verified from real save files — not from wiki prose, which
// disagrees with itself on which name belongs to which prefab).
//
// yield_min/max_kg_cycle is the rate *while actively erupting*; a geyser is
// only active 40–80% of the time (picked once per instance), so the
// long-run average a fully-analyzed geyser reports in-game is well below
// the active-yield midpoint. lifetime_avg_kg_cycle applies the game's own
// derivation (active yield × ~0.6, the midpoint of that 40–80% range) so it
// lines up with the "Average Output" stat shown after Field Research.
//
// Cool Steam Vent is a guaranteed biome spawn (Swamp/Caustic), not part of
// the randomized 25-geyser pool, so it has no GeyserGeneric config to pull
// exact min/max from — only its wiki-reported average (1.5 kg/s @ 110°C)
// is known, hence the null yield range.
//
// `element` reuses the exact display strings from ELEMENT_NAMES in
// src/elements.js wherever that element already exists there (e.g.
// "Dirty Water", "Polluted O₂", "Chlorine", "Liq. Sulfur", "Methane") —
// not the geyser's colloquial ONI name — so the same substance reads
// identically in the Geysers card and the Stockpile card instead of
// looking like two different resources.

/**
 * @type {Array<{
 *   type_id: number,
 *   name: string,
 *   element: string,
 *   output_temp_c: number|null,
 *   yield_min_kg_cycle: number|null,
 *   yield_max_kg_cycle: number|null,
 *   lifetime_avg_kg_cycle: number|null,
 *   dlc: string|null,
 *   disease: string|null,
 * }>}
 */
export const GEYSER_TYPE_NAMES = [
  { type_id:  -899515856, name: "Steam Vent",             element: "Steam",           output_temp_c:  110.00, yield_min_kg_cycle: 1000, yield_max_kg_cycle: 2000, lifetime_avg_kg_cycle:  900, dlc: null,                 disease: null },
  { type_id:   811188634, name: "Cool Steam Vent",        element: "Steam",           output_temp_c:  110.00, yield_min_kg_cycle: null, yield_max_kg_cycle: null, lifetime_avg_kg_cycle:  900, dlc: null,                 disease: null },
  { type_id: -2022709954, name: "Hot Steam Vent",         element: "Steam",           output_temp_c:  500.00, yield_min_kg_cycle:  500, yield_max_kg_cycle: 1000, lifetime_avg_kg_cycle:  450, dlc: null,                 disease: null },
  { type_id:   713477285, name: "Hot Water Geyser",       element: "Water",           output_temp_c:   95.00, yield_min_kg_cycle: 2000, yield_max_kg_cycle: 4000, lifetime_avg_kg_cycle: 1800, dlc: null,                 disease: null },
  { type_id:  1280790313, name: "Cool Slush Geyser",      element: "Dirty Water",     output_temp_c:  -10.00, yield_min_kg_cycle: 1000, yield_max_kg_cycle: 2000, lifetime_avg_kg_cycle:  900, dlc: null,                 disease: null },
  { type_id:  -413583980, name: "Polluted Water Vent",    element: "Dirty Water",     output_temp_c:   30.00, yield_min_kg_cycle: 2000, yield_max_kg_cycle: 4000, lifetime_avg_kg_cycle: 1800, dlc: null,                 disease: "Food Poisoning" },
  { type_id:  1984991388, name: "Cool Salt Slush Geyser", element: "Brine",           output_temp_c:  -10.00, yield_min_kg_cycle: 1000, yield_max_kg_cycle: 2000, lifetime_avg_kg_cycle:  900, dlc: null,                 disease: null },
  { type_id:   630638510, name: "Salt Water Geyser",      element: "Salt Water",      output_temp_c:   95.00, yield_min_kg_cycle: 2000, yield_max_kg_cycle: 4000, lifetime_avg_kg_cycle: 1800, dlc: null,                 disease: null },
  { type_id: -2131904254, name: "Leaky Oil Fissure",      element: "Crude Oil",       output_temp_c:  326.85, yield_min_kg_cycle:    1, yield_max_kg_cycle:  250, lifetime_avg_kg_cycle:   75, dlc: null,                 disease: null },
  { type_id:  -471575302, name: "Minor Volcano",          element: "Magma",           output_temp_c: 1726.85, yield_min_kg_cycle:  400, yield_max_kg_cycle:  800, lifetime_avg_kg_cycle:  360, dlc: null,                 disease: null },
  { type_id: -1592417549, name: "Volcano",                element: "Magma",           output_temp_c: 1726.85, yield_min_kg_cycle:  800, yield_max_kg_cycle: 1600, lifetime_avg_kg_cycle:  720, dlc: null,                 disease: null },
  { type_id:  1482090435, name: "CO₂ Geyser",             element: "Liquid CO₂",      output_temp_c:  -55.15, yield_min_kg_cycle:  100, yield_max_kg_cycle:  200, lifetime_avg_kg_cycle:   90, dlc: null,                 disease: null },
  { type_id:  -620712844, name: "CO₂ Vent",               element: "Carbon Dioxide",  output_temp_c:  500.00, yield_min_kg_cycle:   70, yield_max_kg_cycle:  140, lifetime_avg_kg_cycle:   63, dlc: null,                 disease: null },
  { type_id:  1483840464, name: "Chlorine Gas Vent",      element: "Chlorine",        output_temp_c:   60.00, yield_min_kg_cycle:   70, yield_max_kg_cycle:  140, lifetime_avg_kg_cycle:   63, dlc: null,                 disease: null },
  { type_id:  1123505170, name: "Hydrogen Vent",          element: "Hydrogen",        output_temp_c:  500.00, yield_min_kg_cycle:   70, yield_max_kg_cycle:  140, lifetime_avg_kg_cycle:   63, dlc: null,                 disease: null },
  { type_id:  -513313279, name: "Hot Polluted O₂ Vent",   element: "Polluted O₂",     output_temp_c:  500.00, yield_min_kg_cycle:   70, yield_max_kg_cycle:  140, lifetime_avg_kg_cycle:   63, dlc: null,                 disease: null },
  { type_id:  2128532496, name: "Infectious PO₂ Vent",    element: "Polluted O₂",     output_temp_c:   60.00, yield_min_kg_cycle:   70, yield_max_kg_cycle:  140, lifetime_avg_kg_cycle:   63, dlc: null,                 disease: "Slimelung" },
  { type_id:  -841236436, name: "Natural Gas Geyser",     element: "Methane",         output_temp_c:  150.00, yield_min_kg_cycle:   70, yield_max_kg_cycle:  140, lifetime_avg_kg_cycle:   63, dlc: null,                 disease: null },
  { type_id: -1765654948, name: "Liquid Sulfur Geyser",   element: "Liq. Sulfur",     output_temp_c:  165.20, yield_min_kg_cycle: 1000, yield_max_kg_cycle: 2000, lifetime_avg_kg_cycle:  900, dlc: "Spaced Out",        disease: null },
  { type_id:   254095636, name: "Iron Volcano",           element: "Molten Iron",     output_temp_c: 2526.85, yield_min_kg_cycle:  200, yield_max_kg_cycle:  400, lifetime_avg_kg_cycle:  180, dlc: null,                 disease: null },
  { type_id:  -695301211, name: "Copper Volcano",         element: "Molten Copper",   output_temp_c: 2226.85, yield_min_kg_cycle:  200, yield_max_kg_cycle:  400, lifetime_avg_kg_cycle:  180, dlc: null,                 disease: null },
  { type_id:  -968505972, name: "Aluminum Volcano",       element: "Molten Aluminum", output_temp_c: 1726.85, yield_min_kg_cycle:  200, yield_max_kg_cycle:  400, lifetime_avg_kg_cycle:  180, dlc: "Spaced Out",        disease: null },
  { type_id: -1332060084, name: "Gold Volcano",           element: "Molten Gold",     output_temp_c: 2626.85, yield_min_kg_cycle:  200, yield_max_kg_cycle:  400, lifetime_avg_kg_cycle:  180, dlc: null,                 disease: null },
  { type_id:  1137916511, name: "Cobalt Volcano",         element: "Molten Cobalt",   output_temp_c: 2226.85, yield_min_kg_cycle:  200, yield_max_kg_cycle:  400, lifetime_avg_kg_cycle:  180, dlc: "Spaced Out",        disease: null },
  { type_id:   159381264, name: "Tungsten Volcano",       element: "Molten Tungsten", output_temp_c: 3726.85, yield_min_kg_cycle:  200, yield_max_kg_cycle:  400, lifetime_avg_kg_cycle:  180, dlc: "Spaced Out",        disease: null },
  { type_id:   976669543, name: "Niobium Volcano",        element: "Molten Niobium",  output_temp_c: 3226.85, yield_min_kg_cycle:  800, yield_max_kg_cycle: 1600, lifetime_avg_kg_cycle:  720, dlc: "Spaced Out",        disease: null },

  // Not yet observed in a save (no type_id previously on record) but present
  // in the game's own geyser config data — added so lookups don't silently
  // return nothing if one turns up.
  { type_id:  -508495848, name: "Cool Chlorine Gas Vent", element: "Chlorine",        output_temp_c:    5.00, yield_min_kg_cycle:   70, yield_max_kg_cycle:  140, lifetime_avg_kg_cycle:   63, dlc: null,                 disease: null },
  { type_id:  1190971945, name: "Polluted Brine Vent",    element: "Polluted Brine",  output_temp_c:   95.00, yield_min_kg_cycle: 2000, yield_max_kg_cycle: 4000, lifetime_avg_kg_cycle: 1800, dlc: "Frosty Planet Pack", disease: null },
];
