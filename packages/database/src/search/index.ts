import { around, distance } from "geokdbush";
import KDBush from "kdbush";
import type { Root } from "../generated/fbs/slackwater.ts";
import type { StationReader } from "../stations.js";
import { readStationMeta } from "../database/reader.js";
import { loadGeoIndex } from "./geo.js";
import { buildTextIndex, loadTextIndex } from "./text.js";
import type { SearchIndexData } from "./bundled.js";
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

export function createSearch(
  bytes: Uint8Array,
  db: Root,
  stations: StationReader,
  indexes?: SearchIndexData,
) {
  let geoIndex: KDBush | undefined;
  let textIndex: ReturnType<typeof loadTextIndex> | undefined;
  // Serialized indexes are released once parsed. Consumers on constrained
  // hardware that only do geo lookups never pay for the parsed text index.
  let geoData = indexes?.geo;
  let textData = indexes?.text;

  function getGeoIndex(): KDBush {
    if (!geoIndex) {
      if (geoData !== undefined) {
        geoIndex = loadGeoIndex(geoData);
        geoData = undefined;
      } else {
        // Coordinates alone suffice; do not materialize station identities.
        geoIndex = new KDBush(db.stationsLength());
        for (let i = 0; i < db.stationsLength(); i++) {
          const table = db.stations(i)!;
          geoIndex.add(table.longitude(), table.latitude());
        }
        geoIndex.finish();
      }
    }
    return geoIndex;
  }

  function getTextIndex() {
    if (!textIndex) {
      textIndex =
        textData !== undefined
          ? loadTextIndex(textData)
          : buildTextIndex(readStationMeta(bytes));
      textData = undefined;
    }
    return textIndex;
  }

  function createFilter(
    includeAll?: boolean,
    filter?: Filter,
  ): ((index: number) => boolean) | undefined {
    if (includeAll && !filter) return undefined;
    return (index) =>
      (includeAll || stations.isAccepted(index)) &&
      (!filter || filter(stations.at(index)));
  }

  /**
   * Find stations near a given position.
   */
  function near({
    maxDistance = Infinity,
    maxResults = 10,
    includeAll,
    filter,
    ...position
  }: NearOptions): StationWithDistance[] {
    const point = positionToPoint(position);
    const combined = createFilter(includeAll, filter);

    const ids: number[] = around(
      getGeoIndex(),
      ...point,
      maxResults,
      maxDistance,
      combined,
    );
    return ids.map((id) => {
      const station = stations.at(id);

      return [
        station,
        distance(...point, ...positionToPoint(station)),
      ] as const;
    });
  }

  /**
   * Find the single nearest station to a given position.
   */
  function nearest(options: NearestOptions): StationWithDistance | null {
    const results = near({ ...options, maxResults: 1 });
    return results[0] ?? null;
  }

  /**
   * Find stations within a bounding box.
   */
  function bbox(
    [minLon, minLat, maxLon, maxLat]: [number, number, number, number],
    { includeAll = false, filter }: BboxOptions = {},
  ): Station[] {
    const combined = createFilter(includeAll, filter);
    const ids: number[] = getGeoIndex().range(minLon, minLat, maxLon, maxLat);
    return (combined ? ids.filter(combined) : ids).map((id) => stations.at(id));
  }

  /**
   * Search for stations by text across name, region, country, and continent.
   * Supports fuzzy matching and prefix search.
   */
  function search(
    query: string,
    { includeAll, filter, maxResults = 20 }: TextSearchOptions = {},
  ): Station[] {
    const combined = createFilter(includeAll, filter);
    const index = getTextIndex();

    const searchOptions: Parameters<typeof index.search>[1] = {};

    if (combined) {
      searchOptions.filter = (result) => {
        const index = stations.indexOf(result.id);
        return index !== undefined && combined(index);
      };
    }

    const results = index.search(query, searchOptions);

    return results
      .slice(0, maxResults)
      .map((result) => stations.byId(result.id)!)
      .filter(Boolean);
  }

  return { near, nearest, bbox, search };
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
