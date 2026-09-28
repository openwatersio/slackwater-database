/**
 * One-time: write stations.json from Slackwater iOS's shipped
 * Slackwater/Resources/chs-stations.json, the only source that carries the
 * ids already stored on devices. Kept as the record of where the ids came from.
 *
 *   npm run seed -w sources/chs -- <path to chs-stations.json>
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { seedStations, type ChsStation } from "./chs.ts";

const here = dirname(fileURLToPath(import.meta.url));
const appFile = process.argv[2];
if (!appFile) throw new Error("usage: seed.ts <chs-stations.json>");

const app = JSON.parse(readFileSync(appFile, "utf8")) as ChsStation[];
const tombstones = JSON.parse(
  readFileSync(
    join(here, "..", "..", "metadata", "slug-tombstones.json"),
    "utf8",
  ),
) as { tide: Record<string, string> };
const reserved = new Set(
  Object.keys(tombstones.tide).filter((id) => id.startsWith("chs-")),
);

const stations = seedStations(app, reserved);
const seeded = new Set(stations.map(({ id }) => id));
const missing = [...reserved].filter((id) => !seeded.has(id));
assert.deepEqual(missing, [], "reserved CHS ids missing from the app bundle");

writeFileSync(
  join(here, "stations.json"),
  JSON.stringify(stations, null, 2) + "\n",
);
console.log(
  `${stations.length} of ${app.length} app stations hold a reserved slug; wrote stations.json`,
);
