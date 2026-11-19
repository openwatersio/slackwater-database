import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  codeDigest,
  constantsDigest,
  gauges,
  KARTVERKET,
  kartverket,
  NOAA,
  record,
} from "../calibration-inputs.ts";
import { agencyConstants } from "../verify-fit.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");

describe("calibration", () => {
  test("was fitted with the engine installed", () => {
    const report = JSON.parse(
      readFileSync(
        join(ROOT, "docs", "calibration", "calibration.json"),
        "utf8",
      ),
    );
    const engine = JSON.parse(
      readFileSync(
        join(ROOT, "node_modules", "@slackwater", "engine", "package.json"),
        "utf8",
      ),
    );
    // On failure: npm run refresh:calibration -w packages/harmonic-analysis.
    expect(report.engine).toBe(engine.version);
  });
});

describe("agencyConstants", () => {
  const record = {
    harmonic_constituents: [
      { name: "M2", amplitude: 1, phase: 10 },
      { name: "M1", amplitude: 0, phase: 0 },
      { name: "M3", amplitude: 0, phase: 12 },
    ],
  };

  test("leaves out what NOAA marks as not determined, and keeps measured zeros", () => {
    expect(
      agencyConstants("noaa", record).constants.map((c) => c.name),
    ).toEqual(["M2", "M3"]);
    expect(agencyConstants("kartverket", record).constants).toHaveLength(3);
    expect(agencyConstants("noaa", record).nodeCorrections).toBe("schureman");
    expect(agencyConstants("kartverket", record).nodeCorrections).toBe("iho");
    expect(agencyConstants("kartverket", record).rounding).toEqual({
      amplitude: 0.00005,
      phase: 0.005,
    });
  });

  test("refuses an agency whose published precision isn't declared", () => {
    expect(() => agencyConstants("linz", record)).toThrow(
      "declare the precision",
    );
  });
});

describe("calibration inputs", () => {
  const report = JSON.parse(
    readFileSync(join(ROOT, "docs", "calibration", "calibration.json"), "utf8"),
  ) as { code: string; gauges: { agency: string; constants: string }[] };
  // On failure: npm run refresh:calibration -w packages/harmonic-analysis.

  test("the report was computed by this code", () => {
    expect(report.code).toBe(codeDigest());
  });

  test("the report was computed from the agency constants in data/", () => {
    for (const { agency, constants } of report.gauges)
      expect(
        constantsDigest(
          record(...(agency.split("/") as [string, string]))
            .harmonic_constituents,
        ),
        agency,
      ).toBe(constants);
  });

  test("the gauges are the pinned ones", () => {
    expect(report.gauges.map((g) => g.agency)).toEqual(
      gauges.map((g) => g.agency),
    );
    expect(
      kartverket()
        .map((g) => g.agency.slice("kartverket/".length))
        .join(" "),
    ).toBe(KARTVERKET);
  });

  test("NOAA's analysis years were read for the constants in data/", () => {
    for (const [id, , , digest] of NOAA)
      expect(
        constantsDigest(record("noaa", id).harmonic_constituents),
        id,
      ).toBe(digest);
  });
});
