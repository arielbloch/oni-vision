// Human-readable rendering of the parsed save state. Pure functions:
// take a DatabaseSync handle (or a config object), return a string. No
// I/O, no color libraries, no native deps.
//
// Color is opt-in via { color: true } and uses ANSI escapes directly so
// we don't pull in chalk / picocolors. The CLI in cli/status.js decides
// whether to enable color based on stdout.isTTY and NO_COLOR.

const ANSI = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
};

function paint(s, code, enabled) {
  return enabled ? `${code}${s}${ANSI.reset}` : s;
}

/** Stress level → ANSI color code. */
function stressColor(stress, enabled) {
  if (!enabled) return "";
  if (stress >= 60) return ANSI.red;
  if (stress >= 30) return ANSI.yellow;
  return ANSI.green;
}

/** Render a 10-segment ASCII bar. value is 0..1; bar fills proportionally. */
function bar(value, width = 10) {
  const v = Math.max(0, Math.min(1, value));
  const filled = Math.round(v * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function pad(s, n) {
  s = String(s);
  if (s.length >= n) return s;
  return s + " ".repeat(n - s.length);
}

/** Pad-or-clip to exactly n columns. Long strings get an ellipsis. */
function fit(s, n) {
  s = String(s);
  if (s.length === n) return s;
  if (s.length < n) return s + " ".repeat(n - s.length);
  if (n <= 1) return s.slice(0, n);
  return s.slice(0, n - 1) + "…";
}

function lpad(s, n) {
  s = String(s);
  if (s.length >= n) return s;
  return " ".repeat(n - s.length) + s;
}

/**
 * Pull the headline facts out of save_meta. Returns a plain object;
 * missing values become null.
 */
export function readMeta(db) {
  const rows = db.prepare("SELECT key, value FROM save_meta").all();
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  return {
    baseName: out.baseName ?? null,
    cycle: out.numberOfCycles != null ? Number(out.numberOfCycles) : null,
    dupeCount: out.numberOfDuplicants != null ? Number(out.numberOfDuplicants) : null,
    saveVersion: out.saveVersion ?? null,
    parsedAt: out.parsed_at ?? null,
    sourceFile: out.source_file ?? null,
  };
}

/** Render the top banner: world name + cycle. */
export function renderBanner(db, { color = false, width = 80 } = {}) {
  const meta = readMeta(db);
  const left = meta.baseName ?? "(unnamed colony)";
  const right = meta.cycle != null ? `cycle ${meta.cycle}` : "(unknown cycle)";
  const middle = ` · `;
  const line = `${left}${middle}${right}`;
  // Trailing horizontal rule. Local name `trail` avoids shadowing the
  // module-level `bar()` function for stress bars.
  const trail = "═".repeat(Math.max(0, width - line.length - 8));
  return `═══ ${paint(line, ANSI.bold + ANSI.cyan, color)} ${paint(trail, ANSI.dim, color)}═══`;
}

/** "12 duplicants · 4 critters · 7 geysers". */
export function renderHeadCounts(db, { color = false } = {}) {
  const dupes = db.prepare("SELECT COUNT(*) AS n FROM duplicants").get().n;
  const critters = db.prepare("SELECT COUNT(*) AS n FROM critters").get().n;
  const geysers = db.prepare("SELECT COUNT(*) AS n FROM geysers").get().n;
  const buildings = db.prepare("SELECT COUNT(*) AS n FROM buildings").get().n;
  const sep = paint(" · ", ANSI.dim, color);
  return [
    `${paint(dupes, ANSI.bold, color)} duplicants`,
    `${paint(critters, ANSI.bold, color)} critters`,
    `${paint(geysers, ANSI.bold, color)} geysers`,
    `${paint(buildings, ANSI.bold, color)} buildings`,
  ].join(sep);
}

/** Geyser types grouped by count. */
export function renderGeysers(db, { color = false } = {}) {
  const rows = db
    .prepare("SELECT type_id, COUNT(*) AS n FROM geysers GROUP BY type_id ORDER BY n DESC, type_id")
    .all();
  if (rows.length === 0) return paint("Geysers: none", ANSI.dim, color);

  const header = paint("Geysers", ANSI.bold + ANSI.magenta, color);
  const items = rows
    .map((r) => `${pad(r.type_id ?? "(unknown)", 24)} ×${r.n}`)
    .join("  ");
  return `${header}\n  ${items}`;
}

/** Top elements by mass across loose piles + storage_contents. */
export function renderStockpile(db, { color = false, limit = 8 } = {}) {
  // Combine world_objects (loose piles) and storage_contents (in containers).
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
  const lines = rows.map((r) => {
    const mass = formatMass(r.total_units);
    return `  ${pad(r.element_id, 16)} ${lpad(mass, 12)}   in ${r.items} place${r.items === 1 ? "" : "s"}`;
  });
  return [header, ...lines].join("\n");
}

/** Dupes with stress bars. */
export function renderDupes(db, { color = false, limit = 12 } = {}) {
  const rows = db
    .prepare(
      `SELECT name, stress, current_role
       FROM duplicants
       ORDER BY stress IS NULL, stress DESC
       LIMIT ?`
    )
    .all(limit);
  if (rows.length === 0) return paint("Dupes: none", ANSI.dim, color);

  const header = paint("Dupes (sorted by stress)", ANSI.bold + ANSI.yellow, color);
  const lines = rows.map((r) => {
    const hasStress = r.stress != null;
    const stress = hasStress ? r.stress : 0;
    const c = stressColor(stress, color);
    const reset = color ? ANSI.reset : "";
    const bar10 = hasStress
      ? `${c}${bar(stress / 100)}${reset}`
      : paint("──────────", ANSI.dim, color);
    const pct = hasStress ? `${lpad(stress.toFixed(1), 5)}%` : `   — `;
    return `  ${fit(r.name ?? "(unnamed)", 12)} ${bar10} ${pct}   ${r.current_role ?? ""}`;
  });
  return [header, ...lines].join("\n");
}

/** Top-of-mind alerts: parsed_at staleness, missing data, etc. */
export function renderFreshness(db, { color = false } = {}) {
  const meta = readMeta(db);
  if (!meta.parsedAt) return paint("(no parsed_at stamp — older watcher version?)", ANSI.dim, color);

  const ageMs = Date.now() - new Date(meta.parsedAt).getTime();
  const seconds = Math.floor(ageMs / 1000);
  let human;
  if (seconds < 90) human = `${seconds}s ago`;
  else if (seconds < 5400) human = `${Math.floor(seconds / 60)}m ago`;
  else if (seconds < 86400) human = `${Math.floor(seconds / 3600)}h ago`;
  else human = `${Math.floor(seconds / 86400)}d ago`;

  const sourceTail = meta.sourceFile ? meta.sourceFile.split(/[\\/]/).pop() : "?";
  return paint(`Parsed ${human} from ${sourceTail}`, ANSI.dim, color);
}

/** Compose the full status block. */
export function render(db, opts = {}) {
  const sections = [
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
  ];
  return sections.join("\n");
}

/**
 * Format a mass in raw ONI "units" (which are kg) into a compact string.
 * Tiers: kg → t (tonnes, 1000 kg) → kt (kilotonnes, 1000 t).
 */
function formatMass(units) {
  if (units == null) return "?";
  const u = Number(units);
  if (Number.isNaN(u)) return "?";
  if (u >= 1_000_000) return `${(u / 1_000_000).toFixed(2)} kt`;
  if (u >= 1_000) return `${(u / 1_000).toFixed(2)} t`;
  return `${u.toFixed(0)} kg`;
}
