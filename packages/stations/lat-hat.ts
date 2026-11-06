// NOAA publishes LAT/HAT for most, but not all, of its reference stations.
// For the rest, synthesize them from the station's own constituents over the
// pinned DATUM_EPOCH — the same method the datums package already uses for TICON
// and IOC. Only LAT/HAT are written; every NOAA-published mean is left alone.
//
// That leaves those records MIXED — observed means, synthesized extremes — and
// nothing in the file marks which is which. `datums_source` is one value per
// station, so setting it to "harmonic" would relabel NOAA's own MHHW/MSL/MLLW
// as computed. A later validation pass must not score these as published; see
// sources/noaa/README.md.
//
// Stations with no seasonal term are skipped rather than filled. LAT and HAT
// are the extremes of a full 19-year envelope, and a constituent set with Sa
// and Ssa at zero amplitude cannot describe one: the scan still runs and still
// returns two confident numbers, but the envelope is narrowed by whatever the
// season contributes. NOAA ships its 37-name list with amplitude 0 where it did
// not resolve a constituent, so this is common — 237 of 1,253 harmonic
// references. A narrowed envelope presented as "the lowest this station ever
// gets" is worse than no answer.

import { computeDatums, toFixed } from "@slackwater/datums";
import type { StationData } from "@slackwater/database";

/** Solar annual and semi-annual — the seasonal envelope, under either casing. */
const SEASONAL = new Set(["SA", "SSA"]);

function hasSeasonalTerm(constituents: { name: string; amplitude: number }[]) {
  return constituents.some(
    (c) => SEASONAL.has(c.name.toUpperCase()) && c.amplitude !== 0,
  );
}

export interface LatHatBackfill {
  station: StationData;
  filled: boolean;
  /** Why a reference station missing LAT or HAT could not be filled. */
  skipped?: string;
}

/**
 * Fill a NOAA reference station's missing LAT/HAT. Pure, and idempotent: a
 * station that already has both, or is subordinate, comes back unchanged.
 */
export function backfillLatHat(station: StationData): LatHatBackfill {
  if (station.type === "subordinate") return { station, filled: false };

  const datums = station.datums ?? {};
  if (datums["LAT"] !== undefined && datums["HAT"] !== undefined) {
    return { station, filled: false };
  }

  // computeDatums works in the constituents' own MSL=0 frame; NOAA's datums
  // are on the STND scale, so shift by the station's published MSL. Without
  // one there is nothing to shift onto, and without constituents there is
  // nothing to predict.
  if (datums["MSL"] === undefined || !station.harmonic_constituents?.length) {
    const skipped = datums["MSL"] === undefined ? "no MSL" : "no constituents";
    return { station, filled: false, skipped };
  }
  if (!hasSeasonalTerm(station.harmonic_constituents)) {
    return {
      station,
      filled: false,
      skipped: "no Sa/Ssa — cannot bound a 19-year envelope",
    };
  }

  const { datums: computed } = computeDatums(station.harmonic_constituents, {});
  if (computed["LAT"] === undefined || computed["HAT"] === undefined) {
    return { station, filled: false, skipped: "predictor returned no LAT/HAT" };
  }

  // LAT/HAT lead the datums object, matching update-noaa-stations.ts. A
  // published value of either still wins over the synthesized one.
  return {
    station: {
      ...station,
      datums: {
        LAT: toFixed(computed["LAT"] + datums["MSL"], 3),
        HAT: toFixed(computed["HAT"] + datums["MSL"], 3),
        ...datums,
      },
    },
    filled: true,
  };
}
