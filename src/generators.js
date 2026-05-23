// Generator specs for power runway calculations.
//
// Only the energy density (j_per_kg) lives here — it cannot be derived from
// save data because the game hard-codes wattage and fuel consumption rate in C#.
//
//   j_per_kg = wattage / fuel_consumption_kg_per_s
//
//   Coal Gen:      600 W / 1.0 kg/s  = 600 J/kg
//   Wood Gas Gen:  800 W / 1.0 kg/s  = 800 J/kg
//   Hydrogen Gen:  800 W / 0.1 kg/s  = 8 000 J/kg
//   Petroleum Gen: 2000 W / 2.0 kg/s = 1 000 J/kg  (also burns Ethanol)
//   Natural Gas:   800 W / 0.09 kg/s ≈ 8 889 J/kg
//
// Which fuel element_id each generator is using is discovered automatically at
// serve-time by querying storage_contents of buildings that have an
// EnergyGenerator behavior (see the generator_fuels query in web.js).
//
// If a new generator appears in the save and its prefab_id is missing here,
// the server logs a warning and the frontend skips it — add one line below.

/** @type {Record<string, { j_per_kg: number }>} */
export const GENERATOR_SPECS = {
  "Generator":          { j_per_kg: 600         },  // Coal Generator
  "WoodGasGenerator":   { j_per_kg: 800         },  // Wood Gas Generator
  "HydrogenGenerator":  { j_per_kg: 8000        },  // Hydrogen Generator
  "PetroleumGenerator": { j_per_kg: 1000        },  // Petroleum / Ethanol Generator
  "MethaneGenerator":   { j_per_kg: 8888.8889   },  // Natural Gas Generator
};
