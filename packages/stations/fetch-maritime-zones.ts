/**
 * Regenerate metadata/maritime-zones.geojson from the Marine Regions Maritime
 * Boundaries (EEZ) polygons served by VLIZ's public WFS.
 *
 * Only registry stations need it: every provider file states its own country,
 * and a registry record that does not falls back to the nearest gazetteer
 * place, which can sit across a strait in the wrong country. The snapshot
 * covers the half-degree cells within half a degree of each registry position
 * and records them as `coverage`. Each zone is clipped to those cells and
 * Douglas–Peucker simplified to ~100 m. Joint regimes and overlapping claims
 * are left out, so a station there keeps the gazetteer fallback.
 *
 * Run manually when the registry gains a station outside the coverage:
 *   npm run fetch-maritime-zones -w packages/stations
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import countryLookup from "country-code-lookup";
import { simplify } from "@slackwater/datums";
import { loadRegistry } from "./metadata.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(root, "metadata", "maritime-zones.geojson");
const CACHE = join(root, "tmp", "maritime-zones");
const WFS =
  "https://geo.vliz.be/geoserver/MarineRegions/wfs?service=WFS&version=1.0.0" +
  "&request=GetFeature&typeName=MarineRegions:eez&outputFormat=application/json";
const CELL = 0.5;
/** Simplification tolerance in degrees (~100 m). */
const TOLERANCE = 0.001;

type Ring = [number, number][];
type Box = [number, number, number, number];
interface Zone {
  properties: {
    mrgid: number;
    geoname: string;
    pol_type: string;
    iso_ter1: string | null;
    iso_ter2: string | null;
    iso_sov1: string | null;
  };
  geometry: { type: string; coordinates: Ring[][] | Ring[][][] };
}

async function wfs(query: string, cacheKey: string): Promise<Zone[]> {
  const cached = join(CACHE, `${cacheKey}.json`);
  if (!existsSync(cached)) {
    const response = await fetch(`${WFS}&${query}`);
    if (!response.ok) throw new Error(`WFS request failed: ${response.status}`);
    mkdirSync(CACHE, { recursive: true });
    writeFileSync(cached, await response.text());
  }
  return JSON.parse(readFileSync(cached, "utf8")).features;
}

/** Sutherland–Hodgman clip of a ring to an axis-aligned box. */
function clip(ring: Ring, [minLon, minLat, maxLon, maxLat]: Box): Ring {
  const edges: [(p: [number, number]) => boolean, number, 0 | 1][] = [
    [([x]) => x >= minLon, minLon, 0],
    [([x]) => x <= maxLon, maxLon, 0],
    [([, y]) => y >= minLat, minLat, 1],
    [([, y]) => y <= maxLat, maxLat, 1],
  ];
  let output = ring;
  for (const [inside, value, axis] of edges) {
    const input = output;
    output = [];
    for (let i = 0; i < input.length; i++) {
      const current = input[i]!;
      const previous = input[(i + input.length - 1) % input.length]!;
      const crossing = (): [number, number] => {
        const t = (value - previous[axis]) / (current[axis] - previous[axis]);
        return axis === 0
          ? [value, previous[1] + t * (current[1] - previous[1])]
          : [previous[0] + t * (current[0] - previous[0]), value];
      };
      if (inside(current)) {
        if (!inside(previous)) output.push(crossing());
        output.push(current);
      } else if (inside(previous)) output.push(crossing());
    }
    if (!output.length) return [];
  }
  output.push(output[0]!);
  return output;
}

async function main() {
  const registry = loadRegistry(
    readFileSync(join(root, "metadata", "registry.yaml"), "utf8"),
  );
  const cells = new Map<string, Box>();
  for (const { position } of registry.values()) {
    if (!position) continue;
    const [lat, lon] = position;
    for (let y = Math.floor((lat - CELL) / CELL); y * CELL < lat + CELL; y++)
      for (let x = Math.floor((lon - CELL) / CELL); x * CELL < lon + CELL; x++)
        cells.set(`${x},${y}`, [
          x * CELL,
          y * CELL,
          (x + 1) * CELL,
          (y + 1) * CELL,
        ]);
  }
  const boxes = [...cells.values()].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  console.log(`${boxes.length} cells around ${registry.size} registry records`);

  const mrgids = new Set<number>();
  for (const [minLon, minLat, maxLon, maxLat] of boxes) {
    const polygon = `POLYGON((${minLon} ${minLat},${maxLon} ${minLat},${maxLon} ${maxLat},${minLon} ${maxLat},${minLon} ${minLat}))`;
    const zones = await wfs(
      `propertyName=mrgid&cql_filter=${encodeURIComponent(`INTERSECTS(the_geom,${polygon})`)}`,
      `cell-${minLon}-${minLat}`,
    );
    for (const zone of zones) mrgids.add(zone.properties.mrgid);
  }

  const features = [];
  for (const mrgid of [...mrgids].sort((a, b) => a - b)) {
    const [zone] = await wfs(`cql_filter=mrgid=${mrgid}`, `zone-${mrgid}`);
    if (!zone) throw new Error(`Marine Regions has no zone ${mrgid}`);
    const { geoname, pol_type, iso_ter1, iso_ter2, iso_sov1 } = zone.properties;
    // Alaska and Hawaii carry only their sovereign's code.
    const iso3 = iso_ter1 ?? iso_sov1;
    const country = iso3 ? countryLookup.byIso(iso3)?.iso2 : undefined;
    if (pol_type !== "200NM" || iso_ter2 || !country) {
      console.log(`Skipping ${geoname} (${pol_type})`);
      continue;
    }
    const polygons = (
      zone.geometry.type === "MultiPolygon"
        ? zone.geometry.coordinates
        : [zone.geometry.coordinates]
    ) as Ring[][];
    const coordinates = boxes.flatMap((box) =>
      polygons
        .map((rings) =>
          rings
            .map((ring) => clip(ring, box))
            .filter((ring) => ring.length >= 4)
            .map((ring) =>
              simplify(ring, TOLERANCE).map(([lon, lat]): [number, number] => [
                Number(lon.toFixed(4)),
                Number(lat.toFixed(4)),
              ]),
            )
            .filter((ring) => ring.length >= 4),
        )
        .filter((rings) => rings.length),
    );
    console.log(`${geoname}: ${coordinates.length} clipped polygons`);
    features.push({
      type: "Feature",
      properties: { country, name: geoname, mrgid },
      geometry: { type: "MultiPolygon", coordinates },
    });
  }

  const collection = {
    type: "FeatureCollection",
    // Foreign members: provenance for the committed file.
    source:
      "Flanders Marine Institute: Maritime Boundaries Geodatabase, Exclusive Economic Zones (marineregions.org), via geo.vliz.be WFS",
    license: "CC-BY 4.0 — https://creativecommons.org/licenses/by/4.0/",
    generated_by:
      "packages/stations/fetch-maritime-zones.ts (clipped to coverage cells, simplified ~100m)",
    coverage: boxes,
    features,
  };
  writeFileSync(OUT, JSON.stringify(collection) + "\n");
  console.log(`Wrote ${OUT}`);
}

main();
