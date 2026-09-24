import { readFile } from "node:fs/promises";
import { distanceToRing, pointInPolygon } from "@slackwater/datums";

const WATER_BODIES_URL = new URL(
  "../../metadata/water-bodies.geojson",
  import.meta.url,
);
const KM_PER_DEGREE = 111.195;

/**
 * How far outside a bay or strait a station may sit and still take its name.
 * Gauges stand on piers and wharves at the shore, where the mapped polygon
 * usually ends at the coastline a few hundred metres away.
 */
export const WATER_BODY_MAX_KM = 1;

/**
 * The largest bay or strait that names a station. Beyond this a water body is
 * a sea, such as the Gulf of Maine or the Bay of Biscay, and says less about
 * where the station is than the nearest place does.
 */
export const WATER_BODY_MAX_KM2 = 20_000;

type Ring = [number, number][];

export interface WaterBody {
  name: string;
  /** 0 when the station is inside the polygon. */
  distance: number;
}

export interface WaterBodies {
  /**
   * Water bodies at a position: those containing it, smallest first, then
   * those within `maxDistance` km, nearest first.
   */
  at(lat: number, lon: number, maxDistance?: number): WaterBody[];
}

interface Indexed {
  name: string;
  rings: Ring[];
  bbox: [number, number, number, number];
  area: number;
}

/** Load the reviewed OpenStreetMap bay and strait snapshot. */
export async function loadWaterBodies(): Promise<WaterBodies> {
  const collection = JSON.parse(await readFile(WATER_BODIES_URL, "utf8")) as {
    features: {
      properties: { name: string };
      geometry: { coordinates: Ring[][] };
    }[];
  };
  return waterBodies(
    collection.features.map(({ properties, geometry }) => ({
      name: properties.name,
      rings: geometry.coordinates.map(([outer]) => outer!),
    })),
  );
}

export function waterBodies(
  features: { name: string; rings: Ring[] }[],
): WaterBodies {
  const indexed: Indexed[] = features.map(({ name, rings }) => {
    const bbox: Indexed["bbox"] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const ring of rings)
      for (const [lon, lat] of ring) {
        bbox[0] = Math.min(bbox[0], lon);
        bbox[1] = Math.min(bbox[1], lat);
        bbox[2] = Math.max(bbox[2], lon);
        bbox[3] = Math.max(bbox[3], lat);
      }
    return { name, rings, bbox, area: areaKm2(rings) };
  });

  return {
    at(lat, lon, maxDistance = WATER_BODY_MAX_KM) {
      const padLat = maxDistance / KM_PER_DEGREE;
      const padLon = padLat / Math.max(Math.cos((lat * Math.PI) / 180), 0.01);
      const inside: (WaterBody & { area: number })[] = [];
      const near: WaterBody[] = [];
      for (const feature of indexed) {
        const [minLon, minLat, maxLon, maxLat] = feature.bbox;
        if (
          lon < minLon - padLon ||
          lon > maxLon + padLon ||
          lat < minLat - padLat ||
          lat > maxLat + padLat
        )
          continue;
        if (feature.rings.some((ring) => pointInPolygon(lon, lat, ring))) {
          inside.push({ name: feature.name, distance: 0, area: feature.area });
          continue;
        }
        const distance =
          Math.min(
            ...feature.rings.map((ring) => distanceToRing(lon, lat, ring)),
          ) * KM_PER_DEGREE;
        if (distance <= maxDistance)
          near.push({ name: feature.name, distance });
      }
      return [
        ...inside
          .sort((a, b) => a.area - b.area)
          .map(({ name, distance }) => ({ name, distance })),
        ...near.sort((a, b) => a.distance - b.distance),
      ];
    },
  };
}

/**
 * The English name where OpenStreetMap records one, otherwise the name when it
 * is written in Latin script, matching the romanized GeoNames place names. A
 * list keeps its first value and a trailing parenthetical is dropped.
 */
export function waterBodyName(
  tags: Record<string, string>,
): string | undefined {
  const name = (tags["name:en"] ?? tags["name"])
    ?.split(";")[0]!
    .replace(/\s*\([^)]*\)$/, "")
    .trim();
  return name &&
    /^[\p{Lu}\p{N}][\p{Script=Latin}\p{N}\p{P}\p{Zs}]*$/u.test(name)
    ? name
    : undefined;
}

/** Approximate area of some outer rings in square kilometres. */
export function areaKm2(rings: Ring[]): number {
  let total = 0;
  for (const ring of rings) {
    let sum = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]!;
      const [xj, yj] = ring[j]!;
      sum += (xj - xi) * (yj + yi);
    }
    const lat = ring[0]![1];
    total += (Math.abs(sum) / 2) * Math.cos((lat * Math.PI) / 180);
  }
  return total * KM_PER_DEGREE ** 2;
}
