import { describe, expect, test } from "vitest";
import { stationRouteBySlug, stationRoutes } from "../src/index.js";

describe("station routes", () => {
  test("reads the shipped route index on demand", () => {
    expect(stationRoutes("tide")).toEqual([]);
    expect(stationRoutes("current")).toEqual([]);
    expect(stationRouteBySlug("tide", "missing")).toBeUndefined();
  });
});
