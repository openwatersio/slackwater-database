import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  codeDigest,
  installedEngine,
  methodOf,
  constantsDigest,
  KARTVERKET,
  kartverket,
  NOAA,
  parseNoaaComment,
  record,
  reportRounding,
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
    // On failure: npm run refresh:calibration -w packages/harmonic-analysis.
    expect(report.engine).toBe(installedEngine());
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
  ) as {
    code: string;
    gauges: {
      agency: string;
      constants: string;
      period: { start: string; end: string };
      method: unknown;
      report: {
        agency: { constants: { name: string; ratio: number | null }[] };
      };
    }[];
  };
  // On failure: npm run refresh:calibration -w packages/harmonic-analysis.

  // Fitted the agency's way from the same observations, every constant should
  // agree with the agency's. On failure, find the cause.
  test("every constant agrees with the agency's", () => {
    const disagree = report.gauges.flatMap(({ agency, report }) =>
      report.agency.constants
        .filter((d) => d.ratio === null || d.ratio > 1)
        .map(
          (d) => `${agency} ${d.name} ${d.ratio?.toFixed(2) ?? "no interval"}`,
        ),
    );
    expect(disagree).toEqual([]);
  });

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
    expect(report.gauges.map((g) => g.agency)).toEqual([
      ...kartverket().map((g) => g.agency),
      ...NOAA.map((id) => `noaa/${id}`),
    ]);
    expect(
      kartverket()
        .map((g) => g.agency.slice("kartverket/".length))
        .join(" "),
    ).toBe(KARTVERKET);
  });

  // NOAA's methods come from its API at each refresh, so only Kartverket's
  // can be checked here.
  test("Kartverket's gauges were fitted over the periods and by the methods in data/", () => {
    const fitted = new Map(report.gauges.map((g) => [g.agency, g]));
    for (const gauge of kartverket()) {
      const g = fitted.get(gauge.agency)!;
      expect(g.period, gauge.agency).toEqual({
        start: gauge.start.toISOString().slice(0, 10),
        end: new Date(+gauge.end - 86_400_000).toISOString().slice(0, 10),
      });
      expect(g.method, gauge.agency).toEqual(
        JSON.parse(JSON.stringify(methodOf(gauge), reportRounding)),
      );
    }
  });
});

describe("parseNoaaComment", () => {
  const years = (first: number, last: number) =>
    Array.from({ length: last - first + 1 }, (_, i) => first + i);

  test("reads the main years and each long-period span", () => {
    expect(
      parseNoaaComment(
        "Vector Average of 5 years (2017-2021). Sa from average of 20 years (2002-2021), other long period constituents are unstable.",
      ),
    ).toMatchObject({
      years: [2017, 2021],
      longPeriod: [{ names: ["SA"], years: years(2002, 2021) }],
    });
    expect(
      parseNoaaComment(
        "Mean of six 1-year LSQHA (2007-2012).  Sa and Ssa from 20 years of MSL (1994-2013). Mf from mean of six LSQHA (2007-2012).",
      ).longPeriod,
    ).toEqual([
      { names: ["SA", "SSA"], years: years(1994, 2013) },
      { names: ["MF"], years: years(2007, 2012) },
    ]);
  });

  test("keeps a list together and splits clauses at the comma before 'from'", () => {
    expect(
      parseNoaaComment(
        "5-year (2012-2016) Vector Averaged.  Mm, Msf, Mf from average of 21 years (1996-2016).  Sa and SSa from 20year analysis.",
      ),
    ).toMatchObject({
      longPeriod: [{ names: ["MM", "MSF", "MF"] }],
      unstated: { names: ["SA", "SSA"] },
    });
    expect(
      parseNoaaComment(
        "6 Year Vector Averaged (2011-2016).  Sa, SSa, and MF from 20 years (1997-2016).",
      ).longPeriod?.[0]?.names,
    ).toEqual(["SA", "SSA", "MF"]);
    expect(
      parseNoaaComment(
        "Vector Average of 5 years (2018-2022).  Sa and Ssa from 20 year monthly means analysis (2002-2022),  Mf from average of 20 year annual analysis.",
      ),
    ).toMatchObject({
      unstated: { names: ["SA", "SSA", "MF"] },
    });
  });

  test("leaves out constituents whose years the comment doesn't name", () => {
    const a = parseNoaaComment(
      "Vector Averaged from 5 years 2014-2018.  Sa, Mm, and Mf from average of 15 years (2000-2018)",
    );
    expect(a.longPeriod).toBeUndefined();
    expect(a.unstated?.names).toEqual(["SA", "MM", "MF"]);
    expect(
      parseNoaaComment(
        "Vector average of 5 years (2021-2025).  Ssa and Sa from 19 one-year LSQHA analyses between 2006-2025.",
      ).unstated?.reason,
    ).toContain("counts 19 years in a span of 20");
  });

  test("leaves out lines a sentence names without saying where they came from", () => {
    expect(
      parseNoaaComment(
        "Average of 6 LSQHA (2007-2012).  Sa and SSa from 20 year analyses (1993-2012).  Mm and Msf are not used.",
      ).unstated,
    ).toMatchObject({ names: ["MM", "MSF"] });
  });

  test("leaves out a year the comment skips", () => {
    expect(
      parseNoaaComment(
        "Vector average of 5 years (2019-2023).  Sa and Ssa from 20 year analysis (2003-2015, 2017-2023).",
      ).longPeriod?.[0]?.years,
    ).toEqual([...years(2003, 2015), ...years(2017, 2023)]);
  });

  test("starts a later clause's names after the earlier clause's years", () => {
    expect(
      parseNoaaComment(
        "Vector Average of 5 years (2017-2021). Mm, Msf, Mf from average of 20 years (2002-2021), Sa, Ssa from average of 20 years (2002-2021).",
      ).longPeriod?.map((g) => g.names),
    ).toEqual([
      ["MM", "MSF", "MF"],
      ["SA", "SSA"],
    ]);
    expect(
      parseNoaaComment(
        "Vector Average of 5 years (2017–2021). Sa from 20 years (2002–2021).",
      ).longPeriod?.[0]?.years,
    ).toHaveLength(20);
  });

  test("refuses a comment it can't read", () => {
    expect(() => parseNoaaComment("Analysis of 2019 data.")).toThrow(
      "can't read NOAA's analysis years",
    );
    expect(() =>
      parseNoaaComment(
        "Vector Average of 5 years (2017-2021). Z0 from MSL (2002-2021).",
      ),
    ).toThrow("can't read which constituents");
    expect(() =>
      parseNoaaComment(
        "Vector Average of 5 years (2017-2021). Sa, Ssa and Mtm from 20 years (2000-2019).",
      ),
    ).toThrow("can't read which constituents");
    expect(() =>
      parseNoaaComment(
        "Vector Average of 5 years (2016-2021). Sa from 20 years (2002-2021).",
      ),
    ).toThrow("counts other years than it spans");
    expect(() =>
      parseNoaaComment(
        "Vector Average of 5 years (2017-2021). Sa from 3 years (2019-2020, 2020-2020).",
      ),
    ).toThrow("repeats a year");
  });
});
