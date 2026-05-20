// ONI-vision dashboard — browser-side logic.
// Fetches /api/status on load, on SSE push, and on a polling fallback.
// All thresholds (stale_after_s, stress_bad, …) are read from the API
// response so they stay in sync with src/thresholds.js server-side.
//
// Expected /api/status shape:
//   base_name, cycle, age_seconds, source_file, counts, top_dupes,
//   geysers (per-instance), food, all_resources, stockpile_filters,
//   elements, geyser_types, foods, effects, skills, chore_groups
//   (all six lookup tables), thresholds

// ── Name lookup tables ───────────────────────────────────────────────────────
// Populated from the API (/api/status) on each refresh. The server queries
// current.sqlite which is the single source of truth, written from the JS
// source files (src/elements.js, src/food.js, etc.) during each parse.
// Starting empty is fine — they're filled before the first render call.

let ELEMENT_NAMES = {};  // element_id (string) → name
let GEYSER_NAMES  = {};  // type_id (string)    → name
let BAD_EFFECTS   = {};  // effect string        → { label, cls }
let STRESS_DELTA  = {};  // dupe name → net stress %-pts last cycle (from ReportManager type 2)
let DISTANCE      = {};  // dupe name → tiles walked last cycle (from ReportManager type 10)
let POWER_FUELS   = [];  // populated from API — { element_id, name, j_per_kg, generator_prefab }

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
}

let _lastData = null;  // cached API response for instant settings re-render

/** Resolve a numeric element_id to a display name. */
function elementName(id) {
  if (id == null) return "?";
  const key = String(Math.trunc(Number(id)));
  return ELEMENT_NAMES[key] ?? String(id);
}

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
  geyser_quality_good:     70,
  geyser_quality_warn:     40,
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

function fmtWh(wh) {
  const w = Number(wh);
  if (!Number.isFinite(w)) return "?";
  if (w >= 1_000_000) return `${(w/1_000_000).toFixed(1)} MW`;
  if (w >= 1_000)     return `${(w/1_000).toFixed(1)} kW`;
  return `${Math.round(w)} W`;
}

function bar(pct) {
  const v = Math.max(0, Math.min(100, Number(pct) || 0));
  const cls = v >= T.stress_bad ? "high" : v >= T.stress_warn ? "med" : "";
  return `<div class="bar-track"><div class="bar-fill ${cls}" style="width: ${v}%"></div></div>`;
}

function fileBaseName(path) {
  if (!path) return "";
  return String(path).split(/[\\/]/).pop();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"'\/]/g, (c) => ({
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

/** Grey triangle indicating stress trend. Brightness: 0%→50%grey, +50→white, -50→black. */
function stressDeltaTri(name) {
  const delta = STRESS_DELTA[name];
  if (delta == null) return '';
  const b = Math.max(0, Math.min(1, 0.5 + delta / 100));
  const v = Math.round(b * 255);
  const dir = delta >= 0 ? '▲' : '▼';
  return `<span class="stress-delta-tri" style="color:rgb(${v},${v},${v})">${dir}</span>`;
}

/* ── Donut gauges — kept for potential future use ────────────────────────────
function donutWidget(label, svgHtml) {
  return `<div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex-shrink:0">
    <span class="gauge-sublabel">${label}</span>
    ${svgHtml}
  </div>`;
}

function simpleDonut(pct, col, S = 50) {
  const cx = S / 2, cy = S / 2, r = S * 0.36, sw = S * 0.155;
  const span = Math.min(319.9, pct / 100 * 320);
  function ptd(deg) {
    const a = deg * Math.PI / 180;
    return [+(cx + r * Math.sin(a)).toFixed(2), +(cy - r * Math.cos(a)).toFixed(2)];
  }
  const [x1, y1] = ptd(0);
  const [x2, y2] = ptd(span);
  const large = span > 180 ? 1 : 0;
  const arc = span > 0.3
    ? `<path d="M${x1},${y1} A${r},${r} 0 ${large},1 ${x2},${y2}" fill="none" stroke="${col}" stroke-width="${sw}" stroke-linecap="round"/>`
    : '';
  const dot = `<circle cx="${x1}" cy="${y1}" r="${sw / 2}" fill="${col}"/>`;
  return `<svg width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" style="flex-shrink:0;display:block">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#1c1c30" stroke-width="${sw}"/>
    ${arc}${dot}
  </svg>`;
}
── end donut gauges ─────────────────────────────────────────────────────── */

// ── Segmented Pips Gauge ──────────────────────────────────────────────────────

function _pipRow(pct, col) {
  const color = col ?? (pct >= -1 ? '#4ade80' : pct >= -15 ? '#fb923c' : '#ff2222');
  const mag = Math.abs(pct) / 100;
  const lit = Math.max(1, Math.round(mag * 8));
  const pips = [];
  for (let i = 0; i < 8; i++) {
    if (i < lit) {
      const op = lit === 1 ? 0.9 : lit === 2 ? (i === 0 ? 0.55 : 0.9) : i === 0 ? 0.35 : i === 1 ? 0.6 : 1.0;
      pips.push(`<div style="width:8px;height:${cfg.seg}px;border-radius:4px;background:${color};opacity:${op};flex-shrink:0"></div>`);
    } else {
      pips.push(`<div style="width:8px;height:${cfg.seg}px;border-radius:4px;background:#1c1c30;flex-shrink:0"></div>`);
    }
  }
  return `<div style="display:flex;gap:${cfg.seggap}px">${pips.join('')}</div>`;
}

function _pipChipShell(label, pipsHtml, valueHtml) {
  return `<div style="display:flex;flex-direction:column;gap:4px;background:#0a0a14;border:1px solid #2a2a44;border-radius:5px;padding:${cfg.pad}px ${cfg.pad + 3}px;flex-shrink:0">
  <div style="font-size:${cfg.fs}px;color:${cfg.color};white-space:nowrap">${label}</div>
  ${pipsHtml}
  ${valueHtml}
</div>`;
}

/** Balance chip: green surplus, red deficit, actual delta value + unit. */
function segmentedPipsGauge(label, produced, consumed, fmtFn) {
  const valid = produced != null && consumed != null;
  let pct = 0;
  if (valid) {
    const scale = Math.max(produced, consumed, 1);
    pct = Math.max(-100, Math.min(100, ((produced - consumed) / scale) * 100));
  }
  const delta = valid ? produced - consumed : 0;
  const col   = pct >= -1 ? '#4ade80' : pct >= -15 ? '#fb923c' : '#ff2222';
  const sign  = delta < -0.001 ? '−' : '';
  const val   = `<div style="font-size:13px;font-weight:700;color:${col};white-space:nowrap">${sign}${fmtFn(Math.abs(delta))}</div>`;
  return _pipChipShell(label, _pipRow(pct), val);
}

/** Simple chip: 0–100 percentage with explicit color (stress, breathability). */
function simplePipsGauge(label, pct, col, valLabel) {
  const val = `<div style="font-size:13px;font-weight:700;color:${col};white-space:nowrap">${valLabel}</div>`;
  return _pipChipShell(label, _pipRow(Math.max(0, Math.min(100, pct)), col), val);
}

/** Breathability chip: green pips = breathable portion, red pips = bad portion. */
function breathabilityGauge(label, goodPct) {
  const pct = Math.max(0, Math.min(100, goodPct));
  // Below 95% always show at least 1 red pip so the issue is visible.
  const litGreen = pct >= 95 ? 8 : Math.min(7, Math.round(pct / 100 * 8));
  const pips = [];
  for (let i = 0; i < 8; i++) {
    const color = i < litGreen ? '#4ade80' : '#ff2222';
    pips.push(`<div style="width:8px;height:${cfg.seg}px;border-radius:4px;background:${color};flex-shrink:0"></div>`);
  }
  const pipsHtml = `<div style="display:flex;gap:${cfg.seggap}px">${pips.join('')}</div>`;
  const col = pct >= 95 ? '#4ade80' : pct >= 70 ? '#fb923c' : '#ff2222';
  const val = `<div style="font-size:13px;font-weight:700;color:${col};white-space:nowrap">${pct.toFixed(1)}%</div>`;
  return _pipChipShell(label, pipsHtml, val);
}

/** Aggregated vitals row: all 5 pip gauges in one card. */
function renderStatus(dupes, oxygen, report) {
  const avgStress = (dupes ?? []).length > 0
    ? Math.round(dupes.reduce((s, r) => s + Math.max(0, Math.min(100, r.stress ?? 0)), 0) / dupes.length)
    : 0;
  const stressCol = avgStress >= T.stress_bad ? '#ff2222' : avgStress >= T.stress_warn ? '#facc15' : '#4ade80';
  const breathPct = Math.max(0, Math.min(100, oxygen?.avg_breath_pct ?? 100));

  // Morale placeholder — real calculation (avg duplicant morale balance) wired up later.
  const moraleGauge = segmentedPipsGauge('Morale', 90, 100, v => `${Math.round(v)}%`);

  setHTML("status-card", `
<div style="display:flex;gap:${cfg.chipgap}px;flex-wrap:nowrap;overflow:hidden;
    -webkit-mask-image:linear-gradient(to right,black 70%,transparent 95%);
    mask-image:linear-gradient(to right,black 70%,transparent 95%)">
  ${breathabilityGauge('Breathability', breathPct)}
  ${segmentedPipsGauge('O₂ Gen', oxygen?.report?.produced_kg, oxygen?.report?.consumed_kg, fmtMass)}
  ${moraleGauge}
  ${simplePipsGauge('Stress', avgStress, stressCol, avgStress + '%')}
  ${segmentedPipsGauge('Food Gen', report?.food?.produced_kcal, report?.food?.consumed_kcal, fmtKcal)}
  ${segmentedPipsGauge('Power Gen', report?.power?.produced_wh, report?.power?.consumed_wh, fmtWh)}
</div>`);
}

function renderDupes(rows) {
  if (!rows || rows.length === 0) {
    setHTML("dupes-card", `<div class="empty">no duplicants in this save</div>`);
    return;
  }
  const html = rows.map(r => {
    const stress = Math.max(0, Math.min(100, r.stress ?? 0));
    const col = stress >= T.stress_bad ? '#ff2222' : stress >= T.stress_warn ? '#facc15' : '#4ade80';
    return `<tr>
      <td style="font-size:12px">${escapeHtml(r.name)}</td>
      <td style="font-size:11px;color:var(--fg-dim)">${escapeHtml(r.current_role ?? '')}</td>
      <td class="metric" style="color:${col}">${stress.toFixed(0)}%</td>
    </tr>`;
  }).join('');
  setHTML("dupes-card", `<table><tbody>${html}</tbody></table>`);
}

function renderGeysers(rows) {
  if (!rows || rows.length === 0) {
    setHTML("geysers-card", `<div class="empty">no geysers detected</div>`);
    return;
  }
  const html = rows.map(r => {
    const quality = Math.round(((Number(r.rate_roll) + Number(r.year_percent_roll)) / 2) * 100);
    const cls = quality >= T.geyser_quality_good ? "" : quality >= T.geyser_quality_warn ? "med" : "high";
    return `<tr>
      <td style="font-size:12px">${escapeHtml(geyserName(r.type_id))}</td>
      <td class="bar" style="width:50%">
        <div class="bar-track">
          <div class="bar-fill ${cls}" style="width:${quality}%"></div>
        </div>
      </td>
      <td class="metric">${quality}%</td>
    </tr>`;
  }).join("");
  setHTML("geysers-card", `<table><tbody>${html}</tbody></table>`);
}

// ── Stockpile state ───────────────────────────────────────────────────────────

let allElements     = [];  // all_resources from API (element-based)
let pinnedResources = [];  // WorldInventory.pinnedResources with quantities

/** Format an ONI internal PascalCase/underscore prefab name for display. */
function formatPrefabName(name) {
  return name.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
}

function togglePicker() {
  const el = $("stockpile-picker");
  if (!el) return;
  el.style.display = el.style.display === "none" ? "block" : "none";
  if (el.style.display === "block") renderPicker();
}

function renderPicker() {
  const el = $("stockpile-picker");
  if (!el) return;

  // Show the pinned list with checkboxes so the user can hide individual rows.
  const LS_KEY = "oni-stockpile-hidden-v1";
  let hidden;
  try { hidden = new Set(JSON.parse(localStorage.getItem(LS_KEY) || "[]")); }
  catch { hidden = new Set(); }

  if (pinnedResources.length === 0 && allElements.length === 0) {
    el.innerHTML = '<div class="empty">no data yet</div>';
    return;
  }

  const rows = pinnedResources.length > 0 ? pinnedResources : allElements.slice(0, 20).map(r => ({
    name: String(ELEMENT_NAMES[String(Math.trunc(Number(r.element_id)))] ?? r.element_id),
    hash: r.element_id,
    total_units: r.total_units,
    is_element: true,
  }));

  el.innerHTML = rows.map(r => {
    const key = String(r.hash);
    const checked = !hidden.has(key) ? "checked" : "";
    const displayName = r.is_element ? escapeHtml(elementName(r.hash)) : escapeHtml(formatPrefabName(r.name));
    const qty = escapeHtml(r.is_element ? fmtMass(r.total_units) : `${Math.round(r.total_units)}`);
    return `<label style="display:flex;align-items:center;gap:6px;padding:3px 0;cursor:pointer">
      <input type="checkbox" data-key="${escapeHtml(key)}" ${checked} onchange="onPickerChange()">
      <span style="flex:1">${displayName}</span>
      <span style="color:var(--fg-muted)">${qty}</span>
    </label>`;
  }).join("");
}

function onPickerChange() {
  const LS_KEY = "oni-stockpile-hidden-v1";
  const checkboxes = ($("stockpile-picker") ?? {}).querySelectorAll?.("input[type=checkbox]") ?? [];
  const hidden = new Set([...checkboxes].filter(cb => !cb.checked).map(cb => cb.dataset.key));
  try { localStorage.setItem(LS_KEY, JSON.stringify([...hidden])); } catch { /**/ }
  renderResources(allElements);
}

// ── Renderers ─────────────────────────────────────────────────────────────────

/* ── percentageDonut — kept for potential future use ─────────────────────────
function percentageDonut(produced, consumed, S = 50) {
  const cx = S / 2, cy = S / 2, r = S * 0.36, sw = S * 0.155;
  let pct = 0;
  const valid = produced != null && consumed != null;
  if (valid) {
    const scale = Math.max(produced, consumed, 1);
    pct = Math.max(-100, Math.min(100, ((produced - consumed) / scale) * 100));
  }
  const isPos  = pct >= 0;
  const color  = isPos ? '#38bdf8' : '#ff2222';
  const span   = Math.abs(pct) / 100 * 320;
  function ptd(deg) {
    const a = deg * Math.PI / 180;
    return [+(cx + r * Math.sin(a)).toFixed(2), +(cy - r * Math.cos(a)).toFixed(2)];
  }
  function arcSeg(spanDeg, cw, col) {
    if (spanDeg < 0.3) return '';
    const [x1, y1] = ptd(0);
    const [x2, y2] = ptd(cw ? spanDeg : -spanDeg);
    const large = spanDeg > 180 ? 1 : 0;
    return `<path d="M${x1},${y1} A${r},${r} 0 ${large},${cw ? 1 : 0} ${x2},${y2}" fill="none" stroke="${col}" stroke-width="${sw}" stroke-linecap="round"/>`;
  }
  const [dotX, dotY] = ptd(0);
  const dot = isPos ? `<circle cx="${dotX}" cy="${dotY}" r="${sw / 2}" fill="#38bdf8"/>` : '';
  return `<svg width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" style="flex-shrink:0;display:block">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#1c1c30" stroke-width="${sw}"/>
    ${arcSeg(span, isPos, color)}
    ${dot}
  </svg>`;
}
── end percentageDonut ──────────────────────────────────────────────────── */


function renderPower(report, resources, generators) {
  if (!report?.power) { setHTML("power-card", `<div class="empty">no data</div>`); return; }
  const { produced_wh, consumed_wh } = report.power;

  // Build a set of built generator prefabs so we only show fuels the colony
  // can actually burn.
  const builtGens = new Set((generators ?? []).map(g => g.prefab_id));

  // Look up total mass per element_id from the resources payload.
  const massByElement = {};
  for (const r of resources) {
    if (r.element_id != null) massByElement[String(Math.trunc(Number(r.element_id)))] = r.total_units ?? 0;
  }

  // Compute runway per fuel type (cycles = days in ONI).
  const consumption = consumed_wh || 0;
  const fuelRows = [];
  for (const f of POWER_FUELS) {
    if (!builtGens.has(f.generator_prefab)) continue;
    const key = String(f.element_id);
    const mass = massByElement[key] ?? 0;
    if (mass <= 0) continue;
    const energy = mass * f.j_per_kg; // joules available
    const cycles = consumption > 0 ? energy / consumption : Infinity;
    fuelRows.push({ name: f.name, cycles, mass });
  }

  // Sort by runway descending (largest fuel buffer first).
  fuelRows.sort((a, b) => b.cycles - a.cycles);

  const totalCycles = fuelRows.reduce((s, r) => s + r.cycles, 0);
  const over10 = totalCycles > 10;
  const whole = Math.min(10, Math.floor(totalCycles));
  const frac  = over10 ? 0 : totalCycles - whole;
  const BG_EMPTY = 'var(--bg-elev)';

  // ── Runway bar (mirrors food) ─────────────────────────────────────────────
  const segs = [];
  for (let i = 0; i < 10; i++) {
    if (i < whole) {
      segs.push(`<div class="day-seg" style="background:var(--good)"></div>`);
    } else if (i === whole && frac > 0) {
      const pct = (frac * 100).toFixed(1);
      segs.push(`<div class="day-seg" style="background:linear-gradient(to right,var(--good) ${pct}%,${BG_EMPTY} ${pct}%)"></div>`);
    } else {
      segs.push(`<div class="day-seg" style="background:${BG_EMPTY}"></div>`);
    }
  }
  if (over10) segs.push(`<div class="day-seg-over">∞</div>`);
  const daysLabel = totalCycles === Infinity ? "∞ days" : `${totalCycles.toFixed(1)} days`;
  const runwayBlock = `<div style="display:flex;flex-direction:column;gap:4px;background:#0a0a14;border:1px solid #2a2a44;border-radius:5px;padding:${cfg.pad}px ${cfg.pad + 3}px;flex-shrink:0">
    <div style="font-size:${cfg.fs}px;color:${cfg.color};white-space:nowrap">Fuel Left</div>
    <div style="display:flex;gap:${cfg.seggap}px;align-items:center">${segs.join('')}</div>
    <div style="font-size:13px;font-weight:700;color:var(--good);white-space:nowrap">${escapeHtml(daysLabel)}</div>
  </div>`;

  // ── Per-fuel chips ────────────────────────────────────────────────────────
  const chips = fuelRows.map((r, i) => {
    const color = RUNWAY_PALETTE[i % RUNWAY_PALETTE.length];
    const cval  = r.cycles === Infinity
      ? `<div style="font-size:13px;font-weight:700;color:${color}">∞ d</div>`
      : `<div style="font-size:13px;font-weight:700;color:${color};white-space:nowrap">${r.cycles.toFixed(1)} d</div>`;
    return `<div style="display:flex;flex-direction:column;gap:4px;background:#0a0a14;border:1px solid #2a2a44;border-radius:5px;padding:${cfg.pad}px ${cfg.pad + 3}px;flex-shrink:0">
  <div style="font-size:${cfg.fs}px;color:${color};white-space:nowrap">${escapeHtml(r.name)}</div>
  ${runwaySegs(r.cycles, color)}
  ${cval}
</div>`;
  }).join('');

  setHTML("power-card", `
<div class="gauge-row">
  <div class="gauge-col2">${runwayBlock}</div>
  <div class="gauge-col3">${chips}</div>
</div>`);
}

// ── Runway gauge ─────────────────────────────────────────────────────────────

const RUNWAY_PALETTE = ['#fb923c','#4ade80','#22d3ee','#a78bfa','#f472b6','#facc15','#34d399','#818cf8','#f87171','#67e8f9'];
const RUNWAY_SEGS    = 5;

function darkTint(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const f = 0.20;
  return `rgb(${Math.round(r*f)},${Math.round(g*f)},${Math.round(b*f)})`;
}

function runwaySegs(days, color) {
  const emptyBg = darkTint(color);
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
  if (days > RUNWAY_SEGS) {
    parts.push(`<div style="height:${cfg.seg}px;font-size:${cfg.seg}px;font-weight:700;color:${color};line-height:1;padding:0 3px;display:flex;align-items:center;flex-shrink:0">∞</div>`);
  }
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
  const BG_EMPTY  = 'var(--bg-elev)';

  // ── Runway days bar ───────────────────────────────────────────────────────
  const segs = [];
  for (let i = 0; i < 10; i++) {
    if (i < wholeDays) {
      segs.push(`<div class="day-seg" style="background:var(--good)"></div>`);
    } else if (i === wholeDays && frac > 0) {
      const pct = (frac * 100).toFixed(1);
      segs.push(`<div class="day-seg" style="background:linear-gradient(to right,var(--good) ${pct}%,${BG_EMPTY} ${pct}%)"></div>`);
    } else {
      segs.push(`<div class="day-seg" style="background:${BG_EMPTY}"></div>`);
    }
  }
  if (over10) segs.push(`<div class="day-seg-over">∞</div>`);
  const daysLabel = `${totalDays.toFixed(1)} days`;
  const runwayBlock = `<div style="display:flex;flex-direction:column;gap:4px;background:#0a0a14;border:1px solid #2a2a44;border-radius:5px;padding:${cfg.pad}px ${cfg.pad + 3}px;flex-shrink:0">
    <div style="font-size:${cfg.fs}px;color:${cfg.color};white-space:nowrap">Food Left</div>
    <div style="display:flex;gap:${cfg.seggap}px;align-items:center">${segs.join('')}</div>
    <div style="font-size:13px;font-weight:700;color:var(--good);white-space:nowrap">${escapeHtml(daysLabel)}</div>
  </div>`;

  // ── Per-food runway chips — same row as donut+runway, to the right of segs ──
  const chips = known.map((r, i) => {
    const days  = (r.qty * r.kcal) / T.kcal_per_dupe_per_cycle / n;
    const color = RUNWAY_PALETTE[i % RUNWAY_PALETTE.length];
    const dval  = `<div style="font-size:13px;font-weight:700;color:${color};white-space:nowrap">${days.toFixed(1)} d</div>`;
    return `<div style="display:flex;flex-direction:column;gap:4px;background:#0a0a14;border:1px solid #2a2a44;border-radius:5px;padding:${cfg.pad}px ${cfg.pad + 3}px;flex-shrink:0">
  <div style="font-size:${cfg.fs}px;color:${color};white-space:nowrap">${escapeHtml(r.name ?? r.prefab_id)}</div>
  ${runwaySegs(days, color)}
  ${dval}
</div>`;
  }).join('');

  setHTML("food-card", `
<div class="gauge-row">
  <div class="gauge-col2">${runwayBlock}</div>
  <div class="gauge-col3">${chips}</div>
</div>`);
}

function renderResources(rows) {
  allElements = rows ?? [];

  const LS_KEY = "oni-stockpile-hidden-v1";
  let hidden;
  try { hidden = new Set(JSON.parse(localStorage.getItem(LS_KEY) || "[]")); }
  catch { hidden = new Set(); }

  let display;
  if (pinnedResources.length > 0) {
    display = pinnedResources.filter(r => !hidden.has(String(r.hash)));
  } else {
    display = allElements.slice(0, 8).map(r => ({
      name: String(ELEMENT_NAMES[String(Math.trunc(Number(r.element_id)))] ?? r.element_id),
      hash: r.element_id,
      total_units: r.total_units,
      is_element: true,
    }));
  }

  if (display.length === 0) {
    setHTML("resources-card", `<div class="empty">stockpile empty</div>`);
    return;
  }
  const html = display.map(r => {
    const name = r.is_element ? escapeHtml(elementName(r.hash)) : escapeHtml(formatPrefabName(r.name));
    const qty  = r.is_element ? fmtMass(r.total_units) : `${Math.round(r.total_units ?? 0)}`;
    return `<tr>
      <td style="font-size:12px">${name}</td>
      <td class="metric">${qty}</td>
    </tr>`;
  }).join("");
  setHTML("resources-card", `<table><tbody>${html}</tbody></table>`);
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
    if (data.effects)      BAD_EFFECTS   = data.effects;
    if (data.thresholds)   T             = { ...T, ...data.thresholds };
    if (data.power_fuels)  POWER_FUELS   = data.power_fuels;
    if (data.pinned_resources) pinnedResources = data.pinned_resources;
    if (data.report) {
      STRESS_DELTA = data.report.stress_delta ?? {};
      DISTANCE     = data.report.distance     ?? {};
    }

    _lastData = data;
    renderAll(data);
  } catch (err) {
    showError(`fetch failed: ${err.message}`);
  }
}

function renderAll(data) {
  renderCounts(data.counts || {});
  renderStatus(data.top_dupes || [], data.oxygen || null, data.report || null);
  // renderDupes(data.top_dupes || []);  // commented out — dupes section hidden
  renderFood(data.food || [], data.counts?.duplicants ?? 0);
  renderPower(data.report || null, data.all_resources || [], data.generators || []);
  renderGeysers(data.geysers || []);
  renderResources(data.all_resources || []);
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

// ── SSE — instant push when a new save lands ─────────────────────────────────

function connectSSE() {
  const es = new EventSource("/api/events");
  es.addEventListener("parse", () => refresh());
  es.onerror = () => {
    // EventSource auto-reconnects; nothing extra needed.
  };
}

// ── Boot ─────────────────────────────────────────────────────────────────────

saveSettings();  // apply CSS vars from persisted cfg on load
refresh();
connectSSE();
// Polling as a safety net: covers cases where the SSE connection drops and
// the browser is slow to reconnect, or a save lands during the reconnect window.
setInterval(refresh, POLL_MS);
