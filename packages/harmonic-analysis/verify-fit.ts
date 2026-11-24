import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  constituents as catalog,
  fit as engineFit,
  type FitOptions,
  type FittedConstituent,
  type HarmonicFit,
} from "@slackwater/engine";
import { hasMislabeledClock } from "../../sources/ticon/samples.ts";
import { gauge, isCalibrationGauge } from "./calibration-inputs.ts";
import {
  fitSelected,
  harmonicSamples,
  publishedConstants,
  type HarmonicConstituent,
  type Sample,
} from "./index.ts";
import {
  FINAL_FLAGS,
  readStillwellSamples,
  sourceFinalYear,
  stillwellStation,
  type ErrataDecisions,
  type ReadInputs,
} from "./stillwell.ts";
import {
  compareConstants,
  compareCurves,
  conditioning,
  type NodeCorrections,
  hourly,
  predictAt,
  rmsOf,
  sawYear,
  scoreHeldOut,
  tidalResiduals,
  yearlyScatter,
  type Conditioning,
  type ConstantDifference,
  type HeldOutScore,
  type YearlyScatter,
} from "./verification.ts";

const DATA = join(import.meta.dirname, "..", "..", "data");
const HOUR_MS = 3_600_000;

/** The fastest constituent an hourly fit takes, in degrees an hour: past
 *  the eighth-diurnal band, which ends near 8.5 cycles a day. */
const MAX_HOURLY_SPEED = 127.5;

/** A record in data/, as much of it as verification reads. */
export interface DataRecord {
  harmonic_constituents: HarmonicConstituent[];
  epoch?: { start?: string; end?: string };
}

/**
 * The nodal corrections each agency analyzes with, so its constants are
 * scored as it predicts from them: NOAA uses Schureman's (Schureman 1958,
 * Manual of Harmonic Analysis and Prediction of Tides; Parker 2007, Tidal
 * Analysis and Prediction, NOAA Special Publication NOS CO-OPS 3).
 */
const NODE_CORRECTIONS: Record<string, NodeCorrections> = {
  noaa: "schureman",
  kartverket: "iho",
};

/**
 * Half the last digit each agency publishes, in metres and degrees, which
 * PUBLISHED_PRECISION's comments give. Its digits are the ones stored, which
 * for some sources carry a time-zone shift's further digits, so each agency
 * compared with is declared here: NOAA publishes millimetres and 0.1°, and
 * Kartverket 0.1 mm and 0.01°.
 */
const ROUNDING: Record<string, { amplitude: number; phase: number }> = {
  noaa: { amplitude: 0.0005, phase: 0.05 },
  kartverket: { amplitude: 0.00005, phase: 0.005 },
};
const rounding = (dir: string) => {
  const r = ROUNDING[dir];
  if (!r)
    throw new Error(
      `declare the precision ${dir} publishes in ROUNDING before comparing with it`,
    );
  return r;
};

/** An agency's record as verification compares with it: the constants it
 *  determined, and its rounding. NOAA's amplitude 0 with phase 0 marks a
 *  constituent it didn't determine. */
export function agencyConstants(dir: string, record: DataRecord) {
  return {
    constants: record.harmonic_constituents.filter(
      (c) => dir !== "noaa" || c.amplitude !== 0 || c.phase !== 0,
    ),
    rounding: rounding(dir),
    nodeCorrections: NODE_CORRECTIONS[dir]!,
  };
}

const readRecord = (dir: string, id: string): DataRecord | undefined => {
  const path = join(DATA, dir, `${id}.json`);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;
};

export interface VerifyOptions {
  /** Stillwell series, `<source>/<source_id>`. */
  series: string;
  /** The fit's window, [start, end). */
  start: Date;
  end: Date;
  /** Constituents in priority order. */
  names: string[];
  /** Fit exactly `names` (an agency's list) rather than select from them and the catalog. */
  exact?: boolean;
  fitOptions?: FitOptions;
  /** Fit each UTC year on its own and vector-average the years, as NOAA
   *  publishes (Parker 2007, p. 94). Takes an exact list. */
  yearly?: boolean;
  /** Long-period constituents the agency takes from other years: fitted over
   *  those years with the same list, one year at a time with `yearly`. */
  longPeriod?: { names: string[]; years: number[] }[];
  /** The held-out year; the source's last whole year of final values by default. */
  heldOut?: number;
  /** The agency's constants for this gauge, and the period they were analyzed
   *  over, which a record's `epoch` gives only where it is the analysis period
   *  rather than the datum epoch (NOAA's is the datum epoch). */
  agency?: {
    label: string;
    constants: HarmonicConstituent[];
    epoch?: { start?: string; end?: string };
    /** Half the last digit the agency publishes (see compareConstants). */
    rounding?: { amplitude: number; phase: number };
    /** The nodal corrections the agency analyzes with; IHO's by default. */
    nodeCorrections?: NodeCorrections;
    /** The amplitude gain of a zero-phase filter the agency runs before its
     *  analysis, by speed in degrees an hour, applied to our constants and
     *  intervals before they are compared. */
    gain?: (speed: number) => number;
  };
  /** Decisions on Stillwell's `kept` errata, by id. */
  errata?: ErrataDecisions;
}

/** One fit's verification, as the plan's Verification section lays it out. */
export interface VerificationReport {
  series: string;
  /** What the report read: each year file's version by `<epoch> <year>`, the
   *  errata in the years read, whatever their handling, and the decisions on
   *  the kept ones. */
  inputs: ReadInputs & { decisions: ErrataDecisions };
  fit: {
    start: string;
    end: string;
    hours: number;
    /** With `yearly`, the years fitted and averaged: those with two thirds of
     *  their hours. */
    years?: number[];
    /** The years in the window with under two thirds of their hours: left
     *  out with `yearly`, read in part by a joint fit. */
    shortYears: number[];
    /** Each long-period group, and its years with under two thirds of their
     *  hours, which a one-year fit leaves out and a joint fit reads in part. */
    longPeriod?: { names: string[]; years: number[]; shortYears: number[] }[];
    /** RMS residual of the fit, in metres. */
    rms: number;
    /** Names left out: in an exact list, those past the eighth-diurnal band
     *  an hourly fit stops at; or those not separable from earlier ones. */
    dropped: string[];
    conditioning: Conditioning;
    yearly: YearlyScatter;
    /** Each fitted constituent, unrounded, with its 95% intervals and SNR. */
    constituents: {
      name: string;
      amplitude: number;
      phase: number;
      amplitudeInterval: number | null;
      phaseInterval: number | null;
      snr: number | null;
    }[];
  };
  /** Null when no year after the fit's window has half its hours scored. */
  heldOut: {
    year: number;
    /** Smallest rise or fall the turn picker counts at this gauge, in metres. */
    minRange: number;
    fit: HeldOutScore;
    /** TICON's records of the gauge as `ticon/<id>`, this database's re-fits
     *  of TICON's gauges whose clocks were wrong as `refit/<id>`, and the
     *  agency's constants under its label. */
    others: Record<string, HeldOutScore>;
    /** Whether the fit scores no worse than every TICON record and re-fit
     *  beyond the measurement error, measured for each; null with neither. */
    beatsTicon: boolean | null;
  } | null;
  /** Our constants and prediction against the agency's: differences only.
   *  With our own constants above, the differences give the agency's back, so
   *  this layer suits agencies whose constants the database publishes. */
  agency: {
    label: string;
    constants: ConstantDifference[];
    /** Our predicted curve against one from the agency's constants over the held-out year. */
    curve: { n: number; rms: number; max: number } | null;
  } | null;
}

/** One-year fits of the years with two thirds of their hours, as
 *  yearlyScatter takes them. */
function yearlyFits(
  samples: readonly Sample[],
  fitYear: (samples: readonly Sample[]) => HarmonicFit,
): Map<number, HarmonicFit> {
  const byYear = new Map<number, Sample[]>();
  for (const s of samples) {
    const y = new Date(s.t).getUTCFullYear();
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y)!.push(s);
  }
  const fits = new Map<number, HarmonicFit>();
  for (const [year, rows] of [...byYear].sort(([a], [b]) => a - b))
    if (hasTwoThirds(year, new Set(rows.map((r) => r.t)).size))
      fits.set(year, fitYear(rows));
  return fits;
}

const hasTwoThirds = (year: number, hours: number) => {
  const { start, end } = yearRange(year);
  return hours >= ((2 / 3) * (+end - +start)) / HOUR_MS;
};

/** Of `years`, those whose distinct hours in `samples` are under two thirds
 *  of the year, the rule yearlyFits takes years by. */
export function shortYears(
  samples: readonly Sample[],
  years: readonly number[],
): number[] {
  const hours = new Map<number, Set<number>>();
  for (const { t } of samples) {
    const y = new Date(t).getUTCFullYear();
    if (!hours.has(y)) hours.set(y, new Set());
    hours.get(y)!.add(t);
  }
  return years.filter((y) => !hasTwoThirds(y, hours.get(y)?.size ?? 0));
}

/**
 * The vector average of one-year fits, each of `names` over the years that
 * fit it. Its intervals are those of a mean of independent years: the root
 * sum of squares of each year's, over the number of years.
 */
export function vectorAverage(
  fits: readonly Pick<HarmonicFit, "constituents">[],
  names: readonly string[],
): FittedConstituent[] {
  return names.flatMap((name) => {
    const cs = fits.flatMap((f) =>
      f.constituents.filter((c) => c.name === name),
    );
    if (!cs.length) return [];
    const n = cs.length;
    const rad = (c: FittedConstituent) => (c.phase * Math.PI) / 180;
    const re = cs.reduce((s, c) => s + c.amplitude * Math.cos(rad(c)), 0) / n;
    const im = cs.reduce((s, c) => s + c.amplitude * Math.sin(rad(c)), 0) / n;
    const rss = (key: "amplitudeInterval" | "phaseInterval") =>
      cs.every((c) => c[key] !== undefined)
        ? Math.sqrt(cs.reduce((s, c) => s + c[key]! ** 2, 0)) / n
        : undefined;
    const amplitude = Math.hypot(re, im);
    const amplitudeInterval = rss("amplitudeInterval");
    const phaseInterval = rss("phaseInterval");
    const c: FittedConstituent = {
      name,
      amplitude,
      phase: ((((Math.atan2(im, re) * 180) / Math.PI) % 360) + 360) % 360,
    };
    if (amplitudeInterval !== undefined) {
      c.amplitudeInterval = amplitudeInterval;
      // As the engine gives it: amplitude squared over its variance.
      c.snr = (amplitude / (amplitudeInterval / 1.96)) ** 2;
    }
    if (phaseInterval !== undefined) c.phaseInterval = phaseInterval;
    return [c];
  });
}

/** `constituents` with those in `from` in their place. */
const replace = (
  constituents: FittedConstituent[],
  from: FittedConstituent[],
) => constituents.map((c) => from.find((f) => f.name === c.name) ?? c);

/** Constants as an agency's zero-phase filter leaves them. */
const filtered = (
  constituents: FittedConstituent[],
  gain?: (speed: number) => number,
) =>
  gain
    ? constituents.map((c) => {
        const g = gain(catalog[c.name]!.speed);
        const out: FittedConstituent = { ...c, amplitude: c.amplitude * g };
        if (c.amplitudeInterval !== undefined)
          out.amplitudeInterval = c.amplitudeInterval * g;
        return out;
      })
    : constituents;

const isoDate = (t: number) => new Date(t).toISOString().slice(0, 10);
const yearRange = (y: number) => ({
  start: new Date(Date.UTC(y, 0, 1)),
  end: new Date(Date.UTC(y + 1, 0, 1)),
});

/**
 * Fit a Stillwell series over [start, end) and verify the fit: its
 * diagnostics, its score and every TICON record's on a held-out year of
 * observations, and its constants against the agency's. The held-out year
 * falls back, one year at a time, to the latest earlier year with half its
 * hours scored, never into the fit's window or a long-period fit's years. Reads only final values,
 * instantaneous on the hour: a source that publishes filtered or averaged
 * hourly values (UHSLC, some GESLA contributors) needs the filter's gain
 * corrected first, which the engine doesn't offer yet.
 */
export async function verifyFit(
  options: VerifyOptions,
): Promise<VerificationReport> {
  const { series, start, end } = options;
  // The plan's Sampling rule: an hourly fit stops at the eighth-diurnal
  // band. Selection (fitSelected) adds catalog lines of its own, so the rule
  // applies to exact lists here.
  const tooFast = options.exact
    ? options.names.filter((n) => (catalog[n]?.speed ?? 0) > MAX_HOURLY_SPEED)
    : [];
  const names = options.names.filter((n) => !tooFast.includes(n));
  const station = await stillwellStation(series);
  if (!station) throw new Error(`${series} is not in Stillwell`);
  if (
    options.heldOut !== undefined &&
    +yearRange(options.heldOut).end <= +start
  )
    throw new Error(
      `the held-out year ${options.heldOut} is before the fit's window`,
    );
  if (
    options.heldOut !== undefined &&
    +yearRange(options.heldOut).end > +start &&
    +yearRange(options.heldOut).start < +end
  )
    throw new Error(
      `the held-out year ${options.heldOut} is in the fit's window`,
    );
  const decisions = options.errata ?? {};
  const inputs: ReadInputs = { versions: {}, errata: {} };
  const read = (period: { start: Date; end: Date }) =>
    readStillwellSamples(series, period, FINAL_FLAGS, {
      errata: decisions,
      hourly: true,
      inputs,
    });
  const fitSamples = await read({ start, end });
  if (!fitSamples.length)
    throw new Error(`${series} has no final values to fit`);
  if ((options.yearly || options.longPeriod) && !options.exact)
    throw new Error("yearly and long-period fits take an exact list");
  const fitOptions: FitOptions = { ...options.fitOptions, confidence: true };
  const fitExact = (samples: readonly Sample[]) =>
    engineFit(harmonicSamples(samples), names, {
      ...fitOptions,
      dropDependent: true,
    });
  const longPeriod = options.longPeriod ?? [];
  const longYears = longPeriod.flatMap((g) => g.years);
  const longSamples = longYears.length
    ? await read({
        start: yearRange(Math.min(...longYears)).start,
        end: yearRange(Math.max(...longYears)).end,
      })
    : [];
  const short = (ys: number[]) =>
    shortYears([...fitSamples, ...longSamples], ys);
  let years: number[] | undefined;
  let fitted: Pick<HarmonicFit, "constituents" | "rms" | "dropped">;
  if (options.yearly) {
    const byYear = yearlyFits(
      [
        ...fitSamples,
        ...longSamples.filter((s) => s.t < +start || s.t >= +end),
      ],
      fitExact,
    );
    years = [...byYear.keys()].filter(
      (y) => +yearRange(y).start >= +start && +yearRange(y).end <= +end,
    );
    if (!years.length)
      throw new Error(`${series} has no year with two thirds of its hours`);
    const main = years.map((y) => byYear.get(y)!);
    fitted = {
      constituents: vectorAverage(main, names),
      rms: Math.sqrt(main.reduce((s, f) => s + f.rms ** 2, 0) / main.length),
      dropped: names.filter((n) => main.every((f) => f.dropped.includes(n))),
    };
    for (const group of longPeriod) {
      const long = group.years.flatMap((y) => byYear.get(y) ?? []);
      if (!long.length)
        throw new Error(`${series} has no long-period year to fit`);
      fitted.constituents = replace(
        fitted.constituents,
        vectorAverage(long, group.names),
      );
    }
  } else {
    fitted = options.exact
      ? fitExact(fitSamples)
      : fitSelected(harmonicSamples(fitSamples), names, true, fitOptions);
    for (const group of longPeriod) {
      const wanted = new Set(group.years);
      const long = longSamples.filter((s) =>
        wanted.has(new Date(s.t).getUTCFullYear()),
      );
      fitted.constituents = replace(
        fitted.constituents,
        fitExact(long).constituents.filter((c) => group.names.includes(c.name)),
      );
    }
  }
  const fittedNames = fitted.constituents.map((c) => c.name);
  // Our constants are predicted with the corrections they were fitted with;
  // the predictors have no Foreman set, so a Foreman fit takes IHO's.
  const predictWith: NodeCorrections =
    fitOptions.nodeCorrections === "schureman" ? "schureman" : "iho";
  const published = publishedConstants(fitted.constituents, names);

  let heldOut: VerificationReport["heldOut"] = null;
  const first = options.heldOut ?? (await sourceFinalYear(station.source));
  for (let year = first; +yearRange(year).start >= +end; year--) {
    // A year a long-period fit read isn't held out.
    if (longYears.includes(year)) {
      if (options.heldOut !== undefined)
        throw new Error(`the held-out year ${year} is in the long-period fit`);
      continue;
    }
    const span = yearRange(year);
    const samples = await read(span);
    // Half the year's hours scored, as the held-out decision requires.
    if (
      rmsOf(tidalResiduals(published, samples, predictWith)).hours <
      (+span.end - +span.start) / HOUR_MS / 2
    ) {
      if (options.heldOut !== undefined)
        throw new Error(`${series} has under half of ${year}'s hours to score`);
      continue;
    }
    const others: Parameters<typeof scoreHeldOut>[2] = {};
    const ticon = station.same_as
      .filter((id) => id.startsWith("gesla/"))
      .map((id) => id.slice("gesla/".length))
      // An id from Stillwell names a file in data/ticon and nothing outside it.
      .filter((id) => /^[\w.-]+$/.test(id) && !id.startsWith("."))
      .flatMap((id) => {
        const record = readRecord("ticon", id);
        return record ? [[id, record] as const] : [];
      });
    // For these, data/ticon holds this database's re-fit, which is what ships
    // in place of TICON's constants: scored under its own label, and decisive.
    for (const [id, record] of ticon)
      others[`${hasMislabeledClock(id) ? "refit" : "ticon"}/${id}`] = {
        constituents: record.harmonic_constituents,
        seen: sawYear(record.epoch, span.start, span.end),
      };
    if (options.agency)
      others[options.agency.label] = {
        constituents: options.agency.constants,
        seen: sawYear(options.agency.epoch, span.start, span.end),
        nodeCorrections: options.agency.nodeCorrections,
      };
    const scores = scoreHeldOut(samples, published, others, predictWith);
    const ticonScores = Object.entries(scores.others).filter(
      ([id]) => id.startsWith("ticon/") || id.startsWith("refit/"),
    );
    heldOut = {
      year,
      ...scores,
      beatsTicon: ticonScores.length
        ? ticonScores.every(
            ([, s]) => s.verdict === "better" || s.verdict === "tie",
          )
        : null,
    };
    break;
  }

  let agency: VerificationReport["agency"] = null;
  if (options.agency) {
    let curve = null;
    if (heldOut) {
      const { start, end } = yearRange(heldOut.year);
      const times = hourly(start, end).map((t) => ({ t, level: 0 }));
      curve = compareCurves(
        predictAt(published, times, predictWith),
        predictAt(
          options.agency.constants,
          times,
          options.agency.nodeCorrections,
        ),
      );
    }
    agency = {
      label: options.agency.label,
      constants: compareConstants(
        filtered(fitted.constituents, options.agency.gain),
        options.agency.constants,
        options.agency.rounding,
      ),
      curve,
    };
  }

  return {
    series,
    inputs: { ...inputs, decisions },
    fit: {
      start: isoDate(fitSamples[0]!.t),
      end: isoDate(fitSamples.at(-1)!.t),
      hours: fitSamples.length,
      ...(years && { years }),
      shortYears: short(
        Array.from(
          {
            length:
              new Date(+end - 1).getUTCFullYear() - start.getUTCFullYear() + 1,
          },
          (_, i) => start.getUTCFullYear() + i,
        ),
      ),
      ...(longPeriod.length && {
        longPeriod: longPeriod.map((g) => ({
          ...g,
          shortYears: short(g.years),
        })),
      }),
      rms: fitted.rms,
      dropped: [...tooFast, ...fitted.dropped],
      conditioning: conditioning(fitSamples, fittedNames),
      // Largest first, so a pair a year can't separate keeps its larger member.
      yearly: yearlyScatter(
        fitSamples,
        [...fitted.constituents]
          .sort((a, b) => b.amplitude - a.amplitude)
          .map((c) => c.name),
        options.fitOptions,
      ),
      constituents: fitted.constituents.map((c) => ({
        name: c.name,
        amplitude: c.amplitude,
        phase: c.phase,
        amplitudeInterval: c.amplitudeInterval ?? null,
        phaseInterval: c.phaseInterval ?? null,
        snr: c.snr ?? null,
      })),
    },
    heldOut,
    agency,
  };
}

// Usage: npm run report:verify -w packages/harmonic-analysis -- <series> \
//   --fit 2006-2020 --names data/kartverket/BGO.json [--exact] [--held-out 2024]
//   [--agency kartverket/BGO] [--keep <erratum>] [--drop <erratum>]
if (import.meta.main) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      fit: { type: "string" },
      names: { type: "string" },
      exact: { type: "boolean" },
      "held-out": { type: "string" },
      agency: { type: "string" },
      keep: { type: "string", multiple: true },
      drop: { type: "string", multiple: true },
    },
  });
  const [series] = positionals;
  const fit = values.fit?.match(/^(\d{4})-(\d{4})$/);
  const heldOut = values["held-out"];
  const agencyPath = values.agency?.match(/^([a-z-]+)\/([\w.-]+)$/);
  if (
    !series ||
    !fit ||
    !values.names ||
    (heldOut !== undefined && !/^\d{4}$/.test(heldOut)) ||
    (values.agency !== undefined && !agencyPath)
  )
    throw new Error(
      "usage: verify-fit.ts <series> --fit <first year>-<last year> --names <data record or comma-separated names> [--exact] [--held-out <year>] [--agency noaa/<id> | kartverket/<id>] [--keep <erratum>] [--drop <erratum>]",
    );
  const [from, to] = [Number(fit[1]), Number(fit[2])];
  const both = (values.keep ?? []).filter((e) => values.drop?.includes(e));
  if (both.length) throw new Error(`both kept and dropped: ${both.join(", ")}`);
  const names = values.names.endsWith(".json")
    ? (
        JSON.parse(
          readFileSync(join(DATA, "..", values.names), "utf8"),
        ) as DataRecord
      ).harmonic_constituents
        // NOAA's amplitude 0 with phase 0 marks a constituent it didn't determine.
        .filter(
          (c) =>
            !values.names!.includes("noaa/") ||
            c.amplitude !== 0 ||
            c.phase !== 0,
        )
        .map((c) => c.name)
    : values.names.split(",");
  const [, dir, id] = agencyPath ?? [];
  const agency = dir && id ? readRecord(dir, id) : undefined;
  if (values.agency && !agency)
    throw new Error(`data/${values.agency}.json is missing`);
  // A calibration gauge is fitted the agency's way, as the calibration fits
  // it; any other record is compared with a plain fit.
  const method =
    values.agency && isCalibrationGauge(values.agency)
      ? (await gauge(values.agency)).method
      : undefined;
  const report = await verifyFit({
    series,
    start: new Date(Date.UTC(from, 0, 1)),
    end: new Date(Date.UTC(to + 1, 0, 1)),
    names,
    // The agency's method fits its own exact list.
    exact: Boolean(method) || (values.exact ?? false),
    ...(heldOut ? { heldOut: Number(heldOut) } : {}),
    ...(method && {
      fitOptions: method.fitOptions,
      ...(method.yearly && { yearly: method.yearly }),
      ...(method.longPeriod && { longPeriod: method.longPeriod }),
    }),
    ...(agency
      ? {
          agency: {
            label: values.agency!,
            ...agencyConstants(dir!, agency),
            ...(method?.gain && { gain: method.gain }),
            // A record's epoch can be its datum epoch, as NOAA's is, so the
            // CLI leaves the agency's analysis period unknown: maybe seen.
          },
        }
      : {}),
    errata: Object.fromEntries([
      ...(values.keep ?? []).map((e) => [e, "keep"] as const),
      ...(values.drop ?? []).map((e) => [e, "drop"] as const),
    ]),
  });
  console.log(JSON.stringify(report, null, 2));
}
