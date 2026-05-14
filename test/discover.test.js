// Unit tests for src/discover.js. We build temp filesystems with
// mkdtempSync, drop fake .sav files of varying mtime at varying depths,
// and assert that discoverSaveDir() picks the right one.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { discoverSaveDir, candidateRoots } from "../src/discover.js";

function makeFs() {
  const root = mkdtempSync(join(tmpdir(), "oni-discover-"));
  return root;
}

function touchSave(dir, name, mtimeSeconds) {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, "fake save bytes");
  if (mtimeSeconds !== undefined) {
    utimesSync(path, mtimeSeconds, mtimeSeconds);
  }
  return path;
}

describe("candidateRoots", () => {
  test("macOS: returns both unity.Klei and Klei roots", () => {
    const roots = candidateRoots({ platform: "darwin", home: "/Users/x" });
    assert.equal(roots.length, 2);
    assert.match(roots[0], /unity\.Klei/);
    assert.match(roots[1], /\/Klei\/OxygenNotIncluded$/);
  });

  test("Windows: includes Documents and (when present) LOCALAPPDATA", () => {
    const roots = candidateRoots({
      platform: "win32",
      home: "C:\\Users\\x",
      env: { LOCALAPPDATA: "C:\\Users\\x\\AppData\\Local" },
    });
    assert.equal(roots.length, 2);
    assert.match(roots[0], /Documents/);
    assert.match(roots[1], /AppData\\Local/);
  });

  test("Linux: returns both unity3d and .local/share roots", () => {
    const roots = candidateRoots({ platform: "linux", home: "/home/x" });
    assert.equal(roots.length, 2);
    assert.match(roots[0], /unity3d/);
    assert.match(roots[1], /\.local\/share/);
  });
});

describe("discoverSaveDir", () => {
  test("returns null saveDir when no roots exist, but reports them in probed[]", async () => {
    const result = await discoverSaveDir({
      roots: [join(makeFs(), "no-such-folder")],
    });
    assert.equal(result.saveDir, null);
    assert.equal(result.sourceFile, null);
    assert.equal(result.probed.length, 1);
  });

  test("finds save_files at depth 0 (older Klei layout)", async () => {
    const fs = makeFs();
    const saveDir = join(fs, "save_files");
    touchSave(saveDir, "colony.sav", 1_700_000_000);

    const result = await discoverSaveDir({ roots: [fs] });
    assert.equal(result.saveDir, saveDir);
    assert.equal(result.sourceFile, join(saveDir, "colony.sav"));
  });

  test("finds save_files at depth 1 (recent Steam-on-Mac colony nesting)", async () => {
    const fs = makeFs();
    const saveDir = join(fs, "abc-colony-id", "save_files");
    touchSave(saveDir, "my_colony.sav", 1_700_000_000);

    const result = await discoverSaveDir({ roots: [fs] });
    assert.equal(result.saveDir, saveDir);
    assert.match(result.sourceFile, /my_colony\.sav$/);
  });

  test("picks the most-recent .sav across multiple matches", async () => {
    const fs = makeFs();
    const localDir = join(fs, "save_files");
    const cloudDir = join(fs, "cloud_save_files");
    touchSave(localDir, "old.sav", 1_700_000_000);
    touchSave(cloudDir, "newer.sav", 1_710_000_000);

    const result = await discoverSaveDir({ roots: [fs] });
    assert.equal(result.saveDir, cloudDir);
    assert.match(result.sourceFile, /newer\.sav$/);
  });

  test("prefers a newer save_files even if a cloud_save_files also exists", async () => {
    const fs = makeFs();
    const localDir = join(fs, "save_files");
    const cloudDir = join(fs, "cloud_save_files");
    touchSave(localDir, "newest.sav", 1_720_000_000);
    touchSave(cloudDir, "stale.sav", 1_700_000_000);

    const result = await discoverSaveDir({ roots: [fs] });
    assert.equal(result.saveDir, localDir);
    assert.match(result.sourceFile, /newest\.sav$/);
  });

  test("compares across multiple roots, not just within one", async () => {
    const fs1 = makeFs();
    const fs2 = makeFs();
    const dir1 = join(fs1, "save_files");
    const dir2 = join(fs2, "save_files");
    touchSave(dir1, "old.sav", 1_700_000_000);
    touchSave(dir2, "newer.sav", 1_710_000_000);

    const result = await discoverSaveDir({ roots: [fs1, fs2] });
    assert.equal(result.saveDir, dir2);
  });

  test("an empty save_files folder doesn't match (no .sav -> no candidate)", async () => {
    const fs = makeFs();
    mkdirSync(join(fs, "save_files"), { recursive: true });

    const result = await discoverSaveDir({ roots: [fs] });
    assert.equal(result.saveDir, null);
    // We did probe it though.
    assert.ok(result.probed.some((p) => p.endsWith("save_files")));
  });
});
