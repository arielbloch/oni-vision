// Human-readable rendering of the parsed save state. Pure functions:
// take a DatabaseSync handle (or a config object), return a string. No
// I/O, no color libraries, no native deps.
//
// Color is opt-in via { color: true } and uses ANSI escapes directly so
// we don't pull in chalk / picocolors. The CLI in cli/status.js decides
// whether to enable color based on stdout.isTTY and NO_COLOR.

import { elementName } from "./elements.js";
import { SKILL_LABELS as SKILL_LABELS_ARRAY } from "./skills.js";
import { GEYSER_TYPE_NAMES } from "./geyser_types.js";
import { ANSI, paint, bar, pad, fit, lpad, formatMass, formatAge, stressColor } from "./format.js";

// Build Maps once for O(1) lookup.
const SKILL_LABEL_MAP = new Map(SKILL_LABELS_ARRAY.map(({ branch, label }) => [branch, label]));
const GEYSER_NAMES    = new Map(GEYSER_TYPE_NAMES.map(({ type_id, name }) => [type_id, name]));

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

/** "12 duplicants · 4 critters · 7 geysers". */
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

function geyserName(typeId) {
  if (typeId == null) return "(unknown)";
  const key = Math.trunc(Number(typeId));
  return GEYSER_NAMES.get(key) ?? `hash:${key}`;
}

/** Geyser types grouped by count. */
export function renderGeysers(db, { color = false } = {}) {
  const rows = db
    .prepare("SELECT type_id, COUNT(*) AS n FROM geysers GROUP BY type_id ORDER BY n DESC, type_id")
    .all();
  if (rows.length === 0) return paint("Geysers: none", ANSI.dim, color);

  const header = paint("Geysers", ANSI.bold + ANSI.magenta, color);
  const items  = rows.map((r) => `${pad(geyserName(r.type_id), 24)} ×${r.n}`).join("  ");
  return `${header}\n  ${items}`;
}

/** Top elements by mass across loose piles + storage_contents. */
export function renderStockpile(db, { color = false, limit = 8 } = {}) {
  const sql = `
    SELECT element_id,
           SUM(units) AS total_units,
           SUM(items) AS items
    FROM (
      SELECT element_id, SUM(units) AS units, COUNT(*) AS items
      FROM world_objects
      WHERE element_id IS NOT NULL
      GROUP BY element_id
      UNION ALL
      SELECT element_id, SUM(units) AS units, COUNT(*) AS items
      FROM storage_contents
      WHERE element_id IS NOT NULL
      GROUP BY element_id
    )
    GROUP BY element_id
    ORDER BY total_units DESC
    LIMIT ?`;
  const rows = db.prepare(sql).all(limit);
  if (rows.length === 0) return paint("Stockpile: empty", ANSI.dim, color);

  const header = paint("Stockpile (top elements by mass)", ANSI.bold + ANSI.green, color);
  const lines  = rows.map((r) => {
    const name = elementName(r.element_id);
    const mass = formatMass(r.total_units);
    return `  ${pad(name, 20)} ${lpad(mass, 12)}   in ${r.items} place${r.items === 1 ? "" : "s"}`;
  });
  return [header, ...lines].join("\n");
}

/** Dupes with stress bars and mastered skills. */
export function renderDupes(db, { color = false, limit = 12 } = {}) {
  const rows = db
    .prepare(
      `SELECT d.game_object_id, d.name, d.stress,
              GROUP_CONCAT(ds.skill, ',') AS skills
       FROM duplicants d
       LEFT JOIN duplicant_skills ds ON ds.duplicant_id = d.game_object_id
       GROUP BY d.game_object_id
       ORDER BY d.stress IS NULL, d.stress DESC
       LIMIT ?`
    )
    .all(limit);
  if (rows.length === 0) return paint("Dupes: none", ANSI.dim, color);

  const header = paint("Dupes (sorted by stress)", ANSI.bold + ANSI.yellow, color);
  const lines  = rows.map((r) => {
    const hasStress = r.stress != null;
    const stress    = hasStress ? r.stress : 0;
    const c         = stressColor(stress, color);
    const reset     = color ? ANSI.reset : "";
    const bar10     = hasStress
      ? `${c}${bar(stress / 100)}${reset}`
      : paint("──────────", ANSI.dim, color);
    const pct      = hasStress ? `${lpad(stress.toFixed(1), 5)}%` : `   — `;
    const skillsStr = formatSkills(r.skills);
    const skillCol  = skillsStr ? paint(skillsStr, ANSI.dim, color) : paint("no skills", ANSI.dim, color);
    return `  ${fit(r.name ?? "(unnamed)", 24)} ${bar10} ${pct}   ${skillCol}`;
  });
  return [header, ...lines].join("\n");
}

const ROMAN = ["", "I", "II", "III", "IV", "V"];

/**
 * Convert a comma-separated skills string from GROUP_CONCAT into a compact
 * human-readable label. Groups skills by branch and keeps only the highest
 * level per branch. E.g. "Building1,Building2,Mining1" → "Builder II, Miner I".
 */
function formatSkills(raw) {
  if (!raw) return "";
  const bestLevel = new Map(); // branch key → highest level
  for (const skill of raw.split(",")) {
    const m = skill.match(/^([A-Za-z]+?)(\d+)?$/);
    if (!m) continue;
    const branch = m[1].toLowerCase();
    const level  = m[2] ? Number(m[2]) : 1;
    if (!bestLevel.has(branch) || level > bestLevel.get(branch)) {
      bestLevel.set(branch, level);
    }
  }
  const parts = [];
  for (const [branch, level] of bestLevel) {
    const label = SKILL_LABEL_MAP.get(branch) ?? (branch.charAt(0).toUpperCase() + branch.slice(1));
    const roman = ROMAN[level] ?? String(level);
    parts.push(roman ? `${label} ${roman}` : label);
  }
  return parts.join(", ");
}

/** Top-of-mind alerts: parsed_at staleness, missing data, etc. */
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
    renderGeysers(db, opts),
    "",
    renderStockpile(db, opts),
    "",
    renderDupes(db, opts),
  ].join("\n");
}
