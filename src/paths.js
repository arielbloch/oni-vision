// Path resolution: where ONI saves live, where we put parsed output.
// Reads ~/.oni-watcher/config.json (or ~/.config/oni-watcher/config.json),
// merges over platform defaults, and — if no saveDir is configured —
// auto-detects from a list of well-known locations (see discover.js).

import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";

import { discoverSaveDir } from "./discover.js";

const HOME = homedir();

/** ONI's default save directory by platform. Used as a last-resort fallback
 *  when no config is present and discovery fails. */
function defaultSaveDir() {
  switch (process.platform) {
    case "darwin":
      return join(
        HOME,
        "Library",
        "Application Support",
        "Klei",
        "OxygenNotIncluded",
        "save_files"
      );
    case "win32":
      // %USERPROFILE%/Documents/Klei/OxygenNotIncluded/save_files
      return join(HOME, "Documents", "Klei", "OxygenNotIncluded", "save_files");
    default:
      // Linux uses unity3d's path layout.
      return join(
        HOME,
        ".config",
        "unity3d",
        "Klei",
        "Oxygen Not Included",
        "save_files"
      );
  }
}

const DEFAULTS = {
  saveDir: defaultSaveDir(),
  // Where we write parsed output. Long-running daemon overwrites these.
  outputDir: join(HOME, ".oni-watcher", "output"),
  // Whether to also crawl the auto_save subdir.
  includeAutoSaves: false,
  // Wait this long after the last write before parsing (avoids partial files).
  debounceMs: 1500,
};

function loadUserConfig() {
  const candidates = [
    join(HOME, ".oni-watcher", "config.json"),
    join(HOME, ".config", "oni-watcher", "config.json"),
  ];
  for (const path of candidates) {
    if (existsSync(path)) {
      try {
        const raw = JSON.parse(readFileSync(path, "utf8"));
        // Strip documentation keys (any key starting with "_") so they
        // never accidentally collide with real config fields.
        const clean = {};
        for (const [k, v] of Object.entries(raw)) {
          if (!k.startsWith("_")) clean[k] = v;
        }
        return clean;
      } catch (err) {
        console.warn(`[paths] failed to parse ${path}: ${err.message}`);
      }
    }
  }
  return {};
}

/**
 * Resolve the effective config.
 *
 * Priority: config-file value > auto-detected value > platform default.
 *
 * If the user has explicitly set `saveDir` in their config file we trust
 * them and return immediately. Otherwise we run discovery against the
 * platform's well-known roots; if discovery finds a save folder, that
 * becomes the saveDir. The discovery result (including the list of paths
 * probed) is returned under `_autoDetected` so callers can log either
 * "found X" or "tried Y, none had .sav files".
 */
export async function resolveConfig() {
  const user = loadUserConfig();

  // Explicit user saveDir wins; no discovery needed.
  if (typeof user.saveDir === "string") {
    return { ...DEFAULTS, ...user, _autoDetected: null };
  }

  const discovered = await discoverSaveDir();
  return {
    ...DEFAULTS,
    ...user,
    saveDir: discovered.saveDir ?? DEFAULTS.saveDir,
    _autoDetected: discovered,
  };
}
