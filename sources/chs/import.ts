/**
 * Refresh stations.json from IWLS. Run by hand and review the diff; the
 * prediction probe takes about 20 minutes.
 *
 *   npm run import -w sources/chs [-- --prune]
 *
 * A station IWLS no longer lists or serves is kept and reported. Removing one
 * tombstones its slug and retires its id for good, so it takes --prune.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRegistry } from "@slackwater/stations";
import { reconcile, type ChsStation, type IwlsStation } from "./chs.ts";

const here = dirname(fileURLToPath(import.meta.url));
const metadata = join(here, "..", "..", "metadata");
const IWLS = "https://api-iwls.dfo-mpo.gc.ca/api/v1/stations";
// IWLS rate-limits well inside a second; Slackwater's generator settled on this.
const PROBE_SPACING_MS = 1200;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * IWLS advertises `wlp` for stations it serves no predictions for, so the only
 * reliable test is asking for one hour of them.
 */
async function servesPredictions(
  station: IwlsStation,
  from: string,
  to: string,
): Promise<boolean> {
  const url = `${IWLS}/${station.id}/data?time-series-code=wlp&from=${from}&to=${to}`;
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(url);
    if (response.ok) return ((await response.json()) as unknown[]).length > 0;
    if (attempt === 4)
      throw new Error(
        `IWLS probe ${station.officialName}: HTTP ${response.status}`,
      );
    await sleep(2000 * 2 ** attempt);
  }
}

const response = await fetch(IWLS);
if (!response.ok) throw new Error(`IWLS /stations: HTTP ${response.status}`);
const advertised = ((await response.json()) as IwlsStation[]).filter(
  (station) => station.timeSeries?.some(({ code }) => code === "wlp"),
);

// One hour of yesterday: a day every live station has predictions for.
const day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const serving: IwlsStation[] = [];
for (const [n, station] of advertised.entries()) {
  if (await servesPredictions(station, `${day}T00:00:00Z`, `${day}T01:00:00Z`))
    serving.push(station);
  if (n % 100 === 0)
    console.log(`probing ${n}/${advertised.length}, ${serving.length} serving`);
  await sleep(PROBE_SPACING_MS);
}

const registry = loadRegistry(
  readFileSync(join(metadata, "registry.yaml"), "utf8"),
);
const ports = [...registry.values()].flatMap(({ provider, kind, position }) =>
  provider === "chs" && kind === "tide" && position
    ? [{ latitude: position[0], longitude: position[1] }]
    : [],
);
const slugs = JSON.parse(readFileSync(join(metadata, "slugs.json"), "utf8"));
const tombstones = JSON.parse(
  readFileSync(join(metadata, "slug-tombstones.json"), "utf8"),
);
// Every id that ever held a slug, so a new station never takes one.
const taken = [
  ...registry.keys(),
  ...Object.keys(slugs.tide),
  ...Object.keys(slugs.current),
  ...Object.keys(tombstones.tide),
  ...Object.keys(tombstones.current),
];

const file = join(here, "stations.json");
const previous = JSON.parse(readFileSync(file, "utf8")) as ChsStation[];
const prune = process.argv.includes("--prune");
const seen = new Set(
  reconcile(serving, previous, { ports, taken, prune: true }).map(
    ({ id }) => id,
  ),
);
const next = reconcile(serving, previous, { ports, taken, prune });
writeFileSync(file, JSON.stringify(next, null, 2) + "\n");

const before = new Set(previous.map(({ id }) => id));
const unseen = previous.filter(({ id }) => !seen.has(id));
console.log(
  `${advertised.length} advertise wlp, ${serving.length} serve it; ${next.length} stations, ` +
    `${next.filter(({ id }) => !before.has(id)).length} added`,
);
if (unseen.length)
  console.log(
    `${unseen.length} not seen this run, ${prune ? "removed" : "kept (rerun with --prune to remove)"}:\n` +
      unseen.map(({ id, name }) => `  ${id} (${name})`).join("\n"),
  );
