// Negative/notable status effect labels.
//
// Only effects in this list are surfaced in the web UI and MCP responses;
// positive, cosmetic, or routine effects are omitted. `severity` drives
// badge styling: "bad" = red, "warn" = yellow.
//
// Written into `effects` in current.sqlite during buildOutputs()
// so both the web frontend and MCP plugin can query it without hardcoded JS.

/** @type {Array<{effect: string, label: string, severity: string}>} */
export const EFFECT_LABELS = [
  { effect: "FoodPoisoning",          label: "Food Poisoned",  severity: "bad"  },
  { effect: "SlimeLung",              label: "Slimelung",       severity: "bad"  },
  { effect: "ZombieSpores",           label: "Zombie Spores",  severity: "bad"  },
  { effect: "Scalding",               label: "Scalding",        severity: "bad"  },
  { effect: "SevereScalding",         label: "Melting",         severity: "bad"  },
  { effect: "Hypothermia",            label: "Hypothermia",     severity: "warn" },
  { effect: "SevereHypothermia",      label: "Freezing",        severity: "bad"  },
  { effect: "Sunburn",                label: "Sunburned",       severity: "warn" },
  { effect: "StressedOut",            label: "Stressed Out",    severity: "warn" },
  { effect: "Suffocation",            label: "Suffocating",     severity: "bad"  },
  { effect: "Suffocating",            label: "Suffocating",     severity: "bad"  },
  { effect: "MinorAilment",           label: "Ill",             severity: "warn" },
  { effect: "MajorAilment",           label: "Sick",            severity: "bad"  },
  { effect: "Pathogen_FoodPoisoning", label: "Food Poisoned",  severity: "bad"  },
];
