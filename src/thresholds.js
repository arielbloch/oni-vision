// Game-rule constants and UI thresholds.
// Single source of truth: pipeline writes nothing here (these aren't stored in
// SQLite), but they're served in the /api/status `thresholds` block so the web
// frontend and MCP layer read from one place rather than hardcoding values.

export const THRESHOLDS = {
  stale_after_s:        600,  // seconds before the UI considers data "stale"
  stress_warn:           30,  // stress % → yellow bar
  stress_bad:            60,  // stress % → red bar
  geyser_quality_good:   70,  // quality % → good (no warning colour)
  geyser_quality_warn:   40,  // quality % → medium warning colour
  morale_bar_max:        20,  // morale cost that fills the morale bar to 100 %
  priority_boost:         5,  // chore priority ≥ this is rendered as "boosted"
};
