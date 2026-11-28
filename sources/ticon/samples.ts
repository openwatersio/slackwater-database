import {
  getSourceSuffix,
  roundConstituents,
  type PartialStationData,
} from "@slackwater/stations";
import { parseGeslaSamples } from "@slackwater/datum-data";
import type { Sample } from "@slackwater/datums";
import { selectConstituents } from "@slackwater/engine";
import {
  parseGeslaSamplesInZone,
  publishedConstants,
} from "@slackwater/harmonic-analysis";

type Constituents = PartialStationData["harmonic_constituents"];

// WSV labels German legal time as UTC. RWS subtracts a fixed CET hour rather
// than a DST-aware offset: winter is UTC already, summer remains one hour fast.
// The historical RWS source is already UTC. See #96 and #98.
export const LOCAL_TIME_SOURCES: Record<
  string,
  { zone: string; shiftHours?: number }
> = {
  wsv: { zone: "Europe/Berlin" },
  rws: { zone: "Europe/Amsterdam", shiftHours: 1 },
};

// UHSLC stamps its Hong Kong hourly heights one hour early: the height it
// labels T was measured at T + 1 h UTC. Each gauge's value is the hours to add.
// See #360.
export const EARLY_GAUGES: Record<string, number> = {
  "hong_kong-329-hkg-uhslc_fd": 1,
  "hong_kong-329a-hkg-uhslc_rq": 1,
  "hong_kong-329b-hkg-uhslc_rq": 1,
};

/** Whether a station's GESLA-4 times, and so TICON's phases, are not UTC. */
export function hasMislabeledClock(id: string): boolean {
  return getSourceSuffix(id) in LOCAL_TIME_SOURCES || id in EARLY_GAUGES;
}

export function parseTiconSamples(id: string, text: string): Sample[] {
  const source = LOCAL_TIME_SOURCES[getSourceSuffix(id)];
  if (!source) return shiftEarlyGauge(id, parseGeslaSamples(text));
  return parseGeslaSamplesInZone(text, source.zone).map((p) => ({
    time: new Date(p.t + (source.shiftHours ?? 0) * 3600000),
    level: p.level,
  }));
}

/** Move an early gauge's samples to the UTC time they were measured. */
export function shiftEarlyGauge(id: string, samples: Sample[]): Sample[] {
  if (!EARLY_GAUGES[id]) return samples;
  return samples.map((s) => ({
    time: measuredAt(id, s.time),
    level: s.level,
  }));
}

/** The UTC time a gauge's height stamped `time` was measured. */
function measuredAt(id: string, time: Date): Date {
  return new Date(time.getTime() + (EARLY_GAUGES[id] ?? 0) * 3600000);
}

/**
 * Whether the live UHSLC RQD record, ending at `rqEnd` as UHSLC stamps it,
 * runs past the station's GESLA-4 samples, which parseTiconSamples has already
 * moved to UTC. Both ends are compared in UTC.
 */
export function extendsGeslaRecord(
  id: string,
  rqEnd: Date,
  samples: Sample[],
): boolean {
  const geslaEnd = samples.reduce(
    (end, s) => Math.max(end, s.time.getTime()),
    -Infinity,
  );
  return measuredAt(id, rqEnd).getTime() > geslaEnd;
}

/**
 * A saved re-fit to reuse, or undefined when there is none: no constituents,
 * or the constituents TICON published, which a file saved before its station
 * was re-fit still holds. Stored constituents are at the published precision,
 * so the published ones are compared at that precision too.
 */
export function cachedRefit(
  stored: Constituents | undefined,
  published: Constituents,
): Constituents | undefined {
  if (!stored?.length) return undefined;
  if (sameConstituents(stored, roundConstituents("ticon", published)))
    return undefined;
  return stored;
}

export function sameConstituents(a: Constituents, b: Constituents) {
  return (
    a.length === b.length &&
    a.every(
      (h, i) =>
        h.name === b[i]!.name &&
        h.amplitude === b[i]!.amplitude &&
        h.phase === b[i]!.phase,
    )
  );
}

/** The lines a re-fit may drop: each is a perigee cycle from N2 or L2. */
const PERIGEE_PAIRED = new Map([
  ["3N2", "N2"],
  ["3L2", "L2"],
]);

/**
 * Fit TICON's constituents to a station's record, once its clock is fixed.
 * 3N2 and 3L2 are left out by the Rayleigh criterion on a record shorter than
 * a lunar perigee cycle (8.85 years), where they can't be separated from N2
 * and L2; the stronger one keeps the signal. Every other name is kept whatever
 * its SNR, as TICON keeps them, and the re-fit throws rather than drop one.
 * Throws on a record shorter than 365.25 days, which K1 and S1 need.
 */
export function refitConstituents(
  samples: Sample[],
  names: string[],
): Constituents {
  const sorted = samples.toSorted((a, b) => +a.time - +b.time);
  if (
    !sorted.length ||
    +sorted.at(-1)!.time - +sorted[0]!.time < 365.25 * 86_400_000
  )
    throw new Error("record too short to re-analyze its non-UTC phases");
  const { fit, selection } = selectConstituents(
    sorted.map(({ time, level }) => ({ time, value: level })),
    { candidates: names.map((name) => ({ name })), minSnr: 0 },
  );
  const lost = selection.filter(
    (s) =>
      !s.kept &&
      !(s.reason === "rayleigh" && PERIGEE_PAIRED.get(s.name) === s.conflict),
  );
  if (lost.length)
    throw new Error(
      `re-fit would drop ${lost.map((s) => `${s.name} (${s.reason})`).join(", ")}`,
    );
  return publishedConstants(fit.constituents);
}
