import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  DEPARTURE_LIMIT,
  buildRouteLock,
  buildRoutes,
  buildSlugTable,
  checkSlugTable,
  emptyFormerSlugs,
  departures,
  routeHistoryProblems,
  routePath,
  type RouteLock,
  type RouteMember,
  type SlugTable,
} from "../routes.ts";
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

const emptySlugs = (): SlugTable => ({ catalogue: {}, tide: {}, current: {} });
const emptyRoutes = (): RouteLock => ({ tide: {}, current: {} });

describe("slug allocation", () => {
  test("preserves allocations and resolves new collisions deterministically", () => {
    const previous = {
      ...emptySlugs(),
      tide: { "noaa/existing": "seattle" },
    };
    const inputs = [
      station("noaa/2", "Aberdeen"),
      station("noaa/existing", "Renamed Seattle"),
      station("noaa/1", "Aberdeen"),
    ];
    const forward = buildSlugTable(inputs, previous);
    const reverse = buildSlugTable([...inputs].reverse(), previous);

    expect(forward.table).toEqual(reverse.table);
    expect(forward.table.tide).toMatchObject({
      "noaa/existing": "seattle",
      "noaa/1": "aberdeen-noaa-1",
      "noaa/2": "aberdeen-noaa-2",
    });
  });

  test("qualifies every same-place name collision", () => {
    const result = buildSlugTable(
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
          context: "LA",
          region_code: "US-LA",
        },
        {
          ...station("ticon/crms0129", "Port Sulphur", "tide", "LA"),
          context: "LA",
          region_code: "US-LA",
        },
      ],
      emptySlugs(),
    );

    expect(result.table.tide).toMatchObject({
      "noaa/8724369": "sawyer-key-inside-cudjoe-channel",
      "noaa/8724370": "sawyer-key-outside-cudjoe-channel",
      "ticon/crms0119": "port-sulphur-ticon-crms0119",
      "ticon/crms0129": "port-sulphur-ticon-crms0129",
    });
  });

  test("tombstones departures and lets returning stations reclaim them", () => {
    const previous = {
      ...emptySlugs(),
      tide: { "noaa/old": "everett", "noaa/live": "seattle" },
    };
    const departed = buildSlugTable(
      [station("noaa/live", "Seattle")],
      previous,
    );
    expect(departed.gone).toEqual(["noaa/old"]);
    expect(departed.tombstones.tide).toEqual({ "noaa/old": "everett" });

    const returned = buildSlugTable(
      [station("noaa/live", "Seattle"), station("noaa/old", "Everett")],
      departed.table,
      departed.tombstones,
    );
    expect(returned.table.tide["noaa/old"]).toBe("everett");
    expect(returned.tombstones.tide).toEqual({});
  });

  test("a curated slug outranks the previous allocation and the ladder", () => {
    const previous = {
      ...emptySlugs(),
      tide: { "noaa/1": "everett-washington", "noaa/2": "seattle" },
    };
    const curated = { ...station("noaa/1", "Everett"), slug: "everett" };
    expect(
      buildSlugTable([curated, station("noaa/2", "Seattle")], previous).table
        .tide,
    ).toEqual({
      "noaa/1": "everett",
      "noaa/2": "seattle",
    });
    expect(() =>
      buildSlugTable(
        [{ ...curated, slug: "seattle" }, station("noaa/2", "Seattle")],
        previous,
      ),
    ).toThrow(/noaa\/1.*seattle.*noaa\/2/);
    expect(() =>
      buildSlugTable([curated], emptySlugs(), {
        tide: { "noaa/old": "everett" },
        current: {},
      }),
    ).toThrow(/tombstoned for noaa\/old/);
  });

  test("allows the same slug in tide and current namespaces", () => {
    const result = buildSlugTable(
      [
        station("tide/1", "Dodd Narrows"),
        station("current/1", "Dodd Narrows", "current"),
      ],
      emptySlugs(),
    );
    expect(result.table.tide["tide/1"]).toBe("dodd-narrows");
    expect(result.table.current["current/1"]).toBe("dodd-narrows");
  });

  test("checks immutable allocations and exposes a fixed departure limit", () => {
    const before = { ...emptySlugs(), tide: { "noaa/1": "everett" } };
    const after = { ...emptySlugs(), tide: { "noaa/1": "everett-wa" } };
    expect(checkSlugTable(before, after, { tide: {}, current: {} })).toEqual([
      expect.stringMatching(/noaa\/1.*everett.*everett-wa/),
    ]);
    expect(departures(["noaa/3", "noaa/1"], ["noaa/3"])).toEqual(["noaa/1"]);
    expect(DEPARTURE_LIMIT).toBeGreaterThan(0);
    expect(DEPARTURE_LIMIT).toBeLessThan(100);
  });
});

describe("slug history", () => {
  test("records the slug an id moved off, and hands it to nobody else", () => {
    const previous = {
      ...emptySlugs(),
      tide: { "noaa/a": "sawyer-key", "noaa/b": "sawyer-key-fl" },
    };
    const inputs = [
      {
        ...station("noaa/a", "Sawyer Key", "tide", "FL"),
        context: "Inside",
        region_code: "US-FL",
      },
      {
        ...station("noaa/b", "Sawyer Key", "tide", "FL"),
        context: "Outside",
        region_code: "US-FL",
      },
    ];
    const migrated = buildSlugTable(inputs, previous, undefined, undefined, {
      reallocate: new Set(["noaa/a", "noaa/b"]),
    });
    expect(migrated.table.tide).toEqual({
      "noaa/a": "sawyer-key-inside",
      "noaa/b": "sawyer-key-outside",
    });
    expect(migrated.formerSlugs.tide).toEqual({
      "noaa/a": ["sawyer-key"],
      "noaa/b": ["sawyer-key-fl"],
    });

    // A new station named for the same key cannot pick up either retired slug,
    // even though the allocation table no longer mentions them.
    const later = buildSlugTable(
      [...inputs, station("noaa/c", "Sawyer Key", "tide", "FL")],
      migrated.table,
      undefined,
      migrated.formerSlugs,
    );
    expect(later.table.tide["noaa/c"]).not.toBe("sawyer-key");
    expect(later.table.tide["noaa/c"]).not.toBe("sawyer-key-fl");
    expect(later.formerSlugs).toEqual(migrated.formerSlugs);
  });

  test("a slug vacated during a migration cannot be taken in the same pass", () => {
    // noaa/a leaves `palm-beach-fl` for a context-qualified slug; noaa/b, laddering
    // later in the same pass, would otherwise land on the freshly vacated slug.
    const previous = {
      ...emptySlugs(),
      tide: { "noaa/a": "palm-beach-fl", "noaa/b": "palm-beach-fl-noaa-b" },
    };
    const result = buildSlugTable(
      [
        {
          ...station("noaa/a", "Palm Beach", "tide", "FL"),
          context: "Highway 704 Bridge",
          region_code: "US-FL",
        },
        {
          ...station("noaa/b", "Palm Beach", "tide", "FL"),
          context: "FL",
          region_code: "US-FL",
        },
      ],
      previous,
      undefined,
      undefined,
      { reallocate: new Set(["noaa/a", "noaa/b"]) },
    );
    expect(result.table.tide["noaa/a"]).toBe("palm-beach-highway-704-bridge");
    expect(result.table.tide["noaa/b"]).not.toBe("palm-beach-fl");
    // An id whose ladder still lands on its own old slug keeps it.
    const kept = buildSlugTable(
      [station("noaa/a", "Seattle")],
      { ...emptySlugs(), tide: { "noaa/a": "seattle" } },
      undefined,
      undefined,
      { reallocate: new Set(["noaa/a"]) },
    );
    expect(kept.table.tide["noaa/a"]).toBe("seattle");
    expect(kept.formerSlugs.tide).toEqual({});
  });

  test("a slug vacated by a reset still belongs to its first owner", () => {
    // The table was reset, so `previous` has forgotten that noaa/old held
    // `esperance`; the history has not, and a later station cannot take it.
    const history = {
      ...emptyFormerSlugs(),
      tide: { "noaa/old": ["esperance"] },
    };
    const result = buildSlugTable(
      [station("noaa/new", "Esperance", "tide", "WA")],
      emptySlugs(),
      undefined,
      history,
    );
    expect(result.table.tide["noaa/new"]).not.toBe("esperance");
  });

  test("two ids merge on a curated slug only when one of them is a registry record", () => {
    const previous = {
      ...emptySlugs(),
      tide: {
        "chs-victoria": "victoria-inner-harbour",
        "ticon/victoria": "victoria-james-bay",
      },
    };
    const curated = (id: string) => ({
      ...station(id, "Victoria", "tide", "British Columbia"),
      country: "Canada",
      country_code: "CA",
      region_code: "CA-BC",
      slug: "victoria",
    });
    const merged = buildSlugTable(
      [curated("chs-victoria"), curated("ticon/victoria")],
      previous,
      undefined,
      undefined,
      { registryIds: new Set(["chs-victoria"]) },
    );
    expect(merged.table.tide).toEqual({
      "chs-victoria": "victoria",
      "ticon/victoria": "victoria",
    });
    // Both halves moved, so both old links keep resolving.
    expect(merged.formerSlugs.tide).toEqual({
      "chs-victoria": ["victoria-inner-harbour"],
      "ticon/victoria": ["victoria-james-bay"],
    });

    // Two provider rows may not share a slug: that is a collision, not a merge.
    expect(() =>
      buildSlugTable(
        [curated("ticon/a"), curated("ticon/b")],
        emptySlugs(),
        undefined,
        undefined,
        {
          registryIds: new Set(),
        },
      ),
    ).toThrow(/ticon\/b.*victoria.*ticon\/a/);
    // Nor may two registry records: a shared slug has exactly one curated owner.
    expect(() =>
      buildSlugTable(
        [curated("chs-a"), curated("chs-b")],
        emptySlugs(),
        undefined,
        undefined,
        {
          registryIds: new Set(["chs-a", "chs-b"]),
        },
      ),
    ).toThrow(/victoria.*two registry/);
  });

  test("rejects a tombstone for a slug that is still live under another id", () => {
    // A tombstone means the id left holding that slug. If the slug is also
    // allocated, it changed hands — which is what tombstones exist to forbid.
    expect(() =>
      buildSlugTable(
        [station("chs-victoria", "Victoria")],
        { ...emptySlugs(), tide: { "chs-victoria": "victoria" } },
        { tide: { "chs-victoria-harbour": "victoria" }, current: {} },
      ),
    ).toThrow(/victoria.*chs-victoria-harbour.*chs-victoria/);
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

  test("keeps existing shared slugs as one route", () => {
    const table = JSON.parse(
      readFileSync(
        new URL("../../../metadata/slugs.json", import.meta.url),
        "utf8",
      ),
    ) as SlugTable;
    const shared = [["current", "boundary-pass"]] as const;
    const members = shared.flatMap(([kind, slug]) =>
      Object.entries(table[kind])
        .filter(([, allocated]) => allocated === slug)
        .map(([id]) => routeMember(kind, slug, id, "CA", "CA-BC")),
    );
    const routes = buildRoutes(members, {
      routeLock: emptyRoutes(),
      registryIds: new Set(["noaa-boundary-pass"]),
    });

    for (const [kind, slug] of shared)
      expect(routes[kind].filter((route) => route.slug === slug)).toHaveLength(
        1,
      );
  });

  test("retains explicit former slugs and a previous geographic path", () => {
    const member = {
      ...routeMember("tide", "victoria", "chs-victoria", "CA", "CA-BC"),
      former_slugs: ["victoria-harbour"],
    };
    const previous: RouteLock = {
      tide: {
        victoria: {
          path: "/tides/ca/ab/victoria/",
          former_paths: ["/tides/victoria-old/"],
        },
      },
      current: {},
    };
    const routes = buildRoutes([member], {
      routeLock: previous,
      registryIds: new Set(),
    });
    expect(routes.tide[0]?.former_paths).toEqual([
      "/tides/ca/ab/victoria/",
      "/tides/ca/bc/victoria-harbour/",
      "/tides/victoria-old/",
    ]);
    expect(buildRouteLock([member], previous).tide["victoria"]).toEqual({
      path: "/tides/ca/bc/victoria/",
      former_paths: routes.tide[0]?.former_paths,
    });
  });

  test("retains history when slug and geography change together", () => {
    const member = {
      ...routeMember("tide", "new", "station", "CA", "CA-BC"),
      former_slugs: ["old"],
    };
    const previous: RouteLock = {
      tide: {
        old: {
          path: "/tides/us/wa/old/",
          former_paths: ["/tides/old-old/"],
        },
      },
      current: {},
    };
    const route = buildRoutes([member], {
      routeLock: previous,
      registryIds: new Set(),
    }).tide[0];
    expect(route?.former_paths).toEqual([
      "/tides/ca/bc/old/",
      "/tides/old-old/",
      "/tides/us/wa/old/",
    ]);
    expect(
      buildRouteLock([member], previous).tide["new"]?.former_paths,
    ).toEqual(route?.former_paths);
  });

  test("rejects a former path that is another route's canonical path", () => {
    const a = {
      ...routeMember("tide", "alpha", "a", "US", "US-WA"),
      former_slugs: ["bravo"],
    };
    const b = routeMember("tide", "bravo", "b", "US", "US-CA");
    expect(() =>
      buildRoutes([a, b], {
        routeLock: emptyRoutes(),
        registryIds: new Set(),
      }),
    ).toThrow(/former slug.*current slug/i);
  });

  test("rejects malformed and multiply-owned former slugs", () => {
    expect(() =>
      buildRoutes(
        [
          {
            ...routeMember("tide", "alpha", "a", "US", "US-WA"),
            former_slugs: ["bad/path"],
          },
        ],
        { routeLock: emptyRoutes(), registryIds: new Set() },
      ),
    ).toThrow(/invalid former slug/);

    expect(() =>
      buildRoutes(
        [
          {
            ...routeMember("tide", "alpha", "a", "US", "US-WA"),
            former_slugs: ["old"],
          },
          {
            ...routeMember("tide", "bravo", "b", "US", "US-CA"),
            former_slugs: ["old"],
          },
        ],
        { routeLock: emptyRoutes(), registryIds: new Set() },
      ),
    ).toThrow(/former slug.*already used/i);
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

  test("rejects a slug move that loses published route history", () => {
    const previous: RouteLock = {
      tide: {
        old: { path: "/tides/us/wa/old/", former_paths: ["/tides/old/"] },
      },
      current: {},
    };
    const moved = buildRouteLock(
      [routeMember("tide", "new", "station", "US", "US-WA")],
      previous,
    );
    expect(
      routeHistoryProblems(
        previous,
        moved,
        { ...emptySlugs(), tide: { station: "old" } },
        [],
      ),
    ).toEqual([
      expect.stringMatching(/tide\/old.*\/tides\/us\/wa\/old/),
      expect.stringMatching(/tide\/old.*\/tides\/old/),
    ]);

    const redirected = buildRouteLock(
      [
        {
          ...routeMember("tide", "new", "station", "US", "US-WA"),
          former_slugs: ["old"],
        },
      ],
      previous,
    );
    expect(
      routeHistoryProblems(
        previous,
        redirected,
        { ...emptySlugs(), tide: { station: "old" } },
        [],
      ),
    ).toEqual([]);

    expect(
      routeHistoryProblems(
        previous,
        emptyRoutes(),
        { ...emptySlugs(), tide: { station: "old" } },
        ["station"],
      ),
    ).toEqual([]);
  });
});
