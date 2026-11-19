import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { HarmonicConstituent } from "./index.ts";

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
  /** For NOAA, a digest of the constants the period was read for. */
  digest?: string;
}

/** A short digest of constants, to tell when they change. */
export const constantsDigest = (constants: HarmonicConstituent[]) =>
  createHash("sha256")
    .update(
      JSON.stringify(constants.map((c) => [c.name, c.amplitude, c.phase])),
    )
    .digest("hex")
    .slice(0, 16);

/** The files whose code computes the report, from the root. The engine is
 *  pinned by its version. */
export const CODE = [
  "packages/harmonic-analysis/index.ts",
  "packages/harmonic-analysis/stillwell.ts",
  "packages/harmonic-analysis/verification.ts",
  "packages/harmonic-analysis/verify-fit.ts",
  "packages/harmonic-analysis/calibrate.ts",
  "packages/harmonic-analysis/calibration-inputs.ts",
];

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
  };

/**
 * NOAA CO-OPS reference stations and the years NOAA's constants come from,
 * from each station's harcon comments
 * (https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/<id>/harcon.json),
 * read 2026-11-19. NOAA vector-averages one-year analyses over these years and
 * takes Sa and Ssa, sometimes Mm, Mf and Msf, from a longer span the comments
 * also give; this calibration fits every constituent over the main years.
 * The digest is of the constants those years were read for (constantsDigest):
 * when a NOAA import changes them, read the comments again.
 */
export const NOAA: [string, number, number, string][] = [
  ["1612340", 2014, 2018, "f053c93323616e23"],
  ["1820000", 2014, 2018, "6792a35950d8a9b0"],
  ["8443970", 2015, 2019, "581660c8f1c41afc"],
  ["8452660", 2007, 2012, "6fcfb2127bceab68"],
  ["8518750", 2018, 2022, "308c8c31766e2437"],
  ["8545240", 2016, 2020, "c34629e553f95e65"],
  ["8574680", 2017, 2021, "8bc73101c81e7176"],
  ["8638610", 2015, 2019, "4080427153ecd5d0"],
  ["8665530", 2017, 2021, "cf1a08a603e51457"],
  ["8723214", 2019, 2023, "6e60f860f9dde4a7"],
  ["8724580", 2018, 2022, "ccc9ea46d32d24a7"],
  ["8729840", 2018, 2022, "ea286eed4be177f9"],
  ["8761724", 2021, 2025, "754af73e685df8f0"],
  ["8771450", 2021, 2025, "5fb81976a05cc077"],
  ["9410170", 2017, 2021, "022e603deca80221"],
  ["9435380", 2007, 2012, "481eeb09fbba57e9"],
  ["9449880", 2011, 2016, "4bff6d6b356934f6"],
  ["9455920", 2012, 2016, "4d6292fc0ebaf94d"],
  ["9462620", 2020, 2024, "c9ddd217b2325b78"],
  ["9751639", 2007, 2012, "d3c2b57ec09b7740"],
];

/** Kartverket's gauges with a multi-year analysis (2006–2020 or 2010–2020),
 *  whose period its records carry. */
export const kartverket = (): Gauge[] =>
  readdirSync(join(ROOT, "data", "kartverket"))
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => f.replace(".json", ""))
    .flatMap((id) => {
      const epoch = record("kartverket", id).epoch;
      if (!epoch || epoch.end !== "2020-12-31" || epoch.start > "2010-12-31")
        return [];
      return [
        {
          series: `kartverket/${id}`,
          agency: `kartverket/${id}`,
          start: new Date(epoch.start),
          end: new Date(Date.parse(epoch.end) + DAY_MS),
        },
      ];
    });

/** The Kartverket gauges calibrated: a reimport that changes which records
 *  carry a 2006–2020 or 2010–2020 analysis must change this list too. */
export const KARTVERKET =
  "AES ANX BGO BOO HAR HEI HFT HRO HVG KAB KSU MAY MSU NVK NYA OSC OSL RVK SVG TOS TRD TRG VAW VIK";

/** Every gauge calibrated. */
export const gauges: Gauge[] = [
  ...kartverket(),
  ...NOAA.map(([id, start, end, digest]) => ({
    series: `coops/${id}`,
    agency: `noaa/${id}`,
    start: new Date(Date.UTC(start, 0, 1)),
    end: new Date(Date.UTC(end + 1, 0, 1)),
    digest,
  })),
];
