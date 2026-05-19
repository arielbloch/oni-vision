// O₂ production rates and stats helper shared by ui.js and web.js.
//
// Production rates are game-constants; they are not stored in the save.

/** prefab_id → O₂ output in g/s (wiki-verified) */
export const O2_PRODUCERS = new Map([
  ["Electrolyzer",      888],  // Water Electrolyzer
  ["AlgaeDeoxidizer",   500],  // Algae Deoxidizer
  ["AlgaeTerrarim",      40],  // Algae Terrarium (no-light baseline; +4 g/s when lit)
  ["OxygenDiffuser",    500],  // Oxygen Diffuser (Oxylite)
  ["RustDeoxidizer",    570],  // Rust Deoxidizer
  ["MineralDeoxidizer", 500],  // Oxygen Diffuser (DLC prefab id)
]);

// Trait IDs that modify per-dupe O₂ consumption from the 100 g/s baseline.
const O2_TRAIT_GPS = new Map([
  ["MouthBreather", 200],
  ["DiverLungs",     75],
]);

/**
 * Query O₂ health metrics from a DatabaseSync handle.
 * @returns {{ avg_breath_pct: number, production_gps: number, consumption_gps: number }}
 */
export function oxygenStats(db) {
  const breathRow = db.prepare(
    "SELECT AVG(breath) AS avg FROM duplicants WHERE breath IS NOT NULL"
  ).get();
  const avg_breath_pct = breathRow?.avg ?? 100;

  const prefabs = [...O2_PRODUCERS.keys()];
  const buildingRows = db.prepare(
    `SELECT prefab_id, COUNT(*) AS n FROM buildings
     WHERE prefab_id IN (${prefabs.map(() => "?").join(",")})
     GROUP BY prefab_id`
  ).all(...prefabs);

  const production_gps = buildingRows.reduce(
    (s, r) => s + r.n * (O2_PRODUCERS.get(r.prefab_id) ?? 0), 0
  );

  // Per-dupe consumption accounts for MouthBreather / DiverLungs traits.
  const traitKeys = [...O2_TRAIT_GPS.keys()];
  const dupeTraits = db.prepare(`
    SELECT d.game_object_id,
      MAX(CASE WHEN dt.trait = 'MouthBreather' THEN 1 ELSE 0 END) AS mouth_breather,
      MAX(CASE WHEN dt.trait = 'DiverLungs'    THEN 1 ELSE 0 END) AS diver_lungs
    FROM duplicants d
    LEFT JOIN duplicant_traits dt
      ON dt.duplicant_id = d.game_object_id
      AND dt.trait IN (${traitKeys.map(() => "?").join(",")})
    GROUP BY d.game_object_id
  `).all(...traitKeys);

  const consumption_gps = dupeTraits.reduce((sum, d) => {
    if (d.mouth_breather) return sum + 200;
    if (d.diver_lungs)    return sum + 75;
    return sum + 100;
  }, 0);

  return { avg_breath_pct, production_gps, consumption_gps };
}

