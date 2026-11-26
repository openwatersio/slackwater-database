// Copies the generated database into dist, where the runtime
// `new URL("../generated/slackwater.tcdb", import.meta.url)` resolves for both
// the Node bundle (dist/node/) and the browser bundle (dist/browser/) — one
// shared copy at dist/generated/.
import { mkdirSync, copyFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(root, "dist", "generated"), { recursive: true });
copyFileSync(
  join(root, "src", "generated", "slackwater.tcdb"),
  join(root, "dist", "generated", "slackwater.tcdb"),
);
console.log("copied slackwater.tcdb -> dist/generated/");

const countryData = dirname(
  createRequire(import.meta.url).resolve("@openwaters/c5y-n8r/data"),
);
for (const [source, target] of [
  ["countries.crdb", "countries.crdb"],
  ["evidence.json", "country-evidence.json"],
  ["release.json", "country-release.json"],
  ["../DATA_LICENSE.md", "COUNTRY_DATA_LICENSE.md"],
  ["../LICENSE", "C5Y_N8R_LICENSE"],
  ...[
    "manifest.json",
    "reviewed-overrides.json",
    "review-approvals.json",
    "override-activation.json",
    "licenses/country-code-lookup-MIT.txt",
  ].map((file) => [`../sources/${file}`, `sources/${file}`]),
]) {
  mkdirSync(dirname(join(root, "dist", "generated", target)), {
    recursive: true,
  });
  copyFileSync(
    join(countryData, source),
    join(root, "dist", "generated", target),
  );
}
