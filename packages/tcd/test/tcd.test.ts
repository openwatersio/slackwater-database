/**
 * XTide TCD validation tests.
 *
 * These tests validate that the TCD build pipeline correctly preserves prediction accuracy
 * by comparing XTide predictions from the built TCD against direct harmonic calculations.
 *
 * Pipeline: Station JSON → harmonics.txt/offsets.xml → TCD binary → XTide predictions
 */

import { describe, test, expect, beforeAll } from "vitest";
import { existsSync, statSync, readFileSync } from "fs";
import { join } from "path";
import { stations } from "@slackwater/database";
import {
  getXTidePredictions,
  getXTideAbout,
  checkXTideAvailable,
  restoreTcd,
} from "./xtide.js";
import { getPredictions, getCurrentPredictions } from "./engine-predictions.js";
import { comparePredictions, formatComparisonResult } from "./compare.js";

// Test stations - selected to cover different regions, tide types, and station types
const TEST_STATIONS = [
  {
    id: "noaa/8443970",
    name: "BOSTON, MA, United States",
    description: "East Coast semidiurnal tide",
  },
  {
    id: "noaa/9414290",
    name: "SAN FRANCISCO (Golden Gate), CA, United States",
    description: "West Coast mixed tide",
  },
  {
    id: "noaa/8454000",
    name: "Providence, RI, United States",
    description: "Estuarine location with high tidal range",
  },
] as const;

// Current stations: a reference and one of its subordinates whose flood and
// ebb offsets differ, so a swapped mapping shows up.
const CURRENT_REFERENCE = {
  id: "noaa/ACT1616",
  name: "Pollock Rip Channel (Butler Hole), Massachusetts Current",
};
const CURRENT_SUBORDINATE = {
  id: "noaa/ACT1626",
  name: "Monomoy Point, channel 0.2 nm west of, Massachusetts Current",
};

// Test date range - one week for validation
const START_DATE = new Date("2026-01-01T00:00:00Z");
const END_DATE = new Date("2026-01-08T00:00:00Z");

// Acceptable error thresholds
const MAX_TIME_ERROR_MEAN = 5; // minutes
const MAX_TIME_ERROR_MAX = 15; // minutes
const MAX_HEIGHT_ERROR_MEAN = 0.05; // meters (5 cm)
const MAX_HEIGHT_ERROR_RMSE = 0.1; // meters (10 cm)

const METERS_PER_FOOT = 0.3048;

describe("XTide TCD", () => {
  beforeAll(() => {
    // Check if XTide is available
    if (!checkXTideAvailable()) {
      throw new Error(
        "XTide Docker service is not available. Check docker-compose.yml",
      );
    }
  });

  describe("Reference station predictions", () => {
    TEST_STATIONS.forEach(({ id, name, description }) => {
      test(`${name} - ${description}`, () => {
        const station = stations.find((s) => s.id === id);
        expect(station, `Station ${id} not found`).toBeDefined();

        if (!station) return;

        // Get predictions from direct harmonics calculation
        const expectedPredictions = getPredictions(
          station,
          stations,
          START_DATE,
          END_DATE,
        );

        expect(expectedPredictions.length).toBeGreaterThan(0);

        // Get predictions from XTide using the built TCD
        const xtidePredictions = getXTidePredictions(
          name,
          START_DATE,
          END_DATE,
        );

        expect(xtidePredictions.length).toBeGreaterThan(0);

        // Compare predictions
        const comparison = comparePredictions(
          expectedPredictions,
          xtidePredictions,
        );

        // Log comparison results for debugging
        if (comparison.matched === 0) {
          console.error(`\nNo matched events for ${name}`);
          console.error(`Expected events: ${expectedPredictions.length}`);
          console.error(`Actual events: ${xtidePredictions.length}`);
        } else {
          console.log(`\n${name} comparison:`);
          console.log(formatComparisonResult(comparison));
        }

        // Validate that most events were matched
        const matchRate =
          comparison.matched / (comparison.matched + comparison.unmatched);
        expect(matchRate).toBeGreaterThan(0.95); // At least 95% of events matched

        // Validate time accuracy
        expect(comparison.timeDiffMinutes.mean).toBeLessThan(
          MAX_TIME_ERROR_MEAN,
        );
        expect(comparison.timeDiffMinutes.max).toBeLessThan(MAX_TIME_ERROR_MAX);

        // Validate height accuracy
        expect(Math.abs(comparison.heightDiffMeters.mean)).toBeLessThan(
          MAX_HEIGHT_ERROR_MEAN,
        );
        expect(comparison.heightDiffMeters.rmse).toBeLessThan(
          MAX_HEIGHT_ERROR_RMSE,
        );
      });
    });
  });

  // The file is metric and XTide converts for display, which is why there is no
  // separate imperial build.
  describe("Display units", () => {
    const { name } = TEST_STATIONS[0];

    test("XTide reports the metric file in feet on request", () => {
      const meters = getXTidePredictions(name, START_DATE, END_DATE);
      const feet = getXTidePredictions(name, START_DATE, END_DATE, "ft");

      expect(feet.length).toBe(meters.length);
      expect(new Set(meters.map((e) => e.units))).toEqual(new Set(["m"]));
      expect(new Set(feet.map((e) => e.units))).toEqual(new Set(["ft"]));

      feet.forEach((event, i) => {
        expect(event.time).toEqual(meters[i]!.time);
        expect(event.height).toBeCloseTo(
          meters[i]!.height / METERS_PER_FOOT,
          1,
        );
      });
    });
  });

  describe("Subordinate station records", () => {
    test("keeps position and reference", () => {
      const about = getXTideAbout("Hanalei Bay, HI, United States");
      expect(about.get("Coordinates")).toMatch(/^22\.2150. N, 159\.5020. W$/);
      expect(about.get("Time zone")).toBe("Pacific/Honolulu");
      expect(about.get("Reference")).toBe(
        "Nawiliwili, HI, United States (1611400)",
      );
    });
  });

  describe("Licenses", () => {
    let restored: ReturnType<typeof restoreTcd>;
    beforeAll(() => {
      restored = restoreTcd();
    });

    test("every record keeps its station's license", () => {
      const expected = new Map(
        stations.map((s) => [
          `${s.id.split("/")[0]}/${s.source.id}`,
          s.license.type,
        ]),
      );
      const restrictions: Record<string, string> = {
        "public domain": "Public Domain",
        "cc-by-4.0": "CC BY 4.0",
        "cc-by-nc-4.0": "CC BY-NC 4.0",
      };
      // Each record as a field lookup. Reference records use `# key: value`
      // hot comments; subordinates use `key="value"` attributes.
      const fields = (harmonics: string, start: string, offsets: string) => [
        ...harmonics
          .split(start)
          .slice(1)
          .map(
            (r) => (k: string) =>
              r.match(new RegExp(`^# ${k}: ?(.*)$`, "m"))?.[1],
          ),
        ...offsets
          .split("<subordinatestation ")
          .slice(1)
          .map(
            (r) => (k: string) =>
              r.match(new RegExp(`^\\s*${k}="(.*)"`, "m"))?.[1],
          ),
      ];
      const idOf = (field: (k: string) => string | undefined) =>
        `${field("station_id_context")}/${field("station_id")}`;

      const dist = (file: string) =>
        readFileSync(join(process.cwd(), "dist", file), "utf-8");
      const written = fields(
        dist("harmonics.txt"),
        "\n# source: ",
        dist("offsets.xml"),
      ).map(idOf);
      const records = fields(
        restored.harmonics,
        "# BEGIN HOT COMMENTS",
        restored.offsets,
      );

      // build_tide_db dropped nothing, so every record below is checked
      expect(records.map(idOf).sort()).toEqual(written.sort());
      for (const field of records) {
        expect(field("restriction"), idOf(field)).toBe(
          restrictions[expected.get(idOf(field))!],
        );
      }
    });

    test("licensed stations carry their attribution", () => {
      const station = stations.find(
        (s) => s.id === "ticon/alcudiatg-alc-esp-cmems",
      )!;
      const about = getXTideAbout("Alcudia, Balearic Islands, Spain");
      expect(about.get("Restriction")).toBe("CC BY-NC 4.0");

      const record = restored.harmonics
        .split("# BEGIN HOT COMMENTS")
        .find((r) => r.includes("# station_id: alcudiatg-alc-esp-cmems"))!;
      const notes = [...record.matchAll(/^# note: (.*)$/gm)]
        .map((m) => m[1])
        .join(" ");
      expect(notes).toContain(station.attribution);
    });
  });

  describe("Current stations", () => {
    test("reference current carries directions and knots", () => {
      const station = stations.find((s) => s.id === CURRENT_REFERENCE.id)!;
      const about = getXTideAbout(CURRENT_REFERENCE.name);
      expect(about.get("Type")).toBe("Reference station, current");
      expect(about.get("Native units")).toBe("knots");
      expect(about.get("Flood direction")).toMatch(
        new RegExp(`^${station.current!.flood_direction}. true$`),
      );
      expect(about.get("Ebb direction")).toMatch(
        new RegExp(`^${station.current!.ebb_direction}. true$`),
      );
    });

    test("subordinate current carries its offsets", () => {
      const station = stations.find((s) => s.id === CURRENT_SUBORDINATE.id)!;
      const offsets = station.current!.offsets!;
      const about = getXTideAbout(CURRENT_SUBORDINATE.name);
      expect(about.get("Type")).toBe("Subordinate station, current");
      expect(about.get("Reference")).toBe(CURRENT_REFERENCE.name);
      expect(about.get("Native units")).toBe("knots");
      expect(Number(about.get("Max level mult"))).toBeCloseTo(
        offsets.flood_speed_ratio!,
      );
      expect(Number(about.get("Min level mult"))).toBeCloseTo(
        offsets.ebb_speed_ratio!,
      );
      expect(about.get("Flood begins")).toBe("0:00");
      expect(about.get("Ebb begins")).toBe("+0:18");
    });

    for (const { id, name } of [CURRENT_REFERENCE, CURRENT_SUBORDINATE]) {
      test(`${name} predictions in knots`, () => {
        const station = stations.find((s) => s.id === id)!;
        const expected = getCurrentPredictions(
          station,
          stations,
          START_DATE,
          END_DATE,
        );
        const actual = getXTidePredictions(name, START_DATE, END_DATE);

        expect(actual.length).toBeGreaterThan(0);
        // Speeds are knots even though the file is otherwise in meters
        expect(new Set(actual.map((e) => e.units))).toEqual(new Set(["kt"]));

        const comparison = comparePredictions(expected, actual);
        console.log(`\n${name} comparison:`);
        console.log(formatComparisonResult(comparison));

        const matchRate =
          comparison.matched / (comparison.matched + comparison.unmatched);
        expect(matchRate).toBeGreaterThan(0.95);
        expect(comparison.timeDiffMinutes.mean).toBeLessThan(
          MAX_TIME_ERROR_MEAN,
        );
        expect(comparison.timeDiffMinutes.max).toBeLessThan(MAX_TIME_ERROR_MAX);
        // Differences are knots here
        expect(Math.abs(comparison.heightDiffMeters.mean)).toBeLessThan(
          MAX_HEIGHT_ERROR_MEAN,
        );
        expect(comparison.heightDiffMeters.rmse).toBeLessThan(
          MAX_HEIGHT_ERROR_RMSE,
        );
      });
    }
  });

  describe("TCD file integrity", () => {
    test("TCD file exists and is not empty", () => {
      const tcdPath = join(process.cwd(), "dist", "harmonics.tcd");
      expect(existsSync(tcdPath)).toBe(true);

      const stats = statSync(tcdPath);
      expect(stats.size).toBeGreaterThan(1000); // At least 1KB
    });

    test("harmonics.txt exists and is valid", () => {
      const harmonicsPath = join(process.cwd(), "dist", "harmonics.txt");
      expect(existsSync(harmonicsPath)).toBe(true);

      const content = readFileSync(harmonicsPath, "utf-8");

      // Check for required header elements
      expect(content).toContain("# Tide Harmonics Database");
      expect(content).toContain("MERCHANTABILITY");
      expect(content).toContain("Number of constituents");
    });

    test("offsets.xml exists and is valid", () => {
      const offsetsPath = join(process.cwd(), "dist", "offsets.xml");
      expect(existsSync(offsetsPath)).toBe(true);

      const content = readFileSync(offsetsPath, "utf-8");

      // Check for required XML structure
      expect(content).toContain('<?xml version="1.0"');
      expect(content).toContain("<document>");
      expect(content).toContain("</document>");
    });
  });
});
