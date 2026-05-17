// Chore group catalog — game knowledge for chore priorities.
//
// Hashes are SDBM32 of the internal group name (lowercased), matching the
// algorithm in oni-save-parser's HashedString. They come from the
// ChoreConsumer behavior's choreGroupPriorities array.
//
// Fields:
//   hash       — game-level integer ID (matches what the game hashes)
//   name       — internal string (matches what the game hashes)
//   label      — display label as shown in the "Manage Duplicant Priorities" UI
//   domain     — colour family used by the web UI (Studio palette CSS class).
//                One of: cyan | lavender | tangerine | pink. Mirrors how the
//                game's UI groups related chores (e.g. all building-related
//                chores share a colour).
//   abbr       — short label for the dashboard's per-dupe focus chips
//                (4 chars max so dupe rows stay scannable).
//   sort_order — column order in the game's "Manage Duplicant Priorities" UI.
//                Used by the FE to render focus chips left→right matching
//                the game.
//
// Projected into `chore_groups` in current.sqlite during buildOutputs()
// so both web and MCP consumers can JOIN against it without hardcoded copies.
// Also imported by extractors.js to decode hashes at parse time.
//
// The hash for internal name "???" (1980552242) could not be reverse-engineered;
// it shows as an unlabeled column in the game UI. Set label to "?" until
// identified.

/** @type {Array<{hash: number, name: string, label: string, domain: string, abbr: string, sort_order: number}>} */
export const CHORE_GROUP_NAMES = [
  { hash:  112244180,  name: "Combat",           label: "Attacking",    domain: "tangerine", abbr: "Atk",   sort_order:  1 },
  { hash:  408584755,  name: "LifeSupport",       label: "Life Support", domain: "cyan",      abbr: "Life",  sort_order:  2 },
  { hash:  1794873012, name: "Toggle",            label: "Toggling",     domain: "lavender",  abbr: "Tog",   sort_order:  3 },
  { hash:  1986302507, name: "MedicalAid",        label: "Doctoring",    domain: "pink",      abbr: "Med",   sort_order:  4 },
  { hash:  1102910508, name: "Basekeeping",       label: "Tidying",      domain: "cyan",      abbr: "Tidy",  sort_order:  5 },
  { hash:  893030024,  name: "Cook",              label: "Cooking",      domain: "pink",      abbr: "Cook",  sort_order:  6 },
  { hash:  808844387,  name: "Art",               label: "Decorating",   domain: "pink",      abbr: "Art",   sort_order:  7 },
  { hash: -1197636805, name: "Research",          label: "Researching",  domain: "lavender",  abbr: "Res",   sort_order:  8 },
  { hash: -81999398,   name: "MachineOperating",  label: "Operating",    domain: "lavender",  abbr: "Ops",   sort_order:  9 },
  { hash: -21526676,   name: "Farming",           label: "Farming",      domain: "pink",      abbr: "Farm",  sort_order: 10 },
  { hash: -1433972386, name: "Ranching",          label: "Ranching",     domain: "pink",      abbr: "Ranch", sort_order: 11 },
  { hash:  2017082510, name: "Build",             label: "Building",     domain: "cyan",      abbr: "Build", sort_order: 12 },
  { hash:  833038498,  name: "Dig",               label: "Digging",      domain: "cyan",      abbr: "Dig",   sort_order: 13 },
  { hash:  1212919986, name: "Hauling",           label: "Supplying",    domain: "cyan",      abbr: "Haul",  sort_order: 14 },
  { hash: -1659480933, name: "Storage",           label: "Storing",      domain: "cyan",      abbr: "Store", sort_order: 15 },
  { hash:  1980552242, name: "Unknown",           label: "?",            domain: "tangerine", abbr: "?",     sort_order: 99 },
];

/**
 * Map from hash (number) → chore group entry, for O(1) lookup in extractors.
 * Exported separately so callers don't have to build the Map themselves.
 */
export const CHORE_GROUP_BY_HASH = new Map(
  CHORE_GROUP_NAMES.map((g) => [g.hash, g])
);
