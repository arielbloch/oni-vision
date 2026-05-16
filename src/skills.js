// Skill branch knowledge: labels and morale-cost rule.
// Single source of truth consumed by pipeline.js (to write skill_labels into
// current.sqlite), src/ui.js (CLI renderer), and src/extractors.js (morale_cost).

/** @type {Array<{branch: string, label: string}>} */
export const SKILL_LABELS = [
  { branch: "mining",        label: "Miner"      },
  { branch: "building",      label: "Builder"    },
  { branch: "researching",   label: "Researcher" },
  { branch: "farming",       label: "Farmer"     },
  { branch: "cooking",       label: "Cook"       },
  { branch: "ranching",      label: "Rancher"    },
  { branch: "arting",        label: "Artist"     },
  { branch: "doctoring",     label: "Medic"      },
  { branch: "hauling",       label: "Hauler"     },
  { branch: "suit",          label: "Suit"       },
  { branch: "power",         label: "Engineer"   },
  { branch: "plumbing",      label: "Plumber"    },
  { branch: "hvac",          label: "HVAC"       },
  { branch: "rocketry",      label: "Rocketry"   },
  { branch: "farming2",      label: "Botanist"   },
  { branch: "spaceanalysis", label: "Space"      },
];

/**
 * Sum the morale cost of a comma-separated mastered-skills string.
 * Each skill's trailing tier digit contributes directly to the morale
 * cost shown in-game (e.g. "Mining2" → 2, "Hauling1" → 1, "Suit" → 1).
 */
export function moraleCostOf(skillsCsv) {
  if (!skillsCsv) return 0;
  let cost = 0;
  for (const skill of skillsCsv.split(",")) {
    const m = skill.trim().match(/\d+$/);
    cost += m ? Number(m[0]) : 1;
  }
  return cost;
}
