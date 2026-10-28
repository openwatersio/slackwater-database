/**
 * Snapshot a CHS current results release into
 * metadata/chs-current-validation/<tag>.json: its release, stamp, engine,
 * scorer, database and newest fields, and each gate's `chs_fit` alone. Station
 * files cite the snapshot in `chs_fit.evidence`, and `npm run validate` checks
 * them against it.
 *
 * Run manually, review the diff, and commit the snapshot:
 *   npm run refresh:chs-fit -w packages/stations -- <tag>
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSnapshot, type Dispositions } from "./chs-fit-snapshot.ts";
import { CHS_FIT_EVIDENCE } from "./station-files.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(root, "metadata", "chs-current-validation");
const RELEASES =
  "https://github.com/openwatersio/chs-current-validation/releases/download";

async function main() {
  const tag = process.argv[2];
  if (!tag || !CHS_FIT_EVIDENCE.test(tag))
    throw new Error(
      `usage: npm run refresh:chs-fit -w packages/stations -- <tag>, a results release tag like fit-2026-10-22-8f85912-r2 (got ${tag})`,
    );
  const url = `${RELEASES}/${tag}/dispositions.json`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const source = (await response.json()) as Dispositions;
  let snapshot;
  try {
    snapshot = buildSnapshot(source, tag);
  } catch (error) {
    throw new Error(`${url} ${error instanceof Error ? error.message : error}`);
  }
  mkdirSync(OUT, { recursive: true });
  const path = join(OUT, `${tag}.json`);
  writeFileSync(path, JSON.stringify(snapshot, null, 2) + "\n");
  console.log(
    `wrote ${Object.keys(snapshot["gates"] as object).length} gates to ${path}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
