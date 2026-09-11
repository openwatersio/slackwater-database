import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProductionCatalogue } from "../tools/load-catalogue.ts";
import { buildAuditLock, diffAuditLock } from "../tools/position-audit.ts";
import { buildRouteLock } from "../tools/routes.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const metadataDir = join(root, "metadata");
const catalogue = await loadProductionCatalogue(root);
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
const routeLock = buildRouteLock(members, catalogue.previousRouteLock);
const coastlineBytes = readFileSync(join(metadataDir, "coastline.geojson"));
const auditLock = buildAuditLock(
  routed,
  `sha256-${createHash("sha256").update(coastlineBytes).digest("hex")}`,
);
const previousAudit = JSON.parse(
  readFileSync(join(metadataDir, "audit.lock.json"), "utf8"),
);
const diff = diffAuditLock(previousAudit, routed);
console.log(
  `metadata locks: ${diff.added.length} added, ${diff.moved.length} moved, ${diff.removed.length} removed`,
);

for (const [name, value] of [
  ["slugs.json", catalogue.slugTable],
  ["slug-tombstones.json", catalogue.slugTombstones],
  ["routes.lock.json", routeLock],
  ["audit.lock.json", auditLock],
] as const)
  writeFileSync(join(metadataDir, name), `${JSON.stringify(value, null, 2)}\n`);
