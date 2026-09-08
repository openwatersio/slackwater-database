#!/usr/bin/env node

// Accuracy check for backfill-lat-hat.ts: recompute LAT/HAT from
// constituents for NOAA reference stations that ALSO publish them, and report
// the disagreement. NOAA's published values come from its own 1983-2001 epoch
// while DATUM_EPOCH is 2007-2026, so exact equality is not expected — a few
// centimetres is.
//
// A tool, not a test: the full 1,188-station set takes ~13 minutes. Run by hand
// before merging a change to the backfill logic.
//
//   npm run check-lat-hat -w @tide-database/stations -- [--sample 200]

import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { computeDatums } from "@tide-database/datums";
import { DATA_DIR } from "./station.ts";
import type { StationData } from "@neaps/tide-database";

const NOAA_DIR = join(DATA_DIR, "noaa");

const sampleArg = process.argv.indexOf("--sample");
const SAMPLE = sampleArg === -1 ? 200 : Number(process.argv[sampleArg + 1]);

function median(values: number[]): number {
  return values.slice().sort((a, b) => a - b)[values.length >> 1]!;
}

async function main() {
  const files = (await readdir(NOAA_DIR)).filter((f) => f.endsWith(".json"));
  const candidates: StationData[] = [];

  for (const file of files.sort()) {
    const station: StationData = JSON.parse(
      await readFile(join(NOAA_DIR, file), "utf-8"),
    );
    const d = station.datums ?? {};
    // Only stations whose LAT/HAT came from NOAA, not from the backfill: the
    // backfill never runs where MSL is missing, and its own output would make
    // this check circular. Published values predate it, so require the full
    // observed set that marks a NOAA-surveyed station.
    if (
      station.type !== "subordinate" &&
      d["LAT"] !== undefined &&
      d["HAT"] !== undefined &&
      d["MSL"] !== undefined &&
      d["MHW"] !== undefined &&
      station.harmonic_constituents?.length
    ) {
      candidates.push(station);
    }
  }

  // Deterministic spread across the sorted list rather than a random sample, so
  // two runs are comparable.
  const step = Math.max(1, Math.floor(candidates.length / SAMPLE));
  const sample = candidates.filter((_, i) => i % step === 0).slice(0, SAMPLE);
  console.log(
    `${candidates.length} NOAA references publish LAT/HAT; checking ${sample.length}\n`,
  );

  const errors = { LAT: [] as number[], HAT: [] as number[] };
  const worst: { name: string; lat: number; hat: number }[] = [];

  for (const station of sample) {
    const d = station.datums!;
    const { datums: computed } = computeDatums(
      station.harmonic_constituents,
      {},
    );
    if (computed["LAT"] === undefined || computed["HAT"] === undefined)
      continue;
    const lat = computed["LAT"] + d["MSL"]! - d["LAT"]!;
    const hat = computed["HAT"] + d["MSL"]! - d["HAT"]!;
    errors.LAT.push(Math.abs(lat));
    errors.HAT.push(Math.abs(hat));
    worst.push({ name: station.name, lat, hat });
  }

  worst.sort(
    (a, b) =>
      Math.max(...[b.lat, b.hat].map(Math.abs)) -
      Math.max(...[a.lat, a.hat].map(Math.abs)),
  );
  console.log("Largest disagreements:");
  for (const w of worst.slice(0, 10)) {
    console.log(
      `  ${w.name.slice(0, 40).padEnd(42)} LAT ${(w.lat * 100).toFixed(1).padStart(6)} cm  HAT ${(w.hat * 100).toFixed(1).padStart(6)} cm`,
    );
  }

  console.log("");
  for (const key of ["LAT", "HAT"] as const) {
    const e = errors[key];
    console.log(
      `${key}: n=${e.length}  median |err| ${(median(e) * 100).toFixed(1)} cm  max ${(Math.max(...e) * 100).toFixed(1)} cm`,
    );
  }
}

main().catch(console.error);
