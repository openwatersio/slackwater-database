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
import { loadProductionCatalogue } from "@neaps/stations";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "src", "generated");

// Generate the FlatBuffers accessors. flatc emits ".js" relative imports;
// rewrite them to ".ts" so node can run this code directly (the repo
// convention for node-run TypeScript — bundlers and vitest resolve it too).
mkdirSync(outDir, { recursive: true });
for (const schema of ["database.fbs", "rws-predictions.fbs"]) {
  execFileSync("flatc", ["--ts", "-o", join(outDir, "fbs"), schema], {
    cwd: join(root, "..", "..", "schemas"),
    stdio: "inherit",
  });
}

function rewriteImports(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) rewriteImports(path);
    else if (entry.name.endsWith(".ts")) {
      const source = readFileSync(path, "utf8");
      writeFileSync(path, source.replaceAll(`.js';`, `.ts';`));
    }
  }
}
rewriteImports(join(outDir, "fbs"));

// The builder imports the code generated above, so load it only now.
const { buildDatabase } = await import("../src/database/builder.ts");

const { version } = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8"),
);
// The catalogue reads data/, quality.json, and metadata/ from the repo root.
const catalogue = await loadProductionCatalogue(join(root, "..", ".."));
const database = buildDatabase(catalogue.stations, {
  version,
  routes: catalogue.routes,
});

writeFileSync(join(outDir, "neaps.tcdb"), database);
const stationCounts = (field: "country_code" | "region_code" | "locality") =>
  catalogue.stations.filter((station) => station[field]).length;
const identityOnly = catalogue.stations.filter(
  ({ id }) =>
    !catalogue.providerTideIds.has(id) && !catalogue.providerCurrentIds.has(id),
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
