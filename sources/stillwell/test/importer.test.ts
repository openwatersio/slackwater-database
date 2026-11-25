import { describe, expect, test } from "vitest";
import { constituents as catalog } from "@slackwater/engine";
import { LICENSE_NAMES } from "@slackwater/database";
import { matchKey } from "@slackwater/harmonic-analysis/stillwell";
import { sameGaugeLevels } from "@slackwater/stations";
import { screenRange, ticonLinks } from "../import.ts";
import {
  candidateList,
  PROFILES,
  TWELVE_MONTHS_AFTER_YEAR_END,
} from "../profiles.ts";
import { displayName, fitLicense, LICENSES } from "../record.ts";

describe("fitLicense", () => {
  test("takes Stillwell's CC BY over a station's own lighter terms", () => {
    expect(
      fitLicense({
        id: "pegelonline/1",
        license: "DL-DE-ZERO-2.0",
        commercial_use: true,
      }),
    ).toMatchObject({ type: "cc-by-4.0", commercial_use: true });
  });

  test("keeps CC BY for a CC BY station", () => {
    expect(
      fitLicense({ id: "smhi/1", license: "CC-BY-4.0", commercial_use: true })
        .type,
    ).toBe("cc-by-4.0");
  });

  test("refuses a license it has no mapping for", () => {
    expect(() =>
      fitLicense({ id: "x/1", license: "OGL-3.0", commercial_use: true }),
    ).toThrow("no mapping for Stillwell license OGL-3.0");
  });

  test("refuses terms that bar commercial use", () => {
    expect(() =>
      fitLicense({ id: "x/1", license: "CC-BY-4.0", commercial_use: false }),
    ).toThrow("don't allow commercial use");
  });

  test("every license a fit can carry has a notice", () => {
    const most = Math.max(...Object.values(LICENSES).map((l) => l.rank));
    for (const terms of Object.values(LICENSES))
      if (terms.rank >= LICENSES["CC-BY-4.0"]!.rank)
        expect(LICENSE_NAMES[terms.type]).toBeDefined();
    expect(most).toBe(LICENSES["CC-BY-4.0"]!.rank);
  });
});

test("displayName title-cases a name written in capitals only", () => {
  expect(displayName("KIEL-HOLTENAU")).toBe("Kiel-Holtenau");
  expect(displayName("BHV ALTER LEUCHTTURM")).toBe("Bhv Alter Leuchtturm");
  expect(displayName("Göteborg-Torshamnen")).toBe("Göteborg-Torshamnen");
});

describe("ticonLinks", () => {
  const station = {
    id: "smhi/2109",
    same_as: [
      "cmems/GoteborgTorshamnen",
      "gesla/goteborg_torshamnen-2109-swe-smhi",
      "gesla/goteborgorsh-819-swe-uhslc_fd",
      "gesla/not-in-data",
      "gesla/../escape",
    ],
  };
  const matches = new Map([
    [
      matchKey("smhi/2109", "gesla/goteborg_torshamnen-2109-swe-smhi"),
      {
        a: "gesla/goteborg_torshamnen-2109-swe-smhi",
        b: "smhi/2109",
        months: 25,
        rms_m: 0,
        lag_h: 0,
      },
    ],
  ]);
  const links = ticonLinks(
    station,
    matches,
    (id) => !id.includes("not-in-data"),
  );

  test("keeps GESLA links to records in data/ticon, with Stillwell's comparison or null", () => {
    expect(links).toEqual({
      "goteborg_torshamnen-2109-swe-smhi": { rms_m: 0, lag_h: 0, months: 25 },
      "goteborgorsh-819-swe-uhslc_fd": null,
    });
  });

  test("counts only a matched comparison as the same gauge", () => {
    expect(sameGaugeLevels(links["goteborg_torshamnen-2109-swe-smhi"])).toBe(
      true,
    );
    expect(sameGaugeLevels(links["goteborgorsh-819-swe-uhslc_fd"])).toBe(false);
    expect(sameGaugeLevels({ rms_m: 0.0144, lag_h: 0 })).toBe(false);
    expect(sameGaugeLevels({ rms_m: 0.002, lag_h: 1 })).toBe(false);
  });
});

describe("screenRange", () => {
  const year = Date.UTC(2023, 0, 1);
  const hours = 8760;
  const samples = (m2: number) =>
    Array.from({ length: hours }, (_, h) => ({
      t: year + h * 3_600_000,
      level: m2 * Math.cos(((28.9841042 * h) / 180) * Math.PI),
    }));

  test("gives about twice M2 for a semidiurnal tide", () => {
    // A fit refers M2 to its year's nodal factor, which the synthetic tide
    // lacks, so the range is within a few percent of 2 × 10 cm.
    expect(screenRange(samples(0.1), hours)! / 0.2).toBeCloseTo(1, 1);
  });

  test("puts a 5 mm tide under the 2 cm gate", () => {
    expect(screenRange(samples(0.005), hours)!).toBeLessThan(0.02);
  });

  test("doesn't judge a year with under half its hours", () => {
    expect(screenRange(samples(0.1).slice(0, 4000), hours)).toBeNull();
  });
});

test("the candidate list names each catalog line once, all known to the engine", () => {
  const names = candidateList(catalog);
  const lines = names.map((n) => catalog[n]?.name);
  expect(lines.every(Boolean)).toBe(true);
  expect(new Set(lines).size).toBe(names.length);
  expect(names.slice(0, 4)).toEqual(["Sa", "Ssa", "MSm", "Mm"]);
  // The engine's catalog lacks these two of Foreman's lines; when it adds
  // them, this fails and they join the list.
  expect(["H1", "H2"].filter((n) => !catalog[n])).toEqual(["H1", "H2"]);
});

test("a non-finalizing source's values settle twelve months after their year ends", () => {
  expect(TWELVE_MONTHS_AFTER_YEAR_END(new Date("2026-11-25"))).toEqual(
    new Date("2025-01-01T00:00:00Z"),
  );
  expect(
    TWELVE_MONTHS_AFTER_YEAR_END(new Date("2027-01-01T00:00:00Z")),
  ).toEqual(new Date("2026-01-01T00:00:00Z"));
  expect(PROFILES["pegelonline"]!.settled).toBe(TWELVE_MONTHS_AFTER_YEAR_END);
  expect(PROFILES["smhi"]!.settled).toBeUndefined();
});
