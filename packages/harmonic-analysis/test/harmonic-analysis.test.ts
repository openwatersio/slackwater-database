import { describe, test, expect } from "vitest";
import { constituents, createTidePredictor } from "@slackwater/engine";
import {
  catalogCandidates,
  fitSelected,
  parseGeslaSamplesInZone,
  publishedConstants,
} from "../index.js";

describe("catalogCandidates", () => {
  test("puts the given names first and every other catalog line once after them", () => {
    const names = catalogCandidates(["M2", "SA", "MU2"]).map((c) => c.name);
    expect(names.slice(0, 3)).toEqual(["M2", "SA", "MU2"]);
    const lines = names.map((name) => constituents[name]!.name);
    expect(new Set(lines).size).toBe(lines.length);
    expect(lines).not.toContain("Z0");
    expect(lines.slice(3)).not.toContain("Sa");
    expect(lines.slice(3)).not.toContain("mu2");
  });
});

describe("fitSelected", () => {
  test("keeps a given name the record measures near zero", () => {
    const predictor = createTidePredictor(
      [{ name: "M2", amplitude: 1, phase: 100 }],
      { offset: false },
    );
    const start = Date.UTC(2026, 0, 1);
    const samples = Array.from({ length: 24 * 40 }, (_, h) => {
      const time = new Date(start + h * 3600_000);
      // Millimetre rounding, as a published prediction is, gives the SNR a noise floor.
      const level = predictor.getWaterLevelAtTime({ time }).level;
      return { time, value: Math.round(level * 1000) / 1000 };
    });
    const fit = fitSelected(samples, ["M2", "S2"], false);
    expect(fit.constituents.map((c) => c.name)).toEqual(["M2", "S2"]);
    expect(fit.constituents[1]!.amplitude).toBeLessThan(0.001);
    expect(() => fitSelected(samples, ["M2", "XYZ9"], false)).toThrow(
      "can't fit XYZ9 (unknown)",
    );
  });
});

describe("publishedConstants", () => {
  test("rounds to 1 mm and 0.01 degrees and drops the fit's intervals", () => {
    expect(
      publishedConstants([
        { name: "M2", amplitude: 1.2345678, phase: 110.12345, snr: 9 },
        { name: "S2", amplitude: 0.0004, phase: 359.996 },
      ]),
    ).toEqual([
      { name: "M2", amplitude: 1.235, phase: 110.12 },
      { name: "S2", amplitude: 0, phase: 0 },
    ]);
  });

  test("leaves out a catalog extra that rounds to zero, never a given name", () => {
    expect(
      publishedConstants(
        [
          { name: "M2", amplitude: 1, phase: 10 },
          { name: "S2", amplitude: 0.0004, phase: 20 },
          { name: "MKS2", amplitude: 0.0004, phase: 30 },
          { name: "MSN2", amplitude: 0.0006, phase: 40 },
        ],
        ["M2", "S2"],
      ).map((c) => c.name),
    ).toEqual(["M2", "S2", "MSN2"]);
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
