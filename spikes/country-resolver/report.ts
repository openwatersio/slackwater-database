import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { countryByName as baselineCountryByName } from "../../packages/stations/country.ts";

const started = performance.now();
const { countryByName, countryRegistry } = await import("./adapter.ts");
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
      if (typeof row.country !== "string")
        throw new Error(`Missing country: ${path}`);
      counts.set(row.country, (counts.get(row.country) ?? 0) + 1);
    }
  }
}
walk(join(root, "data"));
const cases = [...counts]
  .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  .map(([input, records]) => {
    const old = baselineCountryByName(input);
    const result = countryRegistry.resolve(input, { namespace: "name" });
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
      selection: result.selection,
      temporalAmbiguity: result.temporalAmbiguity,
      evidenceStatus: result.evidenceStatus,
      candidates: result.candidates.map((c) => ({
        id: c.id,
        name: c.name,
        applicability: c.applicability,
        evidence: c.evidence,
      })),
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
  verifiedInputs: 0,
  limitation:
    "Compatibility baselines are not verified facts. This partial unreviewed corpus cannot replace the production dependency. Timing includes the alpha-2 scan and measures this machine only.",
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
