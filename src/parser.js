// Thin wrapper around oni-save-parser.
// parseSaveGame takes an ArrayBuffer and returns a SaveGame object whose shape
// is fully described in node_modules/oni-save-parser/dts/save-structure/.

import { readFile } from "node:fs/promises";
import { parseSaveGame } from "oni-save-parser";

/** Read a .sav file from disk and return the parsed SaveGame object. */
export async function parseSaveFile(filePath) {
  const buf = await readFile(filePath);
  // Node Buffer is a Uint8Array view over an ArrayBuffer; slice to be safe
  // because the underlying buffer may be larger than this Buffer's view.
  const arrayBuffer = buf.buffer.slice(
    buf.byteOffset,
    buf.byteOffset + buf.byteLength
  );
  return parseSaveGame(arrayBuffer);
}
