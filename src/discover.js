// Auto-detection of ONI's save folder for first-run users.
//
// We probe a per-platform list of well-known root directories. In each
// root we look for a folder named `cloud_save_files` or `save_files`, at
// either depth 0 (older Klei layout) or depth 1 (recent Steam-on-Mac
// layout, which nests by colony id).
//
// The candidate with the most-recent `.sav` wins. If nothing is found,
// we return { saveDir: null, probed: [...every path we tried] } so the
// caller can print a useful diagnostic.

import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { findLatestSave } from "./find-latest.js";

/** Folder names that mean "this is where ONI keeps its save files". */
const SAVE_DIR_NAMES = ["cloud_save_files", "save_files"];

/**
 * Per-platform list of root directories to probe. We don't crawl the
 * whole home directory — only these roots are inspected, and only down
 * to depth 1 inside each.
 */
export function candidateRoots({
  platform = process.platform,
  home = homedir(),
  env = process.env,
} = {}) {
  switch (platform) {
    case "darwin":
      return [
        join(home, "Library", "Application Support", "unity.Klei.Oxygen Not Included"),
        join(home, "Library", "Application Support", "Klei", "OxygenNotIncluded"),
      ];
    case "win32": {
      const roots = [join(home, "Documents", "Klei", "OxygenNotIncluded")];
      if (env.LOCALAPPDATA) {
        roots.push(join(env.LOCALAPPDATA, "Klei", "Oxygen Not Included"));
      }
      return roots;
    }
    default:
      return [
        join(home, ".config", "unity3d", "Klei", "Oxygen Not Included"),
        join(home, ".local", "share", "Klei", "Oxygen Not Included"),
      ];
  }
}

/**
 * Find every directory named cloud_save_files / save_files at depth 0 or 1
 * under `root`, accumulating each path we inspect into `probed` so the
 * caller can show a "we tried these paths" error if discovery fails.
 */
function saveDirsUnder(root, probed) {
  const matches = [];

  // Depth 0 — root directly contains save_files or cloud_save_files.
  for (const name of SAVE_DIR_NAMES) {
    const direct = join(root, name);
    probed.push(direct);
    if (existsSync(direct) && statSync(direct).isDirectory()) {
      matches.push(direct);
    }
  }

  // Depth 1 — root contains colony-named subdirs (e.g. recent Steam-on-Mac
  // installs nest by colony id).
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return matches;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (SAVE_DIR_NAMES.includes(entry.name)) continue; // handled at depth 0

    const sub = join(root, entry.name);
    for (const name of SAVE_DIR_NAMES) {
      const candidate = join(sub, name);
      probed.push(candidate);
      if (existsSync(candidate) && statSync(candidate).isDirectory()) {
        matches.push(candidate);
      }
    }
  }

  return matches;
}

/**
 * Probe `roots` (defaults to candidateRoots() for the current platform)
 * and return the save folder containing the most-recent .sav file across
 * all matches.
 *
 * @returns {Promise<{saveDir: string|null, sourceFile: string|null, mtimeMs: number|null, probed: string[]}>}
 */
export async function discoverSaveDir(opts = {}) {
  const roots = opts.roots ?? candidateRoots(opts);
  const probed = [];
  let best = null;

  for (const root of roots) {
    probed.push(root);
    if (!existsSync(root)) continue;

    const folders = saveDirsUnder(root, probed);
    for (const folder of folders) {
      const latest = await findLatestSave(folder);
      if (latest && (!best || latest.mtimeMs > best.mtimeMs)) {
        best = {
          saveDir: folder,
          sourceFile: latest.path,
          mtimeMs: latest.mtimeMs,
        };
      }
    }
  }

  return {
    saveDir: best?.saveDir ?? null,
    sourceFile: best?.sourceFile ?? null,
    mtimeMs: best?.mtimeMs ?? null,
    probed,
  };
}
