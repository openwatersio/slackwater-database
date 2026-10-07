import { describe, test, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import * as engine from "@slackwater/engine";
import {
  definitionMismatched,
  fitHarmonics,
  parseGeslaSamplesInZone,
  type Sample,
} from "../index.js";

function predictionRms(
  fit: ReturnType<typeof fitHarmonics>,
  samples: Sample[],
): number {
  const predictor = engine.createTidePredictor(fit, { offset: false });
  return Math.sqrt(
    samples.reduce((sum, sample) => {
      const error =
        predictor.getWaterLevelAtTime({ time: new Date(sample.t) }).level -
        sample.level;
      return sum + error * error;
    }, 0) / samples.length,
  );
}

describe("fitHarmonics", () => {
  test("rejects non-finite observations in ordinary fits", () => {
    const samples = Array.from({ length: 20 }, (_, i) => ({
      t: i * 3600000,
      level: i === 3 ? NaN : 1,
    }));
    expect(() => fitHarmonics(samples, ["M2"])).toThrow("invalidSamples");
  });

  test("keeps database name filtering, ordering, and rounding", () => {
    const samples = Array.from({ length: 1200 }, (_, i) => {
      const t = Date.UTC(2020, 0, 1) + i * 3600000;
      const state = engine.astro(new Date(t));
      const model = engine.constituents["M2"]!;
      const { f, u } = model.correction(state);
      return {
        t,
        level:
          2 +
          1.234567 *
            f *
            Math.cos(((model.value(state) + u - 110.1234) * Math.PI) / 180),
      };
    }).reverse();
    const originalStart = samples[0]!.t;
    expect(fitHarmonics(samples, ["m2", "unknown"])).toEqual([
      { name: "m2", amplitude: 1.235, phase: 110.12 },
    ]);
    expect(samples[0]!.t).toBe(originalStart);
  });

  test("recovers known amplitude/phase from a synthetic tide", () => {
    // Synthesize 400 days of hourly heights from known constituents using the
    // same Greenwich/nodal convention the fit assumes, then check round-trip.
    const truth = {
      M2: { H: 1.5, G: 110 },
      S2: { H: 0.5, G: 250 },
      O1: { H: 0.3, G: 40 },
    };
    const Z0 = 5;
    const DEG = Math.PI / 180;

    const samples: Sample[] = [];
    const t0 = Date.UTC(2010, 0, 1);
    for (let h = 0; h < 24 * 400; h++) {
      const t = t0 + h * 3600_000;
      const a = engine.astro(new Date(t));
      let level = Z0;
      for (const [name, { H, G }] of Object.entries(truth)) {
        const con = engine.constituents[name]!;
        const { f, u } = con.correction(a);
        level += H * f * Math.cos((con.value(a) + u - G) * DEG);
      }
      samples.push({ t, level });
    }

    const fit = fitHarmonics(samples, Object.keys(truth));
    for (const [name, { H, G }] of Object.entries(truth)) {
      const got = fit.find((c) => c.name === name)!;
      expect(got.amplitude).toBeCloseTo(H, 3);
      expect(got.phase).toBeCloseTo(G, 2);
    }
  });

  test("fits MKS2 on its own line and never reports it as 3N2", () => {
    const DEG = Math.PI / 180;
    const t0 = Date.UTC(2010, 0, 1);
    const samples: Sample[] = Array.from({ length: 24 * 400 }, (_, h) => {
      const t = t0 + h * 3600_000;
      const a = engine.astro(new Date(t));
      let level = 0;
      for (const [name, H, G] of [
        ["M2", 1, 110],
        ["MKS2", 0.05, 200],
      ] as const) {
        const con = engine.constituents[name]!;
        const { f, u } = con.correction(a);
        level += H * f * Math.cos((con.value(a) + u - G) * DEG);
      }
      return { t, level };
    });

    const fit = fitHarmonics(samples, ["M2", "MKS2", "3N2"]);
    const mks2 = fit.find((c) => c.name === "MKS2");
    expect(mks2?.amplitude).toBeCloseTo(0.05, 3);
    expect(mks2?.phase).toBeCloseTo(200, 1);
    expect(fit.find((c) => c.name === "3N2")?.amplitude ?? 0).toBeLessThan(
      0.002,
    );
  });

  describe("3N2 next to N2", () => {
    const DEG = Math.PI / 180;
    // Two-hourly samples keep a nine-year record quick without aliasing semidiurnal lines.
    const synthetic = (
      hours: number,
      tide: [string, number, number][],
    ): Sample[] => {
      const t0 = Date.UTC(2010, 0, 1);
      return Array.from({ length: Math.floor(hours / 2) }, (_, i) => {
        const t = t0 + i * 2 * 3600_000;
        const a = engine.astro(new Date(t));
        let level = 0;
        for (const [name, H, G] of tide) {
          const con = engine.constituents[name]!;
          const { f, u } = con.correction(a);
          level += H * f * Math.cos((con.value(a) + u - G) * DEG);
        }
        return { t, level };
      });
    };
    const tide: [string, number, number][] = [
      ["M2", 1, 110],
      ["N2", 0.3, 80],
      ["3N2", 0.02, 300],
    ];

    test("leaves 3N2 to N2 when the record is shorter than a perigee cycle", () => {
      const fit = fitHarmonics(synthetic(3 * 8766, tide), ["M2", "N2", "3N2"]);
      expect(fit.map((c) => c.name)).toEqual(["M2", "N2"]);
    });

    test("fits 3N2 on its own line when the record spans a perigee cycle", () => {
      const fit = fitHarmonics(synthetic(9 * 8766, tide), ["M2", "N2", "3N2"]);
      const byName = Object.fromEntries(fit.map((c) => [c.name, c]));
      expect(byName["N2"]?.amplitude).toBeCloseTo(0.3, 3);
      expect(byName["3N2"]?.amplitude).toBeCloseTo(0.02, 3);
      expect(byName["3N2"]?.phase).toBeCloseTo(300, 0);
    });

    test("measures the record's span the same way when samples arrive newest first", () => {
      const fit = fitHarmonics(synthetic(9 * 8766, tide).reverse(), [
        "M2",
        "N2",
        "3N2",
      ]);
      expect(fit.map((c) => c.name)).toEqual(["M2", "N2", "3N2"]);
    });
  });

  test("SVD reconstructs a broad synthetic constituent set", () => {
    const excluded = new Set(["SA", "MKS2", "3N2", "3L2", "T3", "R3"]);
    const names = [
      ...new Map(
        Object.values(engine.constituents)
          .filter(
            (model) =>
              model.speed > 0 && !excluded.has(model.name.toUpperCase()),
          )
          .map((model) => [model.name, model]),
      ).keys(),
    ].slice(0, 99);
    const terms = names.map((name, index) => ({
      name,
      amplitude: 0.005,
      phase: (index * 37) % 360,
    }));
    const t0 = Date.UTC(2018, 0, 1);
    const duration = 6 * 365.25 * 86_400_000;
    const samples = Array.from({ length: 4_000 }, (_, index) => {
      const t = t0 + (duration * index) / 3_999;
      const a = engine.astro(new Date(t));
      const level = terms.reduce((sum, { name, amplitude, phase }) => {
        const model = engine.constituents[name]!;
        const { f, u } = model.correction(a);
        return (
          sum +
          amplitude *
            f *
            Math.cos((model.value(a) + u - phase) * (Math.PI / 180))
        );
      }, 0);
      return { t, level };
    });

    const fit = fitHarmonics(samples, names, { solver: "svd" });
    expect(fit).toHaveLength(99);
    expect(
      fit.every(
        ({ amplitude, phase }) =>
          Number.isFinite(amplitude) && Number.isFinite(phase),
      ),
    ).toBe(true);
    expect(predictionRms(fit, samples)).toBeLessThan(0.003);
  });

  test("SVD returns finite predictions for duplicate constituents", () => {
    const t0 = Date.UTC(2018, 0, 1);
    const m2Samples = Array.from({ length: 4_000 }, (_, index) => {
      const t = t0 + (6 * 365.25 * 86_400_000 * index) / 3_999;
      const a = engine.astro(new Date(t));
      const model = engine.constituents["M2"]!;
      const { f, u } = model.correction(a);
      return {
        t,
        level:
          0.05 * f * Math.cos((model.value(a) + u - 110) * (Math.PI / 180)),
      };
    });

    const duplicate = fitHarmonics(m2Samples, ["M2", "M2"], {
      solver: "svd",
    });
    expect(duplicate).toHaveLength(2);
    expect(
      duplicate.every(
        ({ amplitude, phase }) =>
          Number.isFinite(amplitude) && Number.isFinite(phase),
      ),
    ).toBe(true);
    expect(predictionRms(duplicate, m2Samples)).toBeLessThan(0.003);
  });

  test("SVD returns a finite solution with fewer rows than columns", () => {
    const fit = fitHarmonics(
      [{ t: Date.UTC(2025, 0, 1), level: 0.25 }],
      ["M2"],
      { solver: "svd" },
    );

    expect(fit).toHaveLength(1);
    expect(
      fit.every(
        ({ amplitude, phase }) =>
          Number.isFinite(amplitude) && Number.isFinite(phase),
      ),
    ).toBe(true);
  });
});

describe("re-analyzed TICON stations", () => {
  test("store each constituent under the line it was fit at", () => {
    const dir = new URL("../../../data/ticon/", import.meta.url);
    // The sources sources/ticon/import.ts re-fits; it reuses cached fits until FORCE_HARMONICS=1.
    const refit = readdirSync(dir).filter((f) => /-(wsv|rws)\.json$/.test(f));
    const mismatched = refit.flatMap((file) => {
      const station = JSON.parse(readFileSync(new URL(file, dir), "utf8"));
      return (station.harmonic_constituents as { name: string }[])
        .filter(({ name }) =>
          definitionMismatched(name, engine.constituents[name]!.speed),
        )
        .map(({ name }) => `${file}: ${name}`);
    });
    expect(refit.length).toBeGreaterThan(0);
    expect(mismatched).toEqual([]);
  });
});

describe("parseGeslaSamplesInZone", () => {
  test("converts local wall-clock to UTC across the DST boundary", () => {
    // Two rows in Europe/Berlin: January (MEZ = UTC+1) and July (MESZ = UTC+2).
    const text = [
      "# NULL VALUE -99.9999",
      "#",
      "2020/01/01 12:00:00 1.0 1 1",
      "2020/07/01 12:00:00 2.0 1 1",
    ].join("\n");

    const samples = parseGeslaSamplesInZone(text, "Europe/Berlin");
    expect(samples).toHaveLength(2);
    expect(new Date(samples[0]!.t).toISOString()).toBe(
      "2020-01-01T11:00:00.000Z",
    );
    expect(new Date(samples[1]!.t).toISOString()).toBe(
      "2020-07-01T10:00:00.000Z",
    );
  });

  test("rws convention (fixed-1h-removed) recovers true UTC via Amsterdam + 1h", () => {
    // rws files had a flat 1 h subtracted from Dutch legal time and were then
    // mislabeled UTC, so stored = true_UTC + Amsterdam-DST-flag: winter rows are
    // already true UTC, summer rows are 1 h fast. The import re-references them
    // by parsing in Europe/Amsterdam then re-adding the 1 h. See issue #98.
    const HOUR = 3_600_000;
    const text = [
      "# NULL VALUE -99.9999",
      "#",
      "2020/01/01 12:00:00 1.0 1 1", // winter: stored == true UTC 12:00
      "2020/07/01 11:00:00 2.0 1 1", // summer: stored is 1 h fast of true UTC 10:00
    ].join("\n");

    const corrected = parseGeslaSamplesInZone(text, "Europe/Amsterdam").map(
      (s) => ({ t: s.t + HOUR, level: s.level }),
    );
    expect(corrected).toHaveLength(2);
    expect(new Date(corrected[0]!.t).toISOString()).toBe(
      "2020-01-01T12:00:00.000Z",
    );
    expect(new Date(corrected[1]!.t).toISOString()).toBe(
      "2020-07-01T10:00:00.000Z",
    );
  });
});
