// config-writer.js — create or patch ~/.oni-vision/config.json.
//
// Called once at daemon startup. Two jobs:
//
//   1. No config file → write a complete, commented config using the
//      resolved effective values (so saveDir is already filled in with
//      the auto-detected path rather than the placeholder from the example).
//
//   2. Config file exists but is missing fields → append the missing
//      keys (with their _comment_ companions) to the existing object.
//      Never removes or overwrites keys the user already set.
//
// The file uses the _comment_<key> convention (already established in
// .config-example.json) because JSON has no native comment syntax.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

// ── field schema ─────────────────────────────────────────────────────────────
// Ordered list of top-level config fields. Each entry drives both
// "what comment to write" and "what value to use when the field is absent".
// `value(cfg)` receives the fully-resolved config so we can pre-fill
// the auto-detected saveDir, outputDir, etc.

const TOP_LEVEL_FIELDS = [
  {
    key: "saveDir",
    comment:
      "Path to ONI's save_files directory. " +
      "oni-vision auto-detects this on macOS, Windows, and Linux — " +
      "override only if auto-detection picks the wrong colony.",
    value: (cfg) => cfg.saveDir,
  },
  {
    key: "outputDir",
    comment:
      "Where current.sqlite and current.json land. " +
      "Defaults to ~/.oni-vision/output. " +
      "Override if you want the parsed outputs somewhere else (a project folder, a synced drive, etc.).",
    value: (cfg) => cfg.outputDir,
  },
  {
    key: "includeAutoSaves",
    comment:
      "If true, oni-vision reparses every auto_save " +
      "(ONI auto-saves every cycle by default — that's noisy). " +
      "Default false: only manual saves trigger a reparse.",
    value: (cfg) => cfg.includeAutoSaves,
  },
  {
    key: "debounceMs",
    comment:
      "How long to wait (ms) after the last write to a .sav file before reparsing. " +
      "Stops us from racing the game while it's still writing. " +
      "Default 1500 ms is comfortable for saves up to ~10 MB; bump if you see parse errors.",
    value: (cfg) => cfg.debounceMs,
  },
  {
    key: "web",
    comment:
      "In-process web dashboard. " +
      "Serves a live colony status page at http://localhost:<port>/ while the daemon runs. " +
      "Set enabled:false to turn it off. Change port if 8080 conflicts with another app " +
      "(oni-vision tries up to 10 sequential ports automatically, but a fixed port is cleaner).",
    value: (cfg) => cfg.web,
    // Sub-keys of the web object — used when the key exists but is incomplete.
    subKeys: ["enabled", "port", "host"],
  },
];

// ── public API ────────────────────────────────────────────────────────────────

/**
 * Ensure the config file at `configPath` exists and contains all known
 * fields. Creates it if absent; appends missing fields if present.
 *
 * Logs a one-liner to stdout describing what was done.
 *
 * @param {object} opts
 * @param {object} opts.config       Fully-resolved config (from resolveConfig).
 * @param {string} [opts.home]       Home directory (defaults to os.homedir()).
 * @returns {{ created: boolean, added: string[] }}
 */
export function ensureConfig({ config, home = homedir() } = {}) {
  const configPath = join(home, ".oni-vision", "config.json");

  if (!existsSync(configPath)) {
    return _createConfig(configPath, config);
  }
  return _patchConfig(configPath, config);
}

// ── internals ─────────────────────────────────────────────────────────────────

function _createConfig(configPath, config) {
  mkdirSync(dirname(configPath), { recursive: true });

  const obj = {
    _comment:
      "oni-vision configuration. All keys are optional — omit any to use the built-in default. " +
      "Keys starting with '_' are documentation and are ignored at runtime.",
  };

  for (const field of TOP_LEVEL_FIELDS) {
    obj[`_comment_${field.key}`] = field.comment;
    obj[field.key] = field.value(config);
  }

  writeFileSync(configPath, JSON.stringify(obj, null, 2) + "\n", "utf8");
  console.log(`[vision] created config at ${configPath}`);
  return { created: true, added: TOP_LEVEL_FIELDS.map((f) => f.key) };
}

function _patchConfig(configPath, config) {
  let existing;
  try {
    existing = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    // Malformed JSON — don't touch it, loadUserConfig already warned.
    return { created: false, added: [] };
  }

  const added = [];

  for (const field of TOP_LEVEL_FIELDS) {
    if (!(field.key in existing)) {
      // Whole field is missing — add comment + value.
      existing[`_comment_${field.key}`] = field.comment;
      existing[field.key] = field.value(config);
      added.push(field.key);
    } else if (field.subKeys && typeof existing[field.key] === "object") {
      // Field exists but sub-keys may be missing (e.g. web.host).
      const defaults = field.value(config);
      const missingSubKeys = field.subKeys.filter(
        (k) => !(k in existing[field.key])
      );
      if (missingSubKeys.length > 0) {
        for (const k of missingSubKeys) {
          existing[field.key][k] = defaults[k];
        }
        added.push(...missingSubKeys.map((k) => `${field.key}.${k}`));
      }
    }
  }

  if (added.length > 0) {
    writeFileSync(configPath, JSON.stringify(existing, null, 2) + "\n", "utf8");
    console.log(`[vision] config: added missing fields: ${added.join(", ")}`);
  }

  return { created: false, added };
}
