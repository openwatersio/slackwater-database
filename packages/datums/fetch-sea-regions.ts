/**
 * Regenerate data/baltic-sea.geo.json from the authoritative Marine Regions
 * IHO Sea Areas (S-23) polygons served by VLIZ's public WFS.
 *
 * The MSL chart-datum region is the union of the Baltic Sea and its adjoining
 * basins through the Kattegat (all charted to BSCD2000 / DVR90 ≈ MSL); the
 * Skagerrak is deliberately excluded — the LAT regime starts there.
 *
 * Processing: keep each basin's OUTER ring only — island holes are dropped so
 * gauges on islands (Åland, the archipelagos) still classify by basin — then
 * Douglas–Peucker simplify to ~1 km, which is plenty for a basin mask whose
 * consumers are coastal tide gauges.
 *
 * Run manually when Marine Regions publishes a new IHO version:
 *   npm run fetch-sea-regions -w @neaps/datums
 */
import { writeFile } from "fs/promises";
import { join } from "path";

const __dirname = new URL(".", import.meta.url).pathname;
const OUT = join(__dirname, "..", "..", "data", "baltic-sea.geo.json");

/** Marine Regions gazetteer IDs (MRGIDs) of the IHO basins in the MSL region. */
const BASINS = [2401, 2402, 2407, 2409, 2374]; // Baltic, Bothnia, Finland, Riga, Kattegat

const WFS =
  "https://geo.vliz.be/geoserver/MarineRegions/wfs?service=WFS&version=1.1.0" +
  "&request=GetFeature&typeName=MarineRegions:iho&outputFormat=application/json" +
  `&cql_filter=mrgid IN (${BASINS.join(",")})`;

/** Simplification tolerance in degrees (~1 km). */
const TOLERANCE = 0.01;

type Ring = [number, number][];

/** Iterative Douglas–Peucker; keeps ring closed. */
function simplify(ring: Ring, tolerance: number): Ring {
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

async function main() {
  const res = await fetch(WFS);
  if (!res.ok) throw new Error(`WFS request failed: ${res.status}`);
  const raw = (await res.json()) as {
    features: {
      properties: { name: string; mrgid: number };
      geometry: { type: string; coordinates: number[][][] | number[][][][] };
    }[];
  };
  if (raw.features.length !== BASINS.length) {
    throw new Error(
      `Expected ${BASINS.length} basins, got ${raw.features.length}`,
    );
  }

  const features = raw.features.map((f) => {
    const polys = (
      f.geometry.type === "MultiPolygon"
        ? f.geometry.coordinates
        : [f.geometry.coordinates]
    ) as Ring[][];
    // One polygon per basin in the source; outer ring is first, holes dropped.
    const outer = simplify(polys[0]![0]!, TOLERANCE).map(
      ([lon, lat]) => [Number(lon.toFixed(4)), Number(lat.toFixed(4))] as const,
    );
    console.log(
      `${f.properties.name} (${f.properties.mrgid}): ${polys[0]![0]!.length} → ${outer.length} vertices`,
    );
    return {
      type: "Feature",
      properties: { name: f.properties.name, mrgid: f.properties.mrgid },
      geometry: { type: "Polygon", coordinates: [outer] },
    };
  });

  const collection = {
    type: "FeatureCollection",
    // Foreign members: provenance for the committed file.
    source:
      "Flanders Marine Institute: IHO Sea Areas v3 (marineregions.org), via geo.vliz.be WFS",
    license: "CC-BY 4.0 — https://creativecommons.org/licenses/by/4.0/",
    generated_by:
      "packages/datums/fetch-sea-regions.ts (outer rings only, simplified ~1km)",
    features,
  };

  await writeFile(OUT, JSON.stringify(collection) + "\n");
  console.log(`Wrote ${OUT}`);
}

main();
