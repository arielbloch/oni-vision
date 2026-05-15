// Chore group hash → name → UI label mapping.
//
// Hashes are SDBM32 of the internal group name (lowercased), matching the
// algorithm in oni-save-parser's HashedString. They come from the
// ChoreConsumer behavior's choreGroupPriorities array.
//
// `name`  — internal string (matches what the game hashes)
// `label` — display label as shown in the "Manage Duplicant Priorities" UI
//
// Written to `chore_group_names` in current.sqlite during buildOutputs() so
// both the web frontend and MCP plugin can JOIN against it without hardcoded
// copies. Also imported by extractors.js to decode hashes at parse time.
//
// The hash for internal name "???" (1980552242) could not be reverse-engineered;
// it shows as an unlabeled column in the game UI. Set label to "?" until
// identified.

/** @type {Array<{hash: number, name: string, label: string}>} */
export const CHORE_GROUP_NAMES = [
  { hash:  112244180,  name: "Combat",           label: "Attacking"    },
  { hash:  408584755,  name: "LifeSupport",       label: "Life Support" },
  { hash:  1794873012, name: "Toggle",            label: "Toggling"     },
  { hash:  1986302507, name: "MedicalAid",        label: "Doctoring"    },
  { hash:  1102910508, name: "Basekeeping",       label: "Tidying"      },
  { hash:  893030024,  name: "Cook",              label: "Cooking"      },
  { hash:  808844387,  name: "Art",               label: "Decorating"   },
  { hash: -1197636805, name: "Research",          label: "Researching"  },
  { hash: -21526676,   name: "Farming",           label: "Farming"      },
  { hash: -1433972386, name: "Ranching",          label: "Ranching"     },
  { hash:  2017082510, name: "Build",             label: "Building"     },
  { hash:  833038498,  name: "Dig",               label: "Digging"      },
  { hash:  1212919986, name: "Hauling",           label: "Supplying"    },
  { hash: -1659480933, name: "Storage",           label: "Storing"      },
  { hash: -81999398,   name: "MachineOperating",  label: "Operating"    },
  { hash:  1980552242, name: "Unknown",           label: "?"            },
];

/**
 * Map from hash (number) → chore group entry, for O(1) lookup in extractors.
 * Exported separately so callers don't have to build the Map themselves.
 */
export const CHORE_GROUP_BY_HASH = new Map(
  CHORE_GROUP_NAMES.map((g) => [g.hash, g])
);
