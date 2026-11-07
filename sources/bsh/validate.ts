import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { loadStations } from "@slackwater/database";
import { createTidePredictor } from "@slackwater/engine";
import {
  SITE,
  compare,
  parseOverview,
  parsePlace,
  placeUrl,
  regressions,
  type Metrics,
} from "./bsh.ts";

const BASELINE = new URL("./validation.json", import.meta.url);
const CACHE = new URL("../../tmp/bsh/", import.meta.url);
// A reference station further than this from the BSH gauge is not the same gauge.
const MAX_KM = 2;

export type Result = {
  bshnr: string;
  name: string;
  station: string;
  km: number;
} & Metrics;

export type Baseline = { year: number; gauges: Result[] };

async function cached(name: string, url: string) {
  const file = new URL(name, CACHE);
  try {
    return JSON.parse(await readFile(file, "utf8")) as unknown;
  } catch {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const json = (await res.json()) as unknown;
    await writeFile(file, JSON.stringify(json));
    // Be polite to a site that serves the public tide tables.
    await new Promise((r) => setTimeout(r, 300));
    return json;
  }
}

/**
 * Compare every BSH gauge that has heights with our nearest reference station.
 * Gauges that cannot be compared are returned as errors rather than skipped.
 */
export async function measure(year: number) {
  await mkdir(new URL(`${year}/`, CACHE), { recursive: true });
  const gauges = parseOverview(
    await cached(`${year}/overview.json`, `${SITE}/data/tides_overview.json`),
  );
  const db = await loadStations();
  const results: Result[] = [];
  const errors: string[] = [];
  let published = 0;
  for (const gauge of gauges) {
    const nearest = db.near({
      lat: gauge.latitude,
      lon: gauge.longitude,
      maxDistance: MAX_KM,
      maxResults: 1,
      filter: (s) => s.type === "reference" && s.kind === "tide",
    })[0];
    if (!nearest) continue;
    const [station, km] = nearest;
    const reference = parsePlace(
      await cached(`${year}/${gauge.bshnr}.json`, placeUrl(gauge.bshnr)),
      year,
    );
    if (!reference.length) continue;
    published++;
    const predicted = createTidePredictor(
      station.harmonic_constituents,
    ).getExtremesPrediction({
      start: new Date(Date.UTC(year, 0, 1) - 86_400_000),
      end: new Date(Date.UTC(year + 1, 0, 1) + 86_400_000),
    });
    let metrics: Metrics;
    try {
      metrics = compare(reference, predicted);
    } catch (error) {
      errors.push(`${gauge.bshnr} ${gauge.name}: ${(error as Error).message}`);
      continue;
    }
    results.push({
      bshnr: gauge.bshnr,
      name: gauge.name,
      station: station.id,
      km: round(km, 2),
      ...(Object.fromEntries(
        Object.entries(metrics).map(([k, v]) => [
          k,
          round(v, k === "heightSd" ? 3 : 1),
        ]),
      ) as Metrics),
    });
  }
  if (!published) throw new Error(`BSH publishes no ${year} predictions`);
  results.sort((a, b) => (a.bshnr < b.bshnr ? -1 : a.bshnr > b.bshnr ? 1 : 0));
  return { results, errors };
}

function round(x: number, digits: number) {
  return Number(x.toFixed(digits));
}

/** Failures for gauges that got worse, changed station, or disappeared. */
export function check(baseline: Baseline, current: Result[]) {
  const byGauge = new Map(current.map((r) => [r.bshnr, r]));
  const failures: string[] = [];
  for (const before of baseline.gauges) {
    const after = byGauge.get(before.bshnr);
    const label = `${before.bshnr} ${before.name}`;
    if (!after) failures.push(`${label}: no longer matched`);
    else if (after.station !== before.station)
      failures.push(`${label}: station ${before.station} → ${after.station}`);
    else
      for (const issue of regressions(before, after))
        failures.push(`${label}: ${issue}`);
  }
  return failures;
}

async function main(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: {
      year: { type: "string" },
      update: { type: "boolean" },
      "allow-drop": { type: "boolean" },
    },
  });
  const baseline = JSON.parse(await readFile(BASELINE, "utf8")) as Baseline;
  const year = values.year ? Number(values.year) : baseline.year;
  if (!Number.isInteger(year))
    throw new Error(`Invalid --year: ${values.year}`);
  const { results: current, errors } = await measure(year);
  console.table(
    current.map(({ bshnr, name, station, km, ...m }) => ({
      bshnr,
      name: name.slice(0, 24),
      station: station.slice(0, 32),
      km,
      ...m,
    })),
  );
  console.log(
    `Datenquelle: Gezeitenvorausberechnungen ${year} ©, Bundesamt für Seeschifffahrt und Hydrographie, Hamburg, ${year}`,
  );
  if (errors.length)
    throw new Error(
      `${errors.length} gauges could not be compared:\n${errors.join("\n")}`,
    );
  if (values.update) {
    // Show what the new baseline accepts, so the reviewer sees it outside the diff.
    if (year === baseline.year)
      for (const failure of check(baseline, current))
        console.log(`Accepting ${failure}`);
    const kept = new Set(current.map((r) => r.bshnr));
    const dropped = baseline.gauges.filter((g) => !kept.has(g.bshnr));
    if (dropped.length && !values["allow-drop"])
      throw new Error(
        `Update would drop ${dropped.map((g) => `${g.bshnr} ${g.name}`).join(", ")}; pass --allow-drop to accept`,
      );
    await writeFile(
      BASELINE,
      JSON.stringify({ year, gauges: current }, null, 2) + "\n",
    );
    console.log(`Wrote ${current.length} gauges for ${year}.`);
    return;
  }
  if (year !== baseline.year)
    throw new Error(
      `Baseline is for ${baseline.year}; run with --update to compare ${year}`,
    );
  const failures = check(baseline, current);
  const known = new Set(baseline.gauges.map((g) => g.bshnr));
  const added = current.filter((r) => !known.has(r.bshnr));
  if (added.length)
    console.log(
      `Not in the baseline: ${added.map((r) => r.bshnr).join(", ")}; run with --update to add them.`,
    );
  if (failures.length)
    throw new Error(
      `BSH comparison regressed (${failures.length}):\n${failures.join("\n")}`,
    );
  console.log(`${current.length} gauges within the ${year} baseline.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  main(process.argv.slice(2)).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
