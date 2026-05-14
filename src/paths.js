// Path resolution: where ONI saves live, where we put parsed output.
// Reads ~/.oni-vision/config.json (or ~/.config/oni-vision/config.json),
// merges over platform defaults, and — if no saveDir is configured —
// auto-detects from a list of well-known locations (see discover.js).
//
// Every function takes optional `home` and `platform` overrides so tests
// can drive resolution against a synthetic filesystem without mucking
// with process.env.HOME.

import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";

import { discoverSaveDir } from "./discover.js";

/** ONI's default save directory by platform. Used as a last-resort fallback
 *  when no config is present and discovery fails. */
function defaultSaveDir({ home, platform }) {
  switch (platform) {
    case "darwin":
      return join(
        home,
        "Library",
        "Application Support",
        "Klei",
        "OxygenNotIncluded",
        "save_files"
      );
    case "win32":
      // %USERPROFILE%/Documents/Klei/OxygenNotIncluded/save_files
      return join(home, "Documents", "Klei", "OxygenNotIncluded", "save_files");
    default:
      // Linux uses unity3d's path layout.
      return join(
        home,
        ".config",
        "unity3d",
        "Klei",
        "Oxygen Not Included",
        "save_files"
      );
  }
}

function buildDefaults({ home, platform }) {
  return {
    saveDir: defaultSaveDir({ home, platform }),
    // Where we write parsed output. Long-running daemon overwrites these.
    outputDir: join(home, ".oni-vision", "output"),
    // Whether to also crawl the auto_save subdir.
    includeAutoSaves: false,
    // Wait this long after the last write before parsing (avoids partial files).
    debounceMs: 1500,
    // Web dashboard — on by default, localhost-only, no auth needed.
    // Override with: { "web": { "enabled": false } } in config to turn off,
    // or { "web": { "port": 9090 } } to change the port.
    web: { enabled: true, port: 8080, host: "127.0.0.1" },
  };
}

/**
 * Read the first user config file that exists, strip documentation keys
 * (anything starting with "_"), and return the cleaned object. Returns
 * an empty object if no config file is present or all of them fail to
 * parse.
 */
export function loadUserConfig({ home = homedir() } = {}) {
  const candidates = [
    join(home, ".oni-vision", "config.json"),
    join(home, ".config", "oni-vision", "config.json"),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const raw = JSON.parse(readFileSync(path, "utf8"));
      const clean = {};
      for (const [k, v] of Object.entries(raw)) {
        if (!k.startsWith("_")) clean[k] = v;
      }
      return clean;
    } catch (err) {
      console.warn(`[paths] failed to parse ${path}: ${err.message}`);
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
export async function resolveConfig({
  home = homedir(),
  platform = process.platform,
} = {}) {
  const defaults = buildDefaults({ home, platform });
  const user = loadUserConfig({ home });

  // Deep-merge nested objects so a user setting only { "web": { "port": 9090 } }
  // keeps the default enabled/host values rather than losing them.
  const merged = { ...defaults, ...user };
  if (user.web && typeof user.web === "object") {
    merged.web = { ...defaults.web, ...user.web };
  }

  // Explicit user saveDir wins; no discovery needed.
  if (typeof user.saveDir === "string") {
    return { ...merged, _autoDetected: null };
  }

  const discovered = await discoverSaveDir({ home, platform });
  return {
    ...merged,
    saveDir: discovered.saveDir ?? defaults.saveDir,
    _autoDetected: discovered,
  };
}
