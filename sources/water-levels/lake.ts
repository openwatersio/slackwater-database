import {
  constituentsDigest,
  getSourceSuffix,
  roundConstituents,
} from "@slackwater/stations";
import {
  fitHarmonics,
  isAnalyzable,
  isLongPeriod,
  tidalResidual,
  tidalResiduals,
  type HarmonicConstituent,
  type Sample,
} from "@slackwater/harmonic-analysis";
import {
  lakeStation,
  lakeStations,
  MEASURED_FLAGS,
  readLakeSamples,
} from "@slackwater/harmonic-analysis/lake";

/**
 * The agencies whose series in the water-levels lake are fit here, by their
 * lake source name, which is also their TICON suffix and the directory under
 * data/ their records go to. Each joins once its lake series are fully
 * backfilled, in the order of the lake's TICON replacement inventory
 * (water-levels docs/ticon-replacement.md). sources/<name>/metadata.yaml
 * declares its credit.
 */
export const CONTRIBUTORS = new Map([
  [
    "smhi",
    {
      name: "Swedish Meteorological and Hydrological Institute",
      license: {
        type: "cc-by-4.0",
        commercial_use: true,
        url: "https://creativecommons.org/licenses/by/4.0/",
      },
    },
  ],
]);

/** Years of record a fit takes before its held-out year: one nodal cycle. */
const FIT_YEARS = 19;
const HOUR_MS = 3_600_000;

/** The year a fit was scored on, with its score and every TICON relay's. */
export interface HeldOut {
  start: string;
  end: string;
  /** How many of its hours were scored. */
  hours: number;
  /** The fit's tidal-band residual over the year, in metres (see tidalResidual). */
  rms: number;
  /** Each TICON record of the gauge, by id: its residual; the standard error, in m², of the fit's residual variance minus its own; and a digest of the constants scored (constituentsDigest). */
  ticon: Record<string, { rms: number; se: number; digest: string }>;
}

/** A TICON record of the gauge, to score against the fit. */
export interface Relay {
  id: string;
  constituents: HarmonicConstituent[];
}

export interface LakeFit {
  constituents: HarmonicConstituent[];
  /** The span of samples the fit used, and how many samples it had. */
  fit: { start: string; end: string; hours: number };
  held_out: HeldOut;
  /** The fit years and the held-out year, from which datums are reduced. */
  window: { start: Date; end: Date };
}

/**
 * The lake series for a TICON record's gauge: the series the lake prefers
 * for its GESLA record, which GESLA and TICON name alike. A record whose
 * gauge has no series of the contributor's own in the lake has none.
 */
export async function lakeSeries(ticonId: string): Promise<string | undefined> {
  const contributor = getSourceSuffix(ticonId);
  if (!CONTRIBUTORS.has(contributor)) return undefined;
  const gesla = await lakeStation(`gesla/${ticonId}`);
  // A gauge the lake prefers another agency's series for isn't this one's.
  if (!gesla?.preferred.startsWith(`${contributor}/`)) return undefined;
  if (!(await lakeStation(gesla.preferred)))
    throw new Error(
      `${gesla.id} prefers ${gesla.preferred}, which the lake doesn't list`,
    );
  return gesla.preferred;
}

/** Every TICON record the lake files under a series: the GESLA records whose
 *  preferred series it is, such as SMHI's own, CMEMS's and UHSLC's copies of
 *  one gauge. */
export async function lakeRelays(series: string): Promise<string[]> {
  return [...(await lakeStations()).values()]
    .filter((s) => s.id.startsWith("gesla/") && s.preferred === series)
    .map((s) => s.id.slice("gesla/".length))
    .sort();
}

const isoDate = (t: number) => new Date(t).toISOString().slice(0, 10);
const yearStart = (year: number) => new Date(Date.UTC(year, 0, 1));

const DAY_MS = 86_400_000;

/** `date` moved by `years` whole years. */
const addYears = (date: Date, years: number) => {
  const d = new Date(date);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d;
};

/**
 * Fit TICON's constituent names to a lake series over the FIT_YEARS before a
 * held-out year, and score the fit and each relay's constants on that year by
 * their tidal-band residuals. The held-out year starts the day after
 * `ticonEnd`, the last day of TICON's record, so neither set of constants was
 * fitted on it. A series
 * with too little of that year to score, such as one TICON covers to its last
 * reading, holds out its last calendar year, or the one before, which TICON's
 * constants may have been fitted on. A year needs half its hours scored. The
 * fit keeps the long-period constituents of `longPeriod`, a TICON record of
 * the gauge, since the score can't see them, or its own where that is null.
 * It is scored as it is published, rounded. Returns undefined when the series is
 * too short to fit or score.
 */
export async function fitFromLake(
  series: string,
  ticon: HarmonicConstituent[],
  ticonEnd?: Date,
  relays: Relay[] = [],
  longPeriod: HarmonicConstituent[] | null = ticon,
): Promise<LakeFit | undefined> {
  const station = await lakeStation(series);
  if (!station) throw new Error(`${series} is not in the public lake`);
  if (!station.last) return undefined;
  const lastYear = station.last.getUTCFullYear();
  const windows = [
    ...(ticonEnd
      ? [
          {
            start: new Date(+ticonEnd + DAY_MS),
            end: addYears(new Date(+ticonEnd + DAY_MS), 1),
          },
        ]
      : []),
    { start: yearStart(lastYear), end: yearStart(lastYear + 1) },
    { start: yearStart(lastYear - 1), end: yearStart(lastYear) },
  ];
  // One read covers the fit for every candidate year.
  const samples = await readLakeSamples(
    series,
    {
      start: addYears(
        new Date(Math.min(...windows.map((w) => +w.start))),
        -FIT_YEARS,
      ),
      end: new Date(Math.max(...windows.map((w) => +w.end))),
    },
    MEASURED_FLAGS,
  );
  for (const window of windows) {
    const fit = scoreYear(
      samples,
      window,
      ticon,
      longPeriod,
      relays,
      series.split("/")[0]!,
    );
    if (fit) return fit;
  }
  return undefined;
}

/** Fit the FIT_YEARS before the held-out year and score that year, or
 *  undefined when the fit years are too short to analyze or the year to
 *  score. */
function scoreYear(
  samples: Sample[],
  { start: heldOutStart, end: heldOutEnd }: { start: Date; end: Date },
  ticon: HarmonicConstituent[],
  longPeriod: HarmonicConstituent[] | null,
  relays: Relay[],
  contributor: string,
): LakeFit | undefined {
  const fitStart = addYears(heldOutStart, -FIT_YEARS);
  const fitSamples = samples.filter(
    (s) => s.t >= +fitStart && s.t < +heldOutStart,
  );
  const heldOut = samples.filter(
    (s) => s.t >= +heldOutStart && s.t < +heldOutEnd,
  );
  const names = ticon.map((c) => c.name);
  if (!isAnalyzable(fitSamples, names.length)) return undefined;

  const fitted = fitHarmonics(fitSamples, names);
  // Rounded as published, so the score and the datums see what is saved.
  const constituents = roundConstituents(
    contributor,
    ticon.flatMap((t) =>
      isLongPeriod(t.name) && longPeriod
        ? longPeriod.filter((c) => c.name === t.name)
        : fitted.filter((c) => c.name === t.name),
    ),
  );
  const residuals = tidalResiduals(constituents, heldOut);
  const scored = tidalResidual(constituents, heldOut);
  // Half the year's hours, 4392 in a leap year, must be scored.
  if (scored.hours < (+heldOutEnd - +heldOutStart) / HOUR_MS / 2)
    return undefined;
  return {
    constituents,
    fit: {
      start: isoDate(fitSamples[0]!.t),
      end: isoDate(fitSamples.at(-1)!.t),
      hours: fitSamples.length,
    },
    held_out: {
      start: isoDate(+heldOutStart),
      end: isoDate(+heldOutEnd - DAY_MS),
      hours: scored.hours,
      rms: round(scored.rms),
      ticon: Object.fromEntries(
        relays.map((r) => [
          r.id,
          {
            rms: round(tidalResidual(r.constituents, heldOut).rms),
            se: Number(
              varianceDifferenceSE(
                residuals,
                tidalResiduals(r.constituents, heldOut),
              ).toFixed(12),
            ),
            digest: constituentsDigest(r.constituents),
          },
        ]),
      ),
    },
    window: { start: fitStart, end: heldOutEnd },
  };
}

// Scores are kept to a micrometre, so their squares' rounding stays far below
// the variance tolerance they are judged against.
const round = (m: number) => Math.round(m * 1e6) / 1e6;

/** Hours in a block of the held-out year: 30 days, long enough that weather
 *  leaves one block's residuals roughly independent of the next's. */
const BLOCK_HOURS = 30 * 24;

/**
 * The standard error of the mean, over the hours both score, of a² − b²: how
 * much the difference of two residual variances could move by chance in the
 * year scored. Taken from 30-day blocks, so weather's hour-to-hour
 * correlation doesn't shrink it. A block with less than a week scored is
 * left out.
 */
export function varianceDifferenceSE(
  a: Map<number, number>,
  b: Map<number, number>,
): number {
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
  if (means.length < 2) return Infinity;
  const mean = means.reduce((s, x) => s + x, 0) / means.length;
  const variance =
    means.reduce((s, x) => s + (x - mean) ** 2, 0) / (means.length - 1);
  return Math.sqrt(variance / means.length);
}
