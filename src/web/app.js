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

let ELEMENT_NAMES    = {};  // element_id (string) → name
let GEYSER_NAMES     = {};  // type_id (string)    → name
let BAD_EFFECTS      = {};  // effect string        → { label, cls }
let FOOD             = {};  // prefab_id            → { name, kcal, morale }
let SKILL_LABELS     = {};  // branch → label (kept for potential future use)
let CHORE_GROUPS     = {};  // chore_group internal name → { label, domain, abbr, sort_order }
                            // Populated from /api/status; source of truth is src/chore_groups.js.
                            // docs/frontend-design.md documents the colour/abbr design exploration.

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
  stale_after_s:       600,
  stress_warn:          30,
  stress_bad:           60,
  geyser_quality_good:  70,
  geyser_quality_warn:  40,
  morale_bar_max:       20,
  priority_boost:        5,
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
  if (k >= 1_000)     return `${(k / 1_000).toFixed(0)} kkcal`;
  return `${k.toFixed(0)} kcal`;
}

function fmtDays(days) {
  if (days == null || !Number.isFinite(days) || days <= 0) return "—";
  if (days > 999) return ">999 d";
  return `${days.toFixed(1)} d`;
}

function fmtMass(units) {
  if (units == null) return "?";
  const u = Number(units);
  if (!Number.isFinite(u)) return "?";
  if (u >= 1_000_000) return `${(u/1_000_000).toFixed(2)} kt`;
  if (u >= 1_000)     return `${(u/1_000).toFixed(2)} t`;
  return `${u.toFixed(0)} kg`;
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
  const items = [
    ["duplicants", c.duplicants],
    ["critters",   c.critters],
    ["geysers",    c.geysers],
    ["buildings",  c.buildings],
  ];
  setHTML("counts", items.map(([label, n]) =>
    `<div class="count-card"><div class="n">${n ?? "—"}</div><div class="label">${label}</div></div>`
  ).join(""));
}

function renderDupes(rows) {
  if (!rows || rows.length === 0) {
    setHTML("dupes-card", `<div class="empty">no duplicants in this save</div>`);
    return;
  }
  const html = rows.map(r => {
    const stressVal = r.stress == null ? 0 : Math.max(0, Math.min(100, r.stress));
    const stressBar = `<div class="stress-wrap"><div class="stress-track"><div class="stress-fill" style="width:${stressVal}%"></div></div><span class="stress-val">${r.stress == null ? "—" : Math.round(stressVal) + "%"}</span></div>`;
    const moralePct = Math.min(100, Math.round((r.morale_cost ?? 0) / T.morale_bar_max * 100));
    const moraleBar = `<div class="bar-track"><div class="bar-fill" style="width:${moralePct}%;background:var(--good)"></div></div>`;
    const badges = (r.effects ?? [])
      .map(e => BAD_EFFECTS[e])
      .filter(Boolean)
      .map(e => `<span class="badge ${e.cls}">${escapeHtml(e.label)}</span>`)
      .join("");
    const chips = (r.focus ?? [])
      .slice()
      .sort((a, b) => (CHORE_GROUPS[a.group]?.sort_order ?? 99) - (CHORE_GROUPS[b.group]?.sort_order ?? 99))
      .map(f => {
        const meta = CHORE_GROUPS[f.group] ?? { domain: "tangerine", abbr: "?" };
        const pri  = f.priority >= T.priority_boost ? "p5" : "p4";
        return `<span class="ft ${pri} ft-${meta.domain}">${meta.abbr}</span>`;
      })
      .join("");
    return `<tr>
      <td class="name">${escapeHtml(r.name ?? "(unnamed)")}${badges}</td>
      <td class="focus">${chips || '<span style="color:var(--fg-muted)">—</span>'}</td>
      <td class="skills">${moraleBar}</td>
      <td class="bar">${stressBar}</td>
    </tr>`;
  }).join("");
  const thead = `<thead><tr>
    <th></th>
    <th>Roles</th>
    <th>Morale</th>
    <th>Stress</th>
  </tr></thead>`;
  setHTML("dupes-card", `<table>${thead}<tbody>${html}</tbody></table>`);
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

// ── Stockpile picker state ────────────────────────────────────────────────────

// Persist selected element IDs across reloads in localStorage.
// null means "show top 8 by mass" (default before user configures anything).
const LS_KEY = "oni-stockpile-v1";
let stockpileSelection = null; // Set<string> | null
try {
  const raw = localStorage.getItem(LS_KEY);
  if (raw) stockpileSelection = new Set(JSON.parse(raw));
} catch { /**/ }

let allElements = [];   // populated from latest API response
let inGameFilters = null; // Set<string> | null — from TreeFilterable in the save

function togglePicker() {
  const el = $("stockpile-picker");
  if (!el) return;
  el.style.display = el.style.display === "none" ? "block" : "none";
  if (el.style.display === "block") renderPicker();
}

function renderPicker() {
  const el = $("stockpile-picker");
  if (!el || allElements.length === 0) return;
  el.innerHTML = allElements.map(r => {
    const id = String(Math.trunc(Number(r.element_id)));
    const checked = stockpileSelection === null || stockpileSelection.has(id) ? "checked" : "";
    const name = escapeHtml(elementName(r.element_id));
    const mass = escapeHtml(fmtMass(r.total_units));
    return `<label style="display:flex;align-items:center;gap:6px;padding:3px 0;cursor:pointer">
      <input type="checkbox" data-id="${escapeHtml(id)}" ${checked} onchange="onPickerChange()">
      <span style="flex:1">${name}</span>
      <span style="color:var(--fg-muted)">${mass}</span>
    </label>`;
  }).join("");
}

function onPickerChange() {
  const checkboxes = ($("stockpile-picker") ?? {}).querySelectorAll?.("input[type=checkbox]") ?? [];
  if ([...checkboxes].every(cb => cb.checked)) {
    // All checked → treat as "no filter" (same as default)
    stockpileSelection = null;
    localStorage.removeItem(LS_KEY);
  } else {
    stockpileSelection = new Set([...checkboxes].filter(cb => cb.checked).map(cb => cb.dataset.id));
    try { localStorage.setItem(LS_KEY, JSON.stringify([...stockpileSelection])); } catch { /**/ }
  }
  renderResources(allElements);
}

// ── Renderers ─────────────────────────────────────────────────────────────────

function renderOxygen(oxygen) {
  if (!oxygen) { setHTML("oxygen-card", `<div class="empty">no data</div>`); return; }
  const { avg_breath_pct, report } = oxygen;
  const breathPct = Math.max(0, Math.min(100, avg_breath_pct ?? 100));

  // Breathability: bad% fills from RIGHT (red grows leftward as breath depletes)
  const badPct = (100 - breathPct).toFixed(1);

  // Balance bar: centre-zero, calibrated to max(produced, consumed).
  // Positive delta → green fill extends right. Negative → red fill extends left.
  let balanceHTML = `<div class="o2-balance-bar"><div class="o2-balance-left"></div><div class="o2-balance-hair"></div><div class="o2-balance-right"></div></div>`;
  if (report) {
    const { produced_kg, consumed_kg } = report;
    const scale = Math.max(produced_kg, consumed_kg, 1);
    const delta = produced_kg - consumed_kg;
    const halfPct = Math.min(100, (Math.abs(delta) / scale) * 100);
    if (delta >= 0) {
      // Surplus: green fills from centre rightward
      balanceHTML = `
<div class="o2-balance-bar">
  <div class="o2-balance-left"></div>
  <div class="o2-balance-hair"></div>
  <div class="o2-balance-right"><div class="o2-balance-green" style="width:${halfPct.toFixed(1)}%"></div></div>
</div>`;
    } else {
      // Deficit: red fills from centre leftward
      balanceHTML = `
<div class="o2-balance-bar">
  <div class="o2-balance-left"><div class="o2-balance-red" style="width:${halfPct.toFixed(1)}%"></div></div>
  <div class="o2-balance-hair"></div>
  <div class="o2-balance-right"></div>
</div>`;
    }
  }

  setHTML("oxygen-card", `
<div class="o2-row">
  <span class="o2-label" style="color:var(--bad)">Breathability</span>
  <div class="o2-breath-bar"><div class="o2-breath-red" style="width:${badPct}%"></div></div>
  <span class="o2-value">${Math.round(breathPct)}%</span>
  <div class="o2-gap"></div>
  <span class="o2-label">O2 Production</span>
  ${balanceHTML}
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
  const parts   = [];
  for (let i = 0; i < RUNWAY_SEGS; i++) {
    if (i < whole) {
      parts.push(`<div class="runway-seg" style="background:${color}"></div>`);
    } else if (i === whole && frac > 0.04) {
      const pct = (frac * 100).toFixed(1);
      parts.push(`<div class="runway-seg" style="background:linear-gradient(to right,${color} ${pct}%,${emptyBg} ${pct}%)"></div>`);
    } else {
      parts.push(`<div class="runway-seg" style="background:${emptyBg}"></div>`);
    }
  }
  if (days > RUNWAY_SEGS) {
    parts.push(`<div class="runway-seg-over" style="color:${color}">∞</div>`);
  }
  return `<div class="runway-segs">${parts.join('')}</div>`;
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
  const totalDays = totalKcal / 3000 / n;
  const over10    = totalDays > 10;
  const wholeDays = Math.min(10, Math.floor(totalDays));
  const frac      = over10 ? 0 : totalDays - wholeDays;
  const BG_EMPTY  = '#0d2b1a';

  // ── Total days bar ────────────────────────────────────────────────────────
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
  const daysBar = `<div class="food-days-row"><span class="food-runway-label">Runway</span>${segs.join('')}<span class="food-days-label">${escapeHtml(daysLabel)}</span></div>`;

  // ── Runway chips ───────────────────────────────────────────────────────────
  const chips = known.map((r, i) => {
    const days  = (r.qty * r.kcal) / 3000 / n;
    const color = RUNWAY_PALETTE[i % RUNWAY_PALETTE.length];
    return `<div class="runway-chip">
  <div class="runway-chip-name" style="color:${color}">${escapeHtml(r.name ?? r.prefab_id)}</div>
  ${runwaySegs(days, color)}
</div>`;
  }).join('');

  setHTML("food-card", `<div class="food-layout">${daysBar}<div class="food-chip-row">${chips}</div></div>`);
}

function renderResources(rows) {
  allElements = rows ?? [];

  // Priority: user-configured selection > in-game filter > top 8 by mass.
  let display;
  if (stockpileSelection !== null && stockpileSelection.size > 0) {
    // User has manually chosen specific elements via the picker.
    display = allElements.filter(r => {
      const id = String(Math.trunc(Number(r.element_id)));
      return stockpileSelection.has(id);
    });
  } else if (inGameFilters !== null && inGameFilters.size > 0) {
    // Default: mirror the in-game storage filter settings from the save.
    display = allElements.filter(r => {
      const id = String(Math.trunc(Number(r.element_id)));
      return inGameFilters.has(id);
    });
  } else {
    // Last resort: top 8 elements by total mass.
    display = allElements.slice(0, 8);
  }

  if (display.length === 0) {
    setHTML("resources-card", `<div class="empty">stockpile empty</div>`);
    return;
  }
  const html = display.map(r =>
    `<tr>
      <td style="font-size:12px">${escapeHtml(elementName(r.element_id))}</td>
      <td class="metric">${fmtMass(r.total_units)}</td>
    </tr>`
  ).join("");
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
    if (data.foods)        FOOD          = data.foods;
    if (data.effects)      BAD_EFFECTS   = data.effects;
    if (data.skills)       SKILL_LABELS  = data.skills;
    if (data.chore_groups) CHORE_GROUPS  = data.chore_groups;
    if (data.thresholds)   T             = { ...T, ...data.thresholds };

    renderCounts(data.counts || {});
    renderDupes(data.top_dupes || []);
    renderOxygen(data.oxygen || null);
    renderGeysers(data.geysers || []);
    renderFood(data.food || [], data.counts?.duplicants ?? 0);

    // Update in-game filter defaults before rendering resources.
    if (data.stockpile_filters && data.stockpile_filters.length > 0) {
      inGameFilters = new Set(
        data.stockpile_filters.map(h => String(Math.trunc(Number(h))))
      );
    }
    renderResources(data.all_resources || []);
  } catch (err) {
    showError(`fetch failed: ${err.message}`);
  }
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

refresh();
connectSSE();
// Polling as a safety net: covers cases where the SSE connection drops and
// the browser is slow to reconnect, or a save lands during the reconnect window.
setInterval(refresh, POLL_MS);
