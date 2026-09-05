// Node database source, selected via the "#database-bytes" subpath import (and
// by vitest). readFileSync returns a Buffer, whose bytes are external memory —
// off the V8 heap — so holding the whole database costs no heap.
//
// The relative path works in both layouts because this module sits one
// directory below the package root in src (src/database/) and the bundle sits
// one below in dist (dist/node/ and dist/browser/), both resolving to a single
// shared generated/stations.neaps.
import { readFileSync } from "node:fs";

export function getDatabaseBytes(): Uint8Array | Promise<Uint8Array> {
  return readFileSync(new URL("../generated/stations.neaps", import.meta.url));
}
