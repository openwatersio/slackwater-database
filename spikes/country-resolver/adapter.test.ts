import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { countryByName, countryByIso, countryRegistry } from "./adapter.ts";

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
  assert.equal(countryByName("Congo"), null);
  assert.equal(countryByIso("CS"), null);
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
