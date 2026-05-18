// Integration tests for src/web.js — spawn the server on a random port,
// hit each endpoint, assert the shape. Uses the FAKE_SAVE fixture to
// populate a current.sqlite in a temp outputDir so the /api/status
// endpoint has real data to return.

import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeDatabase } from "../src/db.js";
import { buildFakeTables, buildEmptyTables } from "./helpers.js";
import { startWeb, notifyClients } from "../src/web.js";

let server;
let outputDir;
let baseUrl;

before(async () => {
  outputDir = mkdtempSync(join(tmpdir(), "oni-web-test-"));
  const tables = buildFakeTables();
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

  test("/app.js serves with application/javascript content-type", async () => {
    const res = await fetch(`${baseUrl}/app.js`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /javascript/);
    const body = await res.text();
    assert.match(body, /refresh/); // app.js defines a refresh() function
  });

  test("/styles.css serves with text/css content-type", async () => {
    const res = await fetch(`${baseUrl}/styles.css`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /text\/css/);
    const body = await res.text();
    assert.match(body, /--bg/); // styles.css defines CSS custom properties
  });

  test("unknown path 404s", async () => {
    const res = await fetch(`${baseUrl}/nope`);
    assert.equal(res.status, 404);
  });

  test("non-GET method returns 405 with Allow: GET header", async () => {
    const res = await fetch(`${baseUrl}/api/status`, { method: "POST" });
    assert.equal(res.status, 405);
    assert.equal(res.headers.get("allow"), "GET");
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
    assert.ok(Array.isArray(body.geysers), "per-geyser detail should be an array under `geysers`");
    // type_id is now a SimHash integer (-899515856 = "steam")
    assert.ok(body.geysers.find((g) => g.type_id === -899515856));
    assert.ok(Array.isArray(body.top_resources));

    // Feature 6: lookup tables served from DB.
    assert.ok(body.elements && typeof body.elements === "object",
      "elements should be a non-null object");
    assert.equal(body.elements[String(1836671383)], "Water",
      "elements should resolve Water's SimHash");
    // body.geyser_types is the lookup map (type_id → name); per-geyser detail
    // lives under body.geysers. Both must be present.
    assert.equal(typeof body.geyser_types, "object",
      "geyser_types should be a non-null lookup map");
    assert.ok(!Array.isArray(body.geyser_types),
      "geyser_types must be a map, not an array (per-geyser detail moved to body.geysers)");
    assert.equal(body.geyser_types[String(-899515856)], "Steam Vent",
      "geyser_types should resolve the steam vent hash");
    assert.ok(body.foods && typeof body.foods === "object",
      "foods should be a non-null object");
    assert.ok(body.foods["SurfAndTurf"],
      "foods should include SurfAndTurf");
    assert.equal(body.foods["SurfAndTurf"].morale, 4,
      "SurfAndTurf should have morale +4");
    assert.ok(body.effects && typeof body.effects === "object",
      "effects should be a non-null object");
    assert.ok(body.effects["SlimeLung"],
      "effects should include SlimeLung");
    assert.equal(body.effects["SlimeLung"].cls, "bad",
      "SlimeLung severity should map to cls='bad'");
    assert.ok(body.skills && typeof body.skills === "object",
      "skills should be a non-null object");
    assert.equal(body.skills["mining"], "Miner",
      "skills should resolve mining branch");
    assert.ok(body.chore_groups && typeof body.chore_groups === "object",
      "chore_groups should be a non-null object");
    assert.ok(body.chore_groups["Combat"],
      "chore_groups should include Combat");
    assert.equal(body.chore_groups["Combat"].domain, "tangerine",
      "chore_groups.Combat.domain should be 'tangerine'");
    assert.equal(body.chore_groups["Combat"].abbr, "Atk",
      "chore_groups.Combat.abbr should be 'Atk'");
    assert.equal(body.chore_groups["Combat"].sort_order, 1,
      "chore_groups.Combat.sort_order should be 1");

    // Thresholds block.
    assert.ok(body.thresholds && typeof body.thresholds === "object",
      "thresholds should be a non-null object");
    assert.equal(body.thresholds.stale_after_s, 600,
      "stale_after_s should be 600 seconds");
    assert.equal(body.thresholds.morale_bar_max, 20,
      "morale_bar_max should be 20");
    assert.equal(body.thresholds.stress_bad, 60,
      "stress_bad should be 60");

    // morale_cost on top_dupes.
    const meep = body.top_dupes.find(d => d.name === "Meep");
    assert.ok(meep, "Meep should be in top_dupes");
    assert.equal(meep.morale_cost, 1,
      "Meep has Mining1 mastered → morale_cost = 1");
  });

  test("empty colony (0 dupes, 0 geysers, 0 storage) returns valid shape, not 500", async () => {
    const dir = mkdtempSync(join(tmpdir(), "oni-web-empty-colony-"));
    writeDatabase(join(dir, "current.sqlite"), buildEmptyTables());
    const s = await startWeb({ port: 0, host: "127.0.0.1", outputDir: dir });
    try {
      const res = await fetch(`http://127.0.0.1:${s.address().port}/api/status`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.base_name, "Empty Colony");
      assert.equal(body.cycle, 1);
      assert.equal(body.counts.duplicants, 0);
      assert.equal(body.counts.geysers, 0);
      assert.equal(body.counts.buildings, 0);
      // Empty arrays must be arrays, not nulls — the FE iterates them.
      assert.ok(Array.isArray(body.top_dupes), "top_dupes must be an array");
      assert.equal(body.top_dupes.length, 0);
      assert.ok(Array.isArray(body.geysers), "per-geyser detail should be empty array");
      assert.equal(body.geysers.length, 0);
      assert.ok(Array.isArray(body.food));
      assert.equal(body.food.length, 0);
      assert.ok(Array.isArray(body.all_resources));
      assert.equal(body.all_resources.length, 0);
      // Lookup tables and thresholds still come through even with no save data.
      assert.ok(body.elements && Object.keys(body.elements).length > 0,
        "lookup tables must populate even for empty colonies");
      assert.ok(body.thresholds);
    } finally {
      s.close();
    }
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

  test("connected client actually receives the parse event", async () => {
    const ac = new AbortController();
    const res = await fetch(`${baseUrl}/api/events`, { signal: ac.signal });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    // Drain the initial ": connected" comment.
    await reader.read();

    // Trigger a push after the client is registered.
    await new Promise((r) => setTimeout(r, 20));
    notifyClients();

    // Read until we either see the parse event or hit a 1s deadline.
    const deadline = Date.now() + 1000;
    let buffer = "";
    while (!buffer.includes("event: parse") && Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
    }
    assert.match(buffer, /event: parse/, "client should receive the parse event");

    ac.abort();
  });

  test("notifyClients() is a no-op when no clients are connected", () => {
    // After aborting all connections, calling notifyClients is harmless.
    assert.doesNotThrow(() => notifyClients());
  });
});
