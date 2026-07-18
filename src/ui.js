// Human-readable rendering of the parsed save state. Pure functions:
// take a DatabaseSync handle (or a config object), return a string. No
// I/O, no color libraries, no native deps.
//
// Color is opt-in via { color: true } and uses ANSI escapes directly so
// we don't pull in chalk / picocolors. The CLI in cli/status.js decides
// whether to enable color based on stdout.isTTY and NO_COLOR.
//
// Layout mirrors the web dashboard (src/web/): Dupes table (name · roles ·
// morale · stress), Geysers grouped by type with quality bar, Food section,
// Stockpile. All name resolution is done via SQL JOINs against the lookup
// tables written by the pipeline — no in-process JS maps needed.

import { THRESHOLDS } from "./thresholds.js";
import { ANSI, paint, bar, pad, fit, lpad, formatMass, formatKcal, formatAge, stressColor } from "./format.js";
import { oxygenStats } from "./oxygen.js";
import { reportStats } from "./report.js";
import { GENERATOR_SPECS } from "./generators.js";
import { percentPosition, relativeToPod } from "./geo.js";

/**
 * Pull the headline facts out of save_meta. Returns a plain object;
 * missing values become null.
 */
export function readMeta(db) {
  const rows = db.prepare("SELECT key, value FROM save_meta").all();
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  return {
    baseName:    out.baseName ?? null,
    cycle:       out.numberOfCycles != null ? Number(out.numberOfCycles) : null,
    dupeCount:   out.numberOfDuplicants != null ? Number(out.numberOfDuplicants) : null,
    saveVersion: out.saveVersion ?? null,
    parsedAt:    out.parsed_at ?? null,
    sourceFile:  out.source_file ?? null,
  };
}

/** Render the top banner: world name + cycle. */
export function renderBanner(db, { color = false, width = 80 } = {}) {
  const meta = readMeta(db);
  const left  = meta.baseName ?? "(unnamed colony)";
  const right  = meta.cycle != null ? `cycle ${meta.cycle}` : "(unknown cycle)";
  const line   = `${left} · ${right}`;
  const trail  = "═".repeat(Math.max(0, width - line.length - 8));
  return `═══ ${paint(line, ANSI.bold + ANSI.cyan, color)} ${paint(trail, ANSI.dim, color)}═══`;
}

/** "12 duplicants · 4 critters · 7 geysers · 184 buildings". */
export function renderHeadCounts(db, { color = false } = {}) {
  const dupes     = db.prepare("SELECT COUNT(*) AS n FROM duplicants").get().n;
  const critters  = db.prepare("SELECT COUNT(*) AS n FROM critters").get().n;
  const geysers   = db.prepare("SELECT COUNT(*) AS n FROM geysers").get().n;
  const buildings = db.prepare("SELECT COUNT(*) AS n FROM buildings").get().n;
  const sep = paint(" · ", ANSI.dim, color);
  return [
    `${paint(dupes,     ANSI.bold, color)} duplicants`,
    `${paint(critters,  ANSI.bold, color)} critters`,
    `${paint(geysers,   ANSI.bold, color)} geysers`,
    `${paint(buildings, ANSI.bold, color)} buildings`,
  ].join(sep);
}

/**
 * Duplicants table: name + active status effects | focus (priority-boosted
 * chore groups) | morale bar | stress bar + %.
 *
 * Column layout (80-col safe):
 *   2 indent  22 name+effects  2  12 roles  2  10 morale bar  2  10 stress bar  1  6 stress%
 */
export function renderDupes(db, { color = false, limit = 12 } = {}) {
  // Main dupe rows: join effects for negative-status labels.
  const rows = db.prepare(`
    SELECT d.game_object_id, d.name,
           ROUND(d.stress, 1) AS stress,
           d.morale_cost,
           GROUP_CONCAT(eff.label, ', ') AS effect_labels
    FROM duplicants d
    LEFT JOIN duplicant_effects de ON de.duplicant_id = d.game_object_id
    LEFT JOIN effects eff ON eff.effect = de.effect
    GROUP BY d.game_object_id
    ORDER BY d.stress IS NULL, d.stress DESC
    LIMIT ?
  `).all(limit);

  if (rows.length === 0) return paint("Dupes: none", ANSI.dim, color);

  // Focus chips: chore groups where dupe has priority ≥ priority_boost (5),
  // sorted by the game's column order so they read left→right as in the UI.
  const focusByDupe = new Map();
  for (const { duplicant_id, abbr } of db.prepare(`
    SELECT dp.duplicant_id, cg.abbr
    FROM duplicant_priorities dp
    JOIN chore_groups cg ON cg.name = dp.chore_group
    WHERE dp.priority >= ?
    ORDER BY dp.duplicant_id, cg.sort_order
  `).all(THRESHOLDS.priority_boost)) {
    if (!focusByDupe.has(duplicant_id)) focusByDupe.set(duplicant_id, []);
    focusByDupe.get(duplicant_id).push(abbr);
  }

  const sectionLabel = paint("Dupes (sorted by stress)", ANSI.bold + ANSI.green, color);
  const colHeader = paint(
    `  ${"".padEnd(22)}  ${"Roles".padEnd(12)}  ${"Morale".padEnd(10)}  Stress`,
    ANSI.dim, color
  );

  const lines = rows.map((r) => {
    const effects   = r.effect_labels || "";
    const nameStr   = effects ? `${r.name ?? "(unnamed)"} (${effects})` : (r.name ?? "(unnamed)");
    const nameCol   = fit(nameStr, 22);

    const focusStr  = (focusByDupe.get(r.game_object_id) ?? []).join(" ");
    const focusCol  = fit(focusStr, 12);

    const moralePct = Math.min(1, (r.morale_cost ?? 0) / THRESHOLDS.morale_bar_max);
    const moraleBar = color
      ? `${ANSI.green}${bar(moralePct)}${ANSI.reset}`
      : bar(moralePct);

    const hasStress  = r.stress != null;
    const c          = stressColor(r.stress ?? 0, color);
    const reset      = color ? ANSI.reset : "";
    const stressBar  = hasStress
      ? `${c}${bar(r.stress / 100)}${reset}`
      : paint("──────────", ANSI.dim, color);
    const stressLabel = hasStress ? `${lpad(r.stress.toFixed(1), 5)}%` : `   — `;

    return `  ${nameCol}  ${focusCol}  ${moraleBar}  ${stressBar} ${stressLabel}`;
  });

  return [sectionLabel, colHeader, ...lines].join("\n");
}

/** worldWidth/worldHeight in cells, from save_meta. Null if unknown. */
function readWorldDims(db) {
  const rows = db.prepare(
    `SELECT key, value FROM save_meta WHERE key IN ('worldWidth', 'worldHeight')`
  ).all();
  const m = Object.fromEntries(rows.map((r) => [r.key, Number(r.value)]));
  return { width: m.worldWidth || null, height: m.worldHeight || null };
}

/** Printing pod ("Headquarters" prefab) position. Nulls if deconstructed/absent. */
function readPodPosition(db) {
  const row = db.prepare(
    `SELECT position_x, position_y FROM buildings WHERE prefab_id = 'Headquarters' LIMIT 1`
  ).get();
  return { x: row?.position_x ?? null, y: row?.position_y ?? null };
}

/**
 * Geysers, grouped by resource (all Steam together, all Water together, …),
 * one row per instance under each group: geyser name | map location as
 * %x / %y | plain-English direction relative to the printing pod.
 */
export function renderGeysers(db, { color = false } = {}) {
  const rows = db.prepare(`
    SELECT g.position_x, g.position_y,
           COALESCE(gtn.element, '?') AS resource,
           COALESCE(gtn.name, 'hash:' || g.type_id) AS type_name
    FROM geysers g
    LEFT JOIN geyser_types gtn ON gtn.type_id = g.type_id
    ORDER BY resource, type_name, g.position_x
  `).all();

  if (rows.length === 0) return paint("Geysers: none", ANSI.dim, color);

  const { width, height } = readWorldDims(db);
  const pod = readPodPosition(db);

  const lines = [paint("Geysers", ANSI.bold + ANSI.green, color)];
  let lastResource = null;
  for (const r of rows) {
    if (r.resource !== lastResource) {
      lines.push(paint(`  ${r.resource}`, ANSI.bold, color));
      lastResource = r.resource;
    }
    const nameCol = fit(r.type_name, 22);
    const { xPct, yPct } = percentPosition(r.position_x, r.position_y, width, height);
    const posStr = xPct != null ? `${xPct}% / ${yPct}%` : "?";
    const rel = relativeToPod(r.position_x, r.position_y, pod.x, pod.y, width, height);
    lines.push(`    ${nameCol}  ${pad(posStr, 12)}${rel ? "  " + rel : ""}`);
  }

  return lines.join("\n");
}

/**
 * Food in storage: display name | days remaining | morale bonus.
 * Sorted by morale DESC (best food first) to mirror the web dashboard.
 * Days = (qty × kcal) / THRESHOLDS.kcal_per_dupe_per_cycle / dupe_count —
 * "how long does this food last at full colony consumption?"
 */
export function renderFood(db, { color = false, limit = 8 } = {}) {
  const dupeCount = db.prepare("SELECT COUNT(*) AS n FROM duplicants").get().n || 1;

  const rows = db.prepare(`
    SELECT fm.name, fm.kcal, fm.morale, SUM(cnt) AS qty
    FROM (
      SELECT item_prefab_id AS pid, COALESCE(SUM(units), 0) AS cnt
      FROM storage_contents GROUP BY item_prefab_id
      UNION ALL
      SELECT prefab_id AS pid, COALESCE(SUM(units), 0) AS cnt
      FROM world_objects GROUP BY prefab_id
    ) src
    JOIN foods fm ON fm.prefab_id = src.pid
    GROUP BY src.pid
    ORDER BY fm.morale DESC, (fm.kcal * SUM(cnt)) DESC
    LIMIT ?
  `).all(limit);

  if (rows.length === 0) return paint("Food: none", ANSI.dim, color);

  // Total days bar
  const totalKcal = rows.reduce((s, r) => s + r.kcal * r.qty, 0);
  const totalDays = totalKcal / THRESHOLDS.kcal_per_dupe_per_cycle / dupeCount;
  const filled    = Math.min(10, Math.floor(totalDays));
  const over      = totalDays > 10;

  const filledBar = color ? `${ANSI.green}${"█".repeat(filled)}${ANSI.reset}` : "█".repeat(filled);
  const emptyBar  = color ? `${ANSI.dim}${"░".repeat(10 - filled)}${ANSI.reset}` : "░".repeat(10 - filled);
  const overBox   = !color
    ? "[>10]"
    : over
      ? `${ANSI.bg_green}${ANSI.black}[>10]${ANSI.reset}`
      : `${ANSI.dim}[>10]${ANSI.reset}`;

  const totalStr  = totalDays > 999 ? ">999 d" : `${totalDays.toFixed(1)} d`;
  const header    = paint("Food", ANSI.bold + ANSI.green, color);
  const barLine   = `${header}  ${filledBar}${emptyBar}${overBox}  ${totalStr}`;

  // Per-type list: days right-aligned in 6-char column, then name
  const lines = rows.map((r) => {
    const days    = (r.qty * r.kcal) / THRESHOLDS.kcal_per_dupe_per_cycle / dupeCount;
    const daysStr = days > 999 ? ">999 d" : `${days.toFixed(1)} d`;
    return `  ${lpad(daysStr, 6)}  ${r.name}`;
  });

  return [barLine, ...lines].join("\n");
}

/**
 * Single-line O₂ monitor:
 *   Breathability: 10-char bar, red fills from LEFT as breath drops.
 *   O₂ Gen: 10│10 zero-centered bar — dark-red left, dark-green right,
 *           bright fills grow from the hairline outward.
 */
export function renderOxygen(db, { color = false } = {}) {
  const { avg_breath_pct, production_gps, consumption_gps } = oxygenStats(db);

  // ── Breathability: 10 chars, red from LEFT ────────────────────────────────
  const BBAR = 10;
  const redB = Math.min(BBAR, Math.round((1 - avg_breath_pct / 100) * BBAR));
  const dimB = BBAR - redB;
  const breathBar = color
    ? `${ANSI.red}${"█".repeat(redB)}${ANSI.reset}${ANSI.dim}${"░".repeat(dimB)}${ANSI.reset}`
    : `${"█".repeat(redB)}${"░".repeat(dimB)}`;

  // ── Gen bar: 10 │ 10, zero-centered ──────────────────────────────────────
  const HALF = 10;
  let leftRed = 0, rightGreen = 0, genLabel;

  if (consumption_gps === 0 && production_gps === 0) {
    genLabel = "—";
  } else if (production_gps === 0) {
    leftRed  = HALF;
    genLabel = "no gen";
  } else {
    const ratio = consumption_gps > 0 ? production_gps / consumption_gps : Infinity;
    if (ratio >= 1) {
      rightGreen = Math.min(HALF, Math.round((ratio - 1) * HALF));
      genLabel   = ratio >= 10 ? ">10×" : `${ratio.toFixed(1)}×`;
    } else {
      leftRed  = Math.min(HALF, Math.round((1 - ratio) * HALF));
      genLabel = `${Math.round(ratio * 100)}%`;
    }
  }

  const leftDim  = HALF - leftRed;
  const rightDim = HALF - rightGreen;
  const hair = color ? `${ANSI.dim}│${ANSI.reset}` : "│";

  const leftHalf  = color
    ? `${ANSI.dim}${ANSI.red}${"░".repeat(leftDim)}${ANSI.reset}${ANSI.red}${"█".repeat(leftRed)}${ANSI.reset}`
    : `${"░".repeat(leftDim)}${"█".repeat(leftRed)}`;
  const rightHalf = color
    ? `${ANSI.green}${"█".repeat(rightGreen)}${ANSI.reset}${ANSI.dim}${ANSI.green}${"░".repeat(rightDim)}${ANSI.reset}`
    : `${"█".repeat(rightGreen)}${"░".repeat(rightDim)}`;

  const header = paint("O₂", ANSI.bold + ANSI.green, color);
  return `${header}  Breathability ${breathBar}  ${Math.round(avg_breath_pct)}%   O₂ Gen  ${leftHalf}${hair}${rightHalf}  ${genLabel}`;
}

/**
 * Power monitor: generation vs consumption ratio + fuel runway.
 * Mirrors the web dashboard's power card with a text-based bar.
 */
export function renderPower(db, { color = false } = {}) {
  const rs = reportStats(db);
  if (!rs.power) return paint("Power: no data", ANSI.dim, color);

  const { produced_wh, consumed_wh } = rs.power;
  const consumption = consumed_wh || 0;

  // Discover generator+fuel pairs from storage, resolve element names via SQL.
  const generatorFuels = db.prepare(`
    SELECT b.prefab_id AS generator_prefab,
           sc.element_id,
           COALESCE(en.name, sc.item_prefab_id) AS fuel_name,
           SUM(sc.units) AS stored_kg
    FROM buildings b
    JOIN behaviors beh ON beh.game_object_id = b.game_object_id
                      AND beh.name = 'EnergyGenerator'
    JOIN storage_contents sc ON sc.owner_id = b.game_object_id
    LEFT JOIN elements en ON en.element_id = sc.element_id
    WHERE sc.element_id IS NOT NULL
    GROUP BY b.prefab_id, sc.element_id
  `).all();

  // Total fuel mass per element (storage + loose) for runway calculation.
  const massByElement = {};
  for (const r of db.prepare(`
    SELECT element_id, SUM(units) AS total_units
    FROM (
      SELECT element_id, units FROM storage_contents WHERE element_id IS NOT NULL
      UNION ALL
      SELECT element_id, units FROM world_objects   WHERE element_id IS NOT NULL
    )
    GROUP BY element_id
  `).all()) {
    if (r.element_id != null) massByElement[String(Math.trunc(Number(r.element_id)))] = r.total_units ?? 0;
  }

  // Per-fuel runway: join DB-discovered pairs with static j_per_kg specs.
  // Multiple generator types burning the same element are summed.
  const energyByElement = {};
  const nameByElement   = {};
  for (const gf of generatorFuels) {
    const spec = GENERATOR_SPECS[gf.generator_prefab];
    if (!spec) continue; // unknown generator type — add to GENERATOR_SPECS
    const key  = String(Math.trunc(Number(gf.element_id)));
    const mass = massByElement[key] ?? 0;
    if (mass <= 0) continue;
    energyByElement[key] = (energyByElement[key] ?? 0) + mass * spec.j_per_kg;
    nameByElement[key]   = nameByElement[key] ?? gf.fuel_name;
  }

  const fuels = Object.entries(energyByElement).map(([key, energy]) => ({
    name:   nameByElement[key] ?? key,
    cycles: consumption > 0 ? energy / consumption : Infinity,
    mass:   massByElement[key] ?? 0,
  }));
  fuels.sort((a, b) => b.cycles - a.cycles);

  const totalCycles = fuels.reduce((s, r) => s + r.cycles, 0);

  // Ratio bar: 10 chars, green from center for surplus
  const ratio = consumption > 0 ? produced_wh / consumption : (produced_wh > 0 ? Infinity : 0);
  let genLabel;
  let redB = 0, greenB = 0;
  const BAR = 10;
  if (consumption === 0 && produced_wh === 0) {
    genLabel = "—";
  } else if (produced_wh === 0) {
    redB = BAR;
    genLabel = "no gen";
  } else if (ratio >= 1) {
    greenB = Math.min(BAR, Math.round((ratio - 1) * BAR));
    genLabel = ratio >= 10 ? ">10×" : `${ratio.toFixed(1)}×`;
  } else {
    redB = Math.min(BAR, Math.round((1 - ratio) * BAR));
    genLabel = `${Math.round(ratio * 100)}%`;
  }
  const redDim = BAR - redB;
  const greenDim = BAR - greenB;
  const mid = color ? `${ANSI.dim}│${ANSI.reset}` : "│";
  const leftBar = color
    ? `${ANSI.dim}${ANSI.red}${"░".repeat(redDim)}${ANSI.reset}${ANSI.red}${"█".repeat(redB)}${ANSI.reset}`
    : `${"░".repeat(redDim)}${"█".repeat(redB)}`;
  const rightBar = color
    ? `${ANSI.green}${"█".repeat(greenB)}${ANSI.reset}${ANSI.dim}${ANSI.green}${"░".repeat(greenDim)}${ANSI.reset}`
    : `${"█".repeat(greenB)}${"░".repeat(greenDim)}`;

  const totalStr = totalCycles === Infinity ? "∞" : totalCycles.toFixed(1);
  const header = paint("Power", ANSI.bold + ANSI.green, color);
  const runwayStr = totalCycles > 999 ? ">999 d" : `${totalStr} d`;
  const lines = [`${header}  ${leftBar}${mid}${rightBar}  ${genLabel}   Runway ${runwayStr}`];

  for (const f of fuels) {
    const s = f.cycles === Infinity ? "∞ d" : `${f.cycles.toFixed(1)} d`;
    lines.push(`  ${lpad(s, 6)}  ${f.name}`);
  }

  return lines.join("\n");
}

/** Top elements by mass across loose piles + storage_contents. */
export function renderStockpile(db, { color = false, limit = 8 } = {}) {
  const rows = db.prepare(`
    SELECT COALESCE(en.name, sub.element_id) AS name,
           SUM(sub.units) AS total_units
    FROM (
      SELECT element_id, SUM(units) AS units
      FROM world_objects WHERE element_id IS NOT NULL GROUP BY element_id
      UNION ALL
      SELECT element_id, SUM(units) AS units
      FROM storage_contents WHERE element_id IS NOT NULL GROUP BY element_id
    ) sub
    LEFT JOIN elements en ON en.element_id = sub.element_id
    GROUP BY sub.element_id
    ORDER BY total_units DESC
    LIMIT ?
  `).all(limit);

  if (rows.length === 0) return paint("Stockpile: empty", ANSI.dim, color);

  const header = paint("Stockpile (top elements by mass)", ANSI.bold + ANSI.green, color);
  const lines  = rows.map((r) => {
    const mass = formatMass(r.total_units);
    return `  ${pad(r.name, 20)} ${lpad(mass, 12)}`;
  });
  return [header, ...lines].join("\n");
}

/** Top-of-mind alerts: parsed_at staleness. */
export function renderFreshness(db, { color = false } = {}) {
  const meta = readMeta(db);
  if (!meta.parsedAt) return paint("(no parsed_at stamp — older watcher version?)", ANSI.dim, color);

  const seconds   = Math.floor((Date.now() - new Date(meta.parsedAt).getTime()) / 1000);
  const sourceTail = meta.sourceFile ? meta.sourceFile.split(/[\\/]/).pop() : "?";
  return paint(`Parsed ${formatAge(seconds)} from ${sourceTail}`, ANSI.dim, color);
}

/** Compose the full status block. */
export function render(db, opts = {}) {
  return [
    renderBanner(db, opts),
    "",
    renderHeadCounts(db, opts),
    renderFreshness(db, opts),
    "",
    renderDupes(db, opts),
    "",
    renderOxygen(db, opts),
    "",
    renderPower(db, opts),
    "",
    renderGeysers(db, opts),
    "",
    renderFood(db, opts),
    "",
    renderStockpile(db, opts),
  ].join("\n");
}
