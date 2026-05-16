// ONI-vision dashboard — browser-side logic.
// Fetches /api/status on load, on SSE push, and on a polling fallback.
// All thresholds (stale_after_s, stress_bad, …) are read from the API
// response so they stay in sync with src/thresholds.js server-side.
//
// Expected /api/status shape:
//   base_name, cycle, age_seconds, source_file, counts, top_dupes,
//   geyser_types, food, all_resources, stockpile_filters,
//   element_names, geyser_type_names, food_meta, effect_labels,
//   skill_labels, thresholds

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

// Domain + icon for each chore group (Studio palette).
// domain → .fc-{domain} CSS class (bar colour)
// icon   → Tabler icon name (ti-*)
// docs/frontend-design.md documents the full design exploration.
// Domain colour + abbreviated label for each chore group (Studio palette).
// order matches the game's "Manage Duplicant Priorities" column order (left→right).
// docs/frontend-design.md documents the full design exploration.
const CHORE_META = {
  Combat:           { domain: "tangerine", abbr: "Atk",   order:  1 },
  LifeSupport:      { domain: "cyan",      abbr: "Life",  order:  2 },
  Toggle:           { domain: "lavender",  abbr: "Tog",   order:  3 },
  MedicalAid:       { domain: "pink",      abbr: "Med",   order:  4 },
  Basekeeping:      { domain: "cyan",      abbr: "Tidy",  order:  5 },
  Cook:             { domain: "pink",      abbr: "Cook",  order:  6 },
  Art:              { domain: "pink",      abbr: "Art",   order:  7 },
  Research:         { domain: "lavender",  abbr: "Res",   order:  8 },
  MachineOperating: { domain: "lavender",  abbr: "Ops",   order:  9 },
  Farming:          { domain: "pink",      abbr: "Farm",  order: 10 },
  Ranching:         { domain: "pink",      abbr: "Ranch", order: 11 },
  Build:            { domain: "cyan",      abbr: "Build", order: 12 },
  Dig:              { domain: "cyan",      abbr: "Dig",   order: 13 },
  Hauling:          { domain: "cyan",      abbr: "Haul",  order: 14 },
  Storage:          { domain: "cyan",      abbr: "Store", order: 15 },
  Unknown:          { domain: "tangerine", abbr: "?",     order: 99 },
};

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

// Game-rule thresholds — defaults mirror src/thresholds.js; overwritten from
// /api/status on every refresh so the frontend is always in sync.
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
    const stressBar = r.stress == null
      ? `<div class="bar-track"><div class="bar-fill" style="width:0%;background:var(--bg-elev)"></div></div>`
      : bar(r.stress);
    const moralePct = Math.min(100, Math.round((r.morale_cost ?? 0) / T.morale_bar_max * 100));
    const moraleBar = `<div class="bar-track"><div class="bar-fill" style="width:${moralePct}%;background:var(--good)"></div></div>`;
    const badges = (r.effects ?? [])
      .map(e => BAD_EFFECTS[e])
      .filter(Boolean)
      .map(e => `<span class="badge ${e.cls}">${escapeHtml(e.label)}</span>`)
      .join("");
    const chips = (r.focus ?? [])
      .slice()
      .sort((a, b) => (CHORE_META[a.group]?.order ?? 99) - (CHORE_META[b.group]?.order ?? 99))
      .map(f => {
        const meta = CHORE_META[f.group] ?? { domain: "tangerine", abbr: "?" };
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
      <td class="pct">${quality}%</td>
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

function renderFood(rows) {
  const known = (rows ?? [])
    .map(r => ({ info: FOOD[r.item_prefab_id], qty: r.qty }))
    .filter(r => r.info)
    .sort((a, b) => (b.qty * b.info.kcal) - (a.qty * a.info.kcal));

  if (known.length === 0) {
    setHTML("food-card", `<div class="empty">no food in storage</div>`);
    return;
  }

  const html = known.map(r => {
    const totalKcal = r.qty * r.info.kcal;
    const m = r.info.morale;
    const mLabel = m > 0 ? `+${m}` : String(m);
    const mColor = m > 0 ? "var(--good)" : m < 0 ? "var(--bad)" : "var(--fg-muted)";
    return `<tr>
      <td style="font-size:12px">${escapeHtml(r.info.name)}</td>
      <td class="metric">${fmtKcal(totalKcal)}</td>
      <td class="metric" style="color:${mColor};width:28px">${mLabel}</td>
    </tr>`;
  }).join("");
  setHTML("food-card", `<table><tbody>${html}</tbody></table>`);
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
    if (data.element_names)     ELEMENT_NAMES = data.element_names;
    if (data.geyser_type_names) GEYSER_NAMES  = data.geyser_type_names;
    if (data.food_meta)         FOOD          = data.food_meta;
    if (data.effect_labels)     BAD_EFFECTS   = data.effect_labels;
    if (data.skill_labels)      SKILL_LABELS  = data.skill_labels;
    if (data.thresholds)        T             = { ...T, ...data.thresholds };

    renderCounts(data.counts || {});
    renderDupes(data.top_dupes || []);
    renderGeysers(data.geyser_types || []);
    renderFood(data.food || []);

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
