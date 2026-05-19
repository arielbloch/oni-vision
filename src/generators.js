// Generator fuel metadata for power runway calculations.
//
// Energy density (j_per_kg) is derived from ONI generator specs:
//   Energy = Power / ConsumptionRate  →  Joules per kg of fuel
//   Coal Gen:     600 W / 1 kg/s    = 600 J/kg
//   Hydrogen:     800 W / 0.1 kg/s  = 8000 J/kg
//   Petroleum:   2000 W / 2 kg/s    = 1000 J/kg
//   Natural Gas:  800 W / 0.09 kg/s ≈ 8889 J/kg
//   Ethanol:     2000 W / 2 kg/s    = 1000 J/kg (burns in Petroleum Gen)

/** @type {Array<{element_id: number, name: string, j_per_kg: number, generator_prefab: string}>} */
export const POWER_FUELS = [
  // Coal generator stores fuel as Carbon internally; Coal ore is also valid.
  { element_id: 947100397,  name: "Coal",        j_per_kg: 600,  generator_prefab: "Generator" },
  { element_id: 892111639,  name: "Coal",        j_per_kg: 600,  generator_prefab: "Generator" },
  { element_id: -1046145888, name: "Hydrogen",    j_per_kg: 8000, generator_prefab: "HydrogenGenerator" },
  { element_id: -486269331,  name: "Petroleum",   j_per_kg: 1000, generator_prefab: "PetroleumGenerator" },
  { element_id: -87974045,   name: "Ethanol",     j_per_kg: 1000, generator_prefab: "PetroleumGenerator" },
  { element_id: -841236436,  name: "Natural Gas", j_per_kg: 8888.8889, generator_prefab: "MethaneGenerator" },
];
