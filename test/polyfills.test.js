// Locks the util.isObject polyfill in place. Without it, oni-save-parser
// crashes on recent Node with "util_1.isObject is not a function" because
// Node removed the deprecated API. Regression guard: if someone removes
// the polyfill, parser.js stops working in production but smoke + most
// tests still pass (they use FAKE_SAVE, not the real parser). This test
// is the canary.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import "../src/_polyfills.js";
import util from "node:util";

describe("util.isObject polyfill", () => {
  test("isObject is callable after the polyfill loads", () => {
    assert.equal(typeof util.isObject, "function");
  });

  test("returns true for plain objects, arrays, and instances", () => {
    assert.equal(util.isObject({}), true);
    assert.equal(util.isObject({ a: 1 }), true);
    assert.equal(util.isObject([]), true);
    assert.equal(util.isObject(new Date()), true);
  });

  test("returns false for null, primitives, undefined, functions", () => {
    assert.equal(util.isObject(null), false);
    assert.equal(util.isObject(undefined), false);
    assert.equal(util.isObject(42), false);
    assert.equal(util.isObject("hi"), false);
    assert.equal(util.isObject(true), false);
    assert.equal(util.isObject(() => 0), false);
  });

  test("importing parser.js doesn't throw (polyfill is in scope)", async () => {
    // The parser module itself just imports oni-save-parser and exposes
    // parseSaveFile. We're not running it against a real .sav here —
    // just verifying the module loads, which requires util.isObject to
    // be present when oni-save-parser is required.
    await assert.doesNotReject(import("../src/parser.js"));
  });
});
