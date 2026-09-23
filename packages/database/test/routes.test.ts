import { describe, expect, test } from "vitest";
import { stationRouteBySlug, stationRoutes } from "../src/index.js";

describe("station routes", () => {
  test("reads the shipped route index on demand", () => {
    expect(stationRoutes("tide").length).toBeGreaterThan(0);
    expect(stationRoutes("current").length).toBeGreaterThan(0);
    expect(
      stationRouteBySlug("tide", "victoria-inner-harbour")?.stationIds,
    ).toContain("chs-victoria");
    expect(stationRouteBySlug("current", "boundary-pass")?.stationIds).toEqual([
      "noaa-boundary-pass",
      "noaa/PUG1717",
    ]);
    expect(stationRouteBySlug("tide", "missing")).toBeUndefined();
  });
});
