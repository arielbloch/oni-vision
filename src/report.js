// Per-cycle accounting from ReportManager.dailyReports[-1].
// One DB hit returns stress deltas, distance, food, O₂, and power.

/**
 * Extract dupe name from ONI report context strings like "13. Researcher - Ren".
 * Returns the segment after the last " - ", trimmed.
 */
function extractName(label) {
  if (!label) return null;
  const idx = label.lastIndexOf(" - ");
  return idx >= 0 ? label.slice(idx + 3).trim() : label.trim();
}

/**
 * Query the last daily report from the ReportManager behavior.
 * Returns an object with per-dupe maps and aggregate stats.
 *
 * @returns {{
 *   stress_delta: Record<string, number>,
 *   distance:     Record<string, number>,
 *   food:         { produced_kcal: number, consumed_kcal: number } | null,
 *   oxygen:       { produced_kg: number, consumed_kg: number } | null,
 *   power:        { produced_wh: number, consumed_wh: number } | null,
 * }}
 */
export function reportStats(db) {
  // Aggregate entries — types with a single production/consumption pair
  const aggRows = db.prepare(`
    SELECT
      json_extract(e.value, '$.reportType')  AS rt,
      json_extract(e.value, '$.accPositive') AS pos,
      json_extract(e.value, '$.accNegative') AS neg
    FROM behaviors,
      json_each(json_extract(template_data, '$.dailyReports[#-1].reportEntries')) AS e
    WHERE name = 'ReportManager'
      AND json_extract(e.value, '$.reportType') IN (1, 18, 19)
  `).all();

  // Per-dupe context entries — stress (type 2) and distance (type 10)
  const ctxRows = db.prepare(`
    SELECT
      json_extract(e.value, '$.reportType')   AS rt,
      json_extract(ctx.value, '$.context')    AS label,
      json_extract(ctx.value, '$.accumulate') AS net,
      json_extract(ctx.value, '$.accPositive') AS pos
    FROM behaviors,
      json_each(json_extract(template_data, '$.dailyReports[#-1].reportEntries')) AS e,
      json_each(json_extract(e.value, '$.contextEntries.elements')) AS ctx
    WHERE name = 'ReportManager'
      AND json_extract(e.value, '$.reportType') IN (2, 10)
      AND json_extract(ctx.value, '$.context') IS NOT NULL
  `).all();

  // Build per-dupe maps keyed by extracted dupe name
  const stress_delta = {};  // name → net stress %-pts this cycle
  const distance     = {};  // name → tiles walked this cycle
  for (const r of ctxRows) {
    const name = extractName(r.label);
    if (!name) continue;
    if (r.rt === 2)  stress_delta[name] = r.net;
    if (r.rt === 10) distance[name]     = r.pos;
  }

  // Aggregate by report type
  const byType = {};
  for (const r of aggRows) byType[r.rt] = r;

  const food = byType[1] ? {
    produced_kcal: (byType[1].pos ?? 0) / 1000,
    consumed_kcal: Math.abs(byType[1].neg ?? 0) / 1000,
  } : null;

  const oxygen = byType[18] ? {
    produced_kg: byType[18].pos ?? 0,
    consumed_kg: Math.abs(byType[18].neg ?? 0),
  } : null;

  const power = byType[19] ? {
    produced_wh: byType[19].pos ?? 0,
    consumed_wh: Math.abs(byType[19].neg ?? 0),
  } : null;

  return { stress_delta, distance, food, oxygen, power };
}
