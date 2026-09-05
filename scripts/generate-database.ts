// Generates the FlatBuffers database the module reads at runtime.
//
// Emits under src/generated/ (git-ignored, regenerated on build/test):
//   fbs/            flatc-generated TypeScript for schemas/tide-database.fbs
//   stations.neaps  the database file (shipped in dist and as a release asset)
//
// Run with `node --experimental-transform-types` — the generated FlatBuffers
// code uses TypeScript enums, which plain type stripping cannot erase.

import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "src", "generated");

// Generate the FlatBuffers accessors. flatc emits ".js" relative imports;
// rewrite them to ".ts" so node can run this code directly (the repo
// convention for node-run TypeScript — bundlers and vitest resolve it too).
mkdirSync(outDir, { recursive: true });
execFileSync(
  "flatc",
  [
    "--ts",
    "--ts-omit-entrypoint",
    "-o",
    join(outDir, "fbs"),
    "tide-database.fbs",
  ],
  { cwd: join(root, "schemas"), stdio: "inherit" },
);
const fbsDir = join(outDir, "fbs", "neaps");
for (const file of readdirSync(fbsDir)) {
  const path = join(fbsDir, file);
  const source = readFileSync(path, "utf8");
  writeFileSync(path, source.replaceAll(`.js';`, `.ts';`));
}

// The builder imports the code generated above, so load it only now.
const { buildDatabase } = await import("../src/database/builder.ts");

// data/ also holds non-station GeoJSON (e.g. baltic-sea.geo.json, used by the
// chart-datum tooling); only plain .json files are stations. Must stay in sync
// with the import.meta.glob in src/station-bundle.ts so the search indexes
// share the database's station order.
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return p.endsWith(".json") && !p.endsWith(".geo.json") ? [p] : [];
  });
}

const dataDir = join(root, "data");
const stations = walk(dataDir).map((file) => ({
  id: file.slice(dataDir.length + 1).replace(/\.json$/, ""),
  ...JSON.parse(readFileSync(file, "utf8")),
}));

// Fail the build if any subordinate points at a missing reference — otherwise
// it would only surface at prediction time as a runtime error.
const ids = new Set(stations.map((s) => s.id));
for (const s of stations) {
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
const database = buildDatabase(stations, { version });

writeFileSync(join(outDir, "stations.neaps"), database);
console.log(
  `generated stations.neaps: ${(database.length / 1048576).toFixed(1)} MB, ${stations.length} stations`,
);
