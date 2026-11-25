#!/usr/bin/env node

import createFetch from "make-fetch-happen";
import { fetchNoaa } from "./fetch.ts";
import {
  backfillLatHat,
  normalize,
  save,
  withPublishedPrecision,
  DATA_DIR,
} from "@slackwater/stations";
import type { StationData } from "@slackwater/database";
import { loadGeocoder } from "@slackwater/stations";
import { readFile } from "fs/promises";
import { join } from "path";

const fetch = createFetch.defaults({
  cachePath: "node_modules/.cache",
  cache: "force-cache",
  retry: 10,
});

const NOAA_SOURCE_NAME = "US National Oceanic and Atmospheric Administration";
const STATIONS_URL =
  "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json";

const geocoder = await loadGeocoder();

async function readExisting(id: string): Promise<string | null> {
  try {
    return await readFile(join(DATA_DIR, "noaa", `${id}.json`), "utf-8");
  } catch {
    return null;
  }
}

async function main() {
  const { stations } = await fetch(
    `${STATIONS_URL}?type=tidepredictions&expand=details,tidepredoffsets&units=metric`,
  ).then((r) => r.json());

  console.log(`Fetched metadata for ${stations.length} stations.`);

  const added: string[] = [];
  const updated: string[] = [];
  let unchanged = 0;
  let skipped = 0;

  for (const meta of stations) {
    // At least one station lists itself as its own reference, but doesn't have harmonic data
    if (meta.id === meta.tidepredoffsets?.refStationId) {
      skipped++;
      continue;
    }

    const station = await buildStation(meta);
    const existing = await readExisting(meta.id);
    // The saved record drops any LAT/HAT synthesized last run, and the
    // workflow's backfill step recomputes them. Compare against what that
    // step will write, so the round trip alone isn't reported as an update.
    const { station: backfilled } = backfillLatHat(station);
    const newContent =
      JSON.stringify(withPublishedPrecision("noaa", backfilled), null, 2) +
      "\n";

    await save("noaa", station);

    if (existing === null) {
      added.push(`${meta.id} (${station.name})`);
    } else if (existing !== newContent) {
      updated.push(`${meta.id} (${station.name})`);
    } else {
      unchanged++;
    }

    process.stdout.write(".");
  }

  console.log("\n");
  console.log("## Summary\n");
  console.log(`Processed ${stations.length} stations (${skipped} skipped)\n`);

  if (added.length > 0) {
    console.log(`### ${added.length} stations added\n`);
    for (const s of added) console.log(`- ${s}`);
    console.log();
  }

  if (updated.length > 0) {
    console.log(`### ${updated.length} stations updated\n`);
    for (const s of updated) console.log(`- ${s}`);
    console.log();
  }

  console.log(`${unchanged} stations unchanged\n`);

  console.log("### Source\n");
  console.log(
    `- Stations list: https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions`,
  );
  console.log(
    `- Harmonic constituents: https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/{id}/harcon.json`,
  );
}

async function fetchDetails(id: string): Promise<any> {
  const url = `https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/${id}.json?expand=details,datums,harcon,disclaimers,notices&units=metric`;
  return fetchNoaa(url, (json) => json.stations?.[0], { fetch });
}

async function buildStation(meta: any): Promise<StationData> {
  // The nearest gazetteer place can sit across a state line or, on the Alaska
  // panhandle, in British Columbia; NOAA's own state code settles both.
  // Territories are published as their own country, so they stay geocoded.
  const stateless =
    !meta.state || ["PR", "VI", "GU", "AS", "FM"].includes(meta.state);
  const location = stateless ? geocoder.nearest(meta.lat, meta.lng) : null;
  const {
    country = "United States",
    continent = "North America",
    region = meta.state || undefined,
  } = location || {};

  const station: Partial<StationData> = {
    name: meta.name,
    continent,
    country,
    country_code: location?.place.countryCode ?? "US",
    region,
    type: meta.type == "S" ? "subordinate" : "reference",
    latitude: meta.lat,
    longitude: meta.lng,
    timezone: meta.timezone,
    source: {
      name: NOAA_SOURCE_NAME,
      id: meta.id,
      published_harmonics: true,
      url: `https://tidesandcurrents.noaa.gov/stationhome.html?id=${meta.id}`,
    },
    license: {
      type: "public domain",
      commercial_use: true,
      url: "https://tidesandcurrents.noaa.gov/disclaimers.html",
    },
    chart_datum: "MLLW",
  };

  if (meta.type == "S") {
    Object.assign(station, {
      offsets: {
        reference: `noaa/${meta.tidepredoffsets.refStationId}`,
        height: {
          type:
            meta.tidepredoffsets.heightAdjustedType === "R" ? "ratio" : "fixed",
          high: meta.tidepredoffsets.heightOffsetHighTide,
          low: meta.tidepredoffsets.heightOffsetLowTide,
        },
        time: {
          high: meta.tidepredoffsets.timeOffsetHighTide,
          low: meta.tidepredoffsets.timeOffsetLowTide,
        },
      },
    });
  } else {
    const data = await fetchDetails(meta.id);

    // Parse epoch from datums (e.g., "1983-2001" -> start: 1983-01-01, end: 2001-12-31)
    let epoch: { start: string; end: string } | undefined;
    if (data.datums.epoch) {
      const match = data.datums.epoch.match(/(\d{4})-(\d{4})/);
      if (match) {
        const [, startYear, endYear] = match;
        epoch = {
          start: `${startYear}-01-01`,
          end: `${endYear}-12-31`,
        };
      }
    }

    const datums = {
      ...(data.datums.LAT ? { LAT: data.datums.LAT } : {}),
      ...(data.datums.HAT ? { HAT: data.datums.HAT } : {}),
      // Some stations don't have all datums
      ...(data.datums.datums
        ? Object.fromEntries(
            data.datums.datums.map((d: any) => [d.name, d.value]),
          )
        : {}),
    };

    Object.assign(station, {
      chart_datum: "MLLW" in datums ? "MLLW" : "STND",
      harmonic_constituents: data.harmonicConstituents.HarmonicConstituents.map(
        (h: any) => ({
          name: h.name,
          amplitude: h.amplitude,
          phase: h.phase_GMT,
        }),
      ),
      datums,
      disclaimers: (data.disclaimers.disclaimers ?? [])
        .map((d: any) => d.text)
        .join("\n"),
      ...(epoch ? { epoch } : {}),
    });
  }

  return normalize(station as StationData);
}

await main();
