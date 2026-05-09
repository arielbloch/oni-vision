#!/usr/bin/env node
// oni-watcher daemon. Watches the ONI save_files directory; on every file
// settle event, finds the newest .sav and re-builds current.sqlite + current.json.
//
// Run: npm start
// Override save dir via ONI_SAVE_DIR env, output dir via ONI_OUTPUT_DIR.

import { existsSync, statSync } from "node:fs";
import chokidar from "chokidar";

import { resolveConfig } from "./paths.js";
import { findLatestSave } from "./find-latest.js";
import { buildOutputs } from "./pipeline.js";

const config = resolveConfig({
  saveDir: process.env.ONI_SAVE_DIR,
  outputDir: process.env.ONI_OUTPUT_DIR,
});
// Strip undefined overrides so defaults from paths.js stick.
for (const k of Object.keys(config)) if (config[k] === undefined) delete config[k];

console.log(`[watcher] save dir:   ${config.saveDir}`);
console.log(`[watcher] output dir: ${config.outputDir}`);
console.log(`[watcher] include auto saves: ${config.includeAutoSaves}`);
console.log(`[watcher] debounce:   ${config.debounceMs} ms`);

if (!existsSync(config.saveDir)) {
  console.error(
    `[watcher] FATAL: save directory does not exist: ${config.saveDir}\n` +
    `Set ONI_SAVE_DIR or edit ~/.oni-watcher/config.json to point at the correct folder.`
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

// Watch the directory tree for .sav file events. awaitWriteFinish ensures
// we don't try to parse while the game is still writing.
const watcher = chokidar.watch(config.saveDir, {
  ignored: config.includeAutoSaves
    ? undefined
    : (p) => p.includes(`${require_sep()}auto_save${require_sep()}`),
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

function require_sep() {
  return process.platform === "win32" ? "\\" : "/";
}

// Tidy shutdown.
function shutdown() {
  console.log("[watcher] shutting down...");
  watcher.close().finally(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
