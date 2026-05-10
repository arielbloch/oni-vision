// Tests for src/find-latest.js — recursive newest-.sav finder.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { findLatestSave } from "../src/find-latest.js";

function fs() {
  return mkdtempSync(join(tmpdir(), "oni-find-latest-"));
}

function touchSave(dir, name, mtimeSeconds) {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, "fake");
  if (mtimeSeconds !== undefined) utimesSync(path, mtimeSeconds, mtimeSeconds);
  return path;
}

describe("findLatestSave", () => {
  test("returns null on a directory that doesn't exist", async () => {
    const result = await findLatestSave(join(fs(), "nope"));
    assert.equal(result, null);
  });

  test("returns null on an empty directory", async () => {
    const result = await findLatestSave(fs());
    assert.equal(result, null);
  });

  test("returns the only .sav when there is one", async () => {
    const dir = fs();
    const path = touchSave(dir, "only.sav", 1_700_000_000);
    const result = await findLatestSave(dir);
    assert.equal(result.path, path);
    assert.equal(result.mtimeMs, 1_700_000_000_000);
  });

  test("picks the most-recent .sav when there are several", async () => {
    const dir = fs();
    touchSave(dir, "old.sav", 1_700_000_000);
    touchSave(dir, "newer.sav", 1_710_000_000);
    touchSave(dir, "newest.sav", 1_720_000_000);
    const result = await findLatestSave(dir);
    assert.match(result.path, /newest\.sav$/);
  });

  test("recurses into subdirectories by default", async () => {
    const dir = fs();
    const path = touchSave(join(dir, "deep", "deeper"), "buried.sav", 1_700_000_000);
    const result = await findLatestSave(dir);
    assert.equal(result.path, path);
  });

  test("ignores non-.sav files", async () => {
    const dir = fs();
    writeFileSync(join(dir, "notes.txt"), "hello");
    const result = await findLatestSave(dir);
    assert.equal(result, null);
  });

  test("skips auto_save subdirectory by default", async () => {
    const dir = fs();
    touchSave(join(dir, "auto_save"), "auto.sav", 1_720_000_000); // newer
    touchSave(dir, "manual.sav", 1_700_000_000);                  // older
    const result = await findLatestSave(dir);
    assert.match(result.path, /manual\.sav$/);
  });

  test("includes auto_save when includeAutoSaves: true", async () => {
    const dir = fs();
    touchSave(join(dir, "auto_save"), "auto.sav", 1_720_000_000);
    touchSave(dir, "manual.sav", 1_700_000_000);
    const result = await findLatestSave(dir, { includeAutoSaves: true });
    assert.match(result.path, /auto\.sav$/);
  });
});
