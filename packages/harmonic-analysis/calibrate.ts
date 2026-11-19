import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { constituents as catalog } from "@slackwater/engine";
import { format } from "prettier";
import type { HarmonicConstituent } from "./index.ts";
import {
  agencyConstants,
  verifyFit,
  type VerificationReport,
} from "./verify-fit.ts";

/**
 * Fit gauges whose agency publishes its own constants, over the agency's own
 * analysis years, and compare. Agreement within our 95% intervals shows the
 * fitter, nodal corrections and phase convention are right (plan,
 * Calibration). Writes docs/calibration/calibration.json and README.md; run
 * again whenever the fitter changes.
 */

const ROOT = join(import.meta.dirname, "..", "..");
const OUT = join(ROOT, "docs", "calibration");

interface Gauge {
  series: string;
  agency: string;
  /** The agency's analysis period, [start, end). */
  start: Date;
  end: Date;
  /** For NOAA, a digest of the constants the period was read for. */
  digest?: string;
}

/** A short digest of constants, to tell when they change. */
const constantsDigest = (constants: HarmonicConstituent[]) =>
  createHash("sha256")
    .update(
      JSON.stringify(constants.map((c) => [c.name, c.amplitude, c.phase])),
    )
    .digest("hex")
    .slice(0, 16);

const MARKER = "<!-- calibration results -->";
const template = readFileSync(join(OUT, "README.md"), "utf8");
if (!template.includes(MARKER))
  throw new Error(`docs/calibration/README.md has no ${MARKER} line`);

const DAY_MS = 86_400_000;

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
const NOAA: [string, number, number, string][] = [
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

const record = (dir: string, id: string) =>
  JSON.parse(readFileSync(join(ROOT, "data", dir, `${id}.json`), "utf8")) as {
    harmonic_constituents: HarmonicConstituent[];
    epoch?: { start: string; end: string };
  };

/** Kartverket's gauges with a multi-year analysis (2006–2020 or 2010–2020),
 *  whose period its records carry. */
const kartverket = (): Gauge[] =>
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
const KARTVERKET =
  "AES ANX BGO BOO HAR HEI HFT HRO HVG KAB KSU MAY MSU NVK NYA OSC OSL RVK SVG TOS TRD TRG VAW VIK";
const selected = kartverket().map((g) => g.agency.slice("kartverket/".length));
if (selected.join(" ") !== KARTVERKET)
  throw new Error(
    `Kartverket's multi-year analyses are now ${selected.join(" ")}; update KARTVERKET and the README`,
  );

const gauges: Gauge[] = [
  ...kartverket(),
  ...NOAA.map(([id, start, end, digest]) => ({
    series: `coops/${id}`,
    agency: `noaa/${id}`,
    start: new Date(Date.UTC(start, 0, 1)),
    end: new Date(Date.UTC(end + 1, 0, 1)),
    digest,
  })),
];

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/** Long-period constituents, slower than 5°/h: NOAA takes them from other
 *  spans and methods, and weather moves them from year to year. */
const longPeriod = (name: string) => (catalog[name]?.speed ?? 0) < 5;

interface Result {
  gauge: Gauge;
  report?: VerificationReport;
  error?: string;
}

const results: Result[] = [];
for (const gauge of gauges) {
  const [dir, id] = gauge.agency.split("/") as [string, string];
  const agency = record(dir, id);
  if (
    gauge.digest &&
    constantsDigest(agency.harmonic_constituents) !== gauge.digest
  ) {
    results.push({
      gauge,
      error: `data/${gauge.agency}.json has changed since its analysis years were read; read NOAA's harcon comments again`,
    });
    continue;
  }
  const { constants, rounding } = agencyConstants(dir, agency);
  try {
    const report = await verifyFit({
      series: gauge.series,
      start: gauge.start,
      end: gauge.end,
      names: constants.map((c) => c.name),
      exact: true,
      agency: {
        label: gauge.agency,
        constants,
        rounding,
        epoch: {
          start: isoDate(gauge.start),
          end: isoDate(new Date(+gauge.end - DAY_MS)),
        },
      },
    });
    results.push({ gauge, report });
    console.error(
      `${gauge.series}: ${summarize(report).outside}/${summarize(report).compared} outside`,
    );
  } catch (err) {
    results.push({ gauge, error: (err as Error).message });
    console.error(`${gauge.series}: ${(err as Error).message}`);
  }
}

const failed = results.filter((r) => r.error);
if (failed.length) {
  for (const { gauge, error } of failed)
    console.error(`${gauge.series}: ${error}`);
  throw new Error(
    `${failed.length} of ${results.length} gauges failed; the calibration report is unchanged`,
  );
}

/** How a gauge's constants compare with the agency's. */
function summarize(report: VerificationReport) {
  const diffs = report.agency!.constants;
  const outside = diffs.filter((d) => d.ratio !== null && d.ratio > 1);
  const worst = [...diffs].sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0))[0];
  return {
    compared: diffs.length,
    outside: outside.length,
    outsideLong: outside.filter((d) => longPeriod(d.name)).length,
    worst: worst ? `${worst.name} ${worst.ratio?.toFixed(1)}` : "",
    names: outside.map((d) => d.name),
    ratios: outside.map((d) => d.ratio!),
  };
}

const mm = (m: number | undefined) =>
  m === undefined ? "" : (m * 1000).toFixed(1);
const lines: string[] = [];
const byName = new Map<
  string,
  { outside: number; compared: number; ratios: number[] }
>();
for (const source of ["kartverket", "noaa"]) {
  lines.push(
    "",
    `### ${source === "noaa" ? "NOAA CO-OPS" : "Kartverket"}`,
    "",
    "| Gauge | Fitted | Compared | Outside (long-period) | Largest ratio | Held-out year | Fit RMS (mm) | Agency RMS (mm) | Fit vs agency | Fit vs TICON | Curve RMS (mm) |",
    "| --- | --- | --: | --: | --- | --: | --: | --: | --- | --- | --: |",
  );
  for (const { gauge, report } of results.filter((r) =>
    r.gauge.agency.startsWith(source),
  ) as { gauge: Gauge; report: VerificationReport }[]) {
    // The first and last values fitted, which a record shorter than the
    // agency's period shows.
    const period = `${report.fit.start} to ${report.fit.end}`;
    const s = summarize(report);
    for (const d of report.agency!.constants) {
      const e = byName.get(d.name) ?? { outside: 0, compared: 0, ratios: [] };
      e.compared++;
      if (d.ratio !== null && d.ratio > 1) {
        e.outside++;
        e.ratios.push(d.ratio);
      }
      byName.set(d.name, e);
    }
    const h = report.heldOut;
    const a = h?.others[gauge.agency];
    const ticon = h
      ? Object.entries(h.others)
          .filter(([k]) => k.startsWith("ticon/") || k.startsWith("refit/"))
          .map(([, v]) => v.verdict + (v.seen ? " (seen)" : ""))
          .join(", ")
      : "";
    lines.push(
      `| ${gauge.series} | ${period} | ${s.compared} | ${s.outside} (${s.outsideLong}) | ${s.worst} | ${h?.year ?? "none"} | ${mm(h?.fit.rms)} | ${mm(a?.rms)} | ${a?.verdict ?? ""} | ${ticon} | ${mm(report.agency?.curve?.rms)} |`,
    );
  }
}
const ok = results.filter((r) => r.report);
// A source with nothing outside has no median; say so rather than print NaN.
const fixed = (x: number, digits: number) =>
  Number.isFinite(x) ? x.toFixed(digits) : "—";
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const sourceLine = (label: string, prefix: string) => {
  const diffs = ok
    .filter((r) => r.gauge.agency.startsWith(prefix))
    .flatMap((r) => r.report!.agency!.constants);
  const out = diffs.filter((d) => d.ratio !== null && d.ratio > 1);
  return `| ${label} | ${diffs.length} | ${diffs.filter((d) => d.ratio === null).length} | ${out.length} (${fixed((100 * out.length) / diffs.length, 1)}%) | ${out.filter((d) => longPeriod(d.name)).length} | ${out.filter((d) => Math.abs(d.amplitude) > 0.001).length} | ${fixed(median(out.map((d) => d.ratio!)), 2)} |`;
};
const header = [
  `Gauges fitted: ${ok.length} of ${results.length}.`,
  "",
  "| Source | Compared | Without an interval | Outside our 95% interval | Long-period | With amplitudes over 1 mm apart | Median ratio outside |",
  "| --- | --: | --: | --: | --: | --: | --: |",
  sourceLine("Kartverket", "kartverket/"),
  sourceLine("NOAA CO-OPS", "noaa/"),
  sourceLine("All", ""),
];
const frequent = [...byName]
  .filter(([, e]) => e.outside > 0)
  .sort(
    (a, b) =>
      b[1].outside - a[1].outside ||
      b[1].outside / b[1].compared - a[1].outside / a[1].compared ||
      a[0].localeCompare(b[0]),
  )
  .slice(0, 20)
  .map(
    ([name, e]) =>
      `| ${name} | ${e.outside} of ${e.compared} | ${fixed(median(e.ratios), 2)} |`,
  );
// Both files are written as Prettier would, so a refresh passes `npm run lint`.
const readme = await format(
  template.slice(0, template.indexOf(MARKER) + MARKER.length) +
    "\n\n" +
    [
      ...header,
      ...lines,
      "",
      "### Constituents most often outside the interval",
      "",
      "| Constituent | Outside | Median ratio |",
      "| --- | --: | --: |",
      ...frequent,
    ].join("\n") +
    "\n",
  { parser: "markdown" },
);
// Six significant digits keep the file reviewable and every score's precision.
const round = (_: string, v: unknown) =>
  typeof v === "number" ? Number(v.toPrecision(6)) : v;
const json = await format(
  JSON.stringify(
    {
      // The fitter's version, so a stale report can be told from a fresh one.
      engine: JSON.parse(
        readFileSync(
          join(ROOT, "node_modules", "@slackwater", "engine", "package.json"),
          "utf8",
        ),
      ).version,
      gauges: results.map(({ gauge, report }) => ({
        series: gauge.series,
        agency: gauge.agency,
        period: {
          start: isoDate(gauge.start),
          end: isoDate(new Date(+gauge.end - DAY_MS)),
        },
        report,
      })),
    },
    round,
  ),
  { parser: "json" },
);
// Written together, once both are built, so a failure leaves both as they were.
writeFileSync(join(OUT, "README.md"), readme);
writeFileSync(join(OUT, "calibration.json"), json);
