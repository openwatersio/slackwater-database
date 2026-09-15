#!/usr/bin/env node

import createFetch from "make-fetch-happen";
import { normalize, save, DATA_DIR } from "@neaps/stations";
import type { StationData } from "@neaps/tide-database";
import { loadGeocoder } from "@neaps/stations";
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
    const newContent = JSON.stringify(station, null, 2) + "\n";
    const existing = await readExisting(meta.id);

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

async function buildStation(meta: any): Promise<StationData> {
  const {
    country = "United States",
    continent = "North America",
    region = meta.state || undefined,
  } = geocoder.nearest(meta.lat, meta.lng) || {};

  const station: Partial<StationData> = {
    name: meta.name,
    continent,
    country,
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
    // Fetch full station details
    const res = await fetch(
      `https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/${meta.id}.json?expand=details,datums,harcon,disclaimers,notices&units=metric`,
    ).then((r) => r.json());
    const data = res.stations[0];

    // This should never happen, but just in case
    if (!data) throw new Error(`No data found for station ID: ${meta.id}`);

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

main().catch(console.error);
