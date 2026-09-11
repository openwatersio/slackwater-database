import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProductionCatalogue } from "../tools/load-catalogue.ts";
import {
  auditProblems,
  classifyPosition,
  type AuditLock,
} from "../tools/position-audit.ts";
import { buildRouteLock } from "../tools/routes.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const catalogue = await loadProductionCatalogue(root);
assert.deepEqual(
  catalogue.slugTable,
  catalogue.previousSlugTable,
  "slug allocations changed; run npm run metadata:lock",
);
assert.deepEqual(
  catalogue.slugTombstones,
  catalogue.previousSlugTombstones,
  "slug tombstones changed; run npm run metadata:lock",
);

const routeIds = new Set(
  [...catalogue.routes.tide, ...catalogue.routes.current].flatMap(
    ({ station_ids }) => station_ids,
  ),
);
const routed = catalogue.stations.filter(({ id }) => routeIds.has(id));
const members = routed.map((station) => {
  const kind = station.kind ?? "tide";
  return {
    id: station.id,
    kind,
    slug: catalogue.slugTable[kind][station.id]!,
    country_code: station.country_code,
    region_code: station.region_code,
    former_slugs: station.former_slugs,
  };
});
assert.deepEqual(
  buildRouteLock(members, catalogue.previousRouteLock),
  catalogue.previousRouteLock,
  "route paths changed; run npm run metadata:lock",
);

const auditLock = JSON.parse(
  readFileSync(join(root, "metadata", "audit.lock.json"), "utf8"),
) as AuditLock;
const coastline = readFileSync(join(root, "metadata", "coastline.geojson"));
assert.equal(
  auditLock.coastline,
  `sha256-${createHash("sha256").update(coastline).digest("hex")}`,
  "coastline changed; run npm run metadata:lock",
);
const problems = auditProblems(auditLock, routed);
if (problems.length)
  throw new Error(
    `station position audit changed; run npm run metadata:lock\n${problems.join("\n")}`,
  );
const audited = routed.map((station) => ({
  station,
  result: classifyPosition(station),
}));

const missingLocality = routed.filter(({ locality }) => !locality).length;
const missingRegion = routed.filter(({ region_code }) => !region_code).length;
const ashore = audited.filter(
  ({ result }) => result.verdict === "ashore",
).length;
const uncovered = audited.filter(
  ({ result }) => result.verdict === "unverifiable",
).length;
console.log(
  `validated ${catalogue.stations.length} stations and ${routeIds.size} routed records; warnings: ${missingLocality} without locality, ${missingRegion} without region code, ${ashore} pinned ashore, ${uncovered} outside coastline coverage`,
);
