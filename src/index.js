#!/usr/bin/env node
// oni-vision daemon. Watches the ONI save_files directory; on every file
// settle event, finds the newest .sav and re-builds current.sqlite + current.json.
//
// Run: npm start
// Override defaults by dropping a config file at ~/.oni-vision/config.json
// (or ~/.config/oni-vision/config.json). See .config-example.json.

import { existsSync } from "node:fs";
import chokidar from "chokidar";

import { resolveConfig } from "./paths.js";
import { findLatestSave } from "./find-latest.js";
import { buildOutputs } from "./pipeline.js";
import { startWeb } from "./web.js";

const config = await resolveConfig();

if (config._autoDetected?.saveDir) {
  console.log(`[vision] auto-detected save dir: ${config.saveDir}`);
  console.log(
    `[vision]   newest save: ${config._autoDetected.sourceFile}` +
    ` (${new Date(config._autoDetected.mtimeMs).toISOString()})`
  );
} else if (config._autoDetected) {
  // Discovery ran but found nothing.
  console.warn(
    `[vision] no save folder auto-detected. Tried:\n` +
    config._autoDetected.probed.map((p) => `  - ${p}`).join("\n") +
    `\nFalling back to platform default: ${config.saveDir}`
  );
}
console.log(`[vision] save dir:   ${config.saveDir}`);
console.log(`[vision] output dir: ${config.outputDir}`);
console.log(`[vision] include auto saves: ${config.includeAutoSaves}`);
console.log(`[vision] debounce:   ${config.debounceMs} ms`);

if (!existsSync(config.saveDir)) {
  console.error(
    `[vision] FATAL: save directory does not exist: ${config.saveDir}\n` +
    `Drop a config file at ~/.oni-vision/config.json pointing at the correct folder. ` +
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
      console.log(`[vision] no .sav files in ${config.saveDir} yet`);
      return;
    }
    console.log(
      `[vision] (${reason}) latest save: ${latest.path} (${(latest.size / 1024 / 1024).toFixed(2)} MB)`
    );
    await buildOutputs({ savePath: latest.path, outputDir: config.outputDir });
  } catch (err) {
    console.error(`[vision] parse failed: ${err.stack || err.message}`);
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
  console.error(`[vision] chokidar error: ${err.message}`);
});

// Optional web dashboard. Off by default; opt in via config.web.enabled.
let webServer = null;
if (config.web?.enabled) {
  try {
    webServer = await startWeb({
      port: config.web.port ?? 8080,
      host: config.web.host ?? "127.0.0.1",
      outputDir: config.outputDir,
    });
  } catch (err) {
    console.error(`[vision] web server failed to start: ${err.message}`);
  }
}

console.log("[vision] running. Ctrl-C to stop.");

// Tidy shutdown.
function shutdown() {
  console.log("[vision] shutting down...");
  const tasks = [watcher.close()];
  if (webServer) {
    tasks.push(new Promise((resolve) => webServer.close(() => resolve())));
  }
  Promise.allSettled(tasks).finally(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
