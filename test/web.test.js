// Integration tests for src/web.js — spawn the server on a random port,
// hit each endpoint, assert the shape. Uses the FAKE_SAVE fixture to
// populate a current.sqlite in a temp outputDir so the /api/status
// endpoint has real data to return.

import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { extractAll } from "../src/extractors.js";
import { writeDatabase } from "../src/db.js";
import { FAKE_SAVE } from "./fixture.js";
import { startWeb } from "../src/web.js";

let server;
let outputDir;
let baseUrl;

before(async () => {
  outputDir = mkdtempSync(join(tmpdir(), "oni-web-test-"));
  const tables = extractAll(FAKE_SAVE);
  tables.save_meta.push({ key: "parsed_at", value: new Date().toISOString() });
  tables.save_meta.push({ key: "source_file", value: "/tmp/fake.sav" });
  writeDatabase(join(outputDir, "current.sqlite"), tables);

  // Port 0 → OS picks a free one.
  server = await startWeb({ port: 0, host: "127.0.0.1", outputDir });
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(() => {
  if (server) server.close();
});

describe("GET /", () => {
  test("serves the dashboard HTML with sane content-type", async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /text\/html/);
    const body = await res.text();
    assert.match(body, /<!doctype html>/i);
    assert.match(body, /oni-vision/);
  });

  test("/index.html serves the same page", async () => {
    const res = await fetch(`${baseUrl}/index.html`);
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /<!doctype html>/i);
  });

  test("unknown path 404s", async () => {
    const res = await fetch(`${baseUrl}/nope`);
    assert.equal(res.status, 404);
  });
});

describe("GET /api/status", () => {
  test("returns a populated statusObject for an existing DB", async () => {
    const res = await fetch(`${baseUrl}/api/status`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /application\/json/);
    const body = await res.json();

    // Shape: top-level fields + counts + arrays.
    assert.equal(body.base_name, "Test Base");
    assert.equal(body.cycle, 312);
    assert.equal(body.save_version, "7.26");
    assert.ok(body.counts);
    assert.equal(body.counts.duplicants, 1);
    assert.equal(body.counts.critters, 2);
    assert.equal(body.counts.geysers, 2);
    assert.equal(body.counts.buildings, 2);

    // Top sections populated from FAKE_SAVE.
    assert.ok(Array.isArray(body.top_dupes));
    assert.equal(body.top_dupes[0].name, "Meep");
    assert.ok(Array.isArray(body.geyser_types));
    // type_id is now a SimHash integer (-899515856 = "steam")
    assert.ok(body.geyser_types.find((g) => g.type_id === -899515856));
    assert.ok(Array.isArray(body.top_resources));
  });

  test("returns 503 with a structured error when current.sqlite is missing", async () => {
    // Spin up a SECOND server pointing at an empty dir.
    const emptyDir = mkdtempSync(join(tmpdir(), "oni-web-empty-"));
    const s = await startWeb({ port: 0, host: "127.0.0.1", outputDir: emptyDir });
    const u = `http://127.0.0.1:${s.address().port}`;
    try {
      const res = await fetch(`${u}/api/status`);
      assert.equal(res.status, 503);
      const body = await res.json();
      assert.equal(body.error, "no parse yet");
      assert.match(body.db_path, /current\.sqlite$/);
    } finally {
      s.close();
    }
  });

  test("port fallback: binds on next free port when requested port is busy", async () => {
    // Occupy a port, then ask startWeb to use the same port — it should
    // automatically step up and bind successfully.
    const blocker = await startWeb({ port: 0, host: "127.0.0.1", outputDir });
    const blockedPort = blocker.address().port;
    const fallback = await startWeb({ port: blockedPort, host: "127.0.0.1", outputDir });
    try {
      assert.ok(
        fallback.address().port > blockedPort,
        `expected fallback port > ${blockedPort}, got ${fallback.address().port}`
      );
      // Fallback server should still serve the dashboard.
      const res = await fetch(`http://127.0.0.1:${fallback.address().port}/`);
      assert.equal(res.status, 200);
    } finally {
      blocker.close();
      fallback.close();
    }
  });
});
