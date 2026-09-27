import { readFileSync } from "node:fs";
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
    expect(stationRouteBySlug("tide", "victoria")?.path).toBe(
      "/tides/ca/bc/victoria/",
    );
    expect(
      stationRoutes("tide").find((route) => route.slug === "bridesburg")?.path,
    ).toBe("/tides/us/pa/bridesburg/");
    expect(stationRouteBySlug("tide", "victoria")?.formerPaths).toContain(
      "/tides/ca/bc/victoria-harbour/",
    );
    expect(stationRouteBySlug("current", "boundary-pass")?.stationIds).toEqual([
      "noaa-boundary-pass",
      "noaa/PUG1717",
    ]);
    expect(stationRouteBySlug("tide", "missing")).toBeUndefined();
  });

  // Paths are worked out at read time; the lock records the paths the route
  // builder minted. Any disagreement is a published URL that moved.
  test("reads every route at the path the route lock records", () => {
    const lock = JSON.parse(
      readFileSync(
        new URL("../../../metadata/routes.lock.json", import.meta.url),
        "utf8",
      ),
    ) as Record<"tide" | "current", Record<string, { path: string }>>;
    for (const kind of ["tide", "current"] as const) {
      const read = Object.fromEntries(
        stationRoutes(kind).map(({ slug, path }) => [slug, path]),
      );
      const locked = Object.fromEntries(
        Object.entries(lock[kind]).map(([slug, { path }]) => [slug, path]),
      );
      expect(read).toEqual(locked);
    }
  });
});
