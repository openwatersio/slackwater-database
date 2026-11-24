import {
  constituents as catalog,
  createTidePredictor,
  fit,
  type FitOptions,
  type FittedConstituent,
} from "@slackwater/engine";
import { scoresWorse } from "@slackwater/stations/filtering";
import {
  harmonicSamples,
  type HarmonicConstituent,
  type Sample,
} from "./index.ts";

/**
 * Scores for one fit, in the three layers of the plan's Verification section
 * (docs/plans/stillwell-constituents.md): the fit's own diagnostics, a
 * held-out year of observations, and the agency's predictions. The scores
 * are numbers about a series, never the series, so a report built from them
 * can't carry an agency's curves or extremes.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * A running mean of `width` hours over hours i − lead to i − lead + width − 1,
 * NaN wherever a value is missing. An even width can't be centred, so the
 * Godin filter's two 24-hour passes lead by 11 and 12 hours, which cancel.
 */
function runningMean(xs: number[], width: number, lead: number): number[] {
  const out = new Array<number>(xs.length).fill(NaN);
  for (let i = lead; i + width - lead <= xs.length; i++) {
    let sum = 0;
    for (let k = i - lead; k < i - lead + width; k++) sum += xs[k]!;
    out[i] = sum / width;
  }
  return out;
}

/**
 * Observed minus predicted levels, averaged into whole UTC hours, with the
 * slow part taken out by a Godin filter (24, 24 and 25-hour running means;
 * Godin 1972, The Analysis of Tides): what is left is the diurnal and faster
 * band, where constituent errors show, plus seiches and noise. Keyed by UTC
 * hour (ms / 3600000); an hour counts only when the 71 hours around it all
 * have data. The filter also takes out the long-period constituents, so the
 * score can't see them. Constituents the engine doesn't know predict nothing.
 */
export function tidalResiduals(
  constituents: HarmonicConstituent[],
  samples: readonly Sample[],
  nodeCorrections: NodeCorrections = "iho",
): Map<number, number> {
  const out = new Map<number, number>();
  if (!samples.length) return out;
  const predictor = createTidePredictor(constituents, {
    offset: false,
    nodeCorrections,
  });
  const first = Math.floor(
    samples.reduce((m, s) => Math.min(m, s.t), Infinity) / HOUR_MS,
  );
  const sums: number[] = [];
  const counts: number[] = [];
  for (const { t, level } of samples) {
    const h = Math.floor(t / HOUR_MS) - first;
    sums[h] =
      (sums[h] ?? 0) +
      level -
      predictor.getWaterLevelAtTime({ time: new Date(t) }).level;
    counts[h] = (counts[h] ?? 0) + 1;
  }
  const hourly = Array.from({ length: sums.length }, (_, h) =>
    counts[h] ? sums[h]! / counts[h]! : NaN,
  );
  const slow = runningMean(
    runningMean(runningMean(hourly, 24, 11), 24, 12),
    25,
    12,
  );
  hourly.forEach((r, h) => {
    const fast = r - slow[h]!;
    if (Number.isFinite(fast)) out.set(first + h, fast);
  });
  return out;
}

/** The RMS of tidalResiduals, in metres, and how many hours it scored. */
export function rmsOf(residuals: Map<number, number>): {
  rms: number;
  hours: number;
} {
  let sum = 0;
  for (const r of residuals.values()) sum += r * r;
  return {
    rms: residuals.size ? Math.sqrt(sum / residuals.size) : NaN,
    hours: residuals.size,
  };
}

/** Hours in a block of the held-out year: 30 days, long enough that weather
 *  leaves one block's residuals roughly independent of the next's. This
 *  project's definition, as is the week a block needs scored. */
const BLOCK_HOURS = 30 * 24;

/**
 * The standard error of the mean, over the hours both score, of a² − b²: how
 * much the difference of two residual variances could move by chance in the
 * year scored. Taken from 30-day blocks, so weather's hour-to-hour
 * correlation doesn't shrink it. A block with less than a week scored is left
 * out. Null when fewer than two blocks remain, so it can't be measured.
 */
export function varianceDifferenceSE(
  a: Map<number, number>,
  b: Map<number, number>,
): number | null {
  const blocks = new Map<number, { sum: number; n: number }>();
  for (const [hour, x] of a) {
    const y = b.get(hour);
    if (y === undefined) continue;
    const block = Math.floor(hour / BLOCK_HOURS);
    const e = blocks.get(block) ?? { sum: 0, n: 0 };
    e.sum += x * x - y * y;
    e.n++;
    blocks.set(block, e);
  }
  const means = [...blocks.values()]
    .filter((e) => e.n >= 7 * 24)
    .map((e) => e.sum / e.n);
  if (means.length < 2) return null;
  const mean = means.reduce((s, x) => s + x, 0) / means.length;
  const variance =
    means.reduce((s, x) => s + (x - mean) ** 2, 0) / (means.length - 1);
  return Math.sqrt(variance / means.length);
}

/**
 * How the fit did against one other set of constants on the held-out year:
 * "better" or "worse" beyond the measurement error, "tie" within it, and
 * "unmeasured" when the year is too short to measure that error. A record
 * whose analysis covered the year keeps its verdict, marked as seen by the
 * caller: the year favours it, so a fit that still wins replaces it.
 */
export type Verdict = "better" | "worse" | "tie" | "unmeasured";

export function verdict(
  fitRms: number,
  otherRms: number,
  se: number | null,
): Verdict {
  if (se === null) return "unmeasured";
  if (scoresWorse(fitRms, otherRms, se)) return "worse";
  if (scoresWorse(otherRms, fitRms, se)) return "better";
  return "tie";
}

/** Bands of residual energy, by their centre in cycles per day. */
export const BANDS = { D1: 1, D2: 2, D4: 4, D6: 6 } as const;
/** Half the width of each band, in cycles per day: wide enough for 2Q1 to OO1
 *  around D1 and 2N2 to 2SM2 around D2. This project's definition. */
const BAND_HALF_WIDTH = 0.25;

/**
 * The RMS, in metres, of hourly residuals in each band of BANDS, from their
 * periodogram at the record's Rayleigh frequencies (k / span). With the mean
 * removed, the periodogram's sum over all frequencies is the variance
 * (Parseval). Gaps make it approximate, since the frequencies are then no
 * longer exactly orthogonal over the hours present.
 */
export function bandRms(
  residuals: Map<number, number>,
): Record<keyof typeof BANDS, number> {
  const hours = [...residuals.keys()];
  const n = hours.length;
  const out = { D1: NaN, D2: NaN, D4: NaN, D6: NaN };
  if (n < 2) return out;
  const first = Math.min(...hours);
  const span = Math.max(...hours) - first + 1;
  const mean = [...residuals.values()].reduce((s, x) => s + x, 0) / n;
  for (const [band, centre] of Object.entries(BANDS)) {
    let power = 0;
    const from = Math.ceil(((centre - BAND_HALF_WIDTH) * span) / 24);
    const to = Math.floor(((centre + BAND_HALF_WIDTH) * span) / 24);
    for (let k = from; k <= to; k++) {
      const w = (2 * Math.PI * k) / span;
      let re = 0;
      let im = 0;
      for (const [h, x] of residuals) {
        re += (x - mean) * Math.cos(w * (h - first));
        im -= (x - mean) * Math.sin(w * (h - first));
      }
      power += (2 * (re * re + im * im)) / (n * n);
    }
    out[band as keyof typeof BANDS] = Math.sqrt(power);
  }
  return out;
}

/** A high or low water. */
export interface Turn {
  t: number;
  level: number;
  high: boolean;
}

/**
 * High and low waters in hourly levels, picked the same way for an observed
 * and a predicted series, as Parker insists (2007, §3.9.1, pp. 129–130). Each
 * run of consecutive hours is picked on its own: a turn is the vertex of the
 * parabola through an hour higher (or lower) than both its neighbours, then
 * neighbouring turns of one kind keep the more extreme, and a rise or fall
 * smaller than `minRange` metres is a wiggle, removed smallest first.
 */
export function pickTurns(
  samples: readonly Sample[],
  minRange: number,
): Turn[] {
  const turns: Turn[] = [];
  let run: Sample[] = [];
  const flush = () => {
    turns.push(...pickRun(run, minRange));
    run = [];
  };
  for (const s of samples) {
    if (run.length && s.t !== run.at(-1)!.t + HOUR_MS) flush();
    run.push(s);
  }
  flush();
  return turns;
}

function pickRun(run: Sample[], minRange: number): Turn[] {
  let turns: Turn[] = [];
  for (let i = 1; i + 1 < run.length; i++) {
    const [y0, y1, y2] = [run[i - 1]!.level, run[i]!.level, run[i + 1]!.level];
    const high = y1 > y0 && y1 >= y2;
    if (!high && !(y1 < y0 && y1 <= y2)) continue;
    const a = (y0 - 2 * y1 + y2) / 2;
    const b = (y2 - y0) / 2;
    // A flat top (a = 0) has its turn on the hour.
    const offset = a ? -b / (2 * a) : 0;
    turns.push({
      t: run[i]!.t + offset * HOUR_MS,
      level: a ? y1 - (b * b) / (4 * a) : y1,
      high,
    });
  }
  const alternate = (list: Turn[]) =>
    list.reduce<Turn[]>((out, turn) => {
      const last = out.at(-1);
      if (last?.high !== turn.high) out.push(turn);
      else if (turn.high ? turn.level > last.level : turn.level < last.level)
        out[out.length - 1] = turn;
      return out;
    }, []);
  turns = alternate(turns);
  for (;;) {
    let smallest = -1;
    for (let i = 0; i + 1 < turns.length; i++) {
      const size = Math.abs(turns[i + 1]!.level - turns[i]!.level);
      if (
        size < minRange &&
        (smallest < 0 ||
          size < Math.abs(turns[smallest + 1]!.level - turns[smallest]!.level))
      )
        smallest = i;
    }
    if (smallest < 0) return turns;
    turns = alternate([
      ...turns.slice(0, smallest),
      ...turns.slice(smallest + 2),
    ]);
  }
}

/** How far predicted turns are from reference turns. */
export interface TurnScores {
  /** Reference turns with a predicted turn of the same kind within 3 hours. */
  matched: number;
  /** Reference turns without one. */
  unmatched: number;
  /** Predicted minus reference time, in minutes: negative is early. */
  timeMean: number;
  timeRms: number;
  /** Predicted minus reference height, in metres. */
  heightMean: number;
  heightRms: number;
}

/** Match each reference turn to the nearest predicted turn of its kind within
 *  3 hours, a quarter of a semidiurnal cycle: this project's definition. */
export function compareTurns(
  reference: readonly Turn[],
  predicted: readonly Turn[],
): TurnScores {
  const window = 3 * HOUR_MS;
  const dt: number[] = [];
  const dh: number[] = [];
  let j = 0;
  for (const r of reference) {
    while (j < predicted.length && predicted[j]!.t < r.t - window) j++;
    let best: Turn | undefined;
    for (
      let k = j;
      k < predicted.length && predicted[k]!.t <= r.t + window;
      k++
    )
      if (
        predicted[k]!.high === r.high &&
        (!best || Math.abs(predicted[k]!.t - r.t) < Math.abs(best.t - r.t))
      )
        best = predicted[k];
    if (!best) continue;
    dt.push((best.t - r.t) / 60_000);
    dh.push(best.level - r.level);
  }
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const rms = (xs: number[]) => Math.sqrt(mean(xs.map((x) => x * x)));
  return {
    matched: dt.length,
    unmatched: reference.length - dt.length,
    timeMean: mean(dt),
    timeRms: rms(dt),
    heightMean: mean(dh),
    heightRms: rms(dh),
  };
}

/**
 * Smallest rise or fall the picker counts at a gauge: a fifth of the standard
 * deviation of the observed tidal band (the Godin-filtered levels), so
 * seiches and noise smaller than that don't make turns. One value per gauge,
 * used for every series scored there. This project's definition.
 */
export function gaugeMinRange(observed: readonly Sample[]): number {
  const band = [...tidalResiduals([], observed).values()];
  const mean = band.reduce((s, x) => s + x, 0) / band.length;
  return (
    0.2 * Math.sqrt(band.reduce((s, x) => s + (x - mean) ** 2, 0) / band.length)
  );
}

/** Levels predicted from `constituents` at each sample's time, shifted by the
 *  mean of the samples minus the prediction, so turns compare by shape. */
export function predictAt(
  constituents: HarmonicConstituent[],
  samples: readonly Sample[],
  nodeCorrections: NodeCorrections = "iho",
): Sample[] {
  const predictor = createTidePredictor(constituents, {
    offset: false,
    nodeCorrections,
  });
  const predicted = samples.map(({ t }) => ({
    t,
    level: predictor.getWaterLevelAtTime({ time: new Date(t) }).level,
  }));
  const shift =
    samples.reduce((s, x, i) => s + x.level - predicted[i]!.level, 0) /
    samples.length;
  return predicted.map(({ t, level }) => ({ t, level: level + shift }));
}

/** The nodal correction formulas a set of constants was analyzed with. */
export type NodeCorrections = "iho" | "schureman";

/** One set of constants scored on the held-out year. */
export interface HeldOutScore {
  /** Tidal-band residual RMS after a Godin filter, in metres. */
  rms: number;
  hours: number;
  /** Residual RMS in each band, in metres. */
  bands: Record<keyof typeof BANDS, number>;
  /** Predicted high and low waters against observed ones. */
  turns: TurnScores;
  /** Against the fit: the standard error, in m², of the fit's residual
   *  variance minus this set's, and the fit's verdict. Absent for the fit. */
  se?: number | null;
  verdict?: Verdict;
  /** Whether this set's analysis covered the held-out year. */
  seen?: boolean;
}

/**
 * Score the fit and every other set of constants on the same observed hours
 * with the same code. `observed` holds hourly levels of the held-out year.
 */
export function scoreHeldOut(
  observed: readonly Sample[],
  fitted: HarmonicConstituent[],
  others: Record<
    string,
    {
      constituents: HarmonicConstituent[];
      seen: boolean;
      /** The nodal corrections the constants were analyzed with; IHO's by default. */
      nodeCorrections?: NodeCorrections | undefined;
    }
  >,
  /** The nodal corrections to predict the fitted constants with; IHO's by default. */
  fittedCorrections?: NodeCorrections,
): {
  minRange: number;
  fit: HeldOutScore;
  others: Record<string, HeldOutScore>;
} {
  const minRange = gaugeMinRange(observed);
  const observedTurns = pickTurns(observed, minRange);
  const score = (
    constituents: HarmonicConstituent[],
    nodeCorrections?: NodeCorrections,
  ) => {
    const residuals = tidalResiduals(constituents, observed, nodeCorrections);
    return {
      residuals,
      score: {
        ...rmsOf(residuals),
        bands: bandRms(residuals),
        turns: compareTurns(
          observedTurns,
          pickTurns(
            predictAt(constituents, observed, nodeCorrections),
            minRange,
          ),
        ),
      } satisfies HeldOutScore,
    };
  };
  const ours = score(fitted, fittedCorrections);
  return {
    minRange,
    fit: ours.score,
    others: Object.fromEntries(
      Object.entries(others).map(
        ([label, { constituents, seen, nodeCorrections }]) => {
          const theirs = score(constituents, nodeCorrections);
          const se = varianceDifferenceSE(ours.residuals, theirs.residuals);
          return [
            label,
            {
              ...theirs.score,
              se,
              verdict: verdict(ours.score.rms, theirs.score.rms, se),
              seen,
            },
          ];
        },
      ),
    ),
  };
}

/**
 * Eigenvalues and eigenvectors (columns of `vectors`) of a symmetric matrix,
 * by cyclic Jacobi rotations (Golub and Van Loan, Matrix Computations, §8.5).
 */
export function symmetricEigen(m: number[][]): {
  values: number[];
  vectors: number[][];
} {
  const n = m.length;
  const a = m.map((row) => [...row]);
  const v: number[][] = a.map((_, i) => a.map((_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++)
      for (let q = p + 1; q < n; q++) off += a[p]![q]! ** 2;
    if (off < 1e-30) break;
    for (let p = 0; p < n; p++)
      for (let q = p + 1; q < n; q++) {
        const apq = a[p]![q]!;
        if (Math.abs(apq) < 1e-300) continue;
        const theta = (a[q]![q]! - a[p]![p]!) / (2 * apq);
        const t =
          Math.sign(theta || 1) /
          (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k]![p]!;
          const akq = a[k]![q]!;
          a[k]![p] = c * akp - s * akq;
          a[k]![q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p]![k]!;
          const aqk = a[q]![k]!;
          a[p]![k] = c * apk - s * aqk;
          a[q]![k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k]![p]!;
          const vkq = v[k]![q]!;
          v[k]![p] = c * vkp - s * vkq;
          v[k]![q] = s * vkp + c * vkq;
        }
      }
  }
  return { values: a.map((row, i) => row[i]!), vectors: v };
}

/** The design matrix's conditioning and the most correlated pair of
 *  constituents. */
export interface Conditioning {
  /** Condition number of the column-scaled design matrix; null when it is singular. */
  conditionNumber: number | null;
  /** The largest |correlation| between two constituents' parameters. */
  maxCorrelation: { value: number; between: [string, string] } | null;
}

/**
 * Conditioning of a fit's design matrix at the samples' times: an offset and
 * a cosine and sine column for each constituent at its catalog speed, scaled
 * to unit length. It leaves out the nodal factors and the fit's weights,
 * which change slowly against the tide and scale whole columns, so it
 * describes the sampling and the choice of constituents rather than one
 * solve. Correlations come from the inverse of the scaled normal matrix.
 */
export function conditioning(
  samples: readonly Sample[],
  names: readonly string[],
): Conditioning {
  const speeds = names.map((name) => {
    const c = catalog[name];
    if (!c) throw new Error(`the engine's catalog has no ${name}`);
    return (c.speed * Math.PI) / 180;
  });
  const p = 1 + 2 * names.length;
  const normal = Array.from({ length: p }, () => new Float64Array(p));
  const row = new Float64Array(p);
  const t0 = samples[0]?.t ?? 0;
  for (const { t } of samples) {
    const hours = (t - t0) / HOUR_MS;
    row[0] = 1;
    speeds.forEach((w, j) => {
      row[1 + 2 * j] = Math.cos(w * hours);
      row[2 + 2 * j] = Math.sin(w * hours);
    });
    for (let i = 0; i < p; i++) {
      const ri = row[i]!;
      const ni = normal[i]!;
      for (let j = i; j < p; j++) ni[j] = ni[j]! + ri * row[j]!;
    }
  }
  const scale = normal.map((r, i) => 1 / Math.sqrt(r[i]!));
  const scaled = normal.map((_, i) =>
    normal.map(
      (_, j) =>
        (i <= j ? normal[i]![j]! : normal[j]![i]!) * scale[i]! * scale[j]!,
    ),
  );
  const { values, vectors } = symmetricEigen(scaled);
  const smallest = Math.min(...values);
  // Rounding leaves a singular matrix's smallest eigenvalue near zero, of either sign.
  if (smallest <= 1e-12 * Math.max(...values))
    return { conditionNumber: null, maxCorrelation: null };
  const conditionNumber = Math.sqrt(Math.max(...values) / smallest);
  // Inverse from the eigen-decomposition: V diag(1/λ) Vᵀ.
  const inverse = (i: number, j: number) =>
    values.reduce((s, l, k) => s + (vectors[i]![k]! * vectors[j]![k]!) / l, 0);
  let maxCorrelation: Conditioning["maxCorrelation"] = null;
  const constituentOf = (i: number) => names[Math.floor((i - 1) / 2)]!;
  for (let i = 1; i < p; i++)
    for (let j = i + 1; j < p; j++) {
      if (constituentOf(i) === constituentOf(j)) continue;
      const r = Math.abs(
        inverse(i, j) / Math.sqrt(inverse(i, i) * inverse(j, j)),
      );
      if (!maxCorrelation || r > maxCorrelation.value)
        maxCorrelation = {
          value: r,
          between: [constituentOf(i), constituentOf(j)],
        };
    }
  return { conditionNumber, maxCorrelation };
}

/** The constituents that Parker's stationarity check follows (plan, Checks before fitting). */
const MAJOR = ["M2", "S2", "K1", "O1"];

/**
 * Names a year of record separates by the Rayleigh criterion (Rmin = 1), in
 * the given order, each against the offset and every name kept before it.
 * One fixed set for every year, so no year's set differs from another's.
 */
export function yearlySet(names: readonly string[]): string[] {
  const hours = 365.2422 * 24;
  const kept: number[] = [0];
  return names.filter((name) => {
    const speed = catalog[name]?.speed;
    if (speed === undefined) return false;
    if (kept.some((k) => Math.abs(speed - k) * hours < 360)) return false;
    kept.push(speed);
    return true;
  });
}

/** Year-to-year scatter of M2, S2, K1 and O1. */
export interface YearlyScatter {
  /** Calendar years with at least two thirds of their hours. */
  years: number;
  /** Standard deviation of amplitude (m) and circular standard deviation of phase (°). */
  constituents: Record<string, { amplitude: number; phase: number }>;
}

/**
 * Fit each calendar year with the fixed yearlySet of `names` and measure the
 * scatter of M2, S2, K1 and O1 between years (Parker 2007, p. 86).
 */
export function yearlyScatter(
  samples: readonly Sample[],
  names: readonly string[],
  options: FitOptions = {},
): YearlyScatter {
  // Weights belong to the whole record's samples, not one year's.
  const { weights: _, ...yearOptions } = options;
  const set = yearlySet(names);
  const byYear = new Map<number, Sample[]>();
  for (const s of samples) {
    const y = new Date(s.t).getUTCFullYear();
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y)!.push(s);
  }
  const fits: FittedConstituent[][] = [];
  for (const [year, rows] of byYear) {
    const hours = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / HOUR_MS;
    if (rows.length < (2 / 3) * hours) continue;
    fits.push(
      fit(harmonicSamples(rows), set, { ...yearOptions, dropDependent: true })
        .constituents,
    );
  }
  const constituents: YearlyScatter["constituents"] = {};
  if (fits.length >= 2)
    for (const name of MAJOR) {
      const values = fits.flatMap((f) => f.filter((c) => c.name === name));
      if (values.length < 2) continue;
      const amps = values.map((c) => c.amplitude);
      const mean = amps.reduce((s, x) => s + x, 0) / amps.length;
      const rad = values.map((c) => (c.phase * Math.PI) / 180);
      const R = Math.hypot(
        rad.reduce((s, x) => s + Math.cos(x), 0) / rad.length,
        rad.reduce((s, x) => s + Math.sin(x), 0) / rad.length,
      );
      constituents[name] = {
        amplitude: Math.sqrt(
          amps.reduce((s, x) => s + (x - mean) ** 2, 0) / (amps.length - 1),
        ),
        phase: (Math.sqrt(-2 * Math.log(Math.min(R, 1))) * 180) / Math.PI,
      };
    }
  return { years: fits.length, constituents };
}

/** One constituent of ours against the agency's, as differences only. */
export interface ConstantDifference {
  name: string;
  /** Ours minus theirs, in metres and degrees (phase wrapped to ±180). */
  amplitude: number;
  phase: number;
  /** Our 95% intervals' half-widths, widened by the agency's rounding. */
  amplitudeInterval: number | null;
  phaseInterval: number | null;
  /** The larger of |amplitude| / amplitudeInterval and |phase| / phaseInterval:
   *  over 1 is outside our 95% interval, by that factor. */
  ratio: number | null;
}

/**
 * Our fitted constants against an agency's, name for name. `rounding` is half
 * the last digit the agency publishes, in metres and degrees: its constants
 * are uncertain by that much at least, so it widens our intervals in
 * quadrature before the ratio is taken, and a difference that is only the
 * agency's rounding isn't counted as one.
 */
export function compareConstants(
  ours: readonly FittedConstituent[],
  theirs: readonly HarmonicConstituent[],
  rounding = { amplitude: 0, phase: 0 },
): ConstantDifference[] {
  const byName = new Map(theirs.map((c) => [c.name, c]));
  return ours.flatMap((c) => {
    const t = byName.get(c.name);
    if (!t) return [];
    const amplitude = c.amplitude - t.amplitude;
    const phase = ((((c.phase - t.phase) % 360) + 540) % 360) - 180;
    const ai =
      c.amplitudeInterval == null
        ? null
        : Math.hypot(c.amplitudeInterval, rounding.amplitude);
    const pi =
      c.phaseInterval == null
        ? null
        : Math.hypot(c.phaseInterval, rounding.phase);
    return [
      {
        name: c.name,
        amplitude,
        phase,
        amplitudeInterval: ai,
        phaseInterval: pi,
        ratio:
          ai && pi
            ? Math.max(Math.abs(amplitude) / ai, Math.abs(phase) / pi)
            : null,
      },
    ];
  });
}

/** How far our predicted curve is from the agency's, at the times both have. */
export function compareCurves(
  ours: readonly Sample[],
  theirs: readonly Sample[],
): { n: number; rms: number; max: number } {
  const byTime = new Map(theirs.map((s) => [s.t, s.level]));
  const d = ours.flatMap((s) => {
    const t = byTime.get(s.t);
    return t === undefined ? [] : [s.level - t];
  });
  const mean = d.reduce((s, x) => s + x, 0) / d.length;
  // A curve on another datum differs by a constant, which says nothing of the tide.
  const centred = d.map((x) => x - mean);
  return {
    n: d.length,
    rms: Math.sqrt(centred.reduce((s, x) => s + x * x, 0) / d.length),
    max: Math.max(...centred.map(Math.abs)),
  };
}

/** Hourly instants in [start, end). */
export function hourly(start: Date, end: Date): number[] {
  const out: number[] = [];
  for (let t = Math.ceil(+start / HOUR_MS) * HOUR_MS; t < +end; t += HOUR_MS)
    out.push(t);
  return out;
}

/** Whether a record analyzed over `epoch` saw any of [start, end). A record
 *  that doesn't say when it was analyzed may have seen it. */
export function sawYear(
  epoch: { start?: string; end?: string } | undefined,
  start: Date,
  end: Date,
): boolean {
  return (
    !epoch?.end ||
    !Number.isFinite(Date.parse(epoch.end)) ||
    (epoch.start !== undefined && !Number.isFinite(Date.parse(epoch.start))) ||
    (Date.parse(epoch.end) + DAY_MS > +start &&
      Date.parse(epoch.start ?? "0000-01-01") < +end)
  );
}
