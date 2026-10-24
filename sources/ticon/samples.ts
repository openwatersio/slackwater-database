import { getSourceSuffix } from "@slackwater/stations";
import { parseGeslaSamples, type Sample } from "@slackwater/datums";
import { parseGeslaSamplesInZone } from "@slackwater/harmonic-analysis";

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
  const hours = EARLY_GAUGES[id];
  if (!hours) return samples;
  return samples.map((s) => ({
    time: new Date(s.time.getTime() + hours * 3600000),
    level: s.level,
  }));
}
