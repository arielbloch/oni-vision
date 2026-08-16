// Glue: parse a save file, extract, write SQLite + JSON sidecar.
// Outputs go to a temporary path and are atomically renamed into place so
// readers (Claude / sqlite3 CLI) never see a half-written file.

import { mkdir, rename, rm, writeFile, copyFile } from "node:fs/promises";
import { join } from "node:path";

import { DatabaseSync } from "node:sqlite";

import { parseSaveFile } from "./parser.js";
import { extractAll } from "./extractors.js";
import { writeDatabase, assertLookupTablesPopulated } from "./db.js";
import { makeReplacer } from "./utils.js";
import { render } from "./ui.js";
import { SKILL_LABELS } from "./skills.js";
// Static lookup tables written into current.sqlite so both web and MCP
// consumers can resolve human-readable names via SQL JOINs.
import { ELEMENT_NAMES } from "./elements.js";
import { GEYSER_TYPE_NAMES } from "./geyser_types.js";
import { FOOD_META } from "./food.js";
import { EFFECT_LABELS } from "./effects.js";
import { CHORE_GROUP_NAMES } from "./chore_groups.js";
import { DISEASE_NAMES } from "./diseases.js";

/**
 * Best-effort removal of a stale tmp file. Swallows errors because the
 * file may disappear between our existsSync check and the rm syscall
 * (race), or it may be locked by another process — neither blocks the
 * caller from re-creating the tmp.
 */
async function rmIfExists(path) {
  try {
    await rm(path, { force: true });
  } catch {
    // ignore — writeFile/copyFile below will fail loudly if it matters
  }
}

/**
 * Write `bytes` (string or Buffer) to `finalPath` atomically: stage to
 * `finalPath + ".tmp"` first, then rename(2) into place. Readers never see
 * a partially-written file. If a stale .tmp exists from a previous crashed
 * run we remove it first; if removal fails, writeFile will overwrite it.
 */
async function writeAtomic(finalPath, bytes) {
  const tmp = `${finalPath}.tmp`;
  await rmIfExists(tmp);
  await writeFile(tmp, bytes);
  await rename(tmp, finalPath);
}

/**
 * Same idea as writeAtomic but for a copy: copy to .tmp, then rename.
 */
async function copyAtomic(srcPath, finalPath) {
  const tmp = `${finalPath}.tmp`;
  await rmIfExists(tmp);
  await copyFile(srcPath, tmp);
  await rename(tmp, finalPath);
}

export async function buildOutputs({ savePath, outputDir }) {
  await mkdir(outputDir, { recursive: true });

  const save = await parseSaveFile(savePath);

  const tables = extractAll(save);
  // Stamp parsing metadata so Claude can detect stale data via SQL.
  tables.save_meta.push({ key: "parsed_at", value: new Date().toISOString() });
  tables.save_meta.push({ key: "source_file", value: savePath });

  // Populate static lookup tables so both web and MCP consumers can JOIN
  // against human-readable names without any hardcoded JS on their side.
  tables.elements     = [...ELEMENT_NAMES.entries()].map(([element_id, name]) => ({ element_id, name }));
  tables.geyser_types = GEYSER_TYPE_NAMES;
  tables.foods        = FOOD_META;
  tables.effects      = EFFECT_LABELS;
  tables.skills       = SKILL_LABELS;
  tables.chore_groups = CHORE_GROUP_NAMES;
  tables.diseases     = DISEASE_NAMES;
  assertLookupTablesPopulated(tables);

  // Write SQLite to a temp file, then rename. Pipeline atomicity matters:
  // readers (Claude, sqlite3 CLI) can fire at any moment, and we never want
  // them to see a partially-written file. The same temp+rename pattern is
  // applied to current.json and current.sav below.
  const dbTmp = join(outputDir, "current.sqlite.tmp");
  const dbFinal = join(outputDir, "current.sqlite");
  await rmIfExists(dbTmp);
  writeDatabase(dbTmp, tables);
  try {
    await rename(dbTmp, dbFinal);
  } catch (renameErr) {
    if (renameErr.code !== "ENOENT") throw renameErr;
    // Tmp file disappeared between writeDatabase and rename (e.g. a concurrent
    // rmIfExists from an overlapping run). Fall back to writing directly.
    console.warn("[pipeline] sqlite tmp vanished before rename — writing directly");
    await rmIfExists(dbTmp);
    writeDatabase(dbFinal, tables);
  }

  // JSON sidecar: only the parts that don't belong in tables.
  const sidecar = {
    header: save.header,
    settings: save.settings,
    version: save.version,
    world: stripWorld(save.world),
    gameData: stripGameData(save.gameData),
    sourceFile: savePath,
    parsedAt: new Date().toISOString(),
  };
  await writeAtomic(
    join(outputDir, "current.json"),
    JSON.stringify(sidecar, makeReplacer(), 2)
  );

  // Also keep a copy of the original .sav we parsed so the user can re-parse
  // out-of-band without hunting for it.
  try {
    await copyAtomic(savePath, join(outputDir, "current.sav"));
  } catch (err) {
    console.warn(`[pipeline]   could not copy original save: ${err.message}`);
  }

  // Print a human-readable status block after each successful parse.
  let renderDb = null;
  try {
    renderDb = new DatabaseSync(dbFinal, { readOnly: true });
    renderDb.exec("PRAGMA busy_timeout = 2000");
    const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
    const width = process.stdout.columns ?? 80;
    console.log("\n" + render(renderDb, { color: useColor, width }) + "\n");
  } catch {
    // Render errors are non-fatal; the parse itself succeeded.
  } finally {
    if (renderDb) {
      try { renderDb.close(); } catch { /* ignore */ }
    }
  }

  return { tables, outputDir, savePath };
}

/**
 * Run `buildOutputs` with parse-failure isolation. A corrupt save file, a
 * disk-full error, or a bug in the extractor must not crash the daemon —
 * we log and return so the watcher can retry on the next file event.
 *
 * Returns `{ ok: true, savePath, outputDir }` on success or
 * `{ ok: false, error }` on failure. Never throws.
 */
export async function safeBuildOutputs({ savePath, outputDir }) {
  try {
    await buildOutputs({ savePath, outputDir });
    return { ok: true, savePath, outputDir };
  } catch (err) {
    console.error(`[pipeline] parse failed: ${err.stack || err.message}`);
    return { ok: false, error: err };
  }
}

function stripWorld(world) {
  // World data includes the entire tilemap (huge, binary). Drop it.
  if (!world) return null;
  const { worldDetails: _worldDetails, ...rest } = world;
  return rest;
}

function stripGameData(gd) {
  if (!gd) return null;
  // Drop the giant binary blobs; keep settings.
  const drop = new Set([
    "gasConduitFlow",
    "liquidConduitFlow",
    "fallingWater",
    "unstableGround",
    "worldDetail",
    "autoPrioritizeRoles",
  ]);
  const out = {};
  for (const [k, v] of Object.entries(gd)) {
    if (drop.has(k)) {
      out[k] = "[stripped: large binary blob]";
    } else {
      out[k] = v;
    }
  }
  return out;
}

