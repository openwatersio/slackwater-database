import { StationRoute as StationRouteTable } from "./generated/fbs/slackwater.ts";
import { routePath } from "./route-path.js";
import type { StationReader } from "./stations.js";
import type { Root } from "./generated/fbs/slackwater.ts";
import type { StationRoute } from "./types.js";

export function createRoutes(db: Root, stations: StationReader) {
  const routeCache = {
    tide: new Map<string, StationRoute>(),
    current: new Map<string, StationRoute>(),
  };
  const lists = new Map<"tide" | "current", StationRoute[]>();

  function readRoute(
    kind: "tide" | "current",
    table: StationRouteTable,
  ): StationRoute {
    const slug = table.slug()!;
    const cached = routeCache[kind].get(slug);
    if (cached) return cached;
    const stationIds = Array.from(
      { length: table.stationIdsLength() },
      (_, index) => table.stationIds(index),
    );
    // Members of one route share country and region (the route builder rejects
    // any that disagree), so the first station's geography is the route's.
    const { country_code, region_code } = stations.byId(stationIds[0]!)!;
    const route = {
      slug,
      path: routePath(kind, { slug, country_code, region_code }),
      stationIds,
      formerPaths: Array.from(
        { length: table.formerPathsLength() },
        (_, index) => table.formerPaths(index),
      ),
    };
    routeCache[kind].set(slug, route);
    return route;
  }

  function stationRouteBySlug(
    kind: "tide" | "current",
    slug: string,
  ): StationRoute | undefined {
    const length =
      kind === "tide" ? db.tideRoutesLength() : db.currentRoutesLength();
    let low = 0;
    let high = length - 1;
    while (low <= high) {
      const index = (low + high) >>> 1;
      const table = (
        kind === "tide" ? db.tideRoutes(index) : db.currentRoutes(index)
      )!;
      const candidate = table.slug()!;
      if (candidate === slug) return readRoute(kind, table);
      if (candidate < slug) low = index + 1;
      else high = index - 1;
    }
    return undefined;
  }

  function stationRoutes(kind: "tide" | "current"): StationRoute[] {
    const cached = lists.get(kind);
    if (cached) return cached;
    const length =
      kind === "tide" ? db.tideRoutesLength() : db.currentRoutesLength();
    const routes = Array.from({ length }, (_, index) =>
      readRoute(
        kind,
        (kind === "tide" ? db.tideRoutes(index) : db.currentRoutes(index))!,
      ),
    );
    lists.set(kind, routes);
    return routes;
  }

  return { stationRouteBySlug, stationRoutes };
}
