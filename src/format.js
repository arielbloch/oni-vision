// Pure formatting utilities for the CLI renderer.
// No I/O, no DB access, no external dependencies.
// Shared between src/ui.js (Node CLI) and tested by test/format.test.js.

export const ANSI = {
  reset:   "\x1b[0m",
  dim:     "\x1b[2m",
  bold:    "\x1b[1m",
  cyan:    "\x1b[36m",
  green:   "\x1b[32m",
  yellow:  "\x1b[33m",
  red:     "\x1b[31m",
  blue:    "\x1b[34m",
  magenta: "\x1b[35m",
};

export function paint(s, code, enabled) {
  return enabled ? `${code}${s}${ANSI.reset}` : s;
}

/** Render a block-element ASCII bar. value is 0..1; fills proportionally. */
export function bar(value, width = 10) {
  const v = Math.max(0, Math.min(1, value));
  const filled = Math.round(v * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

/** Right-pad string to at least n columns. */
export function pad(s, n) {
  s = String(s);
  if (s.length >= n) return s;
  return s + " ".repeat(n - s.length);
}

/** Pad-or-clip to exactly n columns. Long strings get an ellipsis. */
export function fit(s, n) {
  s = String(s);
  if (s.length === n) return s;
  if (s.length < n) return s + " ".repeat(n - s.length);
  if (n <= 1) return s.slice(0, n);
  return s.slice(0, n - 1) + "…";
}

/** Left-pad string to at least n columns. */
export function lpad(s, n) {
  s = String(s);
  if (s.length >= n) return s;
  return " ".repeat(n - s.length) + s;
}

/**
 * Format a mass in raw ONI "units" (kg) into a compact string.
 * Tiers: kg → t (tonnes, 1 000 kg) → kt (kilotonnes, 1 000 t).
 */
export function formatMass(units) {
  if (units == null) return "?";
  const u = Number(units);
  if (Number.isNaN(u)) return "?";
  if (u >= 1_000_000) return `${(u / 1_000_000).toFixed(2)} kt`;
  if (u >= 1_000)     return `${(u / 1_000).toFixed(2)} t`;
  return `${u.toFixed(0)} kg`;
}

/**
 * Format an elapsed-time in seconds into a human-readable age string.
 * Matches the fmtAge() function in src/web/app.js — contract-tested in
 * test/format.test.js to keep the two in sync.
 */
export function formatAge(seconds) {
  if (seconds == null) return "unknown";
  const s = Math.max(0, Math.floor(seconds));
  if (s < 90)    return `${s}s ago`;
  if (s < 5400)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Stress level → ANSI color code. Returns empty string when disabled. */
export function stressColor(stress, enabled) {
  if (!enabled) return "";
  if (stress >= 60) return ANSI.red;
  if (stress >= 30) return ANSI.yellow;
  return ANSI.green;
}
