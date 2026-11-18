import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Result } from "@openwaters/c5y-n8r";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { countryByName as baselineCountryByName } from "../../packages/stations/country.ts";

function snapshot(result: Result) {
  return {
    selection: result.selection,
    temporalAmbiguity: result.temporalAmbiguity,
    coverage: result.coverage,
    evidenceStatus: result.evidenceStatus,
    preferred: result.preferred && {
      id: result.preferred.id,
      namespace: result.preferred.namespace,
      value: result.preferred.value,
    },
    candidates: result.candidates.map((c) => ({
      id: c.id,
      name: c.name,
      namespace: c.namespace,
      value: c.value,
      matchedBy: c.matchedBy,
      applicability: c.applicability,
      tentative: c.tentative,
      temporalReviewed: c.temporalReviewed,
      retiredAtDay: c.retiredAtDay,
      successors: c.successors,
      evidence: c.evidence,
    })),
  };
}

const started = performance.now();
const { countryByName, countryRegistry, countryBinarySha256 } =
  await import("./adapter.ts");
const openAndIndexMs = performance.now() - started;
const root = fileURLToPath(new URL("../..", import.meta.url));
const counts = new Map<string, number>();
function walk(dir: string) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (
      entry.name.endsWith(".json") &&
      !entry.name.endsWith(".geo.json")
    ) {
      const row = JSON.parse(readFileSync(path, "utf8"));
      if (
        typeof row.country !== "string" ||
        !row.country.trim() ||
        row.country.length > 1024
      )
        throw new Error(`Invalid country: ${path}`);
      counts.set(row.country, (counts.get(row.country) ?? 0) + 1);
    }
  }
}
walk(join(root, "data"));
const cases = [...counts]
  .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  .map(([input, records]) => {
    const old = baselineCountryByName(input);
    const result = countryRegistry.convert(input, {
      from: "name",
      to: "iso-alpha2",
    });
    const actual = countryByName(input);
    return {
      input,
      records,
      expected: old && {
        iso2: old.iso2,
        country: old.country,
        continent: old.continent,
      },
      actual,
      nameChanged: Boolean(old && actual && old.country !== actual.country),
      continentChanged: Boolean(
        old && actual && old.continent !== actual.continent,
      ),
      datumPolicyReview: Boolean(
        old && actual && old.country !== actual.country,
      ),
      tentative: Boolean(
        result.source.preferred?.tentative ||
        result.target.preferred?.tentative,
      ),
      source: snapshot(result.source),
      target: snapshot(result.target),
      outcome: !actual
        ? "unresolved"
        : !old
          ? "newly-resolved"
          : actual.iso2 !== old.iso2
            ? "code-difference"
            : actual.country !== old.country ||
                actual.continent !== old.continent
              ? "metadata-difference"
              : "baseline-match",
    };
  });
const lookupStarted = performance.now();
for (const [input, records] of counts)
  for (let i = 0; i < records; i++) countryByName(input);
const lookupMs = performance.now() - lookupStarted;
const report = {
  package: "@openwaters/c5y-n8r",
  metadata: countryRegistry.metadata(),
  binarySha256: countryBinarySha256,
  records: [...counts.values()].reduce((a, b) => a + b, 0),
  inputs: counts.size,
  openAndIndexMs,
  lookupMs,
  outcomes: cases.reduce<Record<string, { inputs: number; records: number }>>(
    (out, c) => {
      const value = (out[c.outcome] ??= { inputs: 0, records: 0 });
      value.inputs++;
      value.records += c.records;
      return out;
    },
    {},
  ),
  resolvedInputs: cases.filter((c) => c.actual !== null).length,
  resolvedRecords: cases.reduce(
    (total, c) => total + (c.actual ? c.records : 0),
    0,
  ),
  resolvedInputsWithoutContinent: cases.filter(
    (c) => c.actual && !c.actual.continent?.trim(),
  ).length,
  tentativeResolvedInputs: cases.filter((c) => c.actual && c.tentative).length,
  tentativeResolvedRecords: cases.reduce(
    (total, c) => total + (c.actual && c.tentative ? c.records : 0),
    0,
  ),
  nameDifferenceInputs: cases.filter((c) => c.nameChanged).length,
  continentDifferenceInputs: cases.filter((c) => c.continentChanged).length,
  datumPolicyReviewInputs: cases.filter((c) => c.datumPolicyReview).length,
  verifiedInputs: 0,
  limitation:
    "Compatibility baselines are not verified facts. This partial unreviewed corpus cannot replace the production dependency. Timing includes package loading and validated registry opening and measures this machine only. Tentative preferred codes remain unverified and are reported with their uncertainty.",
  cases,
};
const output = resolve(
  process.argv[2] ?? join(root, "tmp/country-resolver.json"),
);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify({ ...report, cases: undefined, report: output }, null, 2),
);
