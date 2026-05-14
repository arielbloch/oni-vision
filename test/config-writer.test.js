// Tests for src/config-writer.js — create / patch the user config file.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { ensureConfig } from "../src/config-writer.js";

// Minimal resolved config that satisfies all field.value() calls.
const BASE_CONFIG = {
  saveDir: "/tmp/oni-saves",
  outputDir: "/tmp/oni-output",
  includeAutoSaves: false,
  debounceMs: 1500,
  web: { enabled: true, port: 8080, host: "127.0.0.1" },
};

function tmpHome() {
  return mkdtempSync(join(tmpdir(), "oni-cfg-writer-"));
}

function readConfig(home) {
  return JSON.parse(readFileSync(join(home, ".oni-vision", "config.json"), "utf8"));
}

describe("ensureConfig — no config file", () => {
  test("creates the config file with all top-level fields", () => {
    const home = tmpHome();
    const { created, added } = ensureConfig({ config: BASE_CONFIG, home });
    assert.equal(created, true);
    assert.ok(added.length > 0);
    assert.ok(existsSync(join(home, ".oni-vision", "config.json")));
  });

  test("created file is valid JSON", () => {
    const home = tmpHome();
    ensureConfig({ config: BASE_CONFIG, home });
    assert.doesNotThrow(() => readConfig(home));
  });

  test("created file contains all expected keys", () => {
    const home = tmpHome();
    ensureConfig({ config: BASE_CONFIG, home });
    const cfg = readConfig(home);
    assert.ok("saveDir" in cfg);
    assert.ok("outputDir" in cfg);
    assert.ok("includeAutoSaves" in cfg);
    assert.ok("debounceMs" in cfg);
    assert.ok("web" in cfg);
  });

  test("created file uses resolved values, not placeholders", () => {
    const home = tmpHome();
    ensureConfig({ config: BASE_CONFIG, home });
    const cfg = readConfig(home);
    assert.equal(cfg.saveDir, BASE_CONFIG.saveDir);
    assert.equal(cfg.outputDir, BASE_CONFIG.outputDir);
    assert.equal(cfg.debounceMs, BASE_CONFIG.debounceMs);
    assert.deepEqual(cfg.web, BASE_CONFIG.web);
  });

  test("created file has _comment_ keys alongside each field", () => {
    const home = tmpHome();
    ensureConfig({ config: BASE_CONFIG, home });
    const cfg = readConfig(home);
    assert.ok("_comment_saveDir" in cfg, "missing _comment_saveDir");
    assert.ok("_comment_web" in cfg, "missing _comment_web");
    assert.ok(typeof cfg._comment_saveDir === "string" && cfg._comment_saveDir.length > 0);
  });

  test("creates the .oni-vision directory if it does not exist", () => {
    const home = tmpHome(); // fresh dir, no .oni-vision subdir
    ensureConfig({ config: BASE_CONFIG, home });
    assert.ok(existsSync(join(home, ".oni-vision")));
  });
});

describe("ensureConfig — config file already complete", () => {
  test("does not modify a file that already has all fields", () => {
    const home = tmpHome();
    // First call creates the file.
    ensureConfig({ config: BASE_CONFIG, home });
    const before = readFileSync(join(home, ".oni-vision", "config.json"), "utf8");
    // Second call should be a no-op.
    const { created, added } = ensureConfig({ config: BASE_CONFIG, home });
    const after = readFileSync(join(home, ".oni-vision", "config.json"), "utf8");
    assert.equal(created, false);
    assert.equal(added.length, 0);
    assert.equal(before, after);
  });

  test("does not overwrite existing user values", () => {
    const home = tmpHome();
    mkdirSync(join(home, ".oni-vision"), { recursive: true });
    writeFileSync(
      join(home, ".oni-vision", "config.json"),
      JSON.stringify({
        saveDir: "/my/custom/saves",
        outputDir: "/my/custom/output",
        includeAutoSaves: true,
        debounceMs: 3000,
        web: { enabled: false, port: 9090, host: "127.0.0.1" },
      }, null, 2),
      "utf8"
    );
    ensureConfig({ config: BASE_CONFIG, home });
    const cfg = readConfig(home);
    assert.equal(cfg.saveDir, "/my/custom/saves");
    assert.equal(cfg.debounceMs, 3000);
    assert.equal(cfg.web.enabled, false);
    assert.equal(cfg.web.port, 9090);
  });
});

describe("ensureConfig — config file missing some fields", () => {
  test("adds missing top-level field with its _comment_ key", () => {
    const home = tmpHome();
    mkdirSync(join(home, ".oni-vision"), { recursive: true });
    // Write a config that is missing 'web' and 'debounceMs'.
    writeFileSync(
      join(home, ".oni-vision", "config.json"),
      JSON.stringify({ saveDir: "/saves", outputDir: "/out", includeAutoSaves: false }, null, 2),
      "utf8"
    );
    const { added } = ensureConfig({ config: BASE_CONFIG, home });
    assert.ok(added.includes("debounceMs"), "debounceMs not added");
    assert.ok(added.includes("web"), "web not added");
    const cfg = readConfig(home);
    assert.ok("debounceMs" in cfg);
    assert.ok("_comment_debounceMs" in cfg);
    assert.ok("web" in cfg);
    assert.ok("_comment_web" in cfg);
  });

  test("adds missing web sub-key without disturbing existing sub-keys", () => {
    const home = tmpHome();
    mkdirSync(join(home, ".oni-vision"), { recursive: true });
    // Has web but missing 'host'.
    writeFileSync(
      join(home, ".oni-vision", "config.json"),
      JSON.stringify({
        saveDir: "/saves", outputDir: "/out", includeAutoSaves: false,
        debounceMs: 1500, web: { enabled: true, port: 8080 },
      }, null, 2),
      "utf8"
    );
    const { added } = ensureConfig({ config: BASE_CONFIG, home });
    assert.ok(added.includes("web.host"), "web.host not added");
    const cfg = readConfig(home);
    assert.equal(cfg.web.enabled, true);   // original preserved
    assert.equal(cfg.web.port, 8080);      // original preserved
    assert.equal(cfg.web.host, "127.0.0.1"); // added
  });

  test("preserves existing values for partial field set", () => {
    const home = tmpHome();
    mkdirSync(join(home, ".oni-vision"), { recursive: true });
    writeFileSync(
      join(home, ".oni-vision", "config.json"),
      JSON.stringify({ saveDir: "/my/saves" }, null, 2),
      "utf8"
    );
    ensureConfig({ config: BASE_CONFIG, home });
    const cfg = readConfig(home);
    // Existing value must be untouched.
    assert.equal(cfg.saveDir, "/my/saves");
    // Defaults filled in for the rest.
    assert.equal(cfg.outputDir, BASE_CONFIG.outputDir);
  });

  test("is idempotent — running twice produces the same file", () => {
    const home = tmpHome();
    mkdirSync(join(home, ".oni-vision"), { recursive: true });
    writeFileSync(
      join(home, ".oni-vision", "config.json"),
      JSON.stringify({ saveDir: "/saves" }, null, 2),
      "utf8"
    );
    ensureConfig({ config: BASE_CONFIG, home });
    const after1 = readFileSync(join(home, ".oni-vision", "config.json"), "utf8");
    ensureConfig({ config: BASE_CONFIG, home });
    const after2 = readFileSync(join(home, ".oni-vision", "config.json"), "utf8");
    assert.equal(after1, after2);
  });
});

describe("ensureConfig — malformed JSON", () => {
  test("leaves a malformed config file untouched", () => {
    const home = tmpHome();
    mkdirSync(join(home, ".oni-vision"), { recursive: true });
    const bad = "{ not valid json";
    writeFileSync(join(home, ".oni-vision", "config.json"), bad, "utf8");
    const { created, added } = ensureConfig({ config: BASE_CONFIG, home });
    assert.equal(created, false);
    assert.equal(added.length, 0);
    // File content must be unchanged.
    assert.equal(readFileSync(join(home, ".oni-vision", "config.json"), "utf8"), bad);
  });
});
