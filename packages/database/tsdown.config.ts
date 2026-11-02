import { fileURLToPath } from "node:url";
import { defineConfig } from "tsdown";
import { unrunRunner } from "unplugin-macros";
import macros from "unplugin-macros/rolldown";

// Three builds, differing only in how `#slackwater.tcdb` resolves. The Node and
// browser builds resolve it through package.json `imports` conditions (Node
// loads the shared dist/generated/slackwater.tcdb from disk, the browser
// fetches it, both only when loadStations() is called). The worker build serves
// Cloudflare Workers — selected by the `workerd`/`worker` export conditions —
// which can neither read files nor fetch during module evaluation, so its
// source inlines the database as base64 and decodes it only when loading.
const workerBytes = {
  name: "worker-database-bytes",
  resolveId: (id: string) =>
    id === "#slackwater.tcdb"
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
  plugins: [macros({ runner: unrunRunner() })],
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
    plugins: [workerBytes, macros({ runner: unrunRunner() })],
  },
]);
