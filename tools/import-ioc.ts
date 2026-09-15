#!/usr/bin/env node

/**
 * Import IOC SLSMF gauges as a derived source: fit harmonic constituents and
 * reduce datums from quality-controlled observations (issue #124).
 *
 * Only gauges that are still reporting and sit more than MIN_DISTANCE_KM from
 * every station already in data/ are imported; the rest are covered by better
 * (published-constituent) sources. Records shorter than a year are skipped.
 *
 * Usage:
 *   IOC_API_KEY=… node tools/import-ioc.ts
 *   IOC_STATIONS=tbvi2,aarh node tools/import-ioc.ts   # restrict to codes
 *   FORCE=1 node tools/import-ioc.ts                    # re-fit cached stations
 *   IOC_FROM=2007 node tools/import-ioc.ts              # fetch a longer record
 */

import { readdir, readFile } from "fs/promises";
import { join } from "path";
import {
  normalize,
  save,
  load,
  DATA_DIR,
  type PartialStationData,
} from "./station.ts";
import {
  computeDatums,
  computeDatumsFromObservations,
  mergeObservedDatums,
  type Sample,
} from "./datum.ts";
import { fitHarmonics, isAnalyzable } from "./harmonic-analysis.ts";
import { distance } from "./filtering.ts";
import { loadGeocoder } from "./geocode.ts";
import { fetchStations, fetchOperators, fetchHourlySamples } from "./ioc.ts";

const SOURCE = "ioc";
const MIN_DISTANCE_KM = 3;
const MAX_AGE_DAYS = 30;
const force = process.env["FORCE"] === "1";
const only = process.env["IOC_STATIONS"]?.split(",").map((s) => s.trim());
// ponytail: a station-year is a ~40 MB response taking 20–30 s, so default to
// the last 6 years (plenty for the fit; datums lose only cm-level accuracy vs
// the full 19-year window). Raise IOC_FROM for a longer record.
const fromYear = Number(
  process.env["IOC_FROM"] ?? new Date().getUTCFullYear() - 6,
);

// The constituent set TICON-4 publishes for nearly every station; all resolve
// with ≥1 year of hourly data. fitHarmonics drops any @neaps doesn't define.
const CONSTITUENTS = [
  "M2",
  "S2",
  "N2",
  "K2",
  "K1",
  "O1",
  "P1",
  "Q1",
  "M4",
  "MS4",
  "MN4",
  "M6",
  "2N2",
  "MU2",
  "NU2",
  "L2",
  "T2",
  "R2",
  "LAMBDA2",
  "MKS2",
  "2SM2",
  "MA2",
  "MB2",
  "S1",
  "M1",
  "J1",
  "OO1",
  "2Q1",
  "RHO1",
  "SGM",
  "M3",
  "S3",
  "S4",
  "N4",
  "M8",
  "2MS6",
  "2MK5",
  "2MO5",
  "MM",
  "MF",
  "MSF",
  "MTM",
  "MSQM",
  "SA",
  "SSA",
  "EP2",
  "3N2",
  "3L2",
  "T3",
  "R3",
];

const DATUM_DISCLAIMER =
  "Datums are relative to the gauge's own zero; IOC SLSMF publishes no vertical datum.";

/** Positions of every station already in data/ (other sources only). */
async function existingPositions(): Promise<[number, number][]> {
  const out: [number, number][] = [];
  for (const source of await readdir(DATA_DIR, { withFileTypes: true })) {
    if (!source.isDirectory() || source.name === SOURCE) continue;
    const dir = join(DATA_DIR, source.name);
    for (const file of await readdir(dir)) {
      if (!file.endsWith(".json")) continue;
      const s = JSON.parse(await readFile(join(dir, file), "utf-8"));
      out.push([s.latitude, s.longitude]);
    }
  }
  return out;
}

const toISODate = (d: Date) => d.toISOString().split("T")[0]!;

async function fit(code: string) {
  if (!force) {
    try {
      const { harmonic_constituents, datums, datums_source, epoch } =
        await load(SOURCE, code);
      // Written by this tool, so both are always present.
      return {
        harmonic_constituents,
        datums,
        datums_source: datums_source!,
        epoch: epoch!,
      };
    } catch {
      // not cached; fit below
    }
  }

  const samples = await fetchHourlySamples(code, fromYear);
  if (
    !isAnalyzable(
      samples.map((s) => ({ t: s.time.getTime(), level: s.level })),
      CONSTITUENTS.length,
    )
  ) {
    throw new Error("record too short (< 1 year of QC'd data)");
  }
  const harmonic_constituents = fitHarmonics(
    samples.map((s) => ({ t: s.time.getTime(), level: s.level })),
    CONSTITUENTS,
  );

  const harmonic = computeDatums(harmonic_constituents, {});
  const obs = computeDatumsFromObservations(samples);
  const span = (a: Sample[]) => ({
    start: toISODate(a[0]!.time),
    end: toISODate(a[a.length - 1]!.time),
  });
  return obs
    ? {
        harmonic_constituents,
        datums: mergeObservedDatums(harmonic.datums, obs.datums),
        datums_source: "observed" as const,
        epoch: { start: toISODate(obs.start), end: toISODate(obs.end) },
      }
    : {
        harmonic_constituents,
        datums: harmonic.datums,
        datums_source: "harmonic" as const,
        epoch: span(samples),
      };
}

async function main() {
  console.log(
    `=== Importing IOC SLSMF stations ===${force ? " (forcing re-fit)" : ""}\n`,
  );

  const [stations, operators, existing, geocoder] = await Promise.all([
    fetchStations(),
    fetchOperators(),
    existingPositions(),
    loadGeocoder(),
  ]);

  const cutoff = Date.now() - MAX_AGE_DAYS * 86_400_000;
  const candidates = stations.filter((s) => {
    if (only) return only.includes(s.Code);
    if (s.Lat == null || s.Lon == null) return false;
    // DART tsunameters are deep-ocean pressure sensors, not tide stations.
    if (s.Location.trim().startsWith("DART")) return false;
    if (!s.lasttime || Date.parse(s.lasttime.replace(" ", "T") + "Z") < cutoff)
      return false;
    return existing.every(
      ([lat, lon]) => distance(lat, lon, s.Lat!, s.Lon!) > MIN_DISTANCE_KM,
    );
  });
  console.log(
    `${stations.length} gauges, ${candidates.length} active and uncovered\n`,
  );

  let saved = 0;
  let skipped = 0;
  const queue = [...candidates];
  // ponytail: 4 in flight — the server's per-request latency dominates, so a
  // small pool is ~4× faster and still polite.
  const worker = async () => {
    for (let s = queue.shift(); s; s = queue.shift()) {
      const lat = s.Lat!;
      const lon = s.Lon!;
      try {
        const geo = geocoder.nearest(lat, lon, 50);
        const region = geo?.region;
        const operator =
          s.localoperator != null ? operators.get(s.localoperator) : undefined;
        const fitted = await fit(s.Code);

        const candidate: PartialStationData = {
          // "Bahia Mansa_CL" → "Bahia Mansa": strip the country suffix some operators append.
          name: s.Location.trim().replace(/_[A-Z]{2}$/, ""),
          ...(region ? { region } : {}),
          // Remote gauges miss the geocoder; IOC's own label needs its qualifier
          // dropped ("Taiwan (Province of China)", "Puerto Rico; U.S.A.").
          country: geo?.country ?? s.countryname.replace(/\s*[(;].*$/, ""),
          latitude: lat,
          longitude: lon,
          type: "reference",
          disclaimers: [
            DATUM_DISCLAIMER,
            fitted.datums_source === "harmonic"
              ? "Datums derived from harmonic prediction; the observation record is too short for an empirical reduction, so datum values carry higher uncertainty."
              : "",
          ]
            .filter(Boolean)
            .join(" "),
          source: {
            name: "IOC SLSMF",
            url: `https://www.ioc-sealevelmonitoring.org/station.php?code=${s.Code}`,
            id: s.Code,
            published_harmonics: false,
            ...(operator ? { operator } : {}),
          },
          license: {
            type: "IOC Oceanographic Data Exchange Policy",
            commercial_use: false,
            url: "https://www.ioc-sealevelmonitoring.org/disclaimer.php",
            notes:
              `Non-commercial use only per the SLSMF data policy; commercial users should contact the data originator${operator ? ` (${operator})` : ""}. ` +
              "Constituents fit by this project from SLSMF quality-controlled observations. Cite: Flanders Marine Institute (VLIZ); Intergovernmental Oceanographic Commission (IOC) (2026): Sea level station monitoring facility. https://doi.org/10.14284/482",
          },
          ...fitted,
        };
        await save(SOURCE, normalize(candidate));
        saved++;
        process.stdout.write(".");
      } catch (err: any) {
        skipped++;
        console.error(`\n${s.Code} (${s.Location.trim()}): ${err.message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  console.log(
    `\n\nDone. Saved ${saved}, skipped ${skipped} of ${candidates.length}.`,
  );
}

main();
