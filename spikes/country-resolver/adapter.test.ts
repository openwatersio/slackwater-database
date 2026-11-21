import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { countryByName, countryByIso, countryRegistry } from "./adapter.ts";
import { createCountryLookup, countryInfo } from "./lookup.ts";
import evidence from "./noaa-virgin-islands.json" with { type: "json" };
import ticonEvidence from "./ticon-saint-helena.json" with { type: "json" };
import { resolutionCounts } from "./report-summary.ts";
import { groupCountryInputs, sourceCountryInput } from "./source-country.ts";
import { winsOnAuthority } from "../../packages/stations/filtering.ts";
import { getChartDatum, pruneDatums } from "../../packages/stations/station.ts";

test("resolves normalized names and alpha-3 codes without claiming verification", () => {
  assert.deepEqual(countryByName(" turkey "), {
    iso2: "TR",
    country: "Turkey",
    continent: "Asia",
  });
  assert.deepEqual(countryByIso(" TUR "), countryByName("Turkey"));
  assert.equal(
    countryRegistry.resolve("Turkey").evidenceStatus,
    "unreviewed-spike",
  );
});
test("keeps unknown and ambiguous inputs unresolved", () => {
  assert.equal(countryByName("Unknown country"), null);
  assert.equal(countryByName("  "), null);
  assert.equal(countryByIso("  "), null);
  assert.equal(countryByIso("123"), null);
  assert.deepEqual(countryByIso("tr"), countryByName("Turkey"));
  assert.equal(countryByName("Congo"), null);
  assert.equal(countryByIso("CS"), null);
  assert.equal(countryByIso("AN"), null);
});
test("the report runs on source records and exposes metadata differences", () => {
  const dir = mkdtempSync(join(tmpdir(), "country-report-"));
  try {
    const output = join(dir, "report.json");
    const run = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("report.ts", import.meta.url)), output],
      { encoding: "utf8" },
    );
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const report = JSON.parse(readFileSync(output, "utf8"));
    assert.ok(report.records > 0);
    assert.equal(report.identityAudit.matchedRecords, report.records);
    for (const key of [
      "missingCodes",
      "invalidCodes",
      "unresolved",
      "changedCodes",
    ])
      assert.deepEqual(report.identityAudit[key], []);
    assert.equal(report.resolvedInputs, report.inputs);
    assert.equal(report.resolvedRecords, report.records);
    assert.equal(report.outcomes.unresolved, undefined);
    assert.equal(
      report.cases.filter((c: any) => c.input === "Saint Helena").length,
      1,
    );
    assert.equal(
      report.cases.find((c: any) => c.input === "Myanmar (Burma)").actual.iso2,
      "MM",
    );
    const virgin = report.cases.find((c: any) => c.input === "Virgin Islands");
    assert.equal(virgin.records, 26);
    assert.equal(virgin.lookupInput, "United States Virgin Islands");
    assert.equal(virgin.actual.iso2, "VI");
    assert.equal(virgin.jurisdictionPolicyReview, false);
    const subordinate = JSON.parse(
      readFileSync(
        new URL("../../data/noaa/9751540.json", import.meta.url),
        "utf8",
      ),
    );
    assert.equal(winsOnAuthority(subordinate), true);
    assert.equal(
      winsOnAuthority({ ...subordinate, country: virgin.actual.country }),
      true,
    );
    assert.equal(virgin.source.preferred.id, "Q11703");
    assert.equal(virgin.sourceMappings.length, 26);
    assert.equal(
      new Set(virgin.sourceMappings.map((m: any) => m.stationId)).size,
      26,
    );
    assert.ok(
      virgin.sourceMappings.every((m: any) => m.issue.endsWith("/148")),
    );
    assert.equal(countryByName("Virgin Islands"), null);
    const saint = report.cases.find((c: any) => c.input === "Saint Helena");
    assert.equal(saint.records, 3);
    assert.equal(saint.lookupInput, "SHN");
    assert.equal(saint.lookupNamespace, "iso-alpha3");
    assert.ok(saint.actual);
    assert.equal(saint.actual.iso2, "SH");
    assert.equal(saint.source.preferred.id, "Q192184");
    assert.equal(saint.sourceMappings.length, 3);
    assert.equal(countryByName("Saint Helena"), null);
    assert.equal(report.verifiedInputs, 0);
    assert.equal(
      report.binarySha256,
      createHash("sha256")
        .update(
          readFileSync(
            new URL(import.meta.resolve("@openwaters/c5y-n8r/data")),
          ),
        )
        .digest("hex"),
    );
    assert.equal(report.outcomes["code-difference"], undefined);
    assert.ok(report.tentativeResolvedGroups > 0);
    assert.equal(report.resolvedGroups, report.resolvedInputs);
    assert.equal(report.tentativeResolvedInputs, undefined);
    assert.ok(report.tentativeResolvedRecords > 0);
    assert.equal(report.resolvedGroupsWithoutContinent, 0);
    const china = report.cases.find((c: any) => c.input === "China");
    assert.equal(china.nameChanged, true);
    assert.equal(china.datumPolicyReview, false);
    assert.equal(getChartDatum(china.expected.iso2, { TLT: 0 }), "TLT");
    assert.equal(getChartDatum(china.actual.iso2, { TLT: 0 }), "TLT");
    assert.deepEqual(pruneDatums(china.expected.iso2, { TLT: 0 }), {
      TLT: 0,
    });
    assert.deepEqual(pruneDatums(china.actual.iso2, { TLT: 0 }), { TLT: 0 });
    const stored = JSON.parse(
      readFileSync(
        new URL(
          "../../data/ticon/dalian-630a-chn-uhslc_rq.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    assert.equal(stored.chart_datum, "TLT");
    assert.equal(stored.datums.TLT, 0.333);
    const renamedDatums = pruneDatums(china.actual.iso2, stored.datums);
    assert.equal(
      renamedDatums[stored.chart_datum],
      stored.datums[stored.chart_datum],
    );
    const turkey = report.cases.find((c: any) => c.input === "Turkiye");
    for (const stage of [turkey.source, turkey.target]) {
      assert.equal(stage.evidenceStatus, "unreviewed-spike");
      assert.ok(stage.candidates.length > 0);
      assert.ok(stage.candidates.every((c: any) => c.evidence.length > 0));
      assert.ok(
        stage.candidates.every(
          (c: any) => typeof c.temporalReviewed === "boolean",
        ),
      );
    }
    assert.equal(turkey.source.temporalAmbiguity, false);
    assert.equal(turkey.target.temporalAmbiguity, true);
    assert.ok(
      turkey.target.candidates.some(
        (c: any) =>
          c.applicability === "uncertain" && c.tentative && !c.temporalReviewed,
      ),
    );
    assert.ok(
      turkey.target.candidates.some(
        (c: any) => c.namespace === "iso-alpha2" && c.value === "TR",
      ),
    );
    assert.equal(
      report.cases.find((c: any) => c.input === "Turkiye").outcome,
      "metadata-difference",
    );
    assert.equal(
      report.cases.find((c: any) => c.input === "Curaçao").outcome,
      "metadata-difference",
    );
    assert.equal(
      report.cases.find((c: any) => c.input === "United Kingdom").outcome,
      "baseline-match",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the pure lookup uses conversion directly and keeps ambiguity unresolved", () => {
  const calls: unknown[] = [];
  const lookup = createCountryLookup({
    convert(value, options) {
      calls.push([value, options]);
      return countryRegistry.convert(value, options);
    },
  });
  assert.deepEqual(lookup.countryByIso("TUR"), countryByName("Turkey"));
  assert.equal(lookup.countryByName("Congo"), null);
  assert.deepEqual(calls, [
    ["TUR", { from: "iso-alpha3", to: "iso-alpha2" }],
    ["Congo", { from: "name", to: "iso-alpha2" }],
  ]);
  const ambiguous = countryRegistry.convert("Congo", {
    from: "name",
    to: "iso-alpha2",
  });
  assert.equal(ambiguous.source.selection, "ambiguous");
  assert.equal(ambiguous.target.preferred, undefined);
  assert.ok(ambiguous.target.candidates.length > 1);
});

test("conversion requires a selected target and rejects retired assignments", () => {
  const actual = countryRegistry.convert("TUR", {
    from: "iso-alpha3",
    to: "iso-alpha2",
  });
  const { preferred: _preferred, ...unselectedTarget } = actual.target;
  assert.equal(
    countryInfo({
      ...actual,
      target: {
        ...unselectedTarget,
        selection: "ambiguous",
      },
    }),
    null,
  );
  for (const input of ["AN", "CS"]) {
    const retired = countryRegistry.convert(input, {
      from: "iso-alpha2",
      to: "iso-alpha2",
    });
    assert.equal(countryInfo(retired), null);
    assert.ok(
      retired.target.candidates.some((c) => c.applicability === "retired"),
    );
  }
});

test("a retired source cannot select a current target for the same entity", () => {
  const retired = countryRegistry.convert("BU", {
    from: "iso-alpha2",
    to: "iso-alpha2",
  });
  assert.equal(retired.source.preferred?.applicability, "retired");
  const current = retired.target.candidates.find((c) => c.value === "MM");
  assert.ok(current);
  assert.equal(
    countryInfo({
      source: retired.source,
      target: { ...retired.target, preferred: current, selection: "latest" },
    }),
    null,
  );
});

test("source and target acceptance rejects every unsupported applicability", () => {
  const actual = countryRegistry.convert("TUR", {
    from: "iso-alpha3",
    to: "iso-alpha2",
  });
  assert.ok(actual.source.preferred);
  assert.ok(actual.target.preferred);
  for (const stage of ["source", "target"] as const) {
    for (const applicability of [
      "uncertain",
      "deprecated",
      "outside-date",
    ] as const) {
      const rejected = Object.create(actual[stage].preferred!);
      Object.defineProperties(rejected, {
        applicability: { value: applicability },
        tentative: { value: false },
      });
      assert.equal(
        countryInfo({
          ...actual,
          [stage]: { ...actual[stage], preferred: rejected },
        }),
        null,
      );
    }
  }
});

test("NOAA context resolves only the researched Virgin Islands stations", () => {
  const source = {
    name: "US National Oceanic and Atmospheric Administration",
    id: "9751419",
  };
  const mapped = (name: string, context?: { name?: string; id?: string }) =>
    countryByName(sourceCountryInput(name, context).input);
  assert.deepEqual(mapped("Virgin Islands", source), {
    iso2: "VI",
    country: "United States Virgin Islands",
    continent: "North America",
  });
  assert.equal(countryByName("Virgin Islands"), null);
  assert.equal(mapped("Virgin Islands", { ...source, id: "9999999" }), null);
  assert.equal(
    mapped("Virgin Islands", { ...source, name: "Other provider" }),
    null,
  );
  assert.equal(mapped("Virgin Islands", { name: source.name }), null);
  assert.deepEqual(
    mapped("British Virgin Islands", source),
    countryByName("British Virgin Islands"),
  );
});

test("provider context stays separate when the same spelling has multiple meanings", () => {
  const known = evidence.records.map((record) => ({
    country: "Virgin Islands",
    source: { name: evidence.sourceName, id: record.id },
  }));
  for (const record of known)
    assert.equal(
      countryByName(sourceCountryInput(record.country, record.source).input)
        ?.iso2,
      "VI",
    );
  const groups = groupCountryInputs([
    ...known,
    {
      country: "Virgin Islands",
      source: { name: "Other provider", id: "9751419" },
    },
  ]);
  assert.equal(groups.length, 2);
  const mapped = groups.find(
    (group) => group.lookupInput === "United States Virgin Islands",
  )!;
  assert.equal(mapped.records, 26);
  assert.equal(mapped.sourceMappings.length, 26);
  const unknown = groups.find(
    (group) => group.lookupInput === "Virgin Islands",
  )!;
  assert.equal(unknown.records, 1);
  assert.deepEqual(unknown.sourceMappings, []);
  assert.equal(countryByName(unknown.lookupInput), null);
  const summary = resolutionCounts(
    groups.map((group) => ({
      ...group,
      actual: countryByName(group.lookupInput),
      tentative: Boolean(
        countryRegistry.convert(group.lookupInput, {
          from: "name",
          to: "iso-alpha2",
        }).target.preferred?.tentative,
      ),
    })),
  );
  assert.equal(summary.resolvedInputs, 0);
  assert.equal(summary.resolvedGroups, 1);
  assert.equal(summary.tentativeResolvedGroups, 1);
  assert.equal(summary.resolvedRecords, 26);
});

test("NOAA mapping evidence has unique identities and retained source passages", () => {
  assert.equal(
    new Set(evidence.records.map((record) => record.id)).size,
    evidence.records.length,
  );
  for (const record of evidence.records) {
    assert.match(record.sha256, /^[a-f0-9]{64}$/);
    assert.match(record.benchmarkSha256, /^[a-f0-9]{64}$/);
    assert.ok(record.benchmarkPassage.includes(record.id));
    if (record.id !== "9751373") {
      assert.equal(record.benchmarkState, "VI");
      assert.match(record.benchmarkPassage, /\n\s+VI\r?\n/);
    }
  }
  const coral = evidence.records.find((record) => record.id === "9751373")!;
  assert.equal(coral.benchmarkState, null);
  assert.match(coral.benchmarkPassage, /WESTERN ST JOHN/);
  assert.match(coral.benchmarkPassage, /Cruz Bay/);
});

test("Saint Helena uses only the three TICON SHN series, preserving island and GBR meanings", () => {
  const sourceName = "TICON-4";
  const other = JSON.parse(
    readFileSync(
      new URL("../../data/ticon/st_helena-sth-gbr-noc.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(countryByName(other.country)?.iso2, "GB");
  assert.equal(
    sourceCountryInput(other.country, other.source).input,
    other.country,
  );
  for (const id of [
    "st_helena-292-shn-uhslc_fd",
    "st_helena-292a-shn-uhslc_rq",
    "st_helena-292b-shn-uhslc_rq",
  ]) {
    const mapped = sourceCountryInput("Saint Helena", { name: sourceName, id });
    assert.equal(mapped.input, "SHN");
    assert.equal(mapped.namespace, "iso-alpha3");
    assert.equal(mapped.mapping?.entity, "Q192184");
  }
  for (const source of [
    undefined,
    { name: "Other provider", id: "st_helena-292-shn-uhslc_fd" },
    { name: sourceName, id: "st_helena-sth-gbr-noc" },
  ]) {
    assert.equal(
      sourceCountryInput("Saint Helena", source).input,
      "Saint Helena",
    );
  }
});

test("the TICON context extract matches stored series, licenses and observation epochs", () => {
  const directory = new URL("../../data/ticon/", import.meta.url);
  const records = readdirSync(directory)
    .filter((name) => name.endsWith(".json") && !name.endsWith(".geo.json"))
    .map((name) => JSON.parse(readFileSync(new URL(name, directory), "utf8")))
    .filter(
      (record) =>
        record.country === ticonEvidence.originalCountry &&
        record.source.name === ticonEvidence.sourceName,
    );
  assert.deepEqual(
    records.map((record) => record.source.id).sort(),
    ticonEvidence.records.map((record) => record.id).sort(),
  );
  assert.equal(
    new Set(ticonEvidence.records.map((record) => record.id)).size,
    ticonEvidence.records.length,
  );
  for (const entry of ticonEvidence.records) {
    const stored = records.find((record) => record.source.id === entry.id)!;
    assert.deepEqual(entry.license, stored.license);
    assert.equal(entry.rows, stored.harmonic_constituents.length);
    assert.equal(
      entry.startDate.split("/").reverse().join("-"),
      stored.epoch.start,
    );
    assert.equal(
      entry.endDate.split("/").reverse().join("-"),
      stored.epoch.end,
    );
    assert.equal(entry.countryCode, "SHN");
  }
});
