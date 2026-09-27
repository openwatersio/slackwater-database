import databaseBytes from "#slackwater.tcdb";
import { openDatabase } from "./database/reader.js";
import { StationRoute as StationRouteTable } from "./generated/fbs/slackwater.ts";
import { routePath } from "./route-path.js";
import { stationsById } from "./stations.js";
import type { StationRoute } from "./types.js";

const db = openDatabase(databaseBytes);

function readRoute(
  kind: "tide" | "current",
  table: StationRouteTable,
): StationRoute {
  const slug = table.slug()!;
  const stationIds = Array.from(
    { length: table.stationIdsLength() },
    (_, index) => table.stationIds(index),
  );
  // Members of one route share country and region (the route builder rejects
  // any that disagree), so the first station's geography is the route's.
  const { country_code, region_code } = stationsById.get(stationIds[0]!)!;
  return {
    slug,
    path: routePath(kind, { slug, country_code, region_code }),
    stationIds,
    formerPaths: Array.from({ length: table.formerPathsLength() }, (_, index) =>
      table.formerPaths(index),
    ),
  };
}

export function stationRouteBySlug(
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

export function stationRoutes(kind: "tide" | "current"): StationRoute[] {
  const length =
    kind === "tide" ? db.tideRoutesLength() : db.currentRoutesLength();
  return Array.from({ length }, (_, index) =>
    readRoute(
      kind,
      (kind === "tide" ? db.tideRoutes(index) : db.currentRoutes(index))!,
    ),
  );
}
