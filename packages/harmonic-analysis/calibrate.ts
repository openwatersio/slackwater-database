import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { constituents as catalog } from "@slackwater/engine";
import { format } from "prettier";
import {
  codeDigest,
  constantsDigest,
  gauges,
  installedEngine,
  methodOf,
  type Gauge,
  type NoaaAnalysis,
  KARTVERKET,
  kartverket,
  record,
  ROOT,
  reportRounding,
} from "./calibration-inputs.ts";
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

const OUT = join(ROOT, "docs", "calibration");

const MARKER = "<!-- calibration results -->";
// Read now to fail early, and again before writing, so an edit made while the
// refresh runs is kept.
const readTemplate = () => {
  const text = readFileSync(join(OUT, "README.md"), "utf8");
  if (!text.includes(MARKER))
    throw new Error(`docs/calibration/README.md has no ${MARKER} line`);
  return text;
};
readTemplate();

const DAY_MS = 86_400_000;

const selected = kartverket().map((g) => g.agency.slice("kartverket/".length));
if (selected.join(" ") !== KARTVERKET)
  throw new Error(
    `Kartverket's multi-year analyses are now ${selected.join(" ")}; update KARTVERKET and the README`,
  );

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/** Long-period constituents, slower than 5°/h: NOAA takes them from other
 *  spans and methods, and weather moves them from year to year. */
const longPeriod = (name: string) => (catalog[name]?.speed ?? 0) < 5;

interface Result {
  gauge: Gauge & { analysis?: NoaaAnalysis };
  /** Constituents left out of the comparison, with the reason. */
  notCompared?: { names: string[]; reason: string }[];
  /** A digest of the agency constants fitted against. */
  constants?: string;
  report?: VerificationReport;
  error?: string;
}

/** Constituents a gauge's comparison leaves out, with the reason. */
function notComparedIn(
  gauge: Result["gauge"],
  report: VerificationReport,
): { names: string[]; reason: string }[] {
  const out = gauge.unstated ? [gauge.unstated] : [];
  // Without a year the agency averaged, nothing but the long-period lines
  // could be compared, so the gauge fails rather than drop out unseen. A
  // joint fit reads the hours a short year has, as the agency's did, and the
  // report lists the year.
  if (report.fit.years && report.fit.shortYears.length)
    throw new Error(
      `Stillwell has under two thirds of the hours in ${report.fit.shortYears.join(", ")}, which the agency's average includes`,
    );
  for (const g of report.fit.longPeriod ?? [])
    if (g.shortYears.length)
      out.push({
        names: g.names,
        reason: `Stillwell has under two thirds of the hours in ${g.shortYears.join(", ")}, which the agency's long-period analysis includes`,
      });
  return out;
}

async function calibrate(gauge: Result["gauge"]): Promise<Result> {
  const [dir, id] = gauge.agency.split("/") as [string, string];
  const agency = record(dir, id);
  const { constants, rounding, nodeCorrections } = agencyConstants(dir, agency);
  try {
    const report = await verifyFit({
      series: gauge.series,
      start: gauge.start,
      end: gauge.end,
      names: constants.map((c) => c.name),
      exact: true,
      ...gauge.method,
      agency: {
        label: gauge.agency,
        constants,
        rounding,
        nodeCorrections,
        ...(gauge.method.gain && { gain: gauge.method.gain }),
        epoch: {
          start: isoDate(gauge.start),
          end: isoDate(new Date(+gauge.end - DAY_MS)),
        },
      },
    });
    // Left out of the comparison: what the agency doesn't say how it
    // determined, and what Stillwell lacks a year of that the agency's
    // average includes.
    const notCompared = notComparedIn(gauge, report);
    report.agency!.constants = report.agency!.constants.filter(
      (d) => !notCompared.some((n) => n.names.includes(d.name)),
    );
    console.error(
      `${gauge.series}: ${summarize(report).outside}/${summarize(report).compared} outside`,
    );
    return {
      gauge,
      constants: constantsDigest(agency.harmonic_constituents),
      notCompared,
      report,
    };
  } catch (err) {
    console.error(`${gauge.series}: ${(err as Error).message}`);
    return { gauge, error: (err as Error).message };
  }
}

const results: Result[] = [];
for (const gauge of await gauges()) results.push(await calibrate(gauge));
// Stillwell marks a station while it rewrites its year files and asks to read
// again later, so those gauges are fitted again after the rest, every ten
// minutes for an hour. Any other failure stops the refresh.
const WRITING = "Stillwell is writing its year files";
for (let attempt = 1; attempt <= 6; attempt++) {
  const waiting = results.flatMap((r, i) =>
    r.error?.includes(WRITING) ? [i] : [],
  );
  if (!waiting.length) break;
  console.error(
    `${waiting.length} gauges are being written; trying again in 10 minutes`,
  );
  await new Promise((resolve) => setTimeout(resolve, 600_000));
  for (const i of waiting) results[i] = await calibrate(results[i]!.gauge);
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
  "| Source | Compared | Without an interval | Outside our 95% interval | Long-period | Outside and over 1 mm apart | Median ratio outside |",
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
const template = readTemplate();
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
const json = await format(
  JSON.stringify(
    {
      // The fitter's version, so a stale report can be told from a fresh one.
      engine: installedEngine(),
      // What else it was computed from, which npm test checks.
      code: codeDigest(),
      gauges: results.map(({ gauge, constants, notCompared, report }) => ({
        series: gauge.series,
        agency: gauge.agency,
        constants,
        // How the gauge was fitted, which npm test checks for Kartverket's.
        method: methodOf(gauge),
        ...(notCompared?.length && { notCompared }),
        // NOAA's comment, and the method read from it.
        ...(gauge.analysis && { analysis: gauge.analysis }),
        period: {
          start: isoDate(gauge.start),
          end: isoDate(new Date(+gauge.end - DAY_MS)),
        },
        report,
      })),
    },
    reportRounding,
  ),
  { parser: "json" },
);
// Written once both are built, so a failed fit or build leaves both as they were.
writeFileSync(join(OUT, "README.md"), readme);
writeFileSync(join(OUT, "calibration.json"), json);
