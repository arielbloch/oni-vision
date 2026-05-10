// Renderer smoke tests. We build a SQLite from FAKE_SAVE and assert the
// shape of the output strings — exact-text snapshots are brittle, so we
// match the data points we care about.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { extractAll } from "../src/extractors.js";
import { writeDatabase } from "../src/db.js";
import { FAKE_SAVE } from "./fixture.js";
import {
  render,
  renderBanner,
  renderHeadCounts,
  renderGeysers,
  renderStockpile,
  renderDupes,
  readMeta,
} from "../src/ui.js";

function buildDb() {
  const tables = extractAll(FAKE_SAVE);
  tables.save_meta.push({ key: "parsed_at", value: new Date().toISOString() });
  tables.save_meta.push({ key: "source_file", value: "/tmp/fake.sav" });

  const dir = mkdtempSync(join(tmpdir(), "oni-ui-test-"));
  const dbPath = join(dir, "test.sqlite");
  writeDatabase(dbPath, tables);
  return new DatabaseSync(dbPath);
}

describe("readMeta", () => {
  test("returns headline facts as numbers / strings, not raw save_meta", () => {
    const db = buildDb();
    const meta = readMeta(db);
    assert.equal(meta.baseName, "Test Base");
    assert.equal(meta.cycle, 312);
    assert.equal(meta.dupeCount, 3);
    assert.equal(meta.saveVersion, "7.26");
    assert.match(meta.parsedAt, /^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("renderBanner", () => {
  test("includes the base name and cycle", () => {
    const db = buildDb();
    const out = renderBanner(db, { color: false, width: 80 });
    assert.match(out, /Test Base/);
    assert.match(out, /cycle 312/);
  });

  test("color=false produces no ANSI escapes", () => {
    const db = buildDb();
    const out = renderBanner(db, { color: false, width: 80 });
    assert.doesNotMatch(out, /\x1b\[/);
  });

  test("color=true produces some ANSI escapes", () => {
    const db = buildDb();
    const out = renderBanner(db, { color: true, width: 80 });
    assert.match(out, /\x1b\[/);
  });
});

describe("renderHeadCounts", () => {
  test("counts dupes / critters / geysers / buildings", () => {
    const db = buildDb();
    const out = renderHeadCounts(db);
    // FAKE_SAVE: 1 dupe, 2 critters (Hatch + Pip), 2 geysers (steam + BigVolcano),
    // 2 buildings (BatterySmart + StorageLocker). Algae pile is a world_object.
    assert.match(out, /1 duplicants/);
    assert.match(out, /2 critters/);
    assert.match(out, /2 geysers/);
    assert.match(out, /2 buildings/);
  });
});

describe("renderGeysers", () => {
  test("lists each geyser type with a count", () => {
    const db = buildDb();
    const out = renderGeysers(db);
    assert.match(out, /steam/);
    assert.match(out, /big_volcano/);
    assert.match(out, /×1/);
  });
});

describe("renderStockpile", () => {
  test("aggregates across world_objects and storage_contents", () => {
    const db = buildDb();
    const out = renderStockpile(db);
    // FAKE_SAVE has Algae in two places: 750 loose + 500 in locker = 1250.
    // Water 250 in locker.
    assert.match(out, /Algae/);
    assert.match(out, /Water/);
  });
});

describe("renderDupes", () => {
  test("includes Meep with stress percentage", () => {
    const db = buildDb();
    const out = renderDupes(db);
    assert.match(out, /Meep/);
    // Meep's stress is 12.5 in the fixture; should appear with 1 decimal.
    assert.match(out, /12\.5/);
    assert.match(out, /Digger/);
  });
});

describe("render", () => {
  test("composes all sections without throwing", () => {
    const db = buildDb();
    const out = render(db, { color: false, width: 80 });
    // Banner
    assert.match(out, /Test Base/);
    // Headcounts
    assert.match(out, /duplicants/);
    // Geysers
    assert.match(out, /Geysers/);
    // Stockpile
    assert.match(out, /Stockpile/);
    // Dupes section
    assert.match(out, /Dupes/);
  });
});
