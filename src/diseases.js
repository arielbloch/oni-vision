// Disease (germ) catalog — game knowledge for ONI's contamination system.
//
// Every cell, object, and dupe can carry germ contamination tracked as
// `disease_id` (SimHash integer) + `disease_count` (germ count). The
// disease_id is the SDBM32 hash of the internal disease name, lowercased
// (same algorithm as elements and geyser types).
//
// Buildings, world_objects, and storage_contents already carry
// `disease_id` columns; this lookup lets every consumer JOIN to a
// human-readable name without hardcoding hashes.
//
// Hashes computed with the project's SDBM algorithm (test/extractors-style)
// from the internal names below — verified against `node -e` reproduction
// using known hashes for "water" (1836671383) and "steam" (-899515856).
// The internal disease names come from the Klei wiki; if a save reports a
// disease_id not in this table the queries fall back to `hash:N`.

/** @type {Array<{disease_id: number, name: string}>} */
export const DISEASE_NAMES = [
  { disease_id: -1883943126, name: "Slimelung"      },
  { disease_id:  1918712348, name: "Food Poisoning" },
  { disease_id: -2135408972, name: "Zombie Spores"  },
  { disease_id:  1468040844, name: "Floral Scents"  },
  { disease_id: -1884831694, name: "Pollen Germs"   },
];
