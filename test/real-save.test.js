// End-to-end integration test against a real ONI save file.
//
// Looks for any .sav file under save/ (gitignored — local-only) and runs
// the full parse → extract → write → query chain. Skips cleanly when no
// save is present, so CI (which doesn't ship a save) stays green.
//
// This is the test that surfaces issues the synthetic FAKE_SAVE fixture
// can't: real shape variance, DLC content, save-version mismatches,
// extractor leaks of non-primitive values, etc.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";

import { parseSaveFile } from "../src/parser.js";
import { extractAll } from "../src/extractors.js";
import { writeDatabase } from "../src/db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAVE_DIR = join(__dirname, "..", "save");

function findRealSave() {
  if (!existsSync(SAVE_DIR)) return null;
  const candidates = readdirSync(SAVE_DIR).filter((f) => f.endsWith(".sav")).sort();
  return candidates.length > 0 ? join(SAVE_DIR, candidates[0]) : null;
}

const savePath = findRealSave();
const skipReason = savePath ? undefined : "no .sav file under save/ — skipping real-save integration test";

describe("real ONI save end-to-end", { skip: skipReason }, () => {
  test("parse → extract → write → query produces a sane DB", async () => {
    // 1. Parse the binary save.
    const save = await parseSaveFile(savePath);
    assert.ok(save, "parseSaveFile returned a falsy value");
    assert.ok(save.header, "parsed save has no header block");
    assert.ok(save.header.gameInfo, "parsed save has no gameInfo");

    // 2. Run the extractor.
    const tables = extractAll(save);
    assert.ok(tables.save_meta.length > 0, "save_meta empty");
    assert.ok(tables.game_objects.length > 0, "no game_objects extracted");
    assert.ok(tables.behaviors.length > 0, "no behaviors extracted");

    // 3. Write a fresh SQLite into a tmp dir.
    const dir = mkdtempSync(join(tmpdir(), "oni-real-test-"));
    const dbPath = join(dir, "real.sqlite");
    writeDatabase(dbPath, tables);

    // 4. Open it read-only and assert the colony's shape is sane.
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      // save_meta has the headline counts.
      const cycleRow = db
        .prepare("SELECT value FROM save_meta WHERE key = 'numberOfCycles'")
        .get();
      assert.ok(cycleRow, "save_meta missing numberOfCycles");
      const cycle = Number(cycleRow.value);
      assert.ok(
        Number.isInteger(cycle) && cycle > 0 && cycle < 100000,
        `cycle ${cycleRow.value} out of sane range`
      );

      const dupeCountRow = db
        .prepare("SELECT value FROM save_meta WHERE key = 'numberOfDuplicants'")
        .get();
      assert.ok(dupeCountRow, "save_meta missing numberOfDuplicants");
      const headerDupes = Number(dupeCountRow.value);

      // Typed table populated and matches the header count.
      const dupes = db.prepare("SELECT COUNT(*) AS n FROM duplicants").get().n;
      assert.ok(dupes > 0, "no duplicants in the DB");
      assert.equal(
        dupes,
        headerDupes,
        `duplicants table has ${dupes} rows but save_meta says ${headerDupes}`
      );

      // Dupes have non-null names and the schema columns are present.
      const sampleDupe = db
        .prepare(
          `SELECT name, gender, current_role, stress, calories, hp
           FROM duplicants ORDER BY game_object_id LIMIT 1`
        )
        .get();
      assert.ok(sampleDupe, "could not SELECT a sample dupe");
      assert.ok(
        typeof sampleDupe.name === "string" && sampleDupe.name.length > 0,
        `sample dupe has empty name: ${JSON.stringify(sampleDupe)}`
      );

      // Buildings table is populated (any real save has at least the
      // printing pod). If this is 0 the extractor classification regressed.
      const buildings = db.prepare("SELECT COUNT(*) AS n FROM buildings").get().n;
      assert.ok(
        buildings > 0,
        "no buildings in the DB — extractor classification likely regressed"
      );

      // World objects (loose resources / debris) should also exist on
      // any non-empty colony.
      const worldObjects = db.prepare("SELECT COUNT(*) AS n FROM world_objects").get().n;
      assert.ok(
        worldObjects > 0,
        "no world_objects — loose-pile classification regressed"
      );

      // Sanity on the storage_contents column rename (Wave 4).
      const storageRowCount = db.prepare("SELECT COUNT(*) AS n FROM storage_contents").get().n;
      assert.ok(typeof storageRowCount === "number");
      if (storageRowCount > 0) {
        const joined = db
          .prepare(
            `SELECT COUNT(*) AS n
             FROM storage_contents sc
             JOIN buildings b ON b.game_object_id = sc.owner_id
             LIMIT 1`
          )
          .get().n;
        assert.ok(joined >= 0, "storage_contents.owner_id join failed");
      }

      // Geysers / critters: a save may have 0 of either depending on
      // game state, but the columns must read without error.
      const geysers = db.prepare("SELECT type_id, COUNT(*) AS n FROM geysers GROUP BY type_id").all();
      assert.ok(Array.isArray(geysers));
      const critters = db.prepare("SELECT COUNT(*) AS n FROM critters").get().n;
      assert.ok(typeof critters === "number");
    } finally {
      db.close();
    }
  });
});
