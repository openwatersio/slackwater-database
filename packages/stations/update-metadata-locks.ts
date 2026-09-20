import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProductionCatalogue } from "./load-catalogue.ts";
import { buildAuditLock, diffAuditLock } from "./position-audit.ts";
import { buildRouteLock, routeHistoryProblems } from "./routes.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const metadataDir = join(root, "metadata");
const catalogue = await loadProductionCatalogue(root);
const routeIds = new Set(
  [...catalogue.routes.tide, ...catalogue.routes.current].flatMap(
    ({ station_ids }) => station_ids,
  ),
);
const routed = catalogue.stations.filter(({ id }) => routeIds.has(id));
const routeLock = buildRouteLock(
  catalogue.members,
  catalogue.previousRouteLock,
);
const routeProblems = routeHistoryProblems(
  catalogue.previousRouteLock,
  routeLock,
  catalogue.previousSlugTable,
  catalogue.gone,
);
if (routeProblems.length)
  throw new Error(`route history would be lost\n${routeProblems.join("\n")}`);
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
for (const id of diff.added) console.log(`added: ${id}`);
for (const { id, was, now } of diff.moved)
  console.log(`moved: ${id} ${was.join(",")} -> ${now.join(",")}`);
for (const id of diff.removed) console.log(`removed: ${id}`);

for (const [name, value] of [
  ["slugs.json", catalogue.slugTable],
  ["slug-tombstones.json", catalogue.slugTombstones],
  ["routes.lock.json", routeLock],
  ["audit.lock.json", auditLock],
] as const)
  writeFileSync(join(metadataDir, name), `${JSON.stringify(value, null, 2)}\n`);
