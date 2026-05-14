// Find the most-recently-modified .sav file in a directory tree.
// Skips auto-saves unless includeAutoSaves is set.

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export async function findLatestSave(rootDir, { includeAutoSaves = false } = {}) {
  let best = null;
  await walk(rootDir);
  return best;

  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!includeAutoSaves && entry.name === "auto_save") continue;
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".sav")) {
        let s;
        try {
          s = await stat(full);
        } catch {
          continue;
        }
        if (!best || s.mtimeMs > best.mtimeMs) {
          best = { path: full, mtimeMs: s.mtimeMs, size: s.size };
        }
      }
    }
  }
}
