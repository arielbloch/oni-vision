// Path resolution: where ONI saves live, where we put parsed output.
// Uses ~/.config/oni-watcher/config.json if present, else macOS defaults.

import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";

const HOME = homedir();

const DEFAULTS = {
  // macOS default — see README for Windows/Linux paths.
  saveDir: join(
    HOME,
    "Library",
    "Application Support",
    "Klei",
    "OxygenNotIncluded",
    "save_files"
  ),
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
        return JSON.parse(readFileSync(path, "utf8"));
      } catch (err) {
        console.warn(`[paths] failed to parse ${path}: ${err.message}`);
      }
    }
  }
  return {};
}

export function resolveConfig(overrides = {}) {
  return { ...DEFAULTS, ...loadUserConfig(), ...overrides };
}

export const PATHS = resolveConfig();
