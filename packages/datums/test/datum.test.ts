import { describe, test, expect } from "vitest";
import {
  computeDatumsFromObservations,
  parseGeslaSamples,
  type Sample,
} from "../datum.js";

describe("computeDatumsFromObservations", () => {
  test("recovers MSL and range from a synthetic M2 tide in the gauge frame", () => {
    // 400 days (> 1 yr min) of hourly heights: M2 (12.42h) amplitude 2m about a
    // gauge mean of 5m. Datums should come back in that frame, not MSL=0.
    const samples: Sample[] = [];
    const t0 = Date.UTC(2000, 0, 1);
    for (let h = 0; h < 24 * 400; h++) {
      samples.push({
        time: new Date(t0 + h * 3600_000),
        level: 5 + 2 * Math.sin((2 * Math.PI * h) / 12.42),
      });
    }

    const result = computeDatumsFromObservations(samples)!;
    expect(result).not.toBeNull();
    const MSL = result.datums["MSL"]!;
    const MHW = result.datums["MHW"]!;
    const MLW = result.datums["MLW"]!;

    expect(MSL).toBeCloseTo(5, 1); // mean of hourly heights, real gauge frame
    expect(MHW).toBeGreaterThan(MSL);
    expect(MLW).toBeLessThan(MSL);
    expect(MHW).toBeCloseTo(7, 1); // amplitude recovered (hourly sampling)
    expect(MLW).toBeCloseTo(3, 1);
  });

  test("returns null for records shorter than the minimum span", () => {
    const samples: Sample[] = [];
    const t0 = Date.UTC(2000, 0, 1);
    for (let h = 0; h < 24 * 30; h++) {
      samples.push({ time: new Date(t0 + h * 3600_000), level: Math.sin(h) });
    }
    expect(computeDatumsFromObservations(samples)).toBeNull();
  });
});

describe("parseGeslaSamples", () => {
  test("keeps use_flag=1 rows, drops nulls/flagged, converts to UTC", () => {
    const text = [
      "# SITE NAME Test",
      "# TIME ZONE HOURS 0",
      "# NULL VALUE -99.9999",
      "#",
      "2020/01/01 00:00:00   1.2300 1 1",
      "2020/01/01 01:00:00 -99.9999 5 0", // missing -> excluded
      "2020/01/01 02:00:00   3.4000 3 0", // doubtful -> excluded
      "2020/01/01 03:00:00   2.1000 1 1",
    ].join("\n");

    const samples = parseGeslaSamples(text);
    expect(samples).toHaveLength(2);
    expect(samples[0]!.level).toBe(1.23);
    expect(samples[0]!.time.toISOString()).toBe("2020-01-01T00:00:00.000Z");
    expect(samples[1]!.level).toBe(2.1);
  });
});
