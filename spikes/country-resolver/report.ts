import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Result } from "@openwaters/c5y-n8r";
import { loadSources } from "../../packages/stations/sources.ts";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { countryByName as baselineCountryByName } from "../../packages/stations/country.ts";

import { countryInfo } from "./lookup.ts";
import { resolutionCounts } from "./report-summary.ts";
import {
  groupCountryInputs,
  sourceCountryInput,
  type CountrySource,
} from "./source-country.ts";

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
const { countryRegistry, countryBinarySha256, countryByIso } =
  await import("./adapter.ts");
const openAndIndexMs = performance.now() - started;
const root = fileURLToPath(new URL("../..", import.meta.url));
const counts = new Map<string, number>();
const sourceRecords: {
  country: string;
  source?: CountrySource;
}[] = [];
const identityAudit = {
  records: 0,
  matchedRecords: 0,
  missingCodes: [] as string[],
  invalidCodes: [] as string[],
  unresolved: [] as string[],
  changedCodes: [] as { file: string; stored: string; actual: string }[],
};
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
      identityAudit.records++;
      if (row.country_code === undefined) identityAudit.missingCodes.push(path);
      else if (
        typeof row.country_code !== "string" ||
        !/^[A-Z]{2}$/.test(row.country_code)
      )
        identityAudit.invalidCodes.push(path);
      else {
        const input = sourceCountryInput(row.country, row.source);
        const actual = countryInfo(
          countryRegistry.convert(input.input, {
            from: input.namespace,
            to: "iso-alpha2",
          }),
        );
        const coded = countryByIso(row.country_code);
        if (!actual || !coded) identityAudit.unresolved.push(path);
        else if (actual.iso2 !== row.country_code)
          identityAudit.changedCodes.push({
            file: path,
            stored: row.country_code,
            actual: actual.iso2,
          });
        else identityAudit.matchedRecords++;
      }
      counts.set(row.country, (counts.get(row.country) ?? 0) + 1);
      sourceRecords.push({
        country: row.country,
        ...(row.source ? { source: row.source } : {}),
      });
    }
  }
}
walk(join(root, "data"));
const groups = groupCountryInputs(sourceRecords);
const jurisdictionNames = new Set(
  [...loadSources().values()].flatMap((source) => source.jurisdiction ?? []),
);
const cases = groups
  .sort((a, b) =>
    a.input < b.input
      ? -1
      : a.input > b.input
        ? 1
        : a.lookupInput < b.lookupInput
          ? -1
          : a.lookupInput > b.lookupInput
            ? 1
            : a.lookupNamespace < b.lookupNamespace
              ? -1
              : a.lookupNamespace > b.lookupNamespace
                ? 1
                : 0,
  )
  .map(({ input, lookupInput, lookupNamespace, records, sourceMappings }) => {
    const old = baselineCountryByName(input);
    const result = countryRegistry.convert(lookupInput, {
      from: lookupNamespace,
      to: "iso-alpha2",
    });
    const actual = countryInfo(result);
    return {
      input,
      lookupInput,
      lookupNamespace,
      sourceMappings,
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
      datumPolicyReview: Boolean(old && actual && old.iso2 !== actual.iso2),
      jurisdictionPolicyReview: Boolean(
        old &&
        actual &&
        old.iso2 !== actual.iso2 &&
        jurisdictionNames.has(old.iso2),
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
for (const group of groups)
  for (let i = 0; i < group.records; i++)
    countryInfo(
      countryRegistry.convert(group.lookupInput, {
        from: group.lookupNamespace,
        to: "iso-alpha2",
      }),
    );
const lookupMs = performance.now() - lookupStarted;
const report = {
  package: "@openwaters/c5y-n8r",
  metadata: countryRegistry.metadata(),
  binarySha256: countryBinarySha256,
  records: [...counts.values()].reduce((a, b) => a + b, 0),
  inputs: counts.size,
  comparisonGroups: cases.length,
  identityAudit,
  sourceMappedRecords: cases.reduce(
    (total, c) => total + c.sourceMappings.length,
    0,
  ),
  openAndIndexMs,
  lookupMs,
  outcomes: cases.reduce<Record<string, { groups: number; records: number }>>(
    (out, c) => {
      const value = (out[c.outcome] ??= { groups: 0, records: 0 });
      value.groups++;
      value.records += c.records;
      return out;
    },
    {},
  ),
  ...resolutionCounts(cases),
  nameDifferenceGroups: cases.filter((c) => c.nameChanged).length,
  continentDifferenceGroups: cases.filter((c) => c.continentChanged).length,
  datumPolicyReviewGroups: cases.filter((c) => c.datumPolicyReview).length,
  jurisdictionPolicyReviewGroups: cases.filter(
    (c) => c.jurisdictionPolicyReview,
  ).length,
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
