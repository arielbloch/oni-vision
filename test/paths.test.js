// Tests for src/paths.js — config resolution + discovery fallback.
// We point home at a fresh tmpdir and verify each priority level:
//   user config saveDir > auto-detected > platform default.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveConfig, loadUserConfig } from "../src/paths.js";

function tmpHome() {
  return mkdtempSync(join(tmpdir(), "oni-paths-"));
}

function writeConfig(home, contents) {
  const dir = join(home, ".oni-watcher");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.json"), JSON.stringify(contents, null, 2));
}

describe("loadUserConfig", () => {
  test("returns {} if no config file exists", () => {
    const home = tmpHome();
    const cfg = loadUserConfig({ home });
    assert.deepEqual(cfg, {});
  });

  test("reads ~/.oni-watcher/config.json when present", () => {
    const home = tmpHome();
    writeConfig(home, { saveDir: "/tmp/explicit", debounceMs: 9999 });
    const cfg = loadUserConfig({ home });
    assert.equal(cfg.saveDir, "/tmp/explicit");
    assert.equal(cfg.debounceMs, 9999);
  });

  test("strips _-prefixed documentation keys", () => {
    const home = tmpHome();
    writeConfig(home, {
      _comment: "ignore me",
      _comment_saveDir: "ignore me too",
      saveDir: "/tmp/explicit",
    });
    const cfg = loadUserConfig({ home });
    assert.equal(cfg.saveDir, "/tmp/explicit");
    assert.ok(!("_comment" in cfg));
    assert.ok(!("_comment_saveDir" in cfg));
  });

  test("returns {} (with a warning to stderr) if config is malformed JSON", () => {
    const home = tmpHome();
    mkdirSync(join(home, ".oni-watcher"), { recursive: true });
    writeFileSync(join(home, ".oni-watcher", "config.json"), "{ not valid json");
    const cfg = loadUserConfig({ home });
    assert.deepEqual(cfg, {});
  });
});

describe("resolveConfig", () => {
  test("returns platform-correct defaults when no config exists and discovery fails", async () => {
    const home = tmpHome();
    const cfg = await resolveConfig({ home, platform: "darwin" });
    assert.match(cfg.saveDir, /OxygenNotIncluded\/save_files$/);
    assert.match(cfg.outputDir, /\.oni-watcher\/output$/);
    assert.equal(cfg.includeAutoSaves, false);
    assert.equal(cfg.debounceMs, 1500);
    // Discovery ran but returned null because no folders exist under the synthetic home.
    assert.ok(cfg._autoDetected !== null);
    assert.equal(cfg._autoDetected.saveDir, null);
    assert.ok(Array.isArray(cfg._autoDetected.probed));
  });

  test("explicit user saveDir short-circuits discovery", async () => {
    const home = tmpHome();
    writeConfig(home, { saveDir: "/tmp/explicit-sd" });
    const cfg = await resolveConfig({ home, platform: "darwin" });
    assert.equal(cfg.saveDir, "/tmp/explicit-sd");
    // _autoDetected should be null when user supplied saveDir explicitly.
    assert.equal(cfg._autoDetected, null);
  });

  test("user config overrides individual default fields without affecting saveDir discovery", async () => {
    const home = tmpHome();
    writeConfig(home, { debounceMs: 5000, includeAutoSaves: true });
    const cfg = await resolveConfig({ home, platform: "darwin" });
    assert.equal(cfg.debounceMs, 5000);
    assert.equal(cfg.includeAutoSaves, true);
    // No saveDir in user config → discovery still runs.
    assert.ok(cfg._autoDetected !== null);
  });

  test("Linux platform default is the unity3d path", async () => {
    const home = tmpHome();
    const cfg = await resolveConfig({ home, platform: "linux" });
    assert.match(cfg.saveDir, /unity3d.+Oxygen Not Included\/save_files$/);
  });

  test("Windows platform default is the Documents path", async () => {
    const home = tmpHome();
    const cfg = await resolveConfig({ home, platform: "win32" });
    assert.match(cfg.saveDir, /Documents.+Klei.+OxygenNotIncluded.+save_files$/);
  });
});
