import { around, distance } from "geokdbush";
import { allStations, qualityFilter, stationsById } from "../stations.js";
import { createGeoIndex } from "./geo.js" with { type: "macro" };
import { loadGeoIndex } from "./geo.js";
import { createTextIndex } from "./text.js" with { type: "macro" };
import { loadTextIndex } from "./text.js";
import type { Station } from "../types.js";

export type Position = Latitude & Longitude;
type Latitude = { latitude: number } | { lat: number };
type Longitude = { longitude: number } | { lon: number } | { lng: number };

export type Filter = (station: Station) => boolean;

export type NearestOptions = Position & {
  maxDistance?: number;
  /** Include all stations, not just quality-filtered ones. */
  includeAll?: boolean;
  filter?: Filter;
};

export type NearOptions = NearestOptions & {
  maxResults?: number;
};

export type BboxOptions = {
  /** Include all stations, not just quality-filtered ones. */
  includeAll?: boolean;
  filter?: Filter;
};

export type TextSearchOptions = {
  /** Include all stations, not just quality-filtered ones. */
  includeAll?: boolean;
  filter?: Filter;
  maxResults?: number;
};

/**
 * A tuple of a station and its distance from a given point, in kilometers.
 */
export type StationWithDistance = [Station, number];

// The geo index is small and used by near/nearest/bbox, so load it eagerly.
const geoIndex = loadGeoIndex(await createGeoIndex());

// The text index costs ~15 MB of heap to build. Consumers that only do geo/id
// lookups (e.g. the signalk-tides plugin on constrained hardware) never call
// search(), so defer building it until the first text search. The serialized
// index string (~1.5 MB) is still inlined at build time; only the expensive
// loadTextIndex build is deferred.
let textIndexData: string | undefined = await createTextIndex();
let textIndex: ReturnType<typeof loadTextIndex> | undefined;
function getTextIndex() {
  if (!textIndex) {
    textIndex = loadTextIndex(textIndexData!);
    textIndexData = undefined; // free the ~1.5 MB serialized string for GC
  }
  return textIndex;
}

function createFilter(
  includeAll?: boolean,
  filter?: Filter,
): Filter | undefined {
  const qf = includeAll ? undefined : qualityFilter;
  if (qf && filter) return (s) => qf(s) && filter(s);
  return qf ?? filter;
}

/**
 * Find stations near a given position.
 */
export function near({
  maxDistance = Infinity,
  maxResults = 10,
  includeAll,
  filter,
  ...position
}: NearOptions): StationWithDistance[] {
  const point = positionToPoint(position);
  const combined = createFilter(includeAll, filter);

  const ids: number[] = around(
    geoIndex,
    ...point,
    maxResults,
    maxDistance,
    combined ? (id: number) => combined(allStations[id]!) : undefined,
  );
  return ids.map((id) => {
    const station = allStations[id]!;

    return [station, distance(...point, ...positionToPoint(station))] as const;
  });
}

/**
 * Find the single nearest station to a given position.
 */
export function nearest(options: NearestOptions): StationWithDistance | null {
  const results = near({ ...options, maxResults: 1 });
  return results[0] ?? null;
}

/**
 * Find stations within a bounding box.
 */
export function bbox(
  [minLon, minLat, maxLon, maxLat]: [number, number, number, number],
  { includeAll = false, filter }: BboxOptions = {},
): Station[] {
  const combined = createFilter(includeAll, filter);
  const ids: number[] = geoIndex.range(minLon, minLat, maxLon, maxLat);
  const results = ids.map((id) => allStations[id]!);
  return combined ? results.filter(combined) : results;
}

export function positionToPoint(options: Position): [number, number] {
  const longitude =
    "longitude" in options
      ? options.longitude
      : "lon" in options
        ? options.lon
        : options.lng;
  const latitude = "latitude" in options ? options.latitude : options.lat;
  return [longitude, latitude];
}

/**
 * Search for stations by text across name, region, country, and continent.
 * Supports fuzzy matching and prefix search.
 */
export function search(
  query: string,
  { includeAll, filter, maxResults = 20 }: TextSearchOptions = {},
): Station[] {
  const combined = createFilter(includeAll, filter);
  const index = getTextIndex();

  const searchOptions: Parameters<typeof index.search>[1] = {};

  if (combined) {
    searchOptions.filter = (result) => {
      const station = stationsById.get(result.id);
      return station ? combined(station) : false;
    };
  }

  const results = index.search(query, searchOptions);

  return results
    .slice(0, maxResults)
    .map((result) => stationsById.get(result.id)!)
    .filter(Boolean);
}
