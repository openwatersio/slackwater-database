import { describe, expect, test } from "vitest";
import { stationRouteBySlug, stationRoutes } from "../src/index.js";

describe("station routes", () => {
  test("reads the shipped route index on demand", () => {
    expect(stationRoutes("tide").length).toBeGreaterThan(0);
    expect(stationRoutes("current").length).toBeGreaterThan(0);
    // One route for the curated record and the provider row it names: the
    // registry half first, the harmonics half beside it.
    expect(stationRouteBySlug("tide", "victoria")?.stationIds).toEqual([
      "chs-victoria",
      "ticon/victoria_bc-543a-can-uhslc_rq",
    ]);
    expect(stationRouteBySlug("tide", "victoria")?.formerPaths).toContain(
      "/tides/ca/bc/victoria-harbour/",
    );
    expect(stationRouteBySlug("current", "boundary-pass")?.stationIds).toEqual([
      "noaa-boundary-pass",
      "noaa/PUG1717",
    ]);
    expect(stationRouteBySlug("tide", "missing")).toBeUndefined();
  });
});
