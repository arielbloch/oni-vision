// Pure position math shared by the CLI renderer (src/ui.js) and the web
// API (src/web.js): map coordinates → percent-of-map, and a plain-English
// direction relative to a fixed reference point (the printing pod, internal
// prefab id "Headquarters").

/**
 * Convert a map-cell position to percent-of-map coordinates (0–100, rounded,
 * clamped). Returns nulls if the map dimensions aren't known (older/partial
 * data) so callers can render "?" instead of a bogus percentage.
 *
 * @param {number} x
 * @param {number} y
 * @param {number|null} width  worldWidth in cells
 * @param {number|null} height worldHeight in cells
 * @returns {{xPct: number|null, yPct: number|null}}
 */
export function percentPosition(x, y, width, height) {
  if (!width || !height) return { xPct: null, yPct: null };
  const clamp = (v) => Math.max(0, Math.min(100, Math.round(v)));
  return { xPct: clamp((x / width) * 100), yPct: clamp((y / height) * 100) };
}

/**
 * Describe `(x, y)` relative to the pod at `(podX, podY)` in plain English,
 * combining both axes when both are non-trivial, e.g. "Above and slightly
 * left of pod", "Slightly below and slightly right of pod". An axis is
 * dropped when its normalized distance is under 5% (e.g. "Left of pod"),
 * and both being under 5% collapses to "At the pod".
 *
 * ONI world coordinates: +x is east/right, +y is up/toward the surface.
 *
 * Returns null if the pod position or map dimensions aren't known (e.g. the
 * pod was deconstructed) — callers should omit the column rather than show
 * a meaningless direction.
 *
 * @param {number} x
 * @param {number} y
 * @param {number|null} podX
 * @param {number|null} podY
 * @param {number|null} width  worldWidth in cells, used to normalize magnitude
 * @param {number|null} height worldHeight in cells
 * @returns {string|null}
 */
export function relativeToPod(x, y, podX, podY, width, height) {
  if (podX == null || podY == null || !width || !height) return null;

  const nx = (x - podX) / width;
  const ny = (y - podY) / height;
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);

  const tier = (mag) => (mag < 0.15 ? "slightly " : mag < 0.35 ? "" : "far ");

  const vertical   = ay >= 0.05 ? `${tier(ay)}${ny >= 0 ? "above" : "below"}` : null;
  const horizontal = ax >= 0.05 ? `${tier(ax)}${nx >= 0 ? "right" : "left"}` : null;

  let phrase;
  if (!vertical && !horizontal) {
    phrase = "at the pod";
  } else if (vertical && horizontal) {
    phrase = `${vertical} and ${horizontal} of pod`;
  } else {
    // A lone vertical direction reads naturally without "of" ("above pod");
    // a lone horizontal direction needs it ("right of pod").
    phrase = vertical ? `${vertical} pod` : `${horizontal} of pod`;
  }

  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}
