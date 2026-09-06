import { fileURLToPath } from "node:url";
import { defineConfig } from "tsdown";
import macros from "unplugin-macros/rolldown";

// Three builds, differing only in how `#database-bytes` resolves. The Node and
// browser builds resolve it through package.json `imports` conditions (Node
// reads the shared dist/generated/stations.neaps from disk, the browser
// fetches it). The worker build serves Cloudflare Workers — selected by the
// `workerd`/`worker` export conditions — which can neither read files nor
// fetch during module evaluation, so its source inlines the database into the
// bundle as base64.
const workerBytes = {
  name: "worker-database-bytes",
  resolveId: (id: string) =>
    id === "#database-bytes"
      ? fileURLToPath(
          new URL("./src/database/bytes.worker.ts", import.meta.url),
        )
      : undefined,
};

const base = {
  entry: ["./src/index.ts"],
  dts: true,
  minify: true,
  sourcemap: true,
  target: "es2020",
  plugins: [macros()],
};

// ESM only. kdbush and geokdbush are ESM-only, so a CJS build can't require them
// cleanly; all first-party consumers use ESM.
export default defineConfig([
  { ...base, platform: "neutral", format: ["esm"], outDir: "dist/node" },
  { ...base, platform: "browser", format: ["esm"], outDir: "dist/browser" },
  {
    ...base,
    platform: "browser",
    format: ["esm"],
    outDir: "dist/worker",
    plugins: [workerBytes, macros()],
  },
]);
