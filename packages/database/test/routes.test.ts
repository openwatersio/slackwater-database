import { describe, expect, test } from "vitest";
import { loadStations } from "../src/index.js";

// From source: station files are the stations package's, and this test checks
// the shipped database against them.
import { filePath, readStationFiles } from "../../stations/station-files.ts";

const {
  stationRouteBySlug,
  stationRoutes,
  accepted: stations,
  byId,
} = await loadStations();

describe("station routes", () => {
  test("Roseau's UHSLC records share a Dominica route and keep their former paths", () => {
    const ids = [
      "ticon/roseau-786-dom-uhslc_fd",
      "ticon/roseau-786a-dma-uhslc_rq",
    ];
    const route = stationRouteBySlug("tide", "roseau");
    expect(route).toMatchObject({
      path: "/tides/dm/roseau/",
      stationIds: ids,
      formerPaths: expect.arrayContaining([
        "/tides/do/roseau/",
        "/tides/dm/roseau-ticon-roseau-786a-dma-uhslc-rq/",
      ]),
    });
    for (const id of ids)
      expect(byId(id)).toMatchObject({
        country: "Dominica",
        country_code: "DM",
        timezone: "America/Dominica",
      });
    expect(
      stationRouteBySlug("tide", "roseau-ticon-roseau-786a-dma-uhslc-rq"),
    ).toBeUndefined();
    expect(
      stations.filter(({ id }) => ids.includes(id)).map(({ id }) => id),
    ).toEqual(["ticon/roseau-786-dom-uhslc_fd"]);
    expect(byId(ids[1]!)?.quality).toMatchObject({
      accepted: false,
      redundant: "ticon/roseau-786-dom-uhslc_fd",
    });
  });

  test.each([
    ["kahului", "1615680", "kahului-059-usa-uhslc_fd"],
    ["santa-barbara", "9411340", "santa_barbara_ca-577a-usa-uhslc_rq"],
    ["port-allen", "1611347", "port_allen-553a-usa-uhslc_rq"],
    // Duck took the shortest slug naming it; the relay's came from Duck Pier.
    ["duck", "8651370", "duck_pier_nc-260-usa-uhslc_fd", "duck-pier"],
    ["massacre-bay", "9460150", "massacre_bay_ak-550a-usa-uhslc_rq"],
  ])(
    "%s keeps the gauge's relays on the NOAA route",
    (slug, noaa, relay, base = slug) => {
      const route = stationRouteBySlug("tide", slug)!;
      expect(route.stationIds[0]).toBe(`noaa/${noaa}`);
      expect(route.stationIds).toContain(`ticon/${relay}`);
      const retiredSlug = `${base}-ticon-${relay.replaceAll("_", "-")}`;
      expect(stationRouteBySlug("tide", retiredSlug)).toBeUndefined();
      expect(route.formerPaths).toContain(
        route.path.replace(`${slug}/`, `${retiredSlug}/`),
      );
    },
  );

  test("reads the shipped route index on demand", () => {
    expect(stationRoutes("tide").length).toBeGreaterThan(0);
    expect(stationRoutes("current").length).toBeGreaterThan(0);
    // One route for the curated record and the provider row it names: the
    // registry half first, the harmonics half beside it.
    expect(stationRouteBySlug("tide", "victoria")?.stationIds).toEqual([
      "chs-victoria",
      "ticon/victoria_bc-543a-can-uhslc_rq",
      "ticon/victoria_harbour_bc-7120-can-meds",
    ]);
    // A CHS station keeps its slug and takes its MEDS twin's as a redirect.
    expect(stationRouteBySlug("tide", "comox")).toMatchObject({
      stationIds: ["chs-comox", "ticon/comox_bc-7965-can-meds"],
      formerPaths: ["/tides/ca/bc/comox-bc/"],
    });
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

  // Paths are worked out at read time; a station file records the path it
  // publishes. Any disagreement is a published URL that moved.
  test("reads every route at the path its station file records", () => {
    const files = readStationFiles().filter(({ sources }) => sources.length);
    for (const kind of ["tide", "current"] as const) {
      const read = Object.fromEntries(
        stationRoutes(kind).map(({ slug, path }) => [slug, path]),
      );
      const recorded = Object.fromEntries(
        files
          .filter((file) => file.kind === kind)
          .map((file) => [file.slug, filePath(file)]),
      );
      expect(read).toEqual(recorded);
    }
  });
});
