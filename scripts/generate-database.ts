// Generates the FlatBuffers database the module reads at runtime.
//
// Emits under src/generated/ (git-ignored, regenerated on build/test):
//   fbs/            flatc-generated TypeScript for schemas/database.fbs
//   neaps.tcdb  the database file (shipped in dist and as a release asset)
//
// Run with `node --experimental-transform-types` — the generated FlatBuffers
// code uses TypeScript enums, which plain type stripping cannot erase.

import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import countryLookup from "country-code-lookup";
import currentBundle from "@openwaters/noaa-current-stations/currents.json" with { type: "json" };
import { buildCatalogue } from "../tools/catalogue.ts";
import { currentInputs } from "../tools/current-input.ts";
import { loadGeocoder } from "../tools/geocode.ts";
import { loadCorrections, loadRegistry } from "../tools/metadata.ts";
import type { RouteLock, SlugTable } from "../tools/routes.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "src", "generated");

// Generate the FlatBuffers accessors. flatc emits ".js" relative imports;
// rewrite them to ".ts" so node can run this code directly (the repo
// convention for node-run TypeScript — bundlers and vitest resolve it too).
mkdirSync(outDir, { recursive: true });
execFileSync("flatc", ["--ts", "-o", join(outDir, "fbs"), "database.fbs"], {
  cwd: join(root, "schemas"),
  stdio: "inherit",
});
// Rewrite the entrypoint (fbs/database.ts) and the per-type files it
// re-exports (fbs/neaps/*.ts).
for (const dir of [join(outDir, "fbs"), join(outDir, "fbs", "neaps")]) {
  for (const file of readdirSync(dir)) {
    const path = join(dir, file);
    if (!file.endsWith(".ts")) continue;
    const source = readFileSync(path, "utf8");
    writeFileSync(path, source.replaceAll(`.js';`, `.ts';`));
  }
}

// The builder imports the code generated above, so load it only now.
const { buildDatabase } = await import("../src/database/builder.ts");

// data/ also holds non-station GeoJSON (e.g. baltic-sea.geo.json, used by the
// chart-datum tooling); only plain .json files are stations. This walk is the
// single place that decides what a station is: everything downstream — the
// module, the search indexes, the export pipelines — reads the file it builds.
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return p.endsWith(".json") && !p.endsWith(".geo.json") ? [p] : [];
  });
}

// Quality records ride along in the file (accepted/score inline on Station,
// detail in a Quality table), so the module no longer bundles quality.json.
const quality = new Map<string, { id: string }>(
  JSON.parse(readFileSync(join(root, "quality.json"), "utf8")).map(
    (q: { id: string }) => [q.id, q],
  ),
);

const dataDir = join(root, "data");
function countryCode(id: string, country: string): string {
  const code = countryLookup.byCountry(country)?.iso2;
  if (!code) throw new Error(`${id}: no ISO country code for ${country}`);
  return code;
}

const tides = walk(dataDir).map((file) => {
  const id = file.slice(dataDir.length + 1).replace(/\.json$/, "");
  const source = JSON.parse(readFileSync(file, "utf8"));
  const stationQuality = quality.get(id);
  if (!stationQuality) throw new Error(`${id}: no quality record`);
  return {
    id,
    ...source,
    country_code: countryCode(id, source.country),
    quality: stationQuality,
  };
});

// Fail the build if any subordinate points at a missing reference — otherwise
// it would only surface at prediction time as a runtime error.
const ids = new Set(tides.map((s) => s.id));
for (const s of tides) {
  const reference = s.offsets?.reference;
  if (s.type === "subordinate" && reference && !ids.has(reference)) {
    throw new Error(
      `Station ${s.id} references missing reference station ${reference}`,
    );
  }
}

const { version } = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8"),
);
const metadataDir = join(root, "metadata");
const currents = currentInputs(currentBundle);
const catalogue = buildCatalogue({
  tides,
  currents,
  corrections: loadCorrections(
    readFileSync(join(metadataDir, "corrections.yaml"), "utf8"),
  ),
  registry: loadRegistry(
    readFileSync(join(metadataDir, "registry.yaml"), "utf8"),
  ),
  slugTable: JSON.parse(
    readFileSync(join(metadataDir, "slugs.json"), "utf8"),
  ) as SlugTable,
  routeLock: JSON.parse(
    readFileSync(join(metadataDir, "routes.lock.json"), "utf8"),
  ) as RouteLock,
  geocoder: await loadGeocoder(),
});
const database = buildDatabase(catalogue.stations, {
  version,
  routes: catalogue.routes,
});

writeFileSync(join(outDir, "neaps.tcdb"), database);
const stationCounts = (field: "country_code" | "region_code" | "locality") =>
  catalogue.stations.filter((station) => station[field]).length;
const identityOnly = catalogue.stations.filter(
  ({ id }) => !ids.has(id) && !currents.some((station) => station.id === id),
).length;
console.log(
  [
    `generated neaps.tcdb: ${(database.length / 1048576).toFixed(1)} MB`,
    `${catalogue.stations.length} stations`,
    `${catalogue.stations.filter(({ kind }) => (kind ?? "tide") === "tide").length} tides`,
    `${catalogue.stations.filter(({ kind }) => kind === "current").length} currents`,
    `${identityOnly} identity-only`,
    `${catalogue.routes.tide.length} tide routes`,
    `${catalogue.routes.current.length} current routes`,
    `${stationCounts("country_code")} country codes`,
    `${stationCounts("region_code")} region codes`,
    `${stationCounts("locality")} localities`,
  ].join(", "),
);
