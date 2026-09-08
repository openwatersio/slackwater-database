// Node source for the "#neaps.tcdb" subpath import (also what vitest
// resolves). readFileSync returns a Buffer, whose bytes are external memory —
// off the V8 heap — so holding the whole database costs no heap.
//
// The relative path works in both layouts because this module sits one
// directory below the package root in src (src/database/) and the bundle sits
// one below in dist (dist/node/ and dist/browser/), both resolving to a single
// shared generated/neaps.tcdb.
import { readFileSync } from "node:fs";

export default readFileSync(
  new URL("../generated/neaps.tcdb", import.meta.url),
) as Uint8Array;
