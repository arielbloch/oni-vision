// Geyser type SimHash → display name.
//
// SimHash is computed with ONI's SDBM algorithm applied to the lowercase
// internal type name. These values are stable across game versions.
// Written into `geyser_type_names` in current.sqlite during buildOutputs().

/** @type {Array<{type_id: number, name: string}>} */
export const GEYSER_TYPE_NAMES = [
  { type_id:  -899515856, name: "Steam Vent"              },
  { type_id: -2022709954, name: "Hot Steam Vent"          },
  { type_id:   713477285, name: "Hot Water Geyser"        },
  { type_id:  1280790313, name: "Cool Slush Geyser"       },
  { type_id:  -413583980, name: "Polluted Water Vent"     },
  { type_id:  1984991388, name: "Cool Salt Slush Geyser"  },
  { type_id:   630638510, name: "Salt Water Geyser"       },
  { type_id: -2131904254, name: "Leaky Oil Fissure"       },
  { type_id:  -471575302, name: "Minor Volcano"           },
  { type_id: -1592417549, name: "Volcano"                 },
  { type_id:  1482090435, name: "CO₂ Geyser"             },
  { type_id:  -620712844, name: "CO₂ Vent"               },
  { type_id:  1483840464, name: "Chlorine Gas Vent"       },
  { type_id:  1123505170, name: "Hydrogen Vent"           },
  { type_id:  -513313279, name: "Hot Polluted O₂ Vent"   },
  { type_id:  2128532496, name: "Infectious PO₂ Vent"    },
  { type_id:  -841236436, name: "Natural Gas Geyser"      },
  { type_id: -1765654948, name: "Liquid Sulfur Geyser"   },
  { type_id:  1306370440, name: "Iron Volcano"            },
  { type_id: -1725038055, name: "Copper Volcano"          },
  { type_id:  2108244480, name: "Aluminum Volcano"        },
  { type_id:  -279785280, name: "Gold Volcano"            },
  { type_id:   108179667, name: "Cobalt Volcano"          },
  { type_id: -1058835580, name: "Tungsten Volcano"        },
  { type_id: -1779895821, name: "Niobium Volcano"         },
];
