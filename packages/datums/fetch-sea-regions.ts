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
 *   npm run fetch-sea-regions -w packages/datums
 */
import { writeFile } from "fs/promises";
import { join } from "path";
import { simplify } from "./sea-regions.ts";

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
