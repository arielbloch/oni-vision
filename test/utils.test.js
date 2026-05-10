// Tests for src/utils.js — JSON safety helpers.
// Verifies handling of bigints, circular references, and typed arrays
// — the three categories that JSON.stringify chokes on natively.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { safeStringify, makeReplacer } from "../src/utils.js";

describe("safeStringify", () => {
  test("plain values round-trip via JSON.parse", () => {
    const input = { a: 1, b: "two", c: true, d: null, e: [1, 2] };
    assert.deepEqual(JSON.parse(safeStringify(input)), input);
  });

  test("converts bigints to strings", () => {
    const out = safeStringify({ big: 9007199254740993n });
    assert.equal(JSON.parse(out).big, "9007199254740993");
  });

  test("replaces ArrayBuffer with a marker", () => {
    const buf = new ArrayBuffer(8);
    const out = safeStringify({ data: buf });
    assert.match(JSON.parse(out).data, /^\[ArrayBuffer 8B\]$/);
  });

  test("replaces typed arrays with a marker including their constructor name", () => {
    const arr = new Uint8Array([1, 2, 3, 4]);
    const out = safeStringify({ data: arr });
    assert.match(JSON.parse(out).data, /^\[Uint8Array 4B\]$/);
  });

  test("breaks circular references with [Circular]", () => {
    const a = { name: "a" };
    a.self = a;
    const out = safeStringify(a);
    assert.match(out, /\[Circular\]/);
  });

  test("does not throw on a deeply nested non-circular object", () => {
    let nest = { v: 0 };
    for (let i = 1; i < 30; i++) nest = { v: i, child: nest };
    assert.doesNotThrow(() => safeStringify(nest));
  });
});

describe("makeReplacer", () => {
  test("each call returns a fresh replacer with its own seen-set", () => {
    const a = { x: 1 };
    a.self = a;
    // Stringify once with one replacer.
    JSON.stringify(a, makeReplacer());
    // Stringifying with a fresh replacer must NOT think 'a' was already seen.
    const out = JSON.stringify(a, makeReplacer());
    assert.match(out, /\[Circular\]/);
    // The top-level 'a' itself is the first time we see it; only its
    // self-reference should be flagged.
    assert.equal(out.match(/\[Circular\]/g).length, 1);
  });
});
