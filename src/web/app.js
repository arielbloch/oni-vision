// ONI-vision dashboard — browser-side logic.
// Fetches /api/status on load, on SSE push, and on a polling fallback.
// All thresholds (stale_after_s, stress_bad, …) are read from the API
// response so they stay in sync with src/thresholds.js server-side.
//
// Expected /api/status shape:
//   base_name, cycle, age_seconds, source_file, counts, top_dupes,
//   geysers (per-instance), food, all_resources,
//   elements, geyser_types, foods, effects, skills, chore_groups
//   (all six lookup tables), thresholds

// ── Name lookup tables ───────────────────────────────────────────────────────
// Populated from the API (/api/status) on each refresh. The server queries
// current.sqlite which is the single source of truth, written from the JS
// source files (src/elements.js, src/food.js, etc.) during each parse.
// Starting empty is fine — they're filled before the first render call.

let ELEMENT_NAMES = {};  // element_id (string) → name
let GEYSER_NAMES  = {};  // type_id (string)    → name
// STRESS_DELTA (dupe name → net stress %-pts last cycle, from ReportManager
// type 2) is parked along with renderDupes/stressDeltaTri below and the
// commented-out "Dupes" section in index.html — reactivate all three
// together for the future per-dupe detail view.
// let STRESS_DELTA = {};
let GENERATOR_SPECS = {}; // populated from API — { [prefab_id]: { j_per_kg } }
let GENERATOR_FUELS = []; // populated from API — [{ generator_prefab, element_id, fuel_prefab, stored_kg }]
// Note: DISTANCE (tiles walked per dupe per cycle) is available in data.report.distance
// but has no renderer yet; add one before wiring it up here.

// ── Visual settings ───────────────────────────────────────────────────────────
// Persisted to localStorage; sliders in the settings panel update these and
// call renderAll() to redraw without re-fetching.

const SETTINGS_LS = "oni-settings-v1";
let cfg = {
  fs:      18,         // chip title font size (px)
  color:   "#fb923c",  // chip title color
  pad:     5,          // chip padding (px)
  seggap:  2,          // gap between pips / runway segments (px)
  chipgap: 10,         // gap between chips in a row (px)
  seg:     18,         // pip / runway segment size (px)
  sfs:     18,         // section label font size (px)
  sdist:   2,          // gap between section label and card (px)
  cgap:    40,         // gap between gauge columns (px)
  slc:     44,         // section label lightness (0–100 = black → white)
  cpad:    6,          // card inner padding (px)
  runSat:  90,         // runway gauge color saturation (0–100%)
  col1:    30,         // column-1 offset as % of card width (10–90)
  chipPalette: 1,      // 1 = per-item chips use distinct palette colors, 0 = threshold
};
try {
  const raw = localStorage.getItem(SETTINGS_LS);
  if (raw) cfg = { ...cfg, ...JSON.parse(raw) };
} catch { /**/ }

function saveSettings() {
  try { localStorage.setItem(SETTINGS_LS, JSON.stringify(cfg)); } catch { /**/ }
  const root = document.documentElement;
  root.style.setProperty("--seg-size", cfg.seg + "px");
  root.style.setProperty("--sfs",      cfg.sfs  + "px");
  root.style.setProperty("--sdist",    cfg.sdist + "px");
  root.style.setProperty("--cgap",     cfg.cgap  + "px");
  root.style.setProperty("--slc",      `hsl(0,0%,${cfg.slc}%)`);
  root.style.setProperty("--cpad",     cfg.cpad + "px");
  root.style.setProperty("--col1",     cfg.col1  + "%");
}

let _lastData = null;  // cached API response for instant settings re-render

/** Resolve a numeric geyser type_id to a display name. */
function geyserName(id) {
  if (id == null) return "(unknown)";
  const key = String(Math.trunc(Number(id)));
  return GEYSER_NAMES[key] ?? `hash:${key}`;
}

// ── DOM helpers ──────────────────────────────────────────────────────────────

const POLL_MS = 10000;  // polling fallback (SSE is the primary push path)

// Game-rule thresholds. These defaults mirror src/thresholds.js and are used
// only for the brief window between page load and the first /api/status
// response; from then on every refresh overwrites T with the server values,
// keeping the FE always in sync with the canonical source.
let T = {
  stale_after_s:          600,
  stress_warn:             30,
  stress_bad:              60,
  morale_bar_max:          20,
  priority_boost:           5,
  kcal_per_dupe_per_cycle: 1000,
};

function $(id) { return document.getElementById(id); }
function setText(id, t) { const el = $(id); if (el) el.textContent = t; }
function setHTML(id, h)  { const el = $(id); if (el) el.innerHTML = h; }

function fmtAge(seconds) {
  if (seconds == null) return "unknown";
  const s = Math.max(0, Math.floor(seconds));
  if (s < 90)    return `${s}s ago`;
  if (s < 5400)  return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
}


function fmtKcal(kcal) {
  if (kcal == null || !Number.isFinite(Number(kcal))) return "?";
  const k = Number(kcal);
  if (k >= 1_000_000) return `${(k / 1_000_000).toFixed(1)} Mkcal`;
  if (k >= 1_000)     return `${(k / 1_000).toFixed(0)} kCal`;
  return `${k.toFixed(0)} kcal`;
}

function fmtMass(units) {
  if (units == null) return "?";
  const u = Number(units);
  if (!Number.isFinite(u)) return "?";
  if (u >= 1_000_000) return `${(u/1_000_000).toFixed(2)} kt`;
  if (u >= 1_000)     return `${(u/1_000).toFixed(2)} t`;
  return `${u.toFixed(0)} kg`;
}

function fmtW(wh) {
  const w = Number(wh);
  if (!Number.isFinite(w)) return "?";
  if (w >= 1_000_000) return `${(w/1_000_000).toFixed(1)} MW`;
  if (w >= 1_000)     return `${(w/1_000).toFixed(1)} kW`;
  return `${Math.round(w)} W`;
}

function fileBaseName(path) {
  if (!path) return "";
  return String(path).split(/[\\/]/).pop();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"'/]/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "/": "&#x2F;",
  }[c]));
}

// ── Renderers ────────────────────────────────────────────────────────────────

function renderCounts(c) {
  const parts = [
    [c.duplicants, "dupes"],
    [c.critters,   "critters"],
    [c.geysers,    "geysers"],
    [c.buildings,  "buildings"],
  ];
  setText("counts", parts.map(([n, label]) => `${n ?? "—"} ${label}`).join("  ·  "));
}

// Grey triangle indicating stress trend. Brightness: 0%→50%grey, +50→white,
// -50→black. Parked with renderDupes below — see STRESS_DELTA comment.
// function stressDeltaTri(name) {
//   const delta = STRESS_DELTA[name];
//   if (delta == null) return '';
//   const b = Math.max(0, Math.min(1, 0.5 + delta / 100));
//   const v = Math.round(b * 255);
//   const dir = delta >= 0 ? '▲' : '▼';
//   return `<span class="stress-delta-tri" style="color:rgb(${v},${v},${v})">${dir}</span>`;
// }

// ── Layout helper ────────────────────────────────────────────────────────────

/**
 * Two-section row. `before` fills up to --col1 % of the card width,
 * then `after` starts at that offset and scrolls/fades to the right.
 */
function twoColRow(before, after) {
  const gap = cfg.chipgap + "px";
  return `<div style="display:flex;gap:${gap};align-items:flex-start">
  <div style="min-width:var(--col1,30%);display:flex;gap:${gap};align-items:flex-start;flex-shrink:0">${before}</div>
  <div style="display:flex;gap:${gap};align-items:flex-start;flex:1;overflow:hidden;
    -webkit-mask-image:linear-gradient(to right,black 90%,transparent 96%);
    mask-image:linear-gradient(to right,black 90%,transparent 96%)">${after}</div>
</div>`;
}

// ── Gauge primitives ─────────────────────────────────────────────────────────

function _pipChipShell(label, pipsHtml, valueHtml) {
  return `<div style="display:flex;flex-direction:column;gap:4px;background:#0a0a14;border:1px solid #2a2a44;border-radius:5px;padding:${cfg.pad}px ${cfg.pad + 3}px;flex-shrink:0">
  <div style="font-size:${cfg.fs}px;color:${cfg.color};white-space:nowrap">${label}</div>
  ${pipsHtml}
  ${valueHtml}
</div>`;
}

function _pip(lit, col) {
  return `<div style="width:8px;height:${cfg.seg}px;border-radius:4px;background:${lit ? col : '#1c1c30'};flex-shrink:0"></div>`;
}

/**
 * Design 1 — Percent gauge (0–100%, higher = better).
 * Pips fill left-to-right. Color: ≥80% green, ≥50% orange, <50% red.
 * Pass displayLabel to override the text (e.g. Stress shows raw %, gauge
 * receives inverted value so high stress = few lit pips = red).
 */
// hiIsGood=true (default): high pct = green (breathability, morale).
// hiIsGood=false: low pct = green (stress — fewer pips = healthier colony).
function percentGauge(label, pct, displayLabel, hiIsGood = true) {
  const p   = Math.max(0, Math.min(100, Number(pct) || 0));
  const lit = Math.round(p / 100 * 8);
  const col = hiIsGood
    ? (p >= 80 ? '#4ade80' : p >= 50 ? '#fb923c' : '#ff2222')
    : (p <= T.stress_warn ? '#4ade80' : p <= T.stress_bad ? '#fb923c' : '#ff2222');
  const pips = Array.from({ length: 8 }, (_, i) => _pip(i < lit, col)).join('');
  return _pipChipShell(label,
    `<div style="display:flex;gap:${cfg.seggap}px">${pips}</div>`,
    `<div style="font-size:13px;font-weight:700;color:${col};white-space:nowrap">${displayLabel ?? `${p.toFixed(1)}%`}</div>`
  );
}

/**
 * Design 2 — Balance gauge (production vs consumption).
 * 8 pips split at center: left 4 = deficit side, right 4 = surplus side.
 * Lights from center outward. X (range) = max(produced, consumed) * xFactor.
 * Color: green ≥0, orange ≥ −30%·X, red < −30%·X.
 */
function balanceGauge(label, produced, consumed, fmtFn, xFactor = 0.2) {
  const valid = produced != null && consumed != null;
  const p     = Number(produced ?? 0);
  const c     = Number(consumed ?? 0);
  const X     = Math.max(p, c, 1) * xFactor;
  const delta = valid ? p - c : 0;
  const norm  = valid ? Math.max(-1, Math.min(1, delta / X)) : 0;
  const col   = norm >= 0 ? '#4ade80' : norm >= -0.3 ? '#fb923c' : '#ff2222';
  const lit   = Math.round(Math.abs(norm) * 4);

  const leftPips  = Array.from({ length: 4 }, (_, i) => _pip(norm < 0 && i >= 4 - lit, col)).join('');
  const rightPips = Array.from({ length: 4 }, (_, i) => _pip(norm >= 0 && i < lit, col)).join('');
  const divider   = `<div style="width:2px;height:${Math.round(cfg.seg * 0.65)}px;background:#454560;border-radius:1px;flex-shrink:0"></div>`;
  const pipsHtml  = `<div style="display:flex;gap:${cfg.seggap}px;align-items:center"><div style="display:flex;gap:${cfg.seggap}px">${leftPips}</div>${divider}<div style="display:flex;gap:${cfg.seggap}px">${rightPips}</div></div>`;

  const sign = delta < -0.001 ? '−' : '';
  return _pipChipShell(label, pipsHtml,
    `<div style="font-size:13px;font-weight:700;color:${col};white-space:nowrap">${sign}${fmtFn(Math.abs(delta))}</div>`
  );
}

/** Aggregated vitals row: all gauges in one card. */
function renderStatus(dupes, oxygen, report) {
  const avgStress = (dupes ?? []).length > 0
    ? Math.round(dupes.reduce((s, r) => s + Math.max(0, Math.min(100, r.stress ?? 0)), 0) / dupes.length)
    : 0;
  const breathPct = Math.max(0, Math.min(100, oxygen?.avg_breath_pct ?? 100));
  // morale_cost = total skill morale requirement; show as % of the threshold max.
  const avgMoralePct = (dupes ?? []).length > 0
    ? Math.round(dupes.reduce((s, r) => s + (r.morale_cost ?? 0), 0) / dupes.length / (T.morale_bar_max || 20) * 100)
    : 0;

  setHTML("status-card", twoColRow(
    `${percentGauge('Breathability', breathPct)}
     ${percentGauge('Stress', avgStress, avgStress + '%', false)}
     ${percentGauge('Morale req', avgMoralePct)}`,
    `${balanceGauge('O₂ Gen', oxygen?.report?.produced_kg, oxygen?.report?.consumed_kg, fmtMass)}
     ${balanceGauge('Food Gen', report?.food?.produced_kcal, report?.food?.consumed_kcal, fmtKcal)}
     ${balanceGauge('Power Gen', report?.power?.produced_wh, report?.power?.consumed_wh, fmtW)}`
  ));
}

// Parked with STRESS_DELTA/stressDeltaTri and index.html's commented-out
// "Dupes" section — reactivate together for the future per-dupe detail view.
// function renderDupes(rows) {
//   if (!rows || rows.length === 0) {
//     setHTML("dupes-card", `<div class="empty">no duplicants in this save</div>`);
//     return;
//   }
//   const html = rows.map(r => {
//     const stress = Math.max(0, Math.min(100, r.stress ?? 0));
//     const col = stress >= T.stress_bad ? '#ff2222' : stress >= T.stress_warn ? '#facc15' : '#4ade80';
//     return `<tr>
//       <td style="font-size:12px">${escapeHtml(r.name)}</td>
//       <td style="font-size:11px;color:var(--fg-dim)">${escapeHtml(r.current_role ?? '')}</td>
//       <td class="metric" style="color:${col}">${stress.toFixed(0)}%</td>
//     </tr>`;
//   }).join('');
//   setHTML("dupes-card", `<table><tbody>${html}</tbody></table>`);
// }

// Fixed per-category colors (not a RUNWAY_PALETTE[i % ...] rotation) so a
// resource always reads as itself regardless of which categories a given
// save happens to have — used for both the map dots and the tile labels.
// Picked to approximate each resource's real in-game color; Crude Oil is
// lightened from the "true" near-black brown (#3F2E1E) to #A0703D — the
// true value fails contrast against the near-black background (1.5:1)
// since this color is used as foreground text/dots, not a fill. Hot Steam
// reuses Steam's hue shifted hot (red) rather than a new family, since
// it's the same substance at a different, more dangerous temperature.
const GEYSER_CATEGORY_COLORS = {
  "Water":          "#22d3ee",
  "Steam":          "#818cf8",
  "Hot Steam":      "#f87171",
  "Salt Water":     "#67e8f9",
  "Polluted Water": "#84994f",
  "Natural Gas":    "#fb923c",
  "Crude Oil":      "#A0703D",
  "Hydrogen":       "#f472b6",
  "Chlorine":       "#bef264",
  "Metals":         "#eab308",
};
const GEYSER_OTHER_COLOR = "#a8a8c0";
function geyserColor(category) { return GEYSER_CATEGORY_COLORS[category] ?? GEYSER_OTHER_COLOR; }

// One big map of the whole world with every geyser plotted as a colored dot
// at its real position (plus the pod as a white dot), instead of a tiny
// thumbnail repeated inside each card. Individual geyser tiles (name, temp,
// output — no per-tile minimap anymore, the shared map replaces it) sit
// outside the map on whichever side matches the geyser's real x-position,
// each connected to its dot by a thin leader line. This means one tile per
// geyser *instance* now, not one card per category — a category with two
// instances (e.g. two Steam Vents) gets two tiles, because each instance
// has its own point on the map and needs its own line.
const MAP_MAX_PX = 480;
const MAP_DOT_PX = 7;
const TILE_WIDTH = 250;

function renderGeysers(rows, worldWidth, worldHeight, pod) {
  if (!rows || rows.length === 0) {
    setHTML("geysers-card", `<div class="empty">no geysers detected</div>`);
    return;
  }
  if (!worldWidth || !worldHeight || pod?.xPct == null) {
    // No map to plot against (pod deconstructed, or dims missing) — fall
    // back to a plain colored list rather than an empty/broken map.
    const list = rows.map((r) => {
      const baseName = r.type_name ?? geyserName(r.type_id);
      const temp = r.output_temp_c != null ? ` - ${Math.round(r.output_temp_c)}°` : "";
      return `<div style="padding:4px 0;color:${geyserColor(r.category)}">${escapeHtml(baseName)}${escapeHtml(temp)}</div>`;
    }).join("");
    setHTML("geysers-card", list);
    return;
  }

  // Stable per-geyser index ties each tile to its map dot for the
  // leader-line measurement pass below (drawGeyserLeaderLines).
  const indexed = rows.map((r, idx) => ({ ...r, _idx: idx }));

  const left = [];
  const right = [];
  for (const r of indexed) (r.xPct < 50 ? left : right).push(r);
  // Top-to-bottom on-screen order (higher yPct = further "up" in-game — see
  // the `100 - yPct` flip in mapDot below) so each side's tile stack reads
  // top-to-bottom the same way its dots do, keeping leader lines short and
  // uncrossed rather than random.
  const byScreenY = (a, b) => (b.yPct ?? 0) - (a.yPct ?? 0);
  left.sort(byScreenY);
  right.sort(byScreenY);

  const BASE_FS = 13;
  const nameStyle = `font-size:${Math.round(BASE_FS * 1.2)}px;font-weight:700;color:#fff;white-space:nowrap`;

  const tile = (r) => {
    const color = geyserColor(r.category);
    const baseName = r.type_name ?? geyserName(r.type_id);
    const temp = r.output_temp_c != null ? `${Math.round(r.output_temp_c)}°` : null;
    const output = r.outputRate != null ? `${(r.outputRate / 1000).toFixed(1)} kg/s` : null;
    // flex:0 0 auto, not flex:0 0 TILE_WIDTHpx — the parent (left/right
    // tile column) is flex-direction:column, so flex-basis sets the main
    // axis (height), not width. A tile's height must stay content-driven;
    // its width comes from the `width` property (cross axis) instead.
    return `<div id="geyser-tile-${r._idx}" style="display:flex;flex-direction:column;gap:3px;background:#0a0a14;border:1px solid #2a2a44;border-radius:5px;padding:${cfg.pad}px ${cfg.pad + 3}px;width:${TILE_WIDTH}px;flex:0 0 auto;overflow:hidden">
      <div style="font-size:${Math.round(cfg.fs * 0.8)}px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:${color}">${escapeHtml(r.category ?? "Other")}</div>
      <div style="${nameStyle}">${escapeHtml(baseName)}${temp ? ` - <span style="color:${color}">${escapeHtml(temp)}</span>` : ""}</div>
      ${output ? `<div style="font-size:${BASE_FS}px;font-weight:700;color:${color}">${escapeHtml(output)}</div>` : ""}
    </div>`;
  };

  const ratio = worldWidth / worldHeight;
  const mapW = ratio >= 1 ? MAP_MAX_PX : MAP_MAX_PX * ratio;
  const mapH = ratio >= 1 ? MAP_MAX_PX / ratio : MAP_MAX_PX;
  // Y is flipped (ONI's +y is up/toward the surface; CSS `top` grows
  // downward) so "up" on the map reads as "up" in the game.
  const mapDot = (xPct, yPct, color, id) =>
    `<div id="${id}" style="position:absolute;width:${MAP_DOT_PX}px;height:${MAP_DOT_PX}px;background:${color};left:${xPct}%;top:${100 - yPct}%;transform:translate(-50%,-50%);border-radius:50%;border:1px solid rgba(0,0,0,0.5)"></div>`;
  const dots = indexed
    .filter((r) => r.xPct != null && r.yPct != null)
    .map((r) => mapDot(r.xPct, r.yPct, geyserColor(r.category), `geyser-dot-${r._idx}`))
    .join("");
  const podDot = `<div style="position:absolute;width:${MAP_DOT_PX}px;height:${MAP_DOT_PX}px;background:#fff;left:${pod.xPct}%;top:${100 - pod.yPct}%;transform:translate(-50%,-50%);border-radius:50%;box-shadow:0 0 0 2px rgba(255,255,255,0.35)"></div>`;
  // Background matches the page's outer background (var(--bg)), not the
  // card it sits in, so it reads as a recessed cut-out rather than blending
  // into the card. Also makes it theme-aware (light/dark) instead of a
  // hardcoded dark hex.
  const mapHtml = `<div id="geyser-map" style="position:relative;width:${mapW.toFixed(1)}px;height:${mapH.toFixed(1)}px;background:var(--bg);border:1px solid #2a2a44;border-radius:6px;flex-shrink:0">${podDot}${dots}</div>`;

  const leftHtml = `<div style="display:flex;flex-direction:column;gap:${cfg.chipgap}px;flex-shrink:0">${left.map(tile).join("")}</div>`;
  const rightHtml = `<div style="display:flex;flex-direction:column;gap:${cfg.chipgap}px;flex-shrink:0">${right.map(tile).join("")}</div>`;

  // overflow-x:auto so a narrow window scrolls instead of clipping tiles —
  // the composite (tiles + map + tiles) is wider than a typical card.
  setHTML("geysers-card", `<div id="geyser-map-wrap" style="position:relative;display:flex;align-items:flex-start;justify-content:center;gap:28px;overflow-x:auto;padding:2px">
    ${leftHtml}
    ${mapHtml}
    ${rightHtml}
    <svg id="geyser-lines" style="position:absolute;top:0;left:0;pointer-events:none"></svg>
  </div>`);

  drawGeyserLeaderLines(indexed);
}

// Runs right after renderGeysers' setHTML — at that point the map dots and
// side tiles are real DOM elements, so their actual measured positions (not
// nominal ones) drive the thin connector lines. This is what keeps lines
// accurate regardless of how tall a tile's content makes it, without having
// to predict tile heights ourselves.
function drawGeyserLeaderLines(indexed) {
  const wrap = $("geyser-map-wrap");
  const svg = $("geyser-lines");
  if (!wrap || !svg) return;
  const wrapRect = wrap.getBoundingClientRect();

  const lines = indexed.map((r) => {
    if (r.xPct == null || r.yPct == null) return "";
    const dotEl = document.getElementById(`geyser-dot-${r._idx}`);
    const tileEl = document.getElementById(`geyser-tile-${r._idx}`);
    if (!dotEl || !tileEl) return "";
    const dotRect = dotEl.getBoundingClientRect();
    const tileRect = tileEl.getBoundingClientRect();
    const dotX = dotRect.left + dotRect.width / 2 - wrapRect.left;
    const dotY = dotRect.top + dotRect.height / 2 - wrapRect.top;
    // Anchor at the tile's map-facing edge (right edge for left-side tiles,
    // left edge for right-side ones), not its center, so the line starts at
    // the tile's border instead of cutting across its text.
    const onLeft = r.xPct < 50;
    const tileX = (onLeft ? tileRect.right : tileRect.left) - wrapRect.left;
    const tileY = tileRect.top + tileRect.height / 2 - wrapRect.top;
    return `<line x1="${tileX.toFixed(1)}" y1="${tileY.toFixed(1)}" x2="${dotX.toFixed(1)}" y2="${dotY.toFixed(1)}" stroke="${geyserColor(r.category)}" stroke-width="1" opacity="0.45"/>`;
  }).join("");

  // Explicit pixel size (not width:100%/height:100%) so the SVG covers the
  // full scrollable content area, not just the visible viewport, when the
  // wrap is narrower than its content and scrolling horizontally.
  svg.setAttribute("width", wrap.scrollWidth);
  svg.setAttribute("height", wrap.scrollHeight);
  svg.innerHTML = lines;
}

// ── Renderers ─────────────────────────────────────────────────────────────────

function renderPower(report, resources, generatorFuels, generatorSpecs) {
  if (!report?.power) { setHTML("power-card", `<div class="empty">no data</div>`); return; }
  const { consumed_wh } = report.power;

  // Look up total mass per element_id from the resources payload (storage + loose).
  const massByElement = {};
  for (const r of resources) {
    if (r.element_id != null) massByElement[String(Math.trunc(Number(r.element_id)))] = r.total_units ?? 0;
  }

  // Compute runway per fuel type.
  // generatorFuels rows come from the DB: { generator_prefab, element_id, fuel_prefab, stored_kg }
  // generatorSpecs provides j_per_kg per prefab.
  // Multiple generator types may burn the same element_id — sum them across prefabs.
  const consumption = consumed_wh || 0;
  const energyByElement = {}; // element_id key → accumulated joules
  const labelByElement  = {}; // element_id key → display name
  for (const gf of (generatorFuels ?? [])) {
    const spec = (generatorSpecs ?? {})[gf.generator_prefab];
    if (!spec) continue; // unknown generator — server already warned
    const key  = String(Math.trunc(Number(gf.element_id)));
    const mass = massByElement[key] ?? 0;
    if (mass <= 0) continue;
    energyByElement[key] = (energyByElement[key] ?? 0) + mass * spec.j_per_kg;
    labelByElement[key]  = labelByElement[key] ?? (gf.fuel_prefab ?? key);
  }

  const fuelRows = Object.entries(energyByElement).map(([key, energy]) => {
    const cycles = consumption > 0 ? energy / consumption : Infinity;
    const mass   = massByElement[key] ?? 0;
    // Prefer element name from lookup table; fall back to fuel_prefab from DB.
    const name   = ELEMENT_NAMES[key] ?? labelByElement[key] ?? key;
    return { name, cycles, mass };
  });

  // Sort by runway descending (largest fuel buffer first).
  fuelRows.sort((a, b) => b.cycles - a.cycles);

  const totalCycles = fuelRows.reduce((s, r) => s + r.cycles, 0);
  const over10   = !isFinite(totalCycles) || totalCycles > 10;
  const whole    = Math.min(10, isFinite(totalCycles) ? Math.floor(totalCycles) : 10);
  const frac     = over10 ? 0 : totalCycles - whole;
  const BG_EMPTY = '#1c1c30';
  const runColor = runwayColor(totalCycles);

  // ── Runway bar ───────────────────────────────────────────────────────────
  const segs = [];
  for (let i = 0; i < 10; i++) {
    if (i < whole) {
      segs.push(`<div class="day-seg" style="background:${runColor}"></div>`);
    } else if (i === whole && frac > 0) {
      const pct = (frac * 100).toFixed(1);
      segs.push(`<div class="day-seg" style="background:linear-gradient(to right,${runColor} ${pct}%,${BG_EMPTY} ${pct}%)"></div>`);
    } else {
      segs.push(`<div class="day-seg" style="background:${BG_EMPTY}"></div>`);
    }
  }
  segs.push(`<div class="day-seg-over" style="color:${over10 ? runColor : 'transparent'}">∞</div>`);
  const daysLabel = !isFinite(totalCycles) ? "∞ days" : `${totalCycles.toFixed(1)} days`;
  const runwayBlock = `<div style="display:flex;flex-direction:column;gap:4px;background:#0a0a14;border:1px solid #2a2a44;border-radius:5px;padding:${cfg.pad}px ${cfg.pad + 3}px;flex-shrink:0">
    <div style="font-size:${cfg.fs}px;color:${cfg.color};white-space:nowrap">Fuel Left</div>
    <div style="display:flex;gap:${cfg.seggap}px;align-items:center">${segs.join('')}</div>
    <div style="font-size:13px;font-weight:700;color:${runColor};white-space:nowrap">${escapeHtml(daysLabel)}</div>
  </div>`;

  // ── Per-fuel chips ────────────────────────────────────────────────────────
  const chips = fuelRows.map((r, i) => {
    const color = cfg.chipPalette ? RUNWAY_PALETTE[i % RUNWAY_PALETTE.length] : runwayColor(r.cycles);
    const cval  = !isFinite(r.cycles)
      ? `<div style="font-size:13px;font-weight:700;color:${color}">∞ d</div>`
      : `<div style="font-size:13px;font-weight:700;color:${color};white-space:nowrap">${r.cycles.toFixed(1)} d</div>`;
    return `<div style="display:flex;flex-direction:column;gap:4px;background:#0a0a14;border:1px solid #2a2a44;border-radius:5px;padding:${cfg.pad}px ${cfg.pad + 3}px;flex-shrink:0">
  <div style="font-size:${cfg.fs}px;color:${color};white-space:nowrap">${escapeHtml(r.name)}</div>
  ${runwaySegs(r.cycles, cfg.chipPalette ? color : undefined)}
  ${cval}
</div>`;
  }).join('');

  setHTML("power-card", twoColRow(runwayBlock, chips));
}

// ── Runway gauge ─────────────────────────────────────────────────────────────

const RUNWAY_PALETTE = ['#fb923c','#4ade80','#22d3ee','#a78bfa','#f472b6','#facc15','#34d399','#818cf8','#f87171','#67e8f9'];
const RUNWAY_SEGS    = 5;

/** Threshold color for runway gauges. ≤2d=red, 3–6d=orange, ≥7d=green. */
function runwayColor(days) {
  if (!isFinite(days) || days >= 7) return '#4ade80';
  if (days >= 3) return '#fb923c';
  return '#ff2222';
}

/** overrideColor overrides threshold when supplied (used by per-item palette chips). */
function runwaySegs(days, overrideColor) {
  const color   = overrideColor ?? runwayColor(days);
  const emptyBg = '#1c1c30';
  const capped  = Math.min(days, RUNWAY_SEGS);
  const whole   = Math.floor(capped);
  const frac    = capped - whole;
  const sz      = `width:${cfg.seg}px;height:${cfg.seg}px;border-radius:2px;flex-shrink:0`;
  const parts   = [];
  for (let i = 0; i < RUNWAY_SEGS; i++) {
    if (i < whole) {
      parts.push(`<div style="${sz};background:${color}"></div>`);
    } else if (i === whole && frac > 0.04) {
      const pct = (frac * 100).toFixed(1);
      parts.push(`<div style="${sz};background:linear-gradient(to right,${color} ${pct}%,${emptyBg} ${pct}%)"></div>`);
    } else {
      parts.push(`<div style="${sz};background:${emptyBg}"></div>`);
    }
  }
  parts.push(`<div style="height:${cfg.seg}px;font-size:${cfg.seg}px;font-weight:700;color:${days > RUNWAY_SEGS ? color : 'transparent'};line-height:1;padding:0 3px;display:flex;align-items:center;flex-shrink:0">∞</div>`);
  return `<div style="display:flex;gap:${cfg.seggap}px;align-items:center">${parts.join('')}</div>`;
}

function renderFood(rows, dupeCount) {
  const known = (rows ?? [])
    .filter(r => r.kcal != null)
    .sort((a, b) => b.morale - a.morale || (b.kcal * b.qty) - (a.kcal * a.qty));

  if (known.length === 0) {
    setHTML("food-card", `<div class="empty">no food</div>`);
    return;
  }

  const n = Math.max(1, dupeCount);
  const totalKcal = known.reduce((s, r) => s + r.kcal * r.qty, 0);
  const totalDays = totalKcal / T.kcal_per_dupe_per_cycle / n;
  const over10    = totalDays > 10;
  const wholeDays = Math.min(10, Math.floor(totalDays));
  const frac      = over10 ? 0 : totalDays - wholeDays;
  const BG_EMPTY  = '#1c1c30';
  const runColor  = runwayColor(totalDays);

  // ── Runway days bar ───────────────────────────────────────────────────────
  const segs = [];
  for (let i = 0; i < 10; i++) {
    if (i < wholeDays) {
      segs.push(`<div class="day-seg" style="background:${runColor}"></div>`);
    } else if (i === wholeDays && frac > 0) {
      const pct = (frac * 100).toFixed(1);
      segs.push(`<div class="day-seg" style="background:linear-gradient(to right,${runColor} ${pct}%,${BG_EMPTY} ${pct}%)"></div>`);
    } else {
      segs.push(`<div class="day-seg" style="background:${BG_EMPTY}"></div>`);
    }
  }
  segs.push(`<div class="day-seg-over" style="color:${over10 ? runColor : 'transparent'}">∞</div>`);
  const daysLabel = `${totalDays.toFixed(1)} days`;
  const runwayBlock = `<div style="display:flex;flex-direction:column;gap:4px;background:#0a0a14;border:1px solid #2a2a44;border-radius:5px;padding:${cfg.pad}px ${cfg.pad + 3}px;flex-shrink:0">
    <div style="font-size:${cfg.fs}px;color:${cfg.color};white-space:nowrap">Food Left</div>
    <div style="display:flex;gap:${cfg.seggap}px;align-items:center">${segs.join('')}</div>
    <div style="font-size:13px;font-weight:700;color:${runColor};white-space:nowrap">${escapeHtml(daysLabel)}</div>
  </div>`;

  // ── Per-food runway chips ─────────────────────────────────────────────────
  const chips = known.map((r, i) => {
    const days  = (r.qty * r.kcal) / T.kcal_per_dupe_per_cycle / n;
    const color = cfg.chipPalette ? RUNWAY_PALETTE[i % RUNWAY_PALETTE.length] : runwayColor(days);
    const dval  = `<div style="font-size:13px;font-weight:700;color:${color};white-space:nowrap">${days.toFixed(1)} d</div>`;
    return `<div style="display:flex;flex-direction:column;gap:4px;background:#0a0a14;border:1px solid #2a2a44;border-radius:5px;padding:${cfg.pad}px ${cfg.pad + 3}px;flex-shrink:0">
  <div style="font-size:${cfg.fs}px;color:${color};white-space:nowrap">${escapeHtml(r.name ?? r.prefab_id)}</div>
  ${runwaySegs(days, cfg.chipPalette ? color : undefined)}
  ${dval}
</div>`;
  }).join('');

  setHTML("food-card", twoColRow(runwayBlock, chips));
}

// ── Liveness ─────────────────────────────────────────────────────────────────

function setLiveness(state, label) {
  $("liveness-dot").className = "dot " + state;
  setText("liveness", label);
}

function showError(msg) {
  const el = $("err-banner");
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  setLiveness("cold", "no data");
}

function clearError() {
  const el = $("err-banner");
  if (el) el.hidden = true;
}

// ── Fetch & render ───────────────────────────────────────────────────────────

async function refresh() {
  try {
    const res = await fetch("/api/status", { cache: "no-store" });
    if (res.status === 503) {
      const body = await res.json();
      showError(body.message || body.error || "oni-vision hasn't produced data yet");
      return;
    }
    if (!res.ok) { showError(`HTTP ${res.status}`); return; }
    const data = await res.json();
    clearError();

    // Detect server restart: if server_ts changed, reload to pick up new JS/CSS.
    if (data.server_ts != null) {
      const ts = String(data.server_ts);
      const stored = sessionStorage.getItem("oni-server-ts");
      sessionStorage.setItem("oni-server-ts", ts);
      if (stored !== null && stored !== ts) { window.location.reload(); return; }
    }

    setText("base-name", data.base_name || "(unnamed colony)");
    setText("cycle", data.cycle != null ? `cycle ${data.cycle}` : "(unknown cycle)");
    setText("source-file", fileBaseName(data.source_file));

    const age = data.age_seconds;
    if (age == null) {
      setLiveness("cold", "no parse yet");
    } else if (age >= T.stale_after_s) {
      setLiveness("stale", `parsed ${fmtAge(age)} (stale)`);
    } else {
      setLiveness("live", `parsed ${fmtAge(age)}`);
    }

    // Populate lookup tables and thresholds from the DB-backed API response.
    if (data.elements)     ELEMENT_NAMES = data.elements;
    if (data.geyser_types) GEYSER_NAMES  = data.geyser_types;
    if (data.thresholds)   T             = { ...T, ...data.thresholds };
    if (data.generator_specs)  GENERATOR_SPECS = data.generator_specs;
    if (data.generator_fuels)  GENERATOR_FUELS = data.generator_fuels;
    // Parked with STRESS_DELTA/stressDeltaTri/renderDupes — see declaration comment above.
    // if (data.report) STRESS_DELTA = data.report.stress_delta ?? {};

    _lastData = data;
    renderAll(data);
  } catch (err) {
    showError(`fetch failed: ${err.message}`);
  }
}

function renderAll(data) {
  renderCounts(data.counts || {});
  renderStatus(data.top_dupes || [], data.oxygen || null, data.report || null);
  renderFood(data.food || [], data.counts?.duplicants ?? 0);
  renderPower(data.report || null, data.all_resources || [], GENERATOR_FUELS, GENERATOR_SPECS);
  renderGeysers(data.geysers || [], data.world_width, data.world_height, data.pod);
}

// ── Settings panel ────────────────────────────────────────────────────────────

function toggleSettings() {
  const el = $("settings-panel");
  if (!el) return;
  const open = el.hidden;
  el.hidden = !open;
  if (!el.hidden) renderSettingsPanel();
}

const SWATCHES = [
  { hex: "#fb923c", label: "orange" },
  { hex: "#ffffff", label: "white" },
  { hex: "#e2e2ee", label: "near-white" },
  { hex: "#67e8f9", label: "cyan" },
  { hex: "#a78bfa", label: "lavender" },
  { hex: "#7a7aa0", label: "muted" },
];

function renderSettingsPanel() {
  const swatchHtml = SWATCHES.map(s =>
    `<div onclick="onColorSwatch('${s.hex}')" title="${s.label}"
      style="width:22px;height:22px;border-radius:3px;cursor:pointer;flex-shrink:0;
             background:${s.hex};border:2px solid ${s.hex === cfg.color ? '#fff' : 'transparent'}"></div>`
  ).join('');

  function slider(id, label, min, max, step, key, unit = "px") {
    return `<div class="settings-ctrl">
      <label class="settings-label">${label} <span id="sp-${id}-val">${cfg[key]}${unit}</span></label>
      <input type="range" min="${min}" max="${max}" step="${step}" value="${cfg[key]}"
        oninput="onSetting('${key}',+this.value,'sp-${id}-val','${unit}')">
    </div>`;
  }

  setHTML("settings-panel", `
    <div class="settings-grid">
      ${slider("fs",      "Title size",       8, 24, 1, "fs")}
      ${slider("seg",     "Segment size",    10, 40, 1, "seg")}
      ${slider("pad",     "Chip padding",     2, 16, 1, "pad")}
      ${slider("seggap",  "Seg gap",          1, 10, 1, "seggap")}
      ${slider("chipgap", "Chip gap",         2, 24, 1, "chipgap")}
      ${slider("sfs",     "Section label",    8, 24, 1, "sfs")}
      ${slider("sdist",   "Label distance",   2, 32, 1, "sdist")}
      ${slider("cgap",    "Column gap",       4, 60, 1, "cgap")}
      ${slider("slc",     "Section color",    0,100, 1, "slc", "%")}
      ${slider("cpad",    "Card padding",     0, 24, 1, "cpad")}
      ${slider("runSat",  "Runway saturation",0,100, 1, "runSat", "%")}
      ${slider("col1",    "Column 1 offset", 10, 90, 1, "col1",   "%")}
      <div class="settings-ctrl">
        <label class="settings-label">Chip colors
          <input type="checkbox" ${cfg.chipPalette ? 'checked' : ''} onchange="onToggle('chipPalette',this.checked)"
            style="margin-left:6px;accent-color:var(--good);cursor:pointer">
          <span style="color:var(--fg);font-weight:600;font-family:var(--mono)">${cfg.chipPalette ? 'palette' : 'threshold'}</span>
        </label>
      </div>
      <div class="settings-ctrl">
        <label class="settings-label">Title color</label>
        <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:4px;align-items:center">
          ${swatchHtml}
          <input type="color" value="${cfg.color}" oninput="onColorPick(this.value)"
            style="width:22px;height:22px;padding:1px;border:1px solid var(--border);border-radius:3px;background:none;cursor:pointer">
        </div>
      </div>
    </div>`);
}

function onSetting(key, val, lblId, unit) {
  cfg[key] = val;
  const lbl = $(lblId);
  if (lbl) lbl.textContent = val + unit;
  saveSettings();
  if (_lastData) renderAll(_lastData);
}

function onToggle(key, val) {
  cfg[key] = val ? 1 : 0;
  saveSettings();
  if (_lastData) renderAll(_lastData);
  renderSettingsPanel();
}

function onColorSwatch(hex) {
  cfg.color = hex;
  saveSettings();
  if (_lastData) renderAll(_lastData);
  renderSettingsPanel();
}

function onColorPick(hex) {
  cfg.color = hex;
  saveSettings();
  if (_lastData) renderAll(_lastData);
}

// Public entry points invoked from inline onclick/oninput/onchange attributes
// in generated HTML (settings button in index.html, sliders/swatches in
// renderSettingsPanel) — real call sites eslint can't see since they're
// embedded in template-literal strings, not ordinary JS references.
window.toggleSettings = toggleSettings;
window.onSetting = onSetting;
window.onToggle = onToggle;
window.onColorSwatch = onColorSwatch;
window.onColorPick = onColorPick;

// ── SSE — instant push when a new save lands ─────────────────────────────────

function connectSSE() {
  const es = new EventSource("/api/events");
  es.addEventListener("parse", () => refresh());
  es.addEventListener("reload", (e) => {
    const ts = String((JSON.parse(e.data || "{}")).ts ?? "");
    const stored = sessionStorage.getItem("oni-server-ts");
    sessionStorage.setItem("oni-server-ts", ts);
    if (stored !== null && stored !== ts) {
      window.location.reload();
    } else {
      refresh();
    }
  });
  es.onerror = () => { /* EventSource auto-reconnects */ };
}

// ── Boot ─────────────────────────────────────────────────────────────────────

saveSettings();  // apply CSS vars from persisted cfg on load
refresh();
connectSSE();
// Polling as a safety net: covers cases where the SSE connection drops and
// the browser is slow to reconnect, or a save lands during the reconnect window.
setInterval(refresh, POLL_MS);
