/**
 * Sea-basin classification for tide stations.
 *
 * The only basin we need to distinguish for chart-datum purposes is the
 * Baltic/Kattegat MSL region: the Baltic's riparian states chart to a
 * mean-sea-level datum (BSCD2000) rather than a low-water datum, and Denmark
 * charts all inner Danish waters — the whole Kattegat included — to DVR90 ≈
 * MSL. The LAT regime starts in the Skagerrak/North Sea. This splits Germany's
 * North Sea coast (Seekartennull ≈ LAT) from its Baltic coast (MSL), and
 * Denmark's North Sea coast from its inner waters, which neither administrative
 * region nor a longitude line can do.
 *
 * Geometry: authoritative IHO Sea Areas (S-23) polygons from Marine Regions
 * (Flanders Marine Institute, CC-BY 4.0) — the Baltic Sea, Gulfs of Bothnia /
 * Finland / Riga, and the Kattegat; the Skagerrak is excluded. Outer rings
 * only (island gauges classify by basin) at ~1 km simplification; regenerate
 * with `npm run fetch-sea-regions -w packages/datums`.
 *
 * A small tolerance treats points within ~2 km of a basin boundary as inside:
 * harbor gauges sit exactly on the (simplified) coastline, and it also closes
 * any seam sliver where two basins abut (e.g. Kattegat/Baltic at Öresund).
 */
import { readFileSync } from "fs";
import { join } from "path";

const __dirname = new URL(".", import.meta.url).pathname;

type Ring = readonly (readonly [number, number])[];

const geo = JSON.parse(
  readFileSync(
    join(__dirname, "..", "..", "data", "baltic-sea.geo.json"),
    "utf-8",
  ),
) as { features: { geometry: { coordinates: Ring[] } }[] };

/**
 * The Limfjord is inner Danish waters (charted to DVR90 ≈ MSL) but is not an
 * S-23 sea area, so the IHO polygons miss it. Coarse box over central/eastern
 * Limfjord (Struer/Nykøbing Mors/Løgstør/Aalborg/Hals); the far-western
 * North-Sea entrance (Thyborøn, Lemvig) stays LAT.
 */
// Box edges stay clear of the North Sea coast (Thyborøn/Lemvig west of 8.55,
// Hanstholm north of 57.08); the east edge overlaps the Kattegat harmlessly.
const LIMFJORD_RING: Ring = [
  [8.55, 56.45],
  [10.45, 56.45],
  [10.45, 57.08],
  [8.55, 57.08],
];

const MSL_REGION_RINGS: Ring[] = [
  ...geo.features.map((f) => f.geometry.coordinates[0]!),
  LIMFJORD_RING,
];

/** ~2 km at these latitudes. */
const NEAR_DEG = 0.02;

/**
 * Ray-casting point-in-polygon test. `ring` is a list of [lon, lat] vertices
 * (open or closed; the closing edge is implied). Longitude/latitude are treated
 * as planar x/y, which is fine at this scale for a basin mask.
 */
export function pointInPolygon(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    const intersects =
      yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Minimum distance (degrees, lon scaled by cos lat) from a point to the ring. */
export function distanceToRing(lon: number, lat: number, ring: Ring): number {
  const kx = Math.cos((lat * Math.PI) / 180);
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    const dx = (xj - xi) * kx;
    const dy = yj - yi;
    const px = (lon - xi) * kx;
    const py = lat - yi;
    const lenSq = dx * dx + dy * dy;
    const t =
      lenSq === 0 ? 0 : Math.max(0, Math.min(1, (px * dx + py * dy) / lenSq));
    best = Math.min(best, Math.hypot(px - t * dx, py - t * dy));
  }
  return best;
}

/** True when the coordinate falls within (or hugs the shore of) the Baltic/Kattegat MSL region. */
export function isBaltic(lat: number, lon: number): boolean {
  return MSL_REGION_RINGS.some(
    (ring) =>
      pointInPolygon(lon, lat, ring) ||
      distanceToRing(lon, lat, ring) < NEAR_DEG,
  );
}

/** Iterative Douglas–Peucker; keeps ring closed. */
export function simplify(
  ring: [number, number][],
  tolerance: number,
): [number, number][] {
  const keep = new Uint8Array(ring.length);
  keep[0] = keep[ring.length - 1] = 1;
  const stack: [number, number][] = [[0, ring.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    const [x1, y1] = ring[first]!;
    const [x2, y2] = ring[last]!;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    let maxDist = 0;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const [x, y] = ring[i]!;
      const dist =
        len === 0
          ? Math.hypot(x - x1, y - y1)
          : Math.abs(dy * x - dx * y + x2 * y1 - y2 * x1) / len;
      if (dist > maxDist) {
        maxDist = dist;
        index = i;
      }
    }
    if (maxDist > tolerance) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return ring.filter((_, i) => keep[i]);
}
