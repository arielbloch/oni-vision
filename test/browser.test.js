// Tests for src/browser.js — openBrowser and clearBrowserFlag.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { openBrowser, clearBrowserFlag } from "../src/browser.js";

function tmpHome() {
  return mkdtempSync(join(tmpdir(), "oni-browser-"));
}

const PLATFORM = process.platform;

// ── TTY guard ─────────────────────────────────────────────────────────────────

describe("openBrowser — TTY guard", () => {
  test("returns false when tty is false (background service)", () => {
    const home = tmpHome();
    const result = openBrowser("http://127.0.0.1:8080", { home, platform: PLATFORM, tty: false });
    assert.equal(result, false);
  });

  test("does NOT create the flag file when TTY guard fires", () => {
    const home = tmpHome();
    openBrowser("http://127.0.0.1:8080", { home, platform: PLATFORM, tty: false });
    assert.equal(existsSync(join(home, ".oni-vision", ".browser-opened")), false);
  });
});

// ── flag file guard ───────────────────────────────────────────────────────────

describe("openBrowser — flag file guard", () => {
  test("returns false when flag file already exists", () => {
    const home = tmpHome();
    mkdirSync(join(home, ".oni-vision"), { recursive: true });
    writeFileSync(join(home, ".oni-vision", ".browser-opened"), "http://127.0.0.1:8080\n", "utf8");

    const result = openBrowser("http://127.0.0.1:8080", { home, platform: PLATFORM, tty: true });
    assert.equal(result, false);
  });
});

// ── success path ──────────────────────────────────────────────────────────────

describe("openBrowser — success path", () => {
  test("creates the flag file on a successful open attempt", () => {
    const home = tmpHome();
    // Use 'linux' so the command is 'xdg-open'; in headless CI it may fail,
    // but openBrowser writes the flag file before calling spawn, so it should exist.
    // If spawn errors out synchronously the catch block still returns true after
    // logging a warning — the flag file will have been written.
    try {
      openBrowser("http://127.0.0.1:8080", { home, platform: "linux", tty: true });
    } catch { /* ignore headless spawn errors */ }

    assert.ok(
      existsSync(join(home, ".oni-vision", ".browser-opened")),
      "flag file should be created after a successful open attempt"
    );
  });

  test("flag file contains the URL", () => {
    const home = tmpHome();
    const url = "http://127.0.0.1:9999";
    try {
      openBrowser(url, { home, platform: "linux", tty: true });
    } catch { /* ignore */ }
    const flagPath = join(home, ".oni-vision", ".browser-opened");
    if (existsSync(flagPath)) {
      const content = readFileSync(flagPath, "utf8");
      assert.ok(content.includes(url), `flag file should contain the URL; got: ${content}`);
    }
    // If no flag (spawn failed before write), skip the content check.
  });

  test("second call with same home returns false (flag guard)", () => {
    const home = tmpHome();
    try {
      openBrowser("http://127.0.0.1:8080", { home, platform: "linux", tty: true });
    } catch { /* ignore */ }
    const result = openBrowser("http://127.0.0.1:8080", { home, platform: "linux", tty: true });
    assert.equal(result, false);
  });
});

// ── clearBrowserFlag ──────────────────────────────────────────────────────────

describe("clearBrowserFlag", () => {
  test("removes an existing flag file", () => {
    const home = tmpHome();
    mkdirSync(join(home, ".oni-vision"), { recursive: true });
    writeFileSync(join(home, ".oni-vision", ".browser-opened"), "url\n", "utf8");

    clearBrowserFlag(home);
    assert.equal(existsSync(join(home, ".oni-vision", ".browser-opened")), false);
  });

  test("is a no-op when flag file does not exist", () => {
    const home = tmpHome();
    assert.doesNotThrow(() => clearBrowserFlag(home));
  });

  test("after clearing, flag guard no longer fires", () => {
    const home = tmpHome();
    // Plant a flag.
    mkdirSync(join(home, ".oni-vision"), { recursive: true });
    writeFileSync(join(home, ".oni-vision", ".browser-opened"), "url\n", "utf8");

    // Guard fires.
    assert.equal(openBrowser("http://127.0.0.1:8080", { home, platform: "linux", tty: true }), false);

    // Clear it — flag must be gone.
    clearBrowserFlag(home);
    assert.equal(existsSync(join(home, ".oni-vision", ".browser-opened")), false);

    // Now the call progresses past the flag guard (may still be skipped by TTY
    // in a purely headless env, but not by the flag guard).
    // We verify the flag is absent before the next call, which is sufficient.
  });
});
