/**
 * Check every snapshot in metadata/chs-current-validation/ that a station file
 * cites against the release it names: download that tag's dispositions.json, build the snapshot from it
 * as refresh:chs-fit does, and compare with the committed file. Exits 1 on a
 * mismatch or a missing release; a network error or timeout warns and exits 0.
 *   npm run validate:chs-fit -w packages/stations
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildSnapshot,
  classifyStatus,
  snapshotsToVerify,
  snapshotDifferences,
  type Dispositions,
} from "./chs-fit-snapshot.ts";
import { readStationFiles } from "./station-files.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIR = join(root, "metadata", "chs-current-validation");
const RELEASES =
  "https://github.com/openwatersio/chs-current-validation/releases/download";

const failures: string[] = [];
const committed = readdirSync(DIR)
  .filter((n) => n.endsWith(".json"))
  .map((n) => n.slice(0, -".json".length))
  .sort();
const { verify, skipped } = snapshotsToVerify(committed, readStationFiles());
for (const tag of skipped)
  console.log(`skipped ${tag}: no station file cites it`);
for (const tag of verify) {
  const file = `metadata/chs-current-validation/${tag}.json`;
  const url = `${RELEASES}/${tag}/dispositions.json`;
  let source: Dispositions;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    const status = classifyStatus(response.status);
    if (status === "missing") {
      failures.push(
        `${file}: release ${tag} has no dispositions.json (HTTP 404)`,
      );
      continue;
    }
    if (status === "unreachable") throw new Error(`HTTP ${response.status}`);
    source = (await response.json()) as Dispositions;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(
      `::warning::Could not check ${file} against ${tag}: ${message}`,
    );
    continue;
  }
  try {
    const built = buildSnapshot(source, tag);
    const old = JSON.parse(readFileSync(join(DIR, `${tag}.json`), "utf8"));
    for (const difference of snapshotDifferences(old, built))
      failures.push(`${file}: differs from release ${tag}: ${difference}`);
  } catch (error) {
    failures.push(`${file}: ${error instanceof Error ? error.message : error}`);
  }
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
