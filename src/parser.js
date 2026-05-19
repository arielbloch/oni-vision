// Thin wrapper around oni-save-parser.
// parseSaveGame takes an ArrayBuffer and returns a SaveGame object whose shape
// is fully described in node_modules/oni-save-parser/dts/save-structure/.
//
// `./_polyfills.js` MUST be imported before `oni-save-parser` so that
// util.isObject (removed in recent Node versions) is shimmed in time.

import "./_polyfills.js";
import { readFile } from "node:fs/promises";
import { parseSaveGame } from "oni-save-parser";
import {
  CURRENT_VERSION_MAJOR,
  CURRENT_VERSION_MINOR,
} from "oni-save-parser/lib/save-structure/version-validator.js";

/**
 * Read a .sav file from disk and return the parsed SaveGame.
 *
 * @param {string} filePath
 * @param {object} [opts]
 * @param {"none"|"major"|"minor"} [opts.versionStrictness="major"]
 *   Forwarded to `parseSaveGame`. The upstream library's default is "minor"
 *   (exact major.minor match), which hard-fails the moment Klei ships a
 *   new ONI patch that bumps the save minor — even when the format change
 *   is backward-compatible (the common case). We default to "major" so
 *   the parser stays usable across the typical lifetime of an
 *   oni-save-parser release; if a real format break happens downstream
 *   extraction will throw and surface a real error.
 *
 *   - "none"   skip validation entirely
 *   - "major"  (default) only the major version is checked
 *   - "minor"  exact major.minor required (upstream default)
 *
 * On a successfully-parsed save whose minor version isn't in the parser's
 * known-good list, we log a one-line warning so the caller knows they're
 * running in permissive mode and a downstream error might mean a real
 * format change (rather than a transient bug).
 */
export async function parseSaveFile(filePath, { versionStrictness = "major" } = {}) {
  const buf = await readFile(filePath);
  // Node Buffer is a Uint8Array view over an ArrayBuffer; slice to be safe
  // because the underlying buffer may be larger than this Buffer's view.
  const arrayBuffer = buf.buffer.slice(
    buf.byteOffset,
    buf.byteOffset + buf.byteLength
  );
  const save = parseSaveGame(arrayBuffer, { versionStrictness });

  const major = save?.header?.gameInfo?.saveMajorVersion;
  const minor = save?.header?.gameInfo?.saveMinorVersion;
  if (
    versionStrictness !== "minor" &&
    typeof major === "number" &&
    typeof minor === "number" &&
    major === CURRENT_VERSION_MAJOR &&
    Array.isArray(CURRENT_VERSION_MINOR) &&
    !CURRENT_VERSION_MINOR.includes(minor)
  ) {
    console.warn(
      `oni-vision: save v${major}.${minor} is newer than parser's known v${CURRENT_VERSION_MAJOR}.${CURRENT_VERSION_MINOR.join("/")} — proceeding optimistically`
    );
  }

  return save;
}
