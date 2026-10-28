import { describe, expect, test } from "vitest";
import {
  assignSlugs,
  buildRoutes,
  toSlug,
  type RouteLock,
  type RouteMember,
} from "../routes.ts";
import { routePath } from "../../database/src/route-path.ts";
import type { ResolvedStation } from "../metadata.ts";

const routeMember = (
  kind: "tide" | "current",
  slug: string,
  id: string,
  country_code: string,
  region_code?: string,
): RouteMember => ({
  kind,
  slug,
  id,
  country_code,
  ...(region_code ? { region_code } : {}),
});

const station = (
  id: string,
  name: string,
  kind: "tide" | "current" = "tide",
  region = "Washington",
): ResolvedStation => ({
  id,
  name,
  kind,
  latitude: 47.6,
  longitude: -122.3,
  country: "United States",
  country_code: "US",
  region,
});

const none = () => ({
  tide: new Map<string, string>(),
  current: new Map<string, string>(),
});
const nothing = () => ({ tide: new Set<string>(), current: new Set<string>() });
const emptyRoutes = (): RouteLock => ({ tide: {}, current: {} });

describe("slug allocation", () => {
  test("transliterates letters that carry no separable mark", () => {
    expect(toSlug("Tromsø")).toBe("tromso");
    expect(toSlug("Heimsjøen")).toBe("heimsjoen");
    expect(toSlug("Ærøskøbing")).toBe("aeroskobing");
    expect(toSlug("Łeba")).toBe("leba");
    expect(toSlug("Honningsvåg")).toBe("honningsvag");
    expect(toSlug("Eiði")).toBe("eidi");
    expect(toSlug("Fuglafjørður")).toBe("fuglafjordur");
  });

  test("keeps a station's slug and resolves new collisions deterministically", () => {
    const held = none();
    held.tide.set("noaa/existing", "seattle");
    const inputs = [
      station("noaa/2", "Aberdeen"),
      station("noaa/existing", "Renamed Seattle"),
      station("noaa/1", "Aberdeen"),
    ];
    const forward = assignSlugs(inputs, held, nothing());
    const reverse = assignSlugs([...inputs].reverse(), held, nothing());

    expect(forward).toEqual(reverse);
    expect(Object.fromEntries(forward.tide)).toEqual({
      "noaa/existing": "seattle",
      "noaa/1": "aberdeen-noaa-1",
      "noaa/2": "aberdeen-noaa-2",
    });
  });

  test("qualifies every same-place name collision", () => {
    const result = assignSlugs(
      [
        {
          ...station("noaa/8724369", "Sawyer Key", "tide", "FL"),
          context: "Inside · Cudjoe Channel",
          region_code: "US-FL",
        },
        {
          ...station("noaa/8724370", "Sawyer Key", "tide", "FL"),
          context: "Outside · Cudjoe Channel",
          region_code: "US-FL",
        },
        {
          ...station("ticon/crms0119", "Port Sulphur", "tide", "LA"),
          context: "Gulf Coast",
          region_code: "US-LA",
        },
        {
          ...station("ticon/crms0129", "Port Sulphur", "tide", "LA"),
          context: "Gulf Coast",
          region_code: "US-LA",
        },
      ],
      none(),
      nothing(),
    );

    expect(Object.fromEntries(result.tide)).toEqual({
      "noaa/8724369": "sawyer-key-inside-cudjoe-channel",
      "noaa/8724370": "sawyer-key-outside-cudjoe-channel",
      "ticon/crms0119": "port-sulphur-ticon-crms0119",
      "ticon/crms0129": "port-sulphur-ticon-crms0129",
    });
  });

  // A redirect or a retired station's slug was published for other water, so a
  // new station climbs past it rather than taking the address.
  test("never hands out a reserved slug", () => {
    const reserved = nothing();
    reserved.tide.add("everett");
    const result = assignSlugs(
      [{ ...station("noaa/9447659", "Everett"), context: "Port Gardner" }],
      none(),
      reserved,
    );
    expect(result.tide.get("noaa/9447659")).toBe("everett-port-gardner");
  });

  test("allows the same slug in tide and current namespaces", () => {
    const result = assignSlugs(
      [
        station("noaa/1", "Deception Pass"),
        station("noaa/PUG1", "Deception Pass", "current"),
      ],
      none(),
      nothing(),
    );
    expect(result.tide.get("noaa/1")).toBe("deception-pass");
    expect(result.current.get("noaa/PUG1")).toBe("deception-pass");
  });
});

describe("geographic routes", () => {
  test("builds regional and country-only paths", () => {
    expect(
      routePath(
        "tide",
        routeMember("tide", "victoria", "chs-victoria", "CA", "CA-BC"),
      ),
    ).toBe("/tides/ca/bc/victoria/");
    expect(
      routePath("tide", routeMember("tide", "koror", "uhslc/koror", "PW")),
    ).toBe("/tides/pw/koror/");
  });

  test("rejects slugs a path would read as a country code", () => {
    for (const slug of ["ab", "a"])
      expect(() =>
        buildRoutes([routeMember("tide", slug, "station", "US", "US-WA")], {
          routeLock: emptyRoutes(),
          registryIds: new Set(),
        }),
      ).toThrow(/station: route slug .* is 2 characters or fewer/);
  });

  test("rejects shared slugs whose geography disagrees", () => {
    expect(() =>
      buildRoutes(
        [
          routeMember("tide", "boundary-pass", "a", "CA", "CA-BC"),
          routeMember("tide", "boundary-pass", "b", "US", "US-WA"),
        ],
        { routeLock: emptyRoutes(), registryIds: new Set() },
      ),
    ).toThrow(/boundary-pass.*country|region/);
  });

  test("keeps the registry station first in a shared route", () => {
    const routes = buildRoutes(
      [
        routeMember("current", "boundary-pass", "noaa/PUG1717", "CA", "CA-BC"),
        routeMember(
          "current",
          "boundary-pass",
          "noaa-boundary-pass",
          "CA",
          "CA-BC",
        ),
      ],
      {
        routeLock: emptyRoutes(),
        registryIds: new Set(["noaa-boundary-pass"]),
      },
    );
    expect(routes.current[0]?.station_ids).toEqual([
      "noaa-boundary-pass",
      "noaa/PUG1717",
    ]);
  });

  test("lists an accepted record before a rejected duplicate", () => {
    const routes = buildRoutes(
      [
        {
          ...routeMember("tide", "saxis", "noaa/8573777", "US", "US-VA"),
          rejected: true,
        },
        routeMember("tide", "saxis", "noaa/8633777", "US", "US-VA"),
      ],
      { routeLock: emptyRoutes(), registryIds: new Set() },
    );
    expect(routes.tide[0]?.station_ids).toEqual([
      "noaa/8633777",
      "noaa/8573777",
    ]);
  });

  test("leads with an authoritative record, then the best scored, not the first id", () => {
    const routes = buildRoutes(
      [
        { ...routeMember("tide", "gedser", "dmi/31616", "DK"), score: 45 },
        {
          ...routeMember("tide", "gedser", "ticon/gedser-837a", "DK"),
          score: 83,
        },
        {
          ...routeMember("tide", "massacre-bay", "noaa/9460150", "US", "US-AK"),
          authoritative: true,
          score: 55,
        },
        {
          ...routeMember(
            "tide",
            "massacre-bay",
            "ticon/massacre_bay",
            "US",
            "US-AK",
          ),
          score: 79,
        },
      ],
      { routeLock: emptyRoutes(), registryIds: new Set() },
    );
    expect(routes.tide.map((route) => route.station_ids)).toEqual([
      ["ticon/gedser-837a", "dmi/31616"],
      ["noaa/9460150", "ticon/massacre_bay"],
    ]);
  });

  test("keeps a record quality does not score ahead of scored ones", () => {
    const routes = buildRoutes(
      [
        {
          ...routeMember("tide", "halifax", "ticon/halifax-275", "CA", "CA-NS"),
          score: 90,
        },
        routeMember("tide", "halifax", "chs-halifax", "CA", "CA-NS"),
      ],
      { routeLock: emptyRoutes(), registryIds: new Set() },
    );
    expect(routes.tide[0]?.station_ids).toEqual([
      "chs-halifax",
      "ticon/halifax-275",
    ]);
  });

  test("redirects a station's previous path after its geography moves", () => {
    const routes = buildRoutes(
      [routeMember("tide", "victoria", "chs-victoria", "CA", "CA-BC")],
      {
        routeLock: {
          tide: {
            victoria: {
              path: "/tides/ca/ab/victoria/",
              former_paths: ["/tides/victoria-old/"],
            },
          },
          current: {},
        },
        registryIds: new Set(),
      },
    );
    expect(routes.tide[0]?.former_paths).toEqual([
      "/tides/ca/ab/victoria/",
      "/tides/victoria-old/",
    ]);
  });

  test("rejects a redirect that is another route's canonical path", () => {
    expect(() =>
      buildRoutes(
        [
          routeMember("tide", "alpha", "a", "US", "US-WA"),
          routeMember("tide", "bravo", "b", "US", "US-CA"),
        ],
        {
          routeLock: {
            tide: {
              alpha: {
                path: "/tides/us/wa/alpha/",
                former_paths: ["/tides/us/ca/bravo/"],
              },
            },
            current: {},
          },
          registryIds: new Set(),
        },
      ),
    ).toThrow(/former path.*canonical path/i);
  });

  test("does not redirect a canonical path to itself", () => {
    const member = routeMember("tide", "victoria", "station", "CA", "CA-BC");
    const previous: RouteLock = {
      tide: {
        victoria: {
          path: "/tides/ca/ab/victoria/",
          former_paths: ["/tides/ca/bc/victoria/"],
        },
      },
      current: {},
    };
    expect(
      buildRoutes([member], {
        routeLock: previous,
        registryIds: new Set(),
      }).tide[0]?.former_paths,
    ).toEqual(["/tides/ca/ab/victoria/"]);
  });
});
