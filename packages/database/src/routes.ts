import databaseBytes from "#slackwater.tcdb";
import { openDatabase } from "./database/reader.js";
import { StationRoute as StationRouteTable } from "./generated/fbs/slackwater.ts";
import type { StationRoute } from "./types.js";

const db = openDatabase(databaseBytes);

function readRoute(table: StationRouteTable): StationRoute {
  return {
    slug: table.slug()!,
    stationIds: Array.from({ length: table.stationIdsLength() }, (_, index) =>
      table.stationIds(index),
    ),
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
    if (candidate === slug) return readRoute(table);
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
      (kind === "tide" ? db.tideRoutes(index) : db.currentRoutes(index))!,
    ),
  );
}
