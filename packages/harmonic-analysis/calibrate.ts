import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { constituents as catalog } from "@slackwater/engine";
import { format } from "prettier";
import {
  codeDigest,
  constantsDigest,
  gauges,
  type Gauge,
  KARTVERKET,
  kartverket,
  record,
  ROOT,
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
const template = readFileSync(join(OUT, "README.md"), "utf8");
if (!template.includes(MARKER))
  throw new Error(`docs/calibration/README.md has no ${MARKER} line`);

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
  gauge: Gauge;
  /** A digest of the agency constants fitted against. */
  constants?: string;
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
  const { constants, rounding, nodeCorrections } = agencyConstants(dir, agency);
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
        nodeCorrections,
        epoch: {
          start: isoDate(gauge.start),
          end: isoDate(new Date(+gauge.end - DAY_MS)),
        },
      },
    });
    results.push({
      gauge,
      constants: constantsDigest(agency.harmonic_constituents),
      report,
    });
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
      // What else it was computed from, which npm test checks.
      code: codeDigest(),
      gauges: results.map(({ gauge, constants, report }) => ({
        series: gauge.series,
        agency: gauge.agency,
        constants,
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
// Written once both are built, so a failed fit or build leaves both as they were.
writeFileSync(join(OUT, "README.md"), readme);
writeFileSync(join(OUT, "calibration.json"), json);
