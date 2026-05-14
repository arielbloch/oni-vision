// Polyfills for legacy APIs that our dependencies still call.
// Must be imported BEFORE any module that uses the affected APIs.
//
// As of writing, the only such dependency is oni-save-parser, which
// calls `util.isObject` — a Node API deprecated since v4 (DEP0079) and
// finally removed in recent Node versions. The function it expects is
// trivial: `typeof v === "object" && v !== null`.
//
// We mutate the live `node:util` module so that any subsequent
// `require("util")` (oni-save-parser is CommonJS) sees the polyfill.

import util from "node:util";

if (typeof util.isObject !== "function") {
  util.isObject = function isObject(value) {
    return typeof value === "object" && value !== null;
  };
}
