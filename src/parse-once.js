#!/usr/bin/env node
// One-shot parser. Useful for testing or for parsing a specific save file.
//
// Usage:
//   node src/parse-once.js                       # parse latest in default save dir
//   node src/parse-once.js path/to/your.sav      # parse a specific file
//   ONI_OUTPUT_DIR=./out node src/parse-once.js  # send output elsewhere

import { existsSync } from "node:fs";

import { resolveConfig } from "./paths.js";
import { findLatestSave } from "./find-latest.js";
import { buildOutputs } from "./pipeline.js";

const config = resolveConfig({
  saveDir: process.env.ONI_SAVE_DIR,
  outputDir: process.env.ONI_OUTPUT_DIR,
});
for (const k of Object.keys(config)) if (config[k] === undefined) delete config[k];

const arg = process.argv[2];

let savePath;
if (arg) {
  if (!existsSync(arg)) {
    console.error(`[parse-once] file not found: ${arg}`);
    process.exit(1);
  }
  savePath = arg;
} else {
  if (!existsSync(config.saveDir)) {
    console.error(`[parse-once] save directory not found: ${config.saveDir}`);
    process.exit(1);
  }
  const latest = await findLatestSave(config.saveDir, {
    includeAutoSaves: config.includeAutoSaves,
  });
  if (!latest) {
    console.error(`[parse-once] no .sav files found under ${config.saveDir}`);
    process.exit(1);
  }
  savePath = latest.path;
}

await buildOutputs({ savePath, outputDir: config.outputDir });
