#!/usr/bin/env node

// NOAA publishes LAT/HAT for most, but not all, of its reference stations.
// For the rest, synthesize them from the station's own constituents over the
// pinned DATUM_EPOCH — the same method tools/datum.ts already uses for TICON
// and IOC. Only LAT/HAT are written; every NOAA-published mean is left alone.
//
// That leaves those records MIXED — observed means, synthesized extremes — and
// nothing in the file marks which is which. `datums_source` is one value per
// station, so setting it to "harmonic" would relabel NOAA's own MHHW/MSL/MLLW
// as computed. A later validation pass must not score these as published; see
// data/noaa/README.md.
//
// Stations with no seasonal term are skipped rather than filled. LAT and HAT
// are the extremes of a full 19-year envelope, and a constituent set with Sa
// and Ssa at zero amplitude cannot describe one: the scan still runs and still
// returns two confident numbers, but the envelope is narrowed by whatever the
// season contributes. NOAA ships its 37-name list with amplitude 0 where it did
// not resolve a constituent, so this is common — 237 of 1,253 harmonic
// references. A narrowed envelope presented as "the lowest this station ever
// gets" is worse than no answer.
//
// Idempotent: stations that already have both are skipped, and the epoch is
// pinned, so re-running produces no diff. Chain it AFTER
// tools/update-noaa-stations.ts, which rewrites `datums` wholesale.

import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { computeDatums, toFixed } from "@tide-database/datums";
import { save, DATA_DIR } from "./station.ts";
import type { StationData } from "@neaps/tide-database";

const NOAA_DIR = join(DATA_DIR, "noaa");

/** Solar annual and semi-annual — the seasonal envelope, under either casing. */
const SEASONAL = new Set(["SA", "SSA"]);

function hasSeasonalTerm(constituents: { name: string; amplitude: number }[]) {
  return constituents.some(
    (c) => SEASONAL.has(c.name.toUpperCase()) && c.amplitude !== 0,
  );
}

async function main() {
  const files = (await readdir(NOAA_DIR)).filter((f) => f.endsWith(".json"));
  let filled = 0;
  const skipped: string[] = [];

  for (const file of files.sort()) {
    const station: StationData = JSON.parse(
      await readFile(join(NOAA_DIR, file), "utf-8"),
    );
    if (station.type === "subordinate") continue;

    const datums = station.datums ?? {};
    if (datums["LAT"] !== undefined && datums["HAT"] !== undefined) continue;

    // computeDatums works in the constituents' own MSL=0 frame; NOAA's datums
    // are on the STND scale, so shift by the station's published MSL. Without
    // one there is nothing to shift onto, and without constituents there is
    // nothing to predict.
    if (datums["MSL"] === undefined || !station.harmonic_constituents?.length) {
      skipped.push(
        `${file} (${datums["MSL"] === undefined ? "no MSL" : "no constituents"})`,
      );
      continue;
    }
    if (!hasSeasonalTerm(station.harmonic_constituents)) {
      skipped.push(`${file} (no Sa/Ssa — cannot bound a 19-year envelope)`);
      continue;
    }

    const { datums: computed } = computeDatums(
      station.harmonic_constituents,
      {},
    );
    if (computed["LAT"] === undefined || computed["HAT"] === undefined) {
      skipped.push(`${file} (predictor returned no LAT/HAT)`);
      continue;
    }

    // LAT/HAT lead the datums object, matching update-noaa-stations.ts.
    await save("noaa", {
      ...station,
      datums: {
        LAT: toFixed(computed["LAT"] + datums["MSL"], 3),
        HAT: toFixed(computed["HAT"] + datums["MSL"], 3),
        ...datums,
      },
    });
    filled++;
    console.log(`${station.name} (${station.source.id}): LAT/HAT synthesized`);
  }

  console.log(`\nFilled ${filled} station${filled === 1 ? "" : "s"}.`);
  if (skipped.length) {
    console.log(`Skipped ${skipped.length}:`);
    for (const s of skipped) console.log(`  ${s}`);
  }
}

main().catch(console.error);
