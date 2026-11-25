/**
 * Clock errors, found by timing each record against the authoritative gauges
 * near it. A clock error shifts every constituent by the same minutes, so one
 * time shift fitted across CLOCK_CONSTITUENTS measures it, and a pair whose
 * phases one shift can't explain says nothing about a clock.
 * docs/quality-evaluation.md describes the rules.
 */

import { constituents } from "@slackwater/engine";
import type { StationData } from "@slackwater/database";
import {
  CLOCK_AMPLITUDE_RATIO,
  CLOCK_CONSTITUENTS,
  CLOCK_ERROR_SOURCES,
  CLOCK_MAX_RESIDUAL,
  CLOCK_MAX_SHIFT,
  CLOCK_NEIGHBOR_KM,
  OBSERVATION_ERROR_SOURCES,
  RECORD_CLOCK_SHIFT,
  SOURCE_CLOCK_GAUGES,
  SOURCE_CLOCK_SHARE,
  SOURCE_CLOCK_SHIFT,
  ZONE_CLOCK_WINDOW,
  distance,
  gaugeKey,
  getSourceSuffix,
  isAuthoritative,
} from "./filtering.ts";

interface Station extends StationData {
  id: string;
}

type Phases = Map<string, { amplitude: number; phase: number }>;

function clockPhases(station: Station): Phases | null {
  if (station.type !== "reference") return null;
  const phases: Phases = new Map();
  for (const c of station.harmonic_constituents ?? [])
    if (CLOCK_CONSTITUENTS.includes(c.name)) phases.set(c.name, c);
  return phases.size === CLOCK_CONSTITUENTS.length ? phases : null;
}

const wrap = (degrees: number) => ((((degrees + 180) % 360) + 360) % 360) - 180;

export interface TimeShift {
  /** Minutes `a`'s tide runs late (positive) or early (negative). */
  minutes: number;
  /** Degrees of phase the shift leaves unexplained, as an amplitude-weighted
   *  root mean square over CLOCK_CONSTITUENTS. */
  residual: number;
}

/** How record `a`'s tide runs against `b`'s: the shift, every minute out to
 *  CLOCK_MAX_SHIFT either way, that best explains every phase difference at
 *  once, weighting each constituent by its amplitude. */
export function timeShift(a: Phases, b: Phases): TimeShift {
  const terms = CLOCK_CONSTITUENTS.map((name) => {
    const x = a.get(name)!;
    const y = b.get(name)!;
    return {
      difference: x.phase - y.phase,
      speed: constituents[name]!.speed / 60,
      weight: Math.sqrt(x.amplitude * y.amplitude),
    };
  });
  const total = terms.reduce((sum, t) => sum + t.weight, 0);
  let best = 0;
  let bestError = Infinity;
  for (let shift = -CLOCK_MAX_SHIFT; shift <= CLOCK_MAX_SHIFT; shift++) {
    let error = 0;
    for (const t of terms)
      error += t.weight * wrap(t.difference - t.speed * shift) ** 2;
    // Strictly less, so a tie keeps the shift nearest −13 h on every machine.
    if (error < bestError) {
      bestError = error;
      best = shift;
    }
  }
  return {
    minutes: best,
    residual: total > 0 ? Math.sqrt(bestError / total) : Infinity,
  };
}

/** Whether two records' M2 and K1 amplitudes agree within
 *  CLOCK_AMPLITUDE_RATIO. */
function sameTide(a: Phases, b: Phases): boolean {
  return ["M2", "K1"].every((name) => {
    const x = a.get(name)!.amplitude;
    const y = b.get(name)!.amplitude;
    return (
      Math.max(x, y) > 0 &&
      Math.min(x, y) / Math.max(x, y) >= CLOCK_AMPLITUDE_RATIO
    );
  });
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A record's source, as its clock practice is shared: a TICON contributor,
 *  or the directory of a source imported directly. */
export function clockSource(station: Station): string {
  return station.id.startsWith("ticon/")
    ? getSourceSuffix(station.source.id)
    : station.id.split("/")[0]!;
}

/** clockSource, apart for TICON's contributors and direct imports, which can
 *  share a name: TICON's `dmi` records and the `dmi` directory. */
function sourceKey(station: Station): string {
  return `${station.id.startsWith("ticon/") ? "ticon" : "direct"}:${clockSource(station)}`;
}

/** The gauge a record measures, so the moved or split records of one TICON
 *  gauge count once in their source's verdict. */
function clockGauge(station: Station): string {
  return station.id.startsWith("ticon/")
    ? `ticon:${gaugeKey(station.source.id)}`
    : station.id;
}

/** Minutes east of UTC of a time zone's standard time, the smaller of its
 *  January and July offsets under its 2025 rules: Nuuk moved from UTC−3 to
 *  UTC−2 in 2023. */
export function standardOffset(timezone: string): number {
  const offset = (month: number) => {
    const text = new Date(Date.UTC(2025, month, 15, 12)).toLocaleString(
      "en-US",
      { timeZone: timezone, timeZoneName: "longOffset" },
    );
    const match = /GMT(?:([+\-−])(\d{2}):(\d{2}))?/.exec(text);
    if (!match?.[1]) return 0;
    const minutes = Number(match[2]) * 60 + Number(match[3]);
    return match[1] === "+" ? minutes : -minutes;
  };
  return Math.min(offset(0), offset(6));
}

export interface ClockMeasurement {
  /** Median minutes late against the gauges timing it. */
  shift: number;
  gauges: number;
}

/** Each record that is not authoritative, timed against the authoritative
 *  gauges within CLOCK_NEIGHBOR_KM that carry the same tide, by the pairs a
 *  single shift explains within CLOCK_MAX_RESIDUAL. `canTime` leaves out an
 *  authoritative record whose constants fail their own checks. */
export function measureClocks(
  stations: Station[],
  canTime: (station: Station) => boolean = () => true,
): Map<string, ClockMeasurement> {
  const anchors = stations.flatMap((s) => {
    const phases = isAuthoritative(s) && canTime(s) ? clockPhases(s) : null;
    return phases ? [{ station: s, phases }] : [];
  });
  const measured = new Map<string, ClockMeasurement>();
  for (const station of stations) {
    if (isAuthoritative(station)) continue;
    const phases = clockPhases(station);
    if (!phases) continue;
    const shifts: number[] = [];
    for (const anchor of anchors) {
      const km = distance(
        station.latitude,
        station.longitude,
        anchor.station.latitude,
        anchor.station.longitude,
      );
      if (km > CLOCK_NEIGHBOR_KM || !sameTide(phases, anchor.phases)) continue;
      const shift = timeShift(phases, anchor.phases);
      if (shift.residual <= CLOCK_MAX_RESIDUAL) shifts.push(shift.minutes);
    }
    if (shifts.length > 0)
      measured.set(station.id, {
        shift: median(shifts),
        gauges: shifts.length,
      });
  }
  return measured;
}

const lag = (minutes: number) =>
  `${Math.abs(Math.round(minutes))} min ${minutes >= 0 ? "late" : "early"}`;

const utc = (minutes: number) => {
  const sign = minutes < 0 ? "−" : "+";
  const h = Math.floor(Math.abs(minutes) / 60);
  const m = Math.abs(minutes) % 60;
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
};

export interface SourceTiming {
  source: string;
  ticon: boolean;
  /** Timed gauges, each at the median of its records. */
  gauges: number;
  /** Gauges running SOURCE_CLOCK_SHIFT or more in the direction of `median`. */
  off: number;
  median: number;
}

/** Each source's timed gauges, by sourceKey. */
export function sourceTimings(
  stations: Station[],
  measured: Map<string, ClockMeasurement>,
): Map<string, SourceTiming> {
  const gauges = new Map<string, Map<string, number[]>>();
  const labels = new Map<string, string>();
  for (const station of stations) {
    const m = measured.get(station.id);
    if (!m) continue;
    const key = sourceKey(station);
    labels.set(key, clockSource(station));
    const bySource = gauges.get(key) ?? gauges.set(key, new Map()).get(key)!;
    const gauge = clockGauge(station);
    (bySource.get(gauge) ?? bySource.set(gauge, []).get(gauge)!).push(m.shift);
  }
  const timings = new Map<string, SourceTiming>();
  for (const [key, bySource] of gauges) {
    const shifts = [...bySource.values()].map(median);
    const typical = median(shifts);
    timings.set(key, {
      source: labels.get(key)!,
      ticon: key.startsWith("ticon:"),
      gauges: shifts.length,
      off: shifts.filter(
        (s) =>
          Math.sign(s) === Math.sign(typical) &&
          Math.abs(s) >= SOURCE_CLOCK_SHIFT,
      ).length,
      median: typical,
    });
  }
  return timings;
}

/** Whether a source's timing alone shows its clock is off: at least
 *  SOURCE_CLOCK_SHARE of at least SOURCE_CLOCK_GAUGES timed gauges off. */
export function timingShowsClockError(t: SourceTiming): boolean {
  return (
    t.gauges >= SOURCE_CLOCK_GAUGES && t.off / t.gauges >= SOURCE_CLOCK_SHARE
  );
}

/** Each source whose clock is measured as off, by its sourceKey: listed in
 *  CLOCK_ERROR_SOURCES, or with a timing that shows it. A source listed in
 *  OBSERVATION_ERROR_SOURCES isn't judged: its wrong constants run off its
 *  neighbors without a clock to blame. */
export function sourceClockErrors(
  stations: Station[],
  measured: Map<string, ClockMeasurement>,
): Map<string, string> {
  const timings = sourceTimings(stations, measured);
  const keys = new Set([
    ...timings.keys(),
    ...Object.keys(CLOCK_ERROR_SOURCES).map((source) => `ticon:${source}`),
  ]);
  const sources = new Map<string, string>();
  for (const key of keys) {
    const t = timings.get(key);
    const ticon = key.startsWith("ticon:");
    const source = t?.source ?? key.slice("ticon:".length);
    const listed = ticon ? CLOCK_ERROR_SOURCES[source] : undefined;
    if (!listed && ticon && OBSERVATION_ERROR_SOURCES[source]) continue;
    const timed = t
      ? `${t.off} of its ${t.gauges} gauge${t.gauges === 1 ? "" : "s"} ` +
        `timed against authoritative gauges within ${CLOCK_NEIGHBOR_KM} km ` +
        `run ${SOURCE_CLOCK_SHIFT} min or more ${t.median >= 0 ? "late" : "early"}, ` +
        `a median ${lag(t.median)}`
      : undefined;
    if (listed)
      sources.set(
        key,
        `Clock error in source ${source}: ${listed}${timed ? `; ${timed}` : ""}`,
      );
    else if (t && timingShowsClockError(t))
      sources.set(key, `Clock error in source ${source}: ${timed}`);
  }
  return sources;
}

/** The clock error of each record that has one, as an issue: every record of
 *  a source in sourceClockErrors, and a record running RECORD_CLOCK_SHIFT or
 *  more within ZONE_CLOCK_WINDOW of its time zone's standard offset, which is
 *  local time labeled UTC. */
export function clockErrors(
  stations: Station[],
  canTime?: (station: Station) => boolean,
): Map<string, string> {
  const measured = measureClocks(stations, canTime);
  const sources = sourceClockErrors(stations, measured);
  const errors = new Map<string, string>();
  for (const station of stations) {
    if (isAuthoritative(station)) continue;
    const m = measured.get(station.id);
    // Every record goes with its source, even one its neighbors time as right:
    // CRMS0139 times within 6 min of NOAA's and 93 min early against its own gauge.
    const source = sources.get(sourceKey(station));
    if (source) {
      errors.set(
        station.id,
        m ? `${source}; this record runs ${lag(m.shift)}` : source,
      );
      continue;
    }
    if (!m || Math.abs(m.shift) < RECORD_CLOCK_SHIFT) continue;
    const zone = standardOffset(station.timezone);
    if (Math.abs(m.shift - zone) > ZONE_CLOCK_WINDOW) continue;
    errors.set(
      station.id,
      `Clock error: runs ${lag(m.shift)} against ${m.gauges} ` +
        `authoritative gauge${m.gauges === 1 ? "" : "s"} within ` +
        `${CLOCK_NEIGHBOR_KM} km, near its standard time (${utc(zone)}): ` +
        `local time labeled UTC`,
    );
  }
  return errors;
}
