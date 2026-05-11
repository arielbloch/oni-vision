#!/usr/bin/env node
// One-shot world-status renderer. Reads ~/.oni-vision/output/current.sqlite
// (or a path passed as the first arg) and prints the formatted status
// block. Does NOT re-parse — it just queries what the oni-vision daemon
// already produced.
//
//   npm run status                # uses configured outputDir
//   node src/cli/status.js path/to/current.sqlite

import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { resolveConfig } from "../paths.js";
import { render } from "../ui.js";

const argPath = process.argv[2];
let dbPath;
if (argPath) {
  dbPath = argPath;
} else {
  const config = await resolveConfig();
  dbPath = join(config.outputDir, "current.sqlite");
}

if (!existsSync(dbPath)) {
  console.error(
    `[status] no SQLite found at ${dbPath}\n` +
    `Has oni-vision run yet? Try 'npm start' first, or 'npm run parse' for a one-shot.`
  );
  process.exit(1);
}

const db = new DatabaseSync(dbPath, { readOnly: true });

try {
  const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
  const width = process.stdout.columns ?? 80;
  console.log(render(db, { color: useColor, width }));
} finally {
  // Ensure the handle is released even if render throws. Important for
  // long-running shells where this script might be invoked many times.
  try { db.close(); } catch { /* ignore */ }
}
