import {
  createTidePredictor,
  type TidePredictionOptions,
  type HarmonicConstituent,
} from "@neaps/tide-predictor";

export interface EpochSpec {
  end?: Date;
}

/** A single water-level point. `Extreme` from the predictor is assignable to this. */
export interface Sample {
  time: Date;
  level: number;
}

export type Datums = Record<string, number>;

export interface TidalDatumsResult {
  start: Date;
  end: Date;
  datums: Datums;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** One full lunar nodal cycle (6798.383 days = 18.6130 years) */
export const NODAL_CYCLE_DAYS = 6798.383;
/** M2 angular speed (°/hr) — principal lunar semi-diurnal constituent */
const M2_SPEED = 28.9841042;
/** Mean tidal day: two M2 cycles (hours) */
const M2_TIDAL_DAY_HOURS = (360 / M2_SPEED) * 2;

/**
 * Pinned datum epoch: 19 full calendar years (2007–2025), the smallest
 * calendar-aligned window containing one 18.61-year lunar nodal cycle.
 *
 * Pinned (never derived from the current date) so regeneration is
 * deterministic — data diffs only ever reflect logic changes. 19 *full* years
 * rather than `now − 18.61y` because: partial years bias annual statistics
 * (LLWLT averages *annual* lowest lows, so a partial year's minimum is drawn
 * from fewer candidates and sits high); a fractional window over-samples the
 * seasons in its 0.61-year tail, skewing every mean datum; and 19 years ≈ the
 * Metonic cycle, so spring/neap phases distribute evenly across the seasons.
 * Same convention as NOAA's National Tidal Datum Epoch and CHS (both 19 y).
 * Bump deliberately (and regenerate the data) — roughly once a decade.
 */
export const DATUM_EPOCH = {
  start: new Date("2007-01-01T00:00:00Z"),
  end: new Date("2026-01-01T00:00:00Z"),
} as const;

const EPOCH_YEARS = 19;

/**
 * Resolve an EpochSpec to explicit start/end Dates.
 *
 * With no `end`, returns the pinned DATUM_EPOCH. With an explicit `end` (e.g.
 * windowing an observation record that stops before the pinned epoch), uses the
 * 19 years ending at `end` — never less than a full nodal cycle, since shorter
 * spans miss the full range of lunar node variation.
 */
export function resolveEpoch({ end }: EpochSpec): {
  start: Date;
  end: Date;
} {
  if (!end) return { start: DATUM_EPOCH.start, end: DATUM_EPOCH.end };
  const start = new Date(end);
  start.setUTCFullYear(start.getUTCFullYear() - EPOCH_YEARS);
  return { start, end };
}

/**
 * Core helper: given a regular timeline of {time, level}, compute datums.
 *
 * `msl` is the mean sea level to report (mean of all hourly heights, per NOAA
 * CO-OPS handbook §3.1). It only sets the returned MSL field; every other datum
 * stays in the input series' native frame. Synthetic (constituent) callers leave
 * it 0; observed callers pass the mean of the hourly series.
 */
function computeDatumsFromExtremes(extremes: Sample[], msl = 0): Datums {
  const allHighs: number[] = [];
  const allLows: number[] = [];
  const higherHighs: number[] = [];
  const lowerLows: number[] = [];
  // Lowest low water observed in each calendar year, keyed by UTC year. Averaged
  // into LLWLT (Canada's Lower Low Water, Large Tide — the mean of the annual
  // lowest low waters over the analysis period).
  const lowestLowByYear = new Map<number, number>();

  const tidalDayMs = M2_TIDAL_DAY_HOURS * 60 * 60 * 1000;
  const times = extremes.map((pt) => pt.time);
  const heights = extremes.map((pt) => pt.level);

  if (times.length === 0) {
    throw new Error("times array is empty");
  }
  const firstTime = times[0];
  const lastTime = times[times.length - 1];
  if (!firstTime || !lastTime) {
    throw new Error("times array is empty");
  }

  let dayStartTime = firstTime.getTime();
  let idx = 0;
  let daysWithHighs = 0;
  let daysWithLows = 0;

  while (dayStartTime < lastTime.getTime()) {
    const dayEndTime = dayStartTime + tidalDayMs;

    const idxStart = idx;
    while (idx < times.length && times[idx]!.getTime() < dayEndTime) {
      idx++;
    }
    const idxEnd = idx;

    if (idxEnd - idxStart >= 3) {
      const highs: number[] = [];
      const lows: number[] = [];

      for (let i = idxStart + 1; i < idxEnd - 1; i++) {
        const hPrev = heights[i - 1];
        const hCurr = heights[i];
        const hNext = heights[i + 1];

        if (
          hCurr !== undefined &&
          hPrev !== undefined &&
          hNext !== undefined &&
          hCurr >= hPrev &&
          hCurr >= hNext &&
          (hCurr > hPrev || hCurr > hNext)
        ) {
          highs.push(hCurr);
        } else if (
          hCurr !== undefined &&
          hPrev !== undefined &&
          hNext !== undefined &&
          hCurr <= hPrev &&
          hCurr <= hNext &&
          (hCurr < hPrev || hCurr < hNext)
        ) {
          lows.push(hCurr);
          const yr = times[i]!.getUTCFullYear();
          const prevMin = lowestLowByYear.get(yr);
          if (prevMin === undefined || hCurr < prevMin) {
            lowestLowByYear.set(yr, hCurr);
          }
        }
      }

      if (highs.length > 0) {
        daysWithHighs++;
        allHighs.push(...highs);
        highs.sort((a, b) => a - b);
        // higher high
        const hhVal = highs[highs.length - 1];
        if (hhVal !== undefined) {
          higherHighs.push(hhVal);
        }
      }

      if (lows.length > 0) {
        daysWithLows++;
        allLows.push(...lows);
        lows.sort((a, b) => a - b);
        // lower low
        const llVal = lows[0];
        if (llVal !== undefined) {
          lowerLows.push(llVal);
        }
      }
    }

    dayStartTime += tidalDayMs;

    // ensure idx keeps up
    while (idx < times.length && times[idx]!.getTime() < dayStartTime) {
      idx++;
    }
  }

  const mhw = mean(allHighs);
  const mlw = mean(allLows);

  return {
    // max/min loop instead of Math.max(...heights): observed series have 100k+
    // points and the spread overflows the call stack.
    HAT: toFixed(max(heights), 3),
    MHHW: toFixed(mean(higherHighs), 3),
    MHW: toFixed(mhw, 3),
    // MSL = mean of hourly heights (NOAA CO-OPS handbook §3.1). 0 for synthetic
    // constituent series; the observed mean for real water-level series.
    MSL: toFixed(msl, 3),
    MTL: toFixed((mhw + mlw) / 2, 3),
    MLW: toFixed(mlw, 3),
    MLLW: toFixed(mean(lowerLows), 3),
    // LLWLT (Lower Low Water, Large Tide): mean of the annual lowest low waters.
    // Meaningful only over a multi-year span; NaN for sub-annual series and
    // dropped by the caller.
    LLWLT: toFixed(mean([...lowestLowByYear.values()]), 3),
    LAT: toFixed(min(heights), 3),
  };
}

/**
 * Amplitude-derived low/high datums, in the constituent frame (MSL = 0). These
 * are functions of the constituent amplitudes rather than the extremes series,
 * so the caller shifts them into the observed gauge frame the same way it does
 * HAT/LAT.
 *
 * - MHWS/MLWS: Mean High/Low Water Springs, the classic Admiralty approximation
 *   MSL ± (H_M2 + H_S2).
 * - ISLW: Indian Spring Low Water, MSL − (H_M2 + H_S2 + H_K1 + H_O1). Stored
 *   under the national labels NLLW (Japan, "Nearly Lowest Low Water") and ALLW
 *   (South Korea, "Approximate Lowest Low Water"), which share this definition.
 * - TLT: China's Theoretical Lowest Tide (理论最低潮面 / theoretical depth
 *   datum). Approximated as the astronomical minimum of the tide predicted from
 *   the 13 constituents the Vladimirsky method uses. This is NOT the official
 *   Vladimirsky tabular calculation, so expect cm-level differences from
 *   published Chinese values — it captures the theoretical-lowest intent by
 *   restricting the constituent set relative to LAT.
 */
const TLT_CONSTITUENTS = new Set([
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
  "M6",
  "SA",
  "SSA",
]);

function amplitudeDatums(constituents: HarmonicConstituent[]): Datums {
  const amp = new Map<string, number>();
  for (const c of constituents) amp.set(c.name, c.amplitude);
  // Without M2 the approximations would collapse to MSL; omit them instead
  // (mirrors computeTLT returning undefined on an empty subset).
  if (!amp.has("M2")) return {};
  const a = (name: string) => amp.get(name) ?? 0;

  const springs = a("M2") + a("S2");
  const islw = a("M2") + a("S2") + a("K1") + a("O1");

  return {
    MHWS: toFixed(springs, 3),
    MLWS: toFixed(-springs, 3),
    // ISLW value, exposed under both national labels (same construct).
    NLLW: toFixed(-islw, 3),
    ALLW: toFixed(-islw, 3),
  };
}

/**
 * China's Theoretical Lowest Tide, computed as the astronomical minimum of the
 * tide synthesized from the Vladimirsky 13-constituent subset over the epoch, in
 * the constituent frame (MSL = 0). Returns undefined when none of the subset
 * constituents are present.
 */
function computeTLT(
  constituents: HarmonicConstituent[],
  start: Date,
  end: Date,
  tidePredictorOptions: TidePredictionOptions,
): number | undefined {
  const subset = constituents.filter((c) => TLT_CONSTITUENTS.has(c.name));
  if (subset.length === 0) return undefined;
  const predictor = createTidePredictor(subset, tidePredictorOptions);
  const extremes = predictor.getExtremesPrediction({ start, end });
  if (extremes.length === 0) return undefined;
  return toFixed(min(extremes.map((e) => e.level)), 3);
}

/**
 * Use @neaps/tide-predictor to synthesize a multi-year tidal timeline
 * for a given set of constituents, and compute tidal datums from it.
 */
export function computeDatums(
  constituents: HarmonicConstituent[],
  epochSpec: EpochSpec,
  tidePredictorOptions: TidePredictionOptions = {},
): TidalDatumsResult {
  const { start, end } = resolveEpoch(epochSpec);

  // Build predictor from @neaps/tide-predictor
  const predictor = createTidePredictor(constituents, tidePredictorOptions);

  // Get extremes over the epoch
  const extremes = predictor.getExtremesPrediction({
    start,
    end,
  });

  const datums: Datums = {
    ...computeDatumsFromExtremes(extremes),
    ...amplitudeDatums(constituents),
  };
  const tlt = computeTLT(constituents, start, end, tidePredictorOptions);
  if (tlt !== undefined) datums["TLT"] = tlt;

  // Drop any datum that came out non-finite (e.g. LLWLT for a sub-annual
  // synthetic series), so callers never persist NaN.
  for (const [k, v] of Object.entries(datums)) {
    if (!Number.isFinite(v)) delete datums[k];
  }

  return { start, end, datums };
}

/** Minimum record span (days) and hourly-point count to derive datums from observations. */
const MIN_DATUM_DAYS = 365;
const MIN_HOURLY_POINTS = 4000;
const HOUR_MS = 60 * 60 * 1000;

/**
 * Parse a GESLA-4 station file into UTC water-level samples.
 *
 * Keeps only rows flagged use-in-analysis (`use_flag === 1`, which already
 * excludes QC spikes/doubtful/missing) and drops the -99.9999 null. Times are
 * converted to UTC using the header's `TIME ZONE HOURS` (expected 0 for GESLA-4,
 * honored defensively).
 */
export function parseGeslaSamples(text: string): Sample[] {
  const lines = text.split(/\r?\n/);

  let tzHours = 0;
  let nullValue = -99.9999; // GESLA-4 default; overridden by the header below
  for (const line of lines) {
    if (!line.startsWith("#")) break;
    const tz = line.match(/^#\s*TIME ZONE HOURS\s+(-?\d+(?:\.\d+)?)/);
    if (tz) tzHours = parseFloat(tz[1]!);
    const nv = line.match(/^#\s*NULL VALUE\s+(-?\d+(?:\.\d+)?)/);
    if (nv) nullValue = parseFloat(nv[1]!);
  }
  const tzMs = tzHours * HOUR_MS;

  const samples: Sample[] = [];
  for (const line of lines) {
    if (!line || line.startsWith("#")) continue;
    const f = line.trim().split(/\s+/);
    if (f.length < 5 || f[4] !== "1") continue;
    const level = parseFloat(f[2]!);
    if (!Number.isFinite(level) || Math.abs(level - nullValue) < 1e-3) continue;
    const t = Date.parse(`${f[0]!.replaceAll("/", "-")}T${f[1]}Z`);
    if (!Number.isFinite(t)) continue;
    samples.push({ time: new Date(t - tzMs), level });
  }
  return samples;
}

/** Bin samples to mean level per UTC hour, sorted ascending. */
function binHourly(samples: Sample[]): Sample[] {
  const buckets = new Map<number, { sum: number; n: number }>();
  for (const s of samples) {
    const key = Math.floor(s.time.getTime() / HOUR_MS);
    const e = buckets.get(key);
    if (e) {
      e.sum += s.level;
      e.n += 1;
    } else {
      buckets.set(key, { sum: s.level, n: 1 });
    }
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([key, { sum, n }]) => ({
      time: new Date(key * HOUR_MS),
      level: sum / n,
    }));
}

/**
 * Derive tidal datums directly from observed water-level samples (NOAA CO-OPS
 * "first reduction", Computational Techniques for Tidal Datums Handbook §3.1).
 *
 * Bins to hourly heights, takes the most recent ≤18.6-year window, and computes
 * mean datums in the gauge's native frame with real MSL = mean of hourly heights.
 * No control-station correction (acceptable: short-record bias is cm-level per
 * Swanson 1974, vs the 0.3–0.5 m datum errors this replaces). HAT/LAT returned
 * here are observed extremes and should be discarded in favor of harmonic values.
 *
 * Returns null when the windowed record is too short/sparse to be meaningful.
 */
export function computeDatumsFromObservations(
  samples: Sample[],
): TidalDatumsResult | null {
  if (samples.length === 0) return null;

  const hourlyAll = binHourly(samples);
  const end = hourlyAll[hourlyAll.length - 1]!.time;
  const { start } = resolveEpoch({ end });
  const hourly = hourlyAll.filter((s) => s.time >= start);

  const spanDays = (end.getTime() - hourly[0]!.time.getTime()) / DAY_MS;
  if (spanDays < MIN_DATUM_DAYS || hourly.length < MIN_HOURLY_POINTS)
    return null;

  const observedMSL = mean(hourly.map((s) => s.level));
  const datums = computeDatumsFromExtremes(hourly, observedMSL);
  if (!Number.isFinite(datums["MHW"]) || !Number.isFinite(datums["MLW"]))
    return null;

  return { start: hourly[0]!.time, end, datums };
}

export function toFixed(num: number, digits: number) {
  if (typeof num !== "number") return num;

  const factor = Math.pow(10, digits);
  return Math.round(num * factor) / factor;
}

export function mean(arr: number[]): number {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : NaN;
}

/** Loop-based min/max — avoids the call-stack overflow of Math.min/max(...arr) on large arrays. */
export function max(arr: number[]): number {
  let m = -Infinity;
  for (const v of arr) if (v > m) m = v;
  return m;
}

export function min(arr: number[]): number {
  let m = Infinity;
  for (const v of arr) if (v < m) m = v;
  return m;
}
