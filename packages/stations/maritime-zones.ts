import { readFile } from "node:fs/promises";
import { distanceToRing, pointInPolygon } from "@neaps/datums";

const MARITIME_ZONES_URL = new URL(
  "../../metadata/maritime-zones.geojson",
  import.meta.url,
);
const KM_PER_DEGREE = 111.195;

/**
 * How far outside every zone a station may sit and still take the nearest
 * zone's country. The zones end at a generalized coastline, so a gauge up a
 * harbor or inlet lies a few kilometres outside them.
 */
export const MARITIME_ZONE_MAX_KM = 10;

type Ring = [number, number][];
type Box = [number, number, number, number];

export interface MaritimeZones {
  /** ISO 3166-1 alpha-2 code of the zone at a position, if one is known. */
  country(lat: number, lon: number): string | undefined;
}

/** Load the reviewed Marine Regions EEZ snapshot. */
export async function loadMaritimeZones(): Promise<MaritimeZones> {
  const collection = JSON.parse(await readFile(MARITIME_ZONES_URL, "utf8")) as {
    coverage: Box[];
    features: {
      properties: { country: string };
      geometry: { coordinates: Ring[][] };
    }[];
  };
  return maritimeZones(
    collection.coverage,
    collection.features.map(({ properties, geometry }) => ({
      country: properties.country,
      polygons: geometry.coordinates,
    })),
  );
}

export function maritimeZones(
  coverage: Box[],
  zones: { country: string; polygons: Ring[][] }[],
): MaritimeZones {
  return {
    country(lat, lon) {
      if (
        !coverage.some(
          ([minLon, minLat, maxLon, maxLat]) =>
            lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat,
        )
      )
        return undefined;
      let nearest: { country: string; distance: number } | undefined;
      for (const { country, polygons } of zones)
        for (const rings of polygons) {
          const inside =
            rings.filter((ring) => pointInPolygon(lon, lat, ring)).length % 2;
          if (inside) return country;
          const distance = distanceToRing(lon, lat, rings[0]!) * KM_PER_DEGREE;
          if (
            distance <= MARITIME_ZONE_MAX_KM &&
            (!nearest || distance < nearest.distance)
          )
            nearest = { country, distance };
        }
      return nearest?.country;
    },
  };
}
