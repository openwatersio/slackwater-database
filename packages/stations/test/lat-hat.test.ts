import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, test } from "vitest";
import type { StationData } from "@slackwater/database";
import { DATA_DIR } from "../station.js";
import { backfillLatHat } from "../lat-hat.js";

// Gloucester Harbor: NOAA publishes no LAT/HAT, so the stored pair is ours.
const stored: StationData = JSON.parse(
  readFileSync(join(DATA_DIR, "noaa", "8441841.json"), "utf-8"),
);

function without(station: StationData, ...keys: string[]): StationData {
  const datums = { ...station.datums };
  for (const key of keys) delete datums[key];
  return { ...station, datums };
}

describe("backfillLatHat", () => {
  test("restores the stored pair, in place, after the import drops it", () => {
    const { station, filled } = backfillLatHat(without(stored, "LAT", "HAT"));
    expect(filled).toBe(true);
    expect(JSON.stringify(station)).toBe(JSON.stringify(stored));
  });

  test("keeps a published LAT and fills only the missing HAT", () => {
    const published = without(stored, "HAT");
    published.datums!["LAT"] = -9;
    const { station, filled } = backfillLatHat(published);
    expect(filled).toBe(true);
    expect(station.datums?.["LAT"]).toBe(-9);
    expect(station.datums?.["HAT"]).toBe(stored.datums?.["HAT"]);
  });

  test("leaves a station that has both alone", () => {
    expect(backfillLatHat(stored)).toEqual({ station: stored, filled: false });
  });

  test("skips a station with no seasonal term", () => {
    const flat = {
      ...without(stored, "LAT", "HAT"),
      harmonic_constituents: stored.harmonic_constituents!.filter(
        (c) => !["SA", "SSA"].includes(c.name.toUpperCase()),
      ),
    };
    const { station, filled, skipped } = backfillLatHat(flat);
    expect(filled).toBe(false);
    expect(skipped).toMatch(/no Sa\/Ssa/);
    expect(station).toBe(flat);
  });

  test("skips a station with no MSL", () => {
    const { filled, skipped } = backfillLatHat(
      without(stored, "LAT", "HAT", "MSL"),
    );
    expect(filled).toBe(false);
    expect(skipped).toBe("no MSL");
  });
});
