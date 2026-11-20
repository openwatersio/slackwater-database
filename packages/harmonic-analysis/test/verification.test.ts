import { describe, expect, test } from "vitest";
import {
  constituents as catalog,
  createTidePredictor,
} from "@slackwater/engine";
import {
  bandRms,
  compareConstants,
  compareCurves,
  compareTurns,
  conditioning,
  pickTurns,
  rmsOf,
  sawYear,
  scoreHeldOut,
  symmetricEigen,
  tidalResiduals,
  varianceDifferenceSE,
  verdict,
  yearlyScatter,
  yearlySet,
} from "../verification.ts";

const HOUR = 3_600_000;
const START = Date.UTC(2021, 0, 1);

/** Hourly levels of `constituents` from START, plus `extra(hour)`. */
const series = (
  hours: number,
  constituents: { name: string; amplitude: number; phase: number }[],
  extra = (_h: number) => 0,
) => {
  const p = createTidePredictor(constituents, { offset: false });
  return Array.from({ length: hours }, (_, h) => ({
    t: START + h * HOUR,
    level:
      p.getWaterLevelAtTime({ time: new Date(START + h * HOUR) }).level +
      extra(h),
  }));
};

const TIDE = [
  { name: "M2", amplitude: 1, phase: 40 },
  { name: "S2", amplitude: 0.3, phase: 80 },
  { name: "K1", amplitude: 0.2, phase: 120 },
  { name: "O1", amplitude: 0.15, phase: 200 },
];

describe("tidalResiduals", () => {
  test("is zero for the constants that made the series, after the Godin filter", () => {
    const year = series(24 * 120, TIDE, (h) => 0.5 + 0.2 * Math.sin(h / 500));
    const { rms, hours } = rmsOf(tidalResiduals(TIDE, year));
    expect(rms).toBeLessThan(2e-3);
    // The filter's 71 hours eat 35 at each end.
    expect(hours).toBe(24 * 120 - 70);
  });

  test("shows an amplitude error as its RMS", () => {
    const year = series(24 * 120, TIDE);
    const wrong = TIDE.map((c) =>
      c.name === "M2" ? { ...c, amplitude: 0.9 } : c,
    );
    expect(rmsOf(tidalResiduals(wrong, year)).rms).toBeCloseTo(
      0.1 / Math.SQRT2,
      2,
    );
  });
});

describe("bandRms", () => {
  test("puts a semidiurnal residual in D2 alone", () => {
    const residuals = new Map(
      Array.from({ length: 24 * 365 }, (_, h) => [
        h,
        0.1 * Math.cos((2 * Math.PI * 1.93 * h) / 24),
      ]),
    );
    const bands = bandRms(residuals);
    expect(bands.D2).toBeCloseTo(0.1 / Math.SQRT2, 3);
    expect(bands.D1).toBeLessThan(1e-3);
    expect(bands.D4).toBeLessThan(1e-3);
    expect(bands.D6).toBeLessThan(1e-3);
  });
});

describe("pickTurns", () => {
  test("finds the engine's high and low waters to the minute", () => {
    const turns = pickTurns(series(24 * 30, TIDE), 0.1);
    const engine = createTidePredictor(TIDE, { offset: false })
      .getExtremesPrediction({
        start: new Date(START + HOUR),
        end: new Date(START + 24 * 29 * HOUR),
      })
      .map((e) => ({ t: +e.time, level: e.level, high: e.high }));
    expect(
      turns.every((t, i) => i === 0 || t.high !== turns[i - 1]!.high),
    ).toBe(true);
    const scores = compareTurns(engine, turns);
    expect(scores.unmatched).toBe(0);
    expect(scores.timeRms).toBeLessThan(2);
    expect(scores.heightRms).toBeLessThan(0.005);
  });

  test("ignores a wiggle smaller than the gauge's least range", () => {
    const wiggle = (h: number) => 0.02 * Math.cos((2 * Math.PI * h) / 3);
    const clean = pickTurns(series(24 * 10, [TIDE[0]!]), 0.1);
    const noisy = pickTurns(series(24 * 10, [TIDE[0]!], wiggle), 0.1);
    expect(noisy.length).toBe(clean.length);
  });

  test("picks each run of hours on its own", () => {
    const s = series(24 * 10, [TIDE[0]!]).filter((_, h) => h < 100 || h >= 106);
    const turns = pickTurns(s, 0.1);
    expect(
      turns.every((t) => t.t < START + 100 * HOUR || t.t > START + 106 * HOUR),
    ).toBe(true);
  });
});

describe("compareTurns", () => {
  test("measures a constant lag", () => {
    const observed = pickTurns(series(24 * 30, TIDE), 0.1);
    const late = observed.map((t) => ({ ...t, t: t.t + 10 * 60_000 }));
    const scores = compareTurns(observed, late);
    expect(scores.matched).toBe(observed.length);
    expect(scores.timeMean).toBeCloseTo(10, 6);
    expect(scores.timeRms).toBeCloseTo(10, 6);
    expect(scores.heightRms).toBe(0);
  });
});

describe("held-out scoring", () => {
  test("scores every set with the same code, and calls a clear loser worse", () => {
    const year = series(24 * 365, TIDE, (h) => 0.03 * Math.sin(h * 0.7));
    const scores = scoreHeldOut(year, TIDE, {
      exact: { constituents: TIDE, seen: false },
      worse: {
        constituents: TIDE.map((c) =>
          c.name === "M2" ? { ...c, phase: c.phase + 3 } : c,
        ),
        seen: true,
      },
    });
    expect(scores.others["exact"]!.verdict).toBe("tie");
    expect(scores.others["worse"]!.verdict).toBe("better");
    expect(scores.others["worse"]!.seen).toBe(true);
    expect(scores.fit.turns.matched).toBeGreaterThan(1300);
  });

  test("can't measure the error of a year too short for two 30-day blocks", () => {
    const a = new Map([[0, 1]]);
    expect(varianceDifferenceSE(a, a)).toBeNull();
    expect(verdict(0.1, 0.2, null)).toBe("unmeasured");
  });

  test("knows whether a record's analysis saw the year", () => {
    const year = [new Date("2024-01-01"), new Date("2025-01-01")] as const;
    expect(sawYear({ start: "2006-01-01", end: "2020-12-31" }, ...year)).toBe(
      false,
    );
    expect(sawYear({ start: "1915-01-01", end: "2024-03-01" }, ...year)).toBe(
      true,
    );
    expect(sawYear(undefined, ...year)).toBe(true);
    expect(sawYear({ start: "unknown", end: "2024-03-01" }, ...year)).toBe(
      true,
    );
  });
});

describe("conditioning", () => {
  test("decomposes a symmetric matrix", () => {
    const { values } = symmetricEigen([
      [2, 1],
      [1, 2],
    ]);
    expect(values.sort()).toEqual([1, 3].map((x) => expect.closeTo(x, 12)));
  });

  test("finds K1 and P1 inseparable in a month and separable in a year", () => {
    const names = ["M2", "K1", "P1"];
    const month = series(24 * 30, []);
    const year = series(24 * 365, []);
    const short = conditioning(month, names);
    const long = conditioning(year, names);
    expect(short.maxCorrelation!.between.sort()).toEqual(["K1", "P1"]);
    expect(short.maxCorrelation!.value).toBeGreaterThan(0.5);
    expect(short.conditionNumber!).toBeGreaterThan(long.conditionNumber!);
    expect(long.maxCorrelation!.value).toBeLessThan(0.05);
  });

  test("calls a design matrix with a repeated constituent singular", () => {
    expect(conditioning(series(24 * 30, []), ["M2", "M2"])).toEqual({
      conditionNumber: null,
      maxCorrelation: null,
    });
  });

  test("fits each year without the whole record's weights", () => {
    const years = series(24 * 365 * 2, TIDE);
    const weights = years.map(() => 1);
    expect(
      yearlyScatter(years, ["M2", "S2", "K1", "O1"], { weights }).years,
    ).toBe(2);
  });
});

describe("yearly fits", () => {
  test("keep one fixed set a year separates", () => {
    expect(yearlySet(["M2", "S2", "K1", "N2", "T2", "S1", "P1"])).toEqual([
      "M2",
      "S2",
      "K1",
      "N2",
      "P1",
    ]);
    expect(catalog["T2"]).toBeDefined();
  });

  test("show no scatter in a stationary tide", () => {
    const years = series(24 * 365 * 3, TIDE);
    const scatter = yearlyScatter(years, ["M2", "S2", "K1", "O1"]);
    expect(scatter.years).toBe(3);
    expect(scatter.constituents["M2"]!.amplitude).toBeLessThan(1e-4);
    expect(scatter.constituents["K1"]!.phase).toBeLessThan(0.05);
  });
});

describe("agency comparison", () => {
  test("gives differences and the ratio to our interval", () => {
    const diff = compareConstants(
      [
        {
          name: "M2",
          amplitude: 1.002,
          phase: 1,
          amplitudeInterval: 0.001,
          phaseInterval: 1,
        },
      ],
      [{ name: "M2", amplitude: 1, phase: 359 }],
    );
    expect(diff).toEqual([
      {
        name: "M2",
        amplitude: expect.closeTo(0.002, 12),
        phase: 2,
        amplitudeInterval: 0.001,
        phaseInterval: 1,
        ratio: expect.closeTo(2, 9),
      },
    ]);
  });

  test("compares curves on another datum by shape", () => {
    const a = [1, 2, 3].map((x, i) => ({ t: i, level: x }));
    const b = [1, 2, 3].map((x, i) => ({ t: i, level: x + 5 }));
    expect(compareCurves(a, b)).toEqual({ n: 3, rms: 0, max: 0 });
  });
});
