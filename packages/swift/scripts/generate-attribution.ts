// Writes the notice constants from attribution.ts as JSON beside the fixture,
// so the Swift tests can hold StationAttribution's copies to them. Run by
// pretest; the output is git-ignored.

import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LICENSE_NAMES,
  MODIFICATIONS_URL,
  PROJECT_CREDIT,
} from "../../database/src/attribution.ts";

const out = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "Tests",
  "SlackwaterDatabaseTests",
  "attribution.json",
);
writeFileSync(
  out,
  `${JSON.stringify(
    {
      projectCredit: PROJECT_CREDIT,
      modificationsURL: MODIFICATIONS_URL,
      licenseNames: LICENSE_NAMES,
    },
    null,
    2,
  )}\n`,
);
console.log(`generated ${out}`);
