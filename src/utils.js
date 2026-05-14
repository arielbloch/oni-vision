// Shared serialization helpers used by extractors.js (for the JSON columns
// in the behaviors table) and pipeline.js (for the JSON sidecar).

/**
 * JSON.stringify, but tolerant of:
 *   * BigInt values (converted to string),
 *   * circular references (replaced with "[Circular]"),
 *   * ArrayBuffer / typed arrays (replaced with a short marker; the binary
 *     content is not useful in JSON form).
 */
export function safeStringify(value) {
  return JSON.stringify(value, makeReplacer());
}

/**
 * The same logic as a JSON.stringify replacer, exposed for callers that
 * already use JSON.stringify directly (e.g. with a custom indent argument).
 */
export function makeReplacer() {
  const seen = new WeakSet();
  return function replacer(_key, value) {
    if (typeof value === "bigint") return value.toString();
    if (value instanceof ArrayBuffer) return `[ArrayBuffer ${value.byteLength}B]`;
    if (ArrayBuffer.isView(value)) {
      return `[${value.constructor.name} ${value.byteLength}B]`;
    }
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) return "[Circular]";
      seen.add(value);
    }
    return value;
  };
}
