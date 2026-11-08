import { AMPLITUDE_TOLERANCE, getSourceSuffix } from "@slackwater/stations";
import {
  fitHarmonics,
  isAnalyzable,
  isLongPeriod,
  tidalResidual,
  type HarmonicConstituent,
  type Sample,
} from "@slackwater/harmonic-analysis";
import {
  lakeStation,
  readLakeSamples,
} from "@slackwater/harmonic-analysis/lake";

/**
 * TICON contributors whose records are re-fit from their originator's series
 * in the water-levels lake instead of taking TICON's published constants.
 * Each joins once its lake series are fully backfilled, in the order of the
 * lake's TICON replacement inventory (water-levels docs/ticon-replacement.md).
 * A contributor joins only once its lake series are in the same datum as its
 * GESLA-4 records, since getDatums can fall back to the GESLA-4 reduction:
 * SMHI's are both RH 2000.
 */
export const LAKE_CONTRIBUTORS = new Map([
  // A swapped record takes the originator's source, whose metadata.yaml
  // credits it (sources/smhi).
  [
    "smhi",
    {
      name: "Swedish Meteorological and Hydrological Institute",
      url: "https://github.com/openwatersio/water-levels",
    },
  ],
]);

/** Years of record a re-fit uses before its held-out year: one nodal cycle. */
const FIT_YEARS = 19;
const HOUR_MS = 3_600_000;

/** What a lake re-fit was scored on and whether it replaced TICON's constants. */
export interface LakeRefit {
  /** The lake series, such as `smhi/2130`. */
  series: string;
  /** The span of samples the re-fit used. */
  fit: { start: string; end: string };
  /** The year both sets of constants were scored on, after the fit, and how many of its hours were scored. */
  held_out: { start: string; end: string; hours: number };
  /** Each set's tidal-band residual over the held-out year, in metres (see tidalResidual). */
  rms: { refit: number; published: number };
  /** Whether the re-fit replaced TICON's published constants. */
  swapped: boolean;
}

export interface LakeResult {
  refit: LakeRefit;
  constituents: HarmonicConstituent[];
  /** Every sample read, for the datum reduction: the fit and held-out years. */
  samples: Sample[];
}

/**
 * The lake series to re-fit a TICON record from: the series the lake prefers
 * for the gauge of its GESLA record, which GESLA and TICON name alike. A
 * record whose gauge has no originator series in the lake has none.
 */
export async function lakeSeries(ticonId: string): Promise<string | undefined> {
  if (!LAKE_CONTRIBUTORS.has(getSourceSuffix(ticonId))) return undefined;
  const gesla = await lakeStation(`gesla/${ticonId}`);
  if (!gesla || gesla.preferred.startsWith("gesla/")) return undefined;
  if (!(await lakeStation(gesla.preferred)))
    throw new Error(
      `${gesla.id} prefers ${gesla.preferred}, which the lake doesn't list`,
    );
  return gesla.preferred;
}

const isoDate = (t: number) => new Date(t).toISOString().slice(0, 10);
const yearStart = (year: number) => new Date(Date.UTC(year, 0, 1));

/**
 * Re-fit TICON's constituent names from a lake series and score the re-fit
 * and TICON's published constants on the year after the fit, by their
 * tidal-band residuals. An error in a prediction that is independent of the
 * rest of the residual adds to its variance, so the re-fit replaces the
 * published constants unless its residual variance exceeds theirs by more
 * than a constituent error of AMPLITUDE_TOLERANCE, the harmonic analysis
 * uncertainty, would add (A²/2). A smaller difference is noise, not a worse
 * fit. The score can't see long-period constituents, so a swap keeps TICON's
 * for those. Returns
 * undefined when the series is too short to fit or has less than half its
 * held-out year to score.
 */
export async function refitFromLake(
  series: string,
  published: HarmonicConstituent[],
): Promise<LakeResult | undefined> {
  const station = await lakeStation(series);
  if (!station) throw new Error(`${series} is not in the public lake`);
  if (!station.last) return undefined;
  // The last whole year the series covers is held out; the fit takes the
  // years before it. A series whose last hour ends a year has that year whole.
  const heldOutYear = new Date(+station.last + HOUR_MS).getUTCFullYear() - 1;
  const fitStart = yearStart(heldOutYear - FIT_YEARS);
  const heldOutStart = yearStart(heldOutYear);
  const heldOutEnd = yearStart(heldOutYear + 1);

  const samples = await readLakeSamples(series, {
    start: fitStart,
    end: heldOutEnd,
  });
  const fitSamples = samples.filter((s) => s.t < +heldOutStart);
  const heldOut = samples.filter((s) => s.t >= +heldOutStart);
  const names = published.map((c) => c.name);
  if (!isAnalyzable(fitSamples, names.length)) return undefined;

  // The fit takes the long-period names too, so they absorb that signal, but
  // the record keeps TICON's, whether or not the fit returns them.
  const fitted = fitHarmonics(fitSamples, names);
  const constituents = published.flatMap((p) =>
    isLongPeriod(p.name) ? [p] : fitted.filter((c) => c.name === p.name),
  );
  const refit = tidalResidual(constituents, heldOut);
  // Half the held-out year's hours, 4392 in a leap year, must be scored.
  if (refit.hours < (+heldOutEnd - +heldOutStart) / HOUR_MS / 2)
    return undefined;
  const rms = {
    refit: round(refit.rms),
    published: round(tidalResidual(published, heldOut).rms),
  };
  return {
    refit: {
      series,
      fit: {
        start: isoDate(fitSamples[0]!.t),
        end: isoDate(fitSamples.at(-1)!.t),
      },
      held_out: {
        start: isoDate(+heldOutStart),
        end: isoDate(+heldOutEnd - 86_400_000),
        hours: refit.hours,
      },
      rms,
      // Decided on the stored scores, so the record can be checked by hand.
      swapped:
        Number((rms.refit ** 2 - rms.published ** 2).toFixed(12)) <=
        AMPLITUDE_TOLERANCE ** 2 / 2,
    },
    constituents,
    samples,
  };
}

// Scores are kept to a micrometre, so their squares' rounding stays far below
// the variance tolerance they are judged against.
const round = (m: number) => Math.round(m * 1e6) / 1e6;
