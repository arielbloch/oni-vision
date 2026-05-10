// Glue: parse a save file, extract, write SQLite + JSON sidecar.
// Outputs go to a temporary path and are atomically renamed into place so
// readers (Claude / sqlite3 CLI) never see a half-written file.

import { mkdir, rename, rm, writeFile, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { DatabaseSync } from "node:sqlite";

import { parseSaveFile } from "./parser.js";
import { extractAll } from "./extractors.js";
import { writeDatabase } from "./db.js";
import { makeReplacer } from "./utils.js";
import { render } from "./ui.js";

/**
 * Write `bytes` (string or Buffer) to `finalPath` atomically: stage to
 * `finalPath + ".tmp"` first, then rename(2) into place. Readers never see
 * a partially-written file. If a stale .tmp exists from a previous crashed
 * run, we remove it first.
 */
async function writeAtomic(finalPath, bytes) {
  const tmp = `${finalPath}.tmp`;
  if (existsSync(tmp)) await rm(tmp);
  await writeFile(tmp, bytes);
  await rename(tmp, finalPath);
}

/**
 * Same idea as writeAtomic but for a copy: copy to .tmp, then rename.
 */
async function copyAtomic(srcPath, finalPath) {
  const tmp = `${finalPath}.tmp`;
  if (existsSync(tmp)) await rm(tmp);
  await copyFile(srcPath, tmp);
  await rename(tmp, finalPath);
}

export async function buildOutputs({ savePath, outputDir }) {
  await mkdir(outputDir, { recursive: true });

  const t0 = Date.now();
  console.log(`[pipeline] parsing ${savePath}`);
  const save = await parseSaveFile(savePath);
  const tParsed = Date.now();
  console.log(
    `[pipeline]   parsed in ${tParsed - t0} ms (cycle ${save.header?.gameInfo?.numberOfCycles}, dupes ${save.header?.gameInfo?.numberOfDuplicants})`
  );

  const tables = extractAll(save);
  // Stamp parsing metadata so Claude can detect stale data via SQL.
  tables.save_meta.push({ key: "parsed_at", value: new Date().toISOString() });
  tables.save_meta.push({ key: "source_file", value: savePath });
  const tExtracted = Date.now();
  console.log(
    `[pipeline]   extracted ${countRows(tables)} rows across ${Object.keys(tables).length} tables in ${tExtracted - tParsed} ms`
  );

  // Write SQLite to a temp file, then rename. Pipeline atomicity matters:
  // readers (Claude, sqlite3 CLI) can fire at any moment, and we never want
  // them to see a partially-written file. The same temp+rename pattern is
  // applied to current.json and current.sav below.
  const dbTmp = join(outputDir, "current.sqlite.tmp");
  const dbFinal = join(outputDir, "current.sqlite");
  if (existsSync(dbTmp)) await rm(dbTmp);
  writeDatabase(dbTmp, tables);
  await rename(dbTmp, dbFinal);

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

  const tDone = Date.now();
  console.log(`[pipeline]   wrote outputs to ${outputDir} in ${tDone - tExtracted} ms (total ${tDone - t0} ms)`);

  // Print a human-readable status block after each successful parse.
  // Cheap: reads the DB we just wrote. Skipped on errors so a render
  // bug never breaks the parse pipeline.
  try {
    const db = new DatabaseSync(dbFinal, { readOnly: true });
    const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
    const width = process.stdout.columns ?? 80;
    console.log("");
    console.log(render(db, { color: useColor, width }));
    console.log("");
    db.close();
  } catch (err) {
    console.warn(`[pipeline]   render skipped: ${err.message}`);
  }

  return { tables, outputDir, savePath };
}

function countRows(tables) {
  let n = 0;
  for (const rows of Object.values(tables)) n += rows.length;
  return n;
}

function stripWorld(world) {
  // World data includes the entire tilemap (huge, binary). Drop it.
  if (!world) return null;
  const { worldDetails, ...rest } = world;
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

