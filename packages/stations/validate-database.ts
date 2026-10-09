import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProductionCatalogue } from "./load-catalogue.ts";
import { loadCorrections, loadRegistry } from "./metadata.ts";
import { cleanName } from "./name-cleanup.ts";
import {
  auditProblems,
  classifyPosition,
  type AuditLock,
} from "./position-audit.ts";
import { buildRouteLock } from "./routes.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
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
assert.deepEqual(
  catalogue.formerSlugs,
  catalogue.previousFormerSlugs,
  "slug history changed; run npm run metadata:lock",
);

// The generalized maritime boundary can hand a Gulf Islands gauge to
// Washington, and its route path would then read /us/wa/. A CHS station is in
// Canada unless corrections.yaml pins it elsewhere, as it does Saint-Pierre;
// pin a stray one there with `location.countryCode`.
const corrections = loadCorrections(
  readFileSync(join(root, "metadata", "corrections.yaml"), "utf8"),
);
assert.deepEqual(
  catalogue.stations
    .filter(
      ({ id, country_code }) =>
        id.startsWith("chs-") &&
        country_code !== (corrections.get(id)?.location?.countryCode ?? "CA"),
    )
    .map(({ id, country_code }) => `${id} (${country_code})`),
  [],
  "CHS stations resolved outside the country corrections.yaml expects",
);

// A published name is a fixed point of the cleanup, or a regeneration rewrites
// names on its own (#244). A curated name is exempt: it is what the cleanup
// could not produce.
const registry = loadRegistry(
  readFileSync(join(root, "metadata", "registry.yaml"), "utf8"),
);
assert.deepEqual(
  catalogue.stations.flatMap((station) => {
    if (
      !station.name ||
      corrections.get(station.id)?.name ||
      registry.get(station.id)?.name
    )
      return [];
    const again = cleanName(
      station.name,
      station.country,
      station.region_code,
      station.source?.name === "Canadian Hydrographic Service",
    ).name;
    return again === station.name
      ? []
      : [`${station.id}: ${station.name} → ${again}`];
  }),
  [],
  "cleanName rewrites a published name",
);

const routeIds = new Set(
  [...catalogue.routes.tide, ...catalogue.routes.current].flatMap(
    ({ station_ids }) => station_ids,
  ),
);
const routed = catalogue.stations.filter(({ id }) => routeIds.has(id));
assert.deepEqual(
  buildRouteLock(catalogue.members, catalogue.previousRouteLock),
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
if (catalogue.redundantNames.length)
  console.log(
    `${catalogue.redundantNames.length} name corrections match what the cleanup already produces:\n  ${catalogue.redundantNames.join("\n  ")}`,
  );
