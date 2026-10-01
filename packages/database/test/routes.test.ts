import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { stationRouteBySlug, stationRoutes } from "../src/index.js";

describe("station routes", () => {
  test.each([
    ["kahului", "1615680", "kahului-059-usa-uhslc_fd"],
    ["santa-barbara", "9411340", "santa_barbara_ca-577a-usa-uhslc_rq"],
    ["port-allen", "1611347", "port_allen-553a-usa-uhslc_rq"],
    ["duck-pier", "8651370", "duck_pier_nc-260-usa-uhslc_fd"],
    ["massacre-bay", "9460150", "massacre_bay_ak-550a-usa-uhslc_rq"],
  ])("%s keeps both gauge records on the NOAA route", (slug, noaa, relay) => {
    const route = stationRouteBySlug("tide", slug)!;
    expect(route.stationIds).toEqual([`noaa/${noaa}`, `ticon/${relay}`]);
    const retiredSlug = `${slug}-ticon-${relay.replaceAll("_", "-")}`;
    expect(stationRouteBySlug("tide", retiredSlug)).toBeUndefined();
    expect(route.formerPaths).toContain(
      route.path.replace(`${slug}/`, `${retiredSlug}/`),
    );
  });

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
