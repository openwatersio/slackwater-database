// Copies the generated database into dist, where the runtime
// `new URL("../generated/stations.neaps", import.meta.url)` resolves for both
// the Node bundle (dist/node/) and the browser bundle (dist/browser/) — one
// shared copy at dist/generated/.
import { mkdirSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(root, "dist", "generated"), { recursive: true });
copyFileSync(
  join(root, "src", "generated", "stations.neaps"),
  join(root, "dist", "generated", "stations.neaps"),
);
console.log("copied stations.neaps -> dist/generated/");
