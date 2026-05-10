#!/usr/bin/env node
// oni-watcher daemon. Watches the ONI save_files directory; on every file
// settle event, finds the newest .sav and re-builds current.sqlite + current.json.
//
// Run: npm start
// Override defaults by dropping a config file at ~/.oni-watcher/config.json
// (or ~/.config/oni-watcher/config.json). See .config-example.json.

import { existsSync, statSync } from "node:fs";
import chokidar from "chokidar";

import { resolveConfig } from "./paths.js";
import { findLatestSave } from "./find-latest.js";
import { buildOutputs } from "./pipeline.js";

const config = await resolveConfig();

if (config._autoDetected?.saveDir) {
  console.log(`[watcher] auto-detected save dir: ${config.saveDir}`);
  console.log(
    `[watcher]   newest save: ${config._autoDetected.sourceFile}` +
    ` (${new Date(config._autoDetected.mtimeMs).toISOString()})`
  );
} else if (config._autoDetected) {
  // Discovery ran but found nothing.
  console.warn(
    `[watcher] no save folder auto-detected. Tried:\n` +
    config._autoDetected.probed.map((p) => `  - ${p}`).join("\n") +
    `\nFalling back to platform default: ${config.saveDir}`
  );
}
console.log(`[watcher] save dir:   ${config.saveDir}`);
console.log(`[watcher] output dir: ${config.outputDir}`);
console.log(`[watcher] include auto saves: ${config.includeAutoSaves}`);
console.log(`[watcher] debounce:   ${config.debounceMs} ms`);

if (!existsSync(config.saveDir)) {
  console.error(
    `[watcher] FATAL: save directory does not exist: ${config.saveDir}\n` +
    `Drop a config file at ~/.oni-watcher/config.json pointing at the correct folder. ` +
    `See .config-example.json in the project root for a template.`
  );
  process.exit(1);
}

let busy = false;
let queued = false;

async function runOnce(reason) {
  if (busy) {
    queued = true;
    return;
  }
  busy = true;
  try {
    const latest = await findLatestSave(config.saveDir, {
      includeAutoSaves: config.includeAutoSaves,
    });
    if (!latest) {
      console.log(`[watcher] no .sav files in ${config.saveDir} yet`);
      return;
    }
    console.log(
      `[watcher] (${reason}) latest save: ${latest.path} (${(latest.size / 1024 / 1024).toFixed(2)} MB)`
    );
    await buildOutputs({ savePath: latest.path, outputDir: config.outputDir });
  } catch (err) {
    console.error(`[watcher] parse failed: ${err.stack || err.message}`);
  } finally {
    busy = false;
    if (queued) {
      queued = false;
      runOnce("queued");
    }
  }
}

// Initial parse on startup.
runOnce("startup");

// Match a path that contains an `auto_save` segment, on either separator.
// Used to skip ONI's auto-save directory when the user hasn't opted in.
const AUTO_SAVE_SEGMENT = /[\\/]auto_save[\\/]/;

// Watch the directory tree for .sav file events. awaitWriteFinish ensures
// we don't try to parse while the game is still writing.
const watcher = chokidar.watch(config.saveDir, {
  ignored: config.includeAutoSaves
    ? undefined
    : (p) => AUTO_SAVE_SEGMENT.test(p),
  ignoreInitial: true,
  awaitWriteFinish: {
    stabilityThreshold: config.debounceMs,
    pollInterval: 200,
  },
  depth: 5,
});

watcher.on("add", (p) => {
  if (p.endsWith(".sav")) runOnce(`add ${p}`);
});
watcher.on("change", (p) => {
  if (p.endsWith(".sav")) runOnce(`change ${p}`);
});
watcher.on("error", (err) => {
  console.error(`[watcher] chokidar error: ${err.message}`);
});

console.log("[watcher] running. Ctrl-C to stop.");

// Tidy shutdown.
function shutdown() {
  console.log("[watcher] shutting down...");
  watcher.close().finally(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
