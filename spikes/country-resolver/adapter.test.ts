import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { countryByName, countryByIso, countryRegistry } from "./adapter.ts";
import { createCountryLookup, countryInfo } from "./lookup.ts";
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
    assert.ok(report.tentativeResolvedInputs > 0);
    assert.ok(report.tentativeResolvedRecords > 0);
    assert.equal(report.resolvedInputsWithoutContinent, 0);
    const china = report.cases.find((c: any) => c.input === "China");
    assert.equal(china.nameChanged, true);
    assert.equal(china.datumPolicyReview, true);
    assert.equal(getChartDatum(china.expected.country, { TLT: 0 }), "TLT");
    assert.equal(getChartDatum(china.actual.country, { TLT: 0 }), "LAT");
    assert.deepEqual(pruneDatums(china.expected.country, { TLT: 0 }), {
      TLT: 0,
    });
    assert.deepEqual(pruneDatums(china.actual.country, { TLT: 0 }), {});
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
    const renamedDatums = pruneDatums(china.actual.country, stored.datums);
    assert.equal(renamedDatums[stored.chart_datum], undefined);
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
