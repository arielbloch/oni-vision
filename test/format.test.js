// Contract tests: backend formatMass/formatAge (src/format.js) must produce
// identical output to the browser fmtMass/fmtAge (src/web/app.js) for the
// same inputs. This catches the two implementations drifting apart.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { formatMass, formatAge } from "../src/format.js";

const HERE = dirname(fileURLToPath(import.meta.url));

// Extract the browser fmtMass and fmtAge implementations from app.js by
// running the relevant function bodies in a minimal eval context. This is
// simpler than setting up jsdom — we just need the pure functions.
function extractFn(src, name) {
  const re = new RegExp(`function ${name}\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n\\}`);
  const m = src.match(re);
  if (!m) throw new Error(`Could not extract ${name} from app.js`);
  // eslint-disable-next-line no-new-func
  return new Function(...m[0].match(/^function \w+\(([^)]*)\)/)[1].split(",").map(s => s.trim()), m[1]);
}

const appSrc = readFileSync(join(HERE, "../src/web/app.js"), "utf8");
const fmtMass = extractFn(appSrc, "fmtMass");
const fmtAge  = extractFn(appSrc, "fmtAge");

const MASS_CASES = [
  [0,           "0 kg"],
  [1,           "1 kg"],
  [999,         "999 kg"],
  [1000,        "1.00 t"],
  [1500,        "1.50 t"],
  [999999,      "1000.00 t"],
  [1_000_000,   "1.00 kt"],
  [2_500_000,   "2.50 kt"],
  [null,        "?"],
];

const AGE_CASES = [
  [0,      "0s ago"],
  [89,     "89s ago"],
  [90,     "1m ago"],
  [5399,   "89m ago"],
  [5400,   "1h ago"],
  [86399,  "23h ago"],
  [86400,  "1d ago"],
  [172800, "2d ago"],
  [null,   "unknown"],
];

describe("formatMass contract: backend == frontend", () => {
  for (const [input, expected] of MASS_CASES) {
    test(`formatMass(${input}) === "${expected}"`, () => {
      assert.equal(formatMass(input), expected, "backend mismatch");
      assert.equal(fmtMass(input),   expected, "frontend mismatch");
    });
  }
});

describe("formatAge contract: backend == frontend", () => {
  for (const [input, expected] of AGE_CASES) {
    test(`formatAge(${input}) === "${expected}"`, () => {
      assert.equal(formatAge(input), expected, "backend mismatch");
      assert.equal(fmtAge(input),   expected, "frontend mismatch");
    });
  }
});
