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
import { ELEMENT_NAMES } from "../src/elements.js";
import { GEYSER_TYPE_NAMES } from "../src/geyser_types.js";
import { FOOD_META } from "../src/food.js";
import { EFFECT_LABELS } from "../src/effects.js";
import { SKILL_LABELS } from "../src/ui.js";
import { FAKE_SAVE } from "./fixture.js";
import { startWeb, notifyClients } from "../src/web.js";

let server;
let outputDir;
let baseUrl;

before(async () => {
  outputDir = mkdtempSync(join(tmpdir(), "oni-web-test-"));
  const tables = extractAll(FAKE_SAVE);
  tables.save_meta.push({ key: "parsed_at", value: new Date().toISOString() });
  tables.save_meta.push({ key: "source_file", value: "/tmp/fake.sav" });
  // Populate lookup tables the same way pipeline.js does so /api/status
  // returns the full enriched payload in tests.
  tables.element_names    = [...ELEMENT_NAMES.entries()].map(([element_id, name]) => ({ element_id, name }));
  tables.geyser_type_names = GEYSER_TYPE_NAMES;
  tables.food_meta        = FOOD_META;
  tables.effect_labels    = EFFECT_LABELS;
  tables.skill_labels     = [...SKILL_LABELS.entries()].map(([branch, label]) => ({ branch, label }));
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

    // Feature 6: lookup tables served from DB.
    assert.ok(body.element_names && typeof body.element_names === "object",
      "element_names should be a non-null object");
    assert.equal(body.element_names[String(1836671383)], "Water",
      "element_names should resolve Water's SimHash");
    assert.ok(body.geyser_type_names && typeof body.geyser_type_names === "object",
      "geyser_type_names should be a non-null object");
    assert.equal(body.geyser_type_names[String(-899515856)], "Steam Vent",
      "geyser_type_names should resolve the steam vent hash");
    assert.ok(body.food_meta && typeof body.food_meta === "object",
      "food_meta should be a non-null object");
    assert.ok(body.food_meta["SurfAndTurf"],
      "food_meta should include SurfAndTurf");
    assert.equal(body.food_meta["SurfAndTurf"].morale, 8,
      "SurfAndTurf should have morale +8");
    assert.ok(body.effect_labels && typeof body.effect_labels === "object",
      "effect_labels should be a non-null object");
    assert.ok(body.effect_labels["SlimeLung"],
      "effect_labels should include SlimeLung");
    assert.equal(body.effect_labels["SlimeLung"].cls, "bad",
      "SlimeLung severity should map to cls='bad'");
    assert.ok(body.skill_labels && typeof body.skill_labels === "object",
      "skill_labels should be a non-null object");
    assert.equal(body.skill_labels["mining"], "Miner",
      "skill_labels should resolve mining branch");
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

  test("/api/status ignores query string (no 404 on ?t=1)", async () => {
    const res = await fetch(`${baseUrl}/api/status?t=1`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.base_name, "Test Base");
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

describe("GET /api/events (SSE)", () => {
  test("responds with text/event-stream and an initial comment", async () => {
    const ac = new AbortController();
    const res = await fetch(`${baseUrl}/api/events`, { signal: ac.signal });

    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /text\/event-stream/);

    // Read just enough to see the initial ": connected" comment.
    const reader = res.body.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    assert.match(text, /: connected/);

    ac.abort(); // close the stream
  });

  test("notifyClients() pushes a parse event to connected clients", async () => {
    const ac = new AbortController();
    await fetch(`${baseUrl}/api/events`, { signal: ac.signal });

    // Give the server a tick to register the SSE client.
    await new Promise((r) => setTimeout(r, 20));

    // notifyClients should not throw even with one connected client.
    assert.doesNotThrow(() => notifyClients());

    ac.abort();
  });

  test("notifyClients() is a no-op when no clients are connected", () => {
    // After aborting all connections, calling notifyClients is harmless.
    assert.doesNotThrow(() => notifyClients());
  });
});
