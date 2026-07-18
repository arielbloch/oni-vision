import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { percentPosition, relativeToPod } from "../src/geo.js";

describe("percentPosition", () => {
  test("converts cell coordinates to rounded percent-of-map", () => {
    assert.deepEqual(percentPosition(50, 25, 200, 100), { xPct: 25, yPct: 25 });
  });

  test("clamps out-of-bounds coordinates to [0, 100]", () => {
    assert.deepEqual(percentPosition(-10, 250, 200, 100), { xPct: 0, yPct: 100 });
  });

  test("returns nulls when map dimensions are unknown", () => {
    assert.deepEqual(percentPosition(50, 25, null, null), { xPct: null, yPct: null });
    assert.deepEqual(percentPosition(50, 25, 0, 100), { xPct: null, yPct: null });
  });
});

describe("relativeToPod", () => {
  const W = 200, H = 100; // map dims
  const POD = [100, 50];  // pod at map center

  test("returns null when pod position is unknown (deconstructed)", () => {
    assert.equal(relativeToPod(150, 50, null, null, W, H), null);
  });

  test("returns null when map dimensions are unknown", () => {
    assert.equal(relativeToPod(150, 50, ...POD, null, null), null);
  });

  test("very close to the pod on both axes reads 'At the pod'", () => {
    assert.equal(relativeToPod(102, 51, ...POD, W, H), "At the pod");
  });

  test("horizontal only (vertical under 5% is dropped), slightly right", () => {
    // dx=20 -> nx=0.10 (>0.05, <0.15); dy=0
    assert.equal(relativeToPod(120, 50, ...POD, W, H), "Slightly right of pod");
  });

  test("horizontal only, plain right", () => {
    // dx=40 -> nx=0.20 (>=0.15, <0.35)
    assert.equal(relativeToPod(140, 50, ...POD, W, H), "Right of pod");
  });

  test("horizontal only, far right", () => {
    // dx=90 -> nx=0.45 (>=0.35)
    assert.equal(relativeToPod(190, 50, ...POD, W, H), "Far right of pod");
  });

  test("horizontal only, left", () => {
    assert.equal(relativeToPod(60, 50, ...POD, W, H), "Left of pod");
  });

  test("vertical only (no 'of'), slightly above", () => {
    // dy=8 -> ny=0.08 (>0.05, <0.15); dx=0
    assert.equal(relativeToPod(100, 58, ...POD, W, H), "Slightly above pod");
  });

  test("vertical only, plain below", () => {
    // dy=-20 -> ny=-0.20 (>=0.15, <0.35)
    assert.equal(relativeToPod(100, 30, ...POD, W, H), "Below pod");
  });

  test("vertical only, far above", () => {
    // dy=45 -> ny=0.45 (>=0.35)
    assert.equal(relativeToPod(100, 95, ...POD, W, H), "Far above pod");
  });

  test("combines both axes when both are >= 5%", () => {
    // dx=20 -> nx=0.10 (slightly); dy=15 -> ny=0.15 (plain)
    assert.equal(relativeToPod(120, 65, ...POD, W, H), "Above and slightly right of pod");
  });

  test("combines both axes, matching the requested example phrasing", () => {
    // dx=-20 -> nx=-0.10 (slightly left); dy=30 -> ny=0.30 (plain above)
    assert.equal(relativeToPod(80, 80, ...POD, W, H), "Above and slightly left of pod");
  });

  test("combines both axes with independent tiers (far + slightly)", () => {
    // dx=90 -> nx=0.45 (far right); dy=-8 -> ny=-0.08 (slightly below)
    assert.equal(relativeToPod(190, 42, ...POD, W, H), "Slightly below and far right of pod");
  });
});
