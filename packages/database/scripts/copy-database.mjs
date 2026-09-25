// Copies the generated database into dist, where the runtime
// `new URL("../generated/slackwater.tcdb", import.meta.url)` resolves for both
// the Node bundle (dist/node/) and the browser bundle (dist/browser/) — one
// shared copy at dist/generated/.
import { mkdirSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(root, "dist", "generated"), { recursive: true });
copyFileSync(
  join(root, "src", "generated", "slackwater.tcdb"),
  join(root, "dist", "generated", "slackwater.tcdb"),
);
console.log("copied slackwater.tcdb -> dist/generated/");
