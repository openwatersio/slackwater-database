import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { astro, constituents } from "@slackwater/engine";
import type { Sample } from "@slackwater/datums";
import { SAME_GAUGE_M2_DIFFERENCE } from "@slackwater/stations";
import { refitConstituents } from "../samples.ts";

const DEG = Math.PI / 180;

/** A tide of known constants, sampled every `stepHours` from 2010. */
function synthetic(
  hours: number,
  tide: [string, number, number][],
  stepHours = 1,
  offset = 0,
): Sample[] {
  const t0 = Date.UTC(2010, 0, 1);
  return Array.from({ length: Math.floor(hours / stepHours) }, (_, i) => {
    const time = new Date(t0 + i * stepHours * 3600_000);
    const a = astro(time);
    let level = offset;
    for (const [name, H, G] of tide) {
      const con = constituents[name]!;
      const { f, u } = con.correction(a);
      level += H * f * Math.cos((con.value(a) + u - G) * DEG);
    }
    return { time, level };
  });
}

describe("refitConstituents", () => {
  test("recovers known constants under TICON's names, rounded, from samples in any order", () => {
    const samples = synthetic(
      24 * 400,
      [
        ["M2", 1.5, 110],
        ["S2", 0.5, 250],
        ["O1", 0.3, 40],
        ["mu2", 0.1234567, 77.777],
      ],
      1,
      5,
    ).reverse();
    expect(refitConstituents(samples, ["M2", "S2", "O1", "MU2"])).toEqual([
      { name: "M2", amplitude: 1.5, phase: 110 },
      { name: "S2", amplitude: 0.5, phase: 250 },
      { name: "O1", amplitude: 0.3, phase: 40 },
      { name: "MU2", amplitude: 0.123, phase: 77.78 },
    ]);
  });

  test("refuses a record shorter than a year", () => {
    expect(() =>
      refitConstituents(synthetic(24 * 300, [["M2", 1, 0]]), ["M2"]),
    ).toThrow("record too short");
    // Four hours short of the 365.25 days that separate K1 from S1.
    expect(() =>
      refitConstituents(synthetic(24 * 365 + 3, [["M2", 1, 0]]), ["M2"]),
    ).toThrow("record too short");
  });

  test("refuses to drop any name but 3N2 and 3L2", () => {
    const samples = synthetic(24 * 400, [["M2", 1, 0]]);
    expect(() => refitConstituents(samples, ["M2", "XYZ9"])).toThrow(
      "re-fit would drop XYZ9 (unknown)",
    );
    // Where the record keeps 3N2, a duplicate conflicts with it, not with N2.
    expect(() =>
      refitConstituents(synthetic(24 * 365 * 9, [["M2", 1, 0]], 6), [
        "M2",
        "N2",
        "3N2",
        "3N2",
      ]),
    ).toThrow("re-fit would drop 3N2 (rayleigh)");
    // S2 and T2 need 365.26 days.
    expect(() =>
      refitConstituents(synthetic(24 * 365.25 + 1, [["M2", 1, 0]]), [
        "M2",
        "S2",
        "T2",
      ]),
    ).toThrow("re-fit would drop T2 (rayleigh)");
    // Three-hourly samples can't resolve M6's 87°/h.
    expect(() =>
      refitConstituents(synthetic(24 * 400, [["M2", 1, 0]], 3), ["M2", "M6"]),
    ).toThrow("re-fit would drop M6 (nyquist)");
  });

  test("fits MKS2 on its own line and never reports it as 3N2", () => {
    const fit = refitConstituents(
      synthetic(24 * 400, [
        ["M2", 1, 110],
        ["MKS2", 0.05, 200],
      ]),
      ["M2", "MKS2", "3N2"],
    );
    const mks2 = fit.find((c) => c.name === "MKS2");
    expect(mks2?.amplitude).toBeCloseTo(0.05, 3);
    expect(mks2?.phase).toBeCloseTo(200, 1);
    expect(fit.find((c) => c.name === "3N2")?.amplitude ?? 0).toBeLessThan(
      0.002,
    );
  });

  describe("3N2 next to N2", () => {
    const tide: [string, number, number][] = [
      ["M2", 1, 110],
      ["N2", 0.3, 80],
      ["3N2", 0.02, 300],
    ];
    // Two-hourly samples keep a nine-year record quick without aliasing semidiurnal lines.
    test("leaves 3N2 to N2 when the record is shorter than a perigee cycle", () => {
      const fit = refitConstituents(synthetic(3 * 8766, tide, 2), [
        "M2",
        "N2",
        "3N2",
      ]);
      expect(fit.map((c) => c.name)).toEqual(["M2", "N2"]);
    });

    test("fits 3N2 on its own line when the record spans a perigee cycle", () => {
      const fit = refitConstituents(synthetic(9 * 8766, tide, 2), [
        "M2",
        "N2",
        "3N2",
      ]);
      const byName = Object.fromEntries(fit.map((c) => [c.name, c]));
      expect(byName["N2"]?.amplitude).toBeCloseTo(0.3, 3);
      expect(byName["3N2"]?.amplitude).toBeCloseTo(0.02, 3);
      expect(byName["3N2"]?.phase).toBeCloseTo(300, 0);
    });
  });
});

// The lines TICON's published phases fit, scored against the raw GESLA-4
// records. The TICON-4 manual swaps MKS2 and 3N2 (openwatersio/slackwater#359).
const TICON_SPEED: Record<string, number> = {
  SA: 0.0410686,
  MKS2: 29.0662415,
  "3N2": 28.4350877,
  "3L2": 29.5331208,
  T3: 44.9589333,
  R3: 45.0410706,
};

test("re-fit TICON stations store each constituent on the line TICON means by its name", () => {
  const dir = new URL("../../../data/ticon/", import.meta.url);
  const refit = readdirSync(dir).filter((f) => /-(wsv|rws)\.json$/.test(f));
  const mismatched = refit.flatMap((file) => {
    const station = JSON.parse(readFileSync(new URL(file, dir), "utf8"));
    return (station.harmonic_constituents as { name: string }[])
      .filter(
        ({ name }) =>
          name in TICON_SPEED &&
          Math.abs(constituents[name]!.speed - TICON_SPEED[name]!) > 1e-4,
      )
      .map(({ name }) => `${file}: ${name}`);
  });
  expect(refit.length).toBeGreaterThan(0);
  expect(mismatched).toEqual([]);
});

test("Venezia ISPRA phases agree with the City record of the same gauge", () => {
  const read = (id: string) =>
    JSON.parse(
      readFileSync(
        new URL(`../../../data/ticon/${id}.json`, import.meta.url),
        "utf8",
      ),
    ).harmonic_constituents as { name: string; phase: number }[];
  const byName = (id: string) =>
    new Map(read(id).map(({ name, phase }) => [name, phase]));
  const ispra = byName("venezia-ven-ita-ispra");
  const city = byName("venezia-vene-ita-cv");
  // SAME_GAUGE_M2_DIFFERENCE allows this angular difference at equal amplitudes.
  const phaseTolerance = (2 * Math.asin(SAME_GAUGE_M2_DIFFERENCE / 2)) / DEG;

  for (const name of ["M2", "K1", "O1"]) {
    const difference = Math.abs(ispra.get(name)! - city.get(name)!);
    expect(Math.min(difference, 360 - difference), name).toBeLessThanOrEqual(
      phaseTolerance,
    );
  }
});
