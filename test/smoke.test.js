// Wraps the end-to-end smoke run as a node:test entry so `npm test`
// exercises the full extractor -> db -> query pipeline against the
// shared FAKE_SAVE fixture. Output is suppressed so it doesn't clutter
// the test reporter. `npm run smoke` keeps the human-readable mode.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { runSmoke } from "../smoke.mjs";

describe("smoke pipeline", () => {
  test("completes without throwing and writes the expected row counts", () => {
    const result = runSmoke({ silent: true });

    // FAKE_SAVE: 1 dupe, 2 critters (Hatch + Pip), 2 geysers (steam + BigVolcano),
    // 3 buildings (Headquarters pod + BatterySmart + StorageLocker), 1 world
    // object (loose Algae pile), 2 storage_contents rows (Algae + Water
    // inside the StorageLocker).
    assert.equal(result.rowCounts.duplicants, 1);
    assert.equal(result.rowCounts.critters, 2);
    assert.equal(result.rowCounts.geysers, 2);
    assert.equal(result.rowCounts.buildings, 3);
    assert.equal(result.rowCounts.world_objects, 1);
    assert.equal(result.rowCounts.storage_contents, 2);
  });

  test("each representative query returns a parseable result", () => {
    const { queries } = runSmoke({ silent: true });
    // Every query should succeed (no throw) and return an array of rows.
    for (const { query, rows } of queries) {
      assert.ok(Array.isArray(rows), `query did not return rows: ${query}`);
    }
    // Spot-check a couple of specific queries.
    const dupes = queries.find((q) => q.query.startsWith("SELECT name, ROUND(stress"));
    assert.equal(dupes.rows[0].name, "Meep");
    const geyserCounts = queries.find((q) => q.query.includes("v_geysers_summary"));
    // type_id is now a SimHash integer; sort numerically.
    const types = geyserCounts.rows.map((r) => r.type_id).sort((a, b) => a - b);
    assert.deepEqual(types, [-1592417549, -899515856]);
  });
});
