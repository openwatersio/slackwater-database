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
import { stations } from "@neaps/tide-database";
import { getXTidePredictions, checkXTideAvailable } from "./xtide.js";
import { getPredictions } from "./neaps-predictions.js";
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

// Test date range - one week for validation
const START_DATE = new Date("2026-01-01T00:00:00Z");
const END_DATE = new Date("2026-01-08T00:00:00Z");

// Acceptable error thresholds
const MAX_TIME_ERROR_MEAN = 5; // minutes
const MAX_TIME_ERROR_MAX = 15; // minutes
const MAX_HEIGHT_ERROR_MEAN = 0.05; // meters (5 cm)
const MAX_HEIGHT_ERROR_RMSE = 0.1; // meters (10 cm)

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

  describe("TCD file integrity", () => {
    for (const variant of ["metric", "imperial"] as const) {
      describe(variant, () => {
        test("TCD file exists and is not empty", () => {
          const tcdPath = join(
            process.cwd(),
            "dist",
            `harmonics-${variant}.tcd`,
          );
          expect(existsSync(tcdPath)).toBe(true);

          const stats = statSync(tcdPath);
          expect(stats.size).toBeGreaterThan(1000); // At least 1KB
        });

        test("harmonics.txt exists and is valid", () => {
          const harmonicsPath = join(
            process.cwd(),
            "dist",
            `harmonics-${variant}.txt`,
          );
          expect(existsSync(harmonicsPath)).toBe(true);

          const content = readFileSync(harmonicsPath, "utf-8");

          // Check for required header elements
          expect(content).toContain("# Tide Harmonics Database");
          expect(content).toContain("MERCHANTABILITY");
          expect(content).toContain("Number of constituents");
        });

        test("offsets.xml exists and is valid", () => {
          const offsetsPath = join(
            process.cwd(),
            "dist",
            `offsets-${variant}.xml`,
          );
          expect(existsSync(offsetsPath)).toBe(true);

          const content = readFileSync(offsetsPath, "utf-8");

          // Check for required XML structure
          expect(content).toContain('<?xml version="1.0"');
          expect(content).toContain("<document>");
          expect(content).toContain("</document>");
        });
      });
    }
  });
});
