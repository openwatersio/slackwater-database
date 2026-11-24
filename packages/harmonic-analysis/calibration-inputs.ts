import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { roundConstituents } from "@slackwater/stations";
import { fetchNoaa } from "../../sources/noaa/fetch.ts";
import type { HarmonicConstituent } from "./index.ts";
import type { VerifyOptions } from "./verify-fit.ts";

/**
 * What the calibration report (docs/calibration) is computed from, pinned so
 * `npm test` can tell when the checked-in report no longer matches: the
 * gauges, the agency constants in data/, and the code that fits and scores.
 */

export const ROOT = join(import.meta.dirname, "..", "..");
const DAY_MS = 86_400_000;

export interface Gauge {
  series: string;
  agency: string;
  /** The agency's analysis period, [start, end). */
  start: Date;
  end: Date;
  /** How the agency fits, so ours is fitted the same way. */
  method: Pick<VerifyOptions, "fitOptions" | "yearly" | "longPeriod"> & {
    gain?: (speed: number) => number;
  };
  /** Constituents left out of the comparison, with the reason: the agency
   *  doesn't say how it determined them. */
  unstated?: { names: string[]; reason: string };
}

const span = (first: number, last: number, without: number[] = []) =>
  Array.from({ length: last - first + 1 }, (_, i) => first + i).filter(
    (y) => !without.includes(y),
  );

/** JSON.stringify's replacer for calibration.json: six significant digits
 *  keep the file reviewable and every score's precision. */
export const reportRounding = (_: string, v: unknown) =>
  typeof v === "number" ? Number(v.toPrecision(6)) : v;

/** A short digest of constants, to tell when they change. */
export const constantsDigest = (constants: HarmonicConstituent[]) =>
  createHash("sha256")
    .update(
      JSON.stringify(constants.map((c) => [c.name, c.amplitude, c.phase])),
    )
    .digest("hex")
    .slice(0, 16);

/** The files whose code computes the report, from the root. The engine is
 *  pinned by `installedEngine()`. */
export const CODE = [
  "packages/harmonic-analysis/index.ts",
  "packages/harmonic-analysis/stillwell.ts",
  "packages/harmonic-analysis/verification.ts",
  "packages/harmonic-analysis/verify-fit.ts",
  "packages/harmonic-analysis/calibrate.ts",
  "packages/harmonic-analysis/calibration-inputs.ts",
  "sources/noaa/fetch.ts",
  "sources/ticon/samples.ts",
  "packages/stations/filtering.ts",
  "packages/stations/sources.ts",
  "packages/stations/station.ts",
  "packages/datums/datum.ts",
  "packages/datums/observations.ts",
];

/** The engine installed: where npm resolved it from, which tells builds of
 *  one version apart (a pkg.pr.new build names its commit), or its version.
 *  Read from npm's record of node_modules, not package-lock.json, which can
 *  run ahead of an install. */
export const installedEngine = (): string => {
  const lock = JSON.parse(
    readFileSync(join(ROOT, "node_modules", ".package-lock.json"), "utf8"),
  ) as { packages: Record<string, { version: string; resolved?: string }> };
  const engine = lock.packages["node_modules/@slackwater/engine"]!;
  return engine.resolved ?? engine.version;
};

/** A digest of the code in CODE. */
export const codeDigest = () => {
  const hash = createHash("sha256");
  for (const path of CODE)
    hash.update(path).update(readFileSync(join(ROOT, path)));
  return hash.digest("hex").slice(0, 16);
};

export const record = (dir: string, id: string) =>
  JSON.parse(readFileSync(join(ROOT, "data", dir, `${id}.json`), "utf8")) as {
    harmonic_constituents: HarmonicConstituent[];
    epoch?: { start: string; end: string };
    latitude: number;
  };

/** The NOAA CO-OPS reference stations calibrated. */
export const NOAA = [
  "1612340",
  "1820000",
  "8443970",
  "8452660",
  "8518750",
  "8545240",
  "8574680",
  "8638610",
  "8665530",
  "8723214",
  "8724580",
  "8729840",
  "8761724",
  "8771450",
  "9410170",
  "9435380",
  "9449880",
  "9455920",
  "9462620",
  "9751639",
];

/** NOAA's method for one station, from the comment on its constants. */
export interface NoaaAnalysis {
  comment: string;
  /** The years NOAA vector-averages one-year analyses over. */
  years: [number, number];
  /** Long-period constituents NOAA takes from other years. */
  longPeriod?: { names: string[]; years: number[] }[];
  /** Long-period constituents the comment names without saying which years. */
  unstated?: { names: string[]; reason: string };
}

/** NOAA's names for the long-period constituents its comments name. */
const LONG_PERIOD = /\b(SA|SSA|MM|MF|MSF)\b/gi;
const RANGE = /(\d{4})\s*[-–]\s*(\d{4})/g;
/** "15 years", "20year", "5-year", "19 one-year": a count of years. "1-year"
 *  describes one-year analyses, not how many. */
const COUNT = /(\d+)[\s-]*(?:one[\s-]*)?years?\b/gi;
const counted = (text: string) =>
  [...text.matchAll(COUNT)].map((m) => Number(m[1])).filter((n) => n > 1);

/**
 * Read NOAA's method from the comment on a station's constants, such as
 * "Vector Average of 5 years (2017-2021). Sa from average of 20 years
 * (2002-2021), other long period constituents are unstable." The first
 * sentence gives the years NOAA averages; each later clause "<names> from
 * ... (<years>, <years>)" gives long-period constituents and their years.
 * Throws on a comment it can't read, so a new wording stops the refresh.
 */
export function parseNoaaComment(comment: string): NoaaAnalysis {
  const [first = "", ...rest] = comment
    .split(/\.(?:\s+|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
  const main = [...first.matchAll(RANGE)];
  if (main.length !== 1 || !/averag|mean/i.test(first))
    throw new Error(`can't read NOAA's analysis years from "${comment}"`);
  const analysis: NoaaAnalysis = {
    comment,
    years: [Number(main[0]![1]), Number(main[0]![2])],
  };
  const [from, to] = analysis.years;
  if (counted(first).some((n) => n !== to - from + 1))
    throw new Error(
      `NOAA's comment counts other years than it spans: "${comment}"`,
    );
  // Each "from" starts a clause. A later clause's names follow the last year
  // range or bracket of the clause before it, so "Mm, Msf, Mf from" stays one
  // list and "(2002-2021), Sa, Ssa from" starts another.
  // A sentence naming long-period lines without "from", such as "Mm and Msf
  // are not used", says nothing we can reproduce.
  for (const sentence of rest) {
    const names = [...sentence.matchAll(LONG_PERIOD)].map((m) =>
      m[1]!.toUpperCase(),
    );
    if (names.length && !/\bfrom\b/.test(sentence))
      analysis.unstated = {
        names: [...(analysis.unstated?.names ?? []), ...names],
        reason: [
          analysis.unstated?.reason,
          `NOAA's comment says: "${sentence}"`,
        ]
          .filter(Boolean)
          .join("; "),
      };
  }
  const clauses = rest.flatMap((sentence) => {
    const parts = sentence.split(/\bfrom\b/);
    const cuts = parts.map((part, i) => {
      if (i === 0) return 0;
      const ends = [...part.matchAll(RANGE)].map((m) => m.index! + m[0].length);
      return Math.max(part.lastIndexOf(")") + 1, ...ends);
    });
    return parts.slice(0, -1).map((part, i) => {
      const next = parts[i + 1]!;
      const end = i + 2 < parts.length ? cuts[i + 1]! : next.length;
      if (i + 2 < parts.length && end === 0)
        throw new Error(`can't split "${sentence}" into clauses`);
      return {
        clause: sentence,
        before: part.slice(cuts[i]!),
        after: next.slice(0, end),
      };
    });
  });
  for (const { clause, before, after } of clauses) {
    const names = [...before.matchAll(LONG_PERIOD)].map((m) =>
      m[1]!.toUpperCase(),
    );
    const rest = before
      .replace(LONG_PERIOD, "")
      .replace(/\band\b/gi, "")
      .replace(/[,\s]/g, "");
    if (!names.length || rest)
      throw new Error(`can't read which constituents "${clause}" names`);
    const years = [...after.matchAll(RANGE)].flatMap(([, a, b]) =>
      span(Number(a), Number(b)),
    );
    if (new Set(years).size !== years.length)
      throw new Error(`NOAA's comment repeats a year: "${clause}"`);
    // "average of 15 years (2000-2018)" counts fewer years than it spans,
    // without saying which it left out.
    const count = counted(after).find((n) => n !== years.length);
    const why = !years.length
      ? "names no years"
      : count !== undefined
        ? `counts ${count} years in a span of ${years.length} without naming them`
        : undefined;
    if (!why) (analysis.longPeriod ??= []).push({ names, years });
    else
      analysis.unstated = {
        names: [...(analysis.unstated?.names ?? []), ...names],
        reason: [
          analysis.unstated?.reason,
          `NOAA's comment ${why}: "${clause}"`,
        ]
          .filter(Boolean)
          .join("; "),
      };
  }
  return analysis;
}

/**
 * Read NOAA's method for a station from its harmonic constituents API. The
 * same response carries the constants, which must be the ones in
 * data/noaa/<id>.json, so the method read is the one for those constants.
 */
export async function noaaAnalysis(id: string): Promise<NoaaAnalysis> {
  const url = `https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/${id}/harcon.json?units=metric`;
  const constants = await fetchNoaa(
    url,
    (json) =>
      json.HarmonicConstituents as
        | {
            name: string;
            amplitude: number;
            phase_GMT: number;
            comments: string | null;
          }[]
        | undefined,
    { init: { headers: { "User-Agent": "slackwater-database" } } },
  );
  const stored = constantsDigest(record("noaa", id).harmonic_constituents);
  // Rounded as the import stores them, so only a change in what NOAA
  // publishes differs.
  const served = constantsDigest(
    roundConstituents(
      "noaa",
      constants.map((c) => ({
        name: c.name,
        amplitude: c.amplitude,
        phase: c.phase_GMT,
      })),
    ),
  );
  if (served !== stored)
    throw new Error(
      `${url} serves other constants than data/noaa/${id}.json; import NOAA again`,
    );
  const comments = new Set(constants.map((c) => c.comments?.trim() ?? ""));
  if (comments.size !== 1)
    throw new Error(`${url} has ${comments.size} comments; expected one`);
  try {
    return parseNoaaComment([...comments][0]!);
  } catch (error) {
    throw new Error(`${url}: ${(error as Error).message}`, { cause: error });
  }
}

/**
 * The amplitude gain of the filter Kartverket runs before its analysis, by
 * speed in degrees an hour: a 4th-order Butterworth low-pass with a 2.98-hour
 * cutoff, run forward and backward, so zero-phase. Kartverket doesn't
 * document it. Fitting its constants above 4.5 cycles a day, 232 at the 24
 * gauges, pins the order at 4 and the cutoff at 2.98 hours, where the misfit
 * is least; UTide on the 10-minute series filtered at 3.00 hours misses M8 at
 * Stavanger as a gain at 3.00 hours does.
 */
export const kartverketGain = (speed: number) =>
  1 / (1 + ((speed * 24) / 360 / (24 / 2.98)) ** 8);

/** Kartverket's gauges with a multi-year analysis (2006–2020 or 2010–2020),
 *  whose period its records carry. Kartverket fits with UTide, so with
 *  Foreman's nodal corrections at the gauge's latitude at each sample, after
 *  its filter (kartverketGain), and takes SA_KV from 1991–2020. */
export const kartverket = (): Gauge[] =>
  readdirSync(join(ROOT, "data", "kartverket"))
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => f.replace(".json", ""))
    .flatMap((id) => {
      const { epoch, latitude } = record("kartverket", id);
      if (!epoch || epoch.end !== "2020-12-31" || epoch.start > "2010-12-31")
        return [];
      return [
        {
          series: `kartverket/${id}`,
          agency: `kartverket/${id}`,
          start: new Date(epoch.start),
          end: new Date(Date.parse(epoch.end) + DAY_MS),
          method: {
            fitOptions: { nodeCorrections: "foreman", latitude },
            longPeriod: [{ names: ["SA_KV"], years: span(1991, 2020) }],
            gain: kartverketGain,
          },
        } satisfies Gauge,
      ];
    });

/** The Kartverket gauges calibrated: a reimport that changes which records
 *  carry a 2006–2020 or 2010–2020 analysis must change this list too. */
export const KARTVERKET =
  "AES ANX BGO BOO HAR HEI HFT HRO HVG KAB KSU MAY MSU NVK NYA OSC OSL RVK SVG TOS TRD TRG VAW VIK";

/** A gauge's method as the report records it; the gain by its name. */
export const methodOf = ({ method: { gain, ...rest } }: Gauge) => ({
  ...rest,
  ...(gain && { gain: gain.name }),
});

/** Every gauge calibrated, with NOAA's methods read from its API. */
async function noaaGauge(
  id: string,
): Promise<Gauge & { analysis: NoaaAnalysis }> {
  const analysis = await noaaAnalysis(id);
  const [start, end] = analysis.years;
  return {
    series: `coops/${id}`,
    agency: `noaa/${id}`,
    start: new Date(Date.UTC(start, 0, 1)),
    end: new Date(Date.UTC(end + 1, 0, 1)),
    method: {
      fitOptions: {
        nodeCorrections: "schureman" as const,
        nodal: "yearly" as const,
      },
      yearly: true,
      ...(analysis.longPeriod && { longPeriod: analysis.longPeriod }),
    },
    ...(analysis.unstated && { unstated: analysis.unstated }),
    analysis,
  };
}

export async function gauges(): Promise<
  (Gauge & { analysis?: NoaaAnalysis })[]
> {
  const noaa = [];
  for (const id of NOAA) noaa.push(await noaaGauge(id));
  return [...kartverket(), ...noaa];
}

export const isCalibrationGauge = (agency: string) =>
  kartverket().some((g) => g.agency === agency) ||
  NOAA.some((id) => agency === `noaa/${id}`);

/** One calibration gauge, by its agency record, such as `noaa/8443970`. */
export async function gauge(agency: string): Promise<Gauge> {
  const found = kartverket().find((g) => g.agency === agency);
  if (found) return found;
  const id = agency.match(/^noaa\/(\w+)$/)?.[1];
  if (id && NOAA.includes(id)) return noaaGauge(id);
  throw new Error(
    `${agency} isn't a calibration gauge, so there's no method to fit it the agency's way`,
  );
}
