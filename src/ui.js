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

/**
 * Geysers grouped by type: type name × count | quality bar | quality%.
 * Quality = average of rate_roll and year_percent_roll (0–1 each), matching
 * the web dashboard formula. Color: green ≥ 70%, yellow ≥ 40%, red below.
 */
export function renderGeysers(db, { color = false } = {}) {
  const rows = db.prepare(`
    SELECT g.type_id,
           COALESCE(gtn.name, 'hash:' || g.type_id) AS type_name,
           COUNT(*) AS n,
           ROUND(AVG((g.rate_roll + g.year_percent_roll) / 2.0) * 100) AS quality
    FROM geysers g
    LEFT JOIN geyser_types gtn ON gtn.type_id = g.type_id
    GROUP BY g.type_id
    ORDER BY n DESC, g.type_id
  `).all();

  if (rows.length === 0) return paint("Geysers: none", ANSI.dim, color);

  const header = paint("Geysers", ANSI.bold + ANSI.green, color);
  const lines  = rows.map((r) => {
    const quality = r.quality ?? 0;
    let qc = "";
    let qr = "";
    if (color) {
      qc = quality >= THRESHOLDS.geyser_quality_good ? ANSI.green
         : quality >= THRESHOLDS.geyser_quality_warn ? ANSI.yellow
         : ANSI.red;
      qr = ANSI.reset;
    }
    const nameAndCount = fit(`${r.type_name} ×${r.n}`, 28);
    const qualBar      = `${qc}${bar(quality / 100)}${qr}`;
    const qualPct      = `${lpad(String(quality), 3)}%`;
    return `  ${nameAndCount}  ${qualBar}  ${qualPct}`;
  });

  return [header, ...lines].join("\n");
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
    renderGeysers(db, opts),
    "",
    renderFood(db, opts),
    "",
    renderStockpile(db, opts),
  ].join("\n");
}
