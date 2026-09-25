import { readFileSync } from "node:fs";
import { readStationMeta } from "./database/reader.js";
import type { StationMeta } from "./types.js";

// Build-time only. The search-index macros (src/search/geo.ts and text.ts)
// read station identity from the generated database file, so inclusion and
// order come from the file itself — the same source the runtime reads — with
// nothing to keep in sync against scripts/generate-database.ts. `generate`
// writes the file before the bundlers (and pretest) run this. Never part of a
// runtime bundle: only the macros' string results are inlined.

/** Light metadata for every station, in database order. Used at build time. */
export function loadStationMeta(): StationMeta[] {
  return readStationMeta(
    readFileSync(new URL("./generated/slackwater.tcdb", import.meta.url)),
  );
}
