// Tests for the daemon-loop parse-recovery contract: a corrupt save must
// not crash the daemon, just log and let the next file event try again.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { safeBuildOutputs } from "../src/pipeline.js";

describe("safeBuildOutputs", () => {
  test("returns { ok: false } for a corrupt save instead of throwing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "oni-pipeline-test-"));
    const savePath = join(dir, "garbage.sav");
    // Random non-ONI bytes — the parser must reject these.
    writeFileSync(savePath, Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x00, 0x01, 0x02]));

    const result = await safeBuildOutputs({ savePath, outputDir: dir });

    assert.equal(result.ok, false);
    assert.ok(result.error instanceof Error);
    // current.sqlite must NOT have been written — the temp dir should
    // contain only the garbage .sav we just dropped in.
    assert.equal(existsSync(join(dir, "current.sqlite")), false,
      "a failed parse must leave no current.sqlite behind");
  });

  test("returns { ok: false } for a missing save file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "oni-pipeline-test-"));
    const result = await safeBuildOutputs({
      savePath: join(dir, "does-not-exist.sav"),
      outputDir: dir,
    });
    assert.equal(result.ok, false);
    assert.ok(result.error instanceof Error);
  });

  test("never throws — the watcher loop relies on this", async () => {
    // The contract is: no input, however bad, makes safeBuildOutputs reject.
    // Empty/null/garbage paths all map to { ok: false }.
    await assert.doesNotReject(async () => {
      const r = await safeBuildOutputs({ savePath: "", outputDir: "" });
      assert.equal(r.ok, false);
    });
  });
});
