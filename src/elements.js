// SimHash → human-readable element name lookup.
//
// ONI identifies elements by a 32-bit SimHash of the internal element name.
// These hashes are stable across game versions for a given element. The map
// covers every element likely to appear in stockpile / world-object queries.
//
// Hash values computed with ONI's Hash.SDBMLower algorithm:
//   h = 0; for c in name.toLowerCase(): h = (ord(c) + (h<<6) + (h<<16) - h) >>> 0; return h|0

export const ELEMENT_NAMES = new Map([
  // Gases
  [758759285,   "Vacuum"],
  [-1046145888, "Hydrogen"],
  [-1528777920, "Oxygen"],
  [721531317,   "Polluted O₂"],
  [1960575215,  "Carbon Dioxide"],
  [-841236436,  "Methane"],
  [-1324664829, "Chlorine"],
  [-927923200,  "Sour Gas"],
  [-1858722091, "Propane"],
  [-899515856,  "Steam"],

  // Liquids
  [1836671383,  "Water"],
  [1832607973,  "Dirty Water"],
  [1911997537,  "Salt Water"],
  [-324547888,  "Brine"],
  [-1412059381, "Crude Oil"],
  [-486269331,  "Petroleum"],
  [-87974045,   "Ethanol"],
  [1157157570,  "Naphtha"],
  [1323821489,  "Liq. Phosphorus"],
  [-1108652427, "Liq. Sulfur"],
  [-1075911705, "Magma"],

  // Ores & raw minerals — common
  [-1736594426, "Cuprite"],
  [-1870043872, "Algae"],
  [-1153056158, "Slime Mold"],
  [1479554344,  "Slime"],
  [1624244999,  "Dirt"],
  [381796644,   "Sand"],
  [493438017,   "Sandstone"],
  [-105943486,  "Granite"],
  [-2057963720, "Igneous Rock"],    // canonical SimHash of "IgneousRock"
  [-474151749,  "Obsidian"],
  [1362238252,  "Regolith"],
  [1282846257,  "Mafic Rock"],
  [869554203,   "Toxic Sand"],
  [-355957251,  "Igneous Rock"],   // alternate tag hash (IgneousRock tag vs element)
  [183408504,   "Sedimentary Rock"],
  [1608833498,  "Iron Ore"],
  [-758990593,  "Phosphorite"],     // canonical SimHash of "Phosphorite"
  [-877427037,  "Phosphorite"],    // alternate tag hash (PhosphoriteFossilLayer tag)
  [-839728230,  "Bleach Stone"],
  [381665462,   "Salt"],
  [118518245,   "Carbon Fibre"],
  [-1683093854, "Visco-Gel"],
  [-2008682336, "Isoresin"],
  [245514112,   "Fullerene"],
  [1757792140,  "Fossil"],
  [-527922989,  "Fulgurite"],
  [867327137,   "Clay"],
  [947100397,   "Coal"],           // Klei's internal element/tag name is "Carbon"; in-game display is "Coal"
  [1262005685,  "Oxylite"],
  [-1396791454, "Fertilizer"],

  // Refined metals
  [1306370440,  "Iron"],
  [-899253461,  "Steel"],
  [-1725038055, "Copper"],
  [361868060,   "Gold Amalgam"],
  [-279785280,  "Gold"],
  [2108244480,  "Aluminum"],
  [-755153220,  "Lead"],
  [108179667,   "Cobalt"],
  [-1779895821, "Niobium"],
  [-1058835580, "Tungsten"],
  [733064268,   "Platinum"],
  [1838482828,  "Unobtanium"],
  [-1208854194, "Wolframite"],
  [-400237395,  "Oxidized Copper"],

  // Carbon & glass
  [-902240476,  "Refined Carbon"],
  [-2079931820, "Diamond"],
  [623986332,   "Glass"],
  [-1467370314, "Ceramic"],
  [-1139150657, "Mineral Wool"],

  // Special / manufactured
  [-123825053,  "Super Coolant"],
  [-1713958528, "Super Insulator"],
  [1071649902,  "Katairite"],
  [-721320011,  "Lime"],
  [-1142341158, "Polypropylene"],
  [976099455,   "Organic"],       // "creature" element — default for plants, critters, food

  // Elemental solids
  [-220394187,  "Phosphorus"],
  [-729385479,  "Sulfur"],

  // Ice / frozen
  [873952427,   "Ice"],
  [-1561279013, "Brine Ice"],
  [1664334585,  "Dirty Ice"],
  [489261827,   "Snow"],
]);

/**
 * Resolve a raw element_id (stored as a numeric string or number in SQLite)
 * to a display name. Falls back to the raw value if unknown.
 *
 * @param {string|number|null} elementId
 * @returns {string}
 */
export function elementName(elementId) {
  if (elementId == null) return "?";
  // SQLite stores these as REAL, so they arrive as strings like "493438017.0"
  const key = Math.trunc(Number(elementId));
  return ELEMENT_NAMES.get(key) ?? String(elementId);
}
