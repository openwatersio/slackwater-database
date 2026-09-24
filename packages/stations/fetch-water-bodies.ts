/**
 * Regenerate metadata/water-bodies.geojson: the named OpenStreetMap bays and
 * straits (`natural=bay`, `natural=strait`) that contain a catalogue station
 * or pass within WATER_BODY_MAX_KM of one.
 *
 * Station positions come straight from the provider files, the current bundle,
 * the registry, and corrected positions, so this runs before the catalogue can
 * resolve. Overpass lists the bounds of every named bay and strait; those whose
 * bounds reach a station are downloaded with geometry and kept when a station
 * lies inside or near them. Seas larger than WATER_BODY_MAX_KM2 are left out.
 * Relations keep their outer rings only, so a gauge on an island still
 * classifies by the water around it. Rings are Douglas–Peucker simplified in
 * proportion to their size.
 *
 * Run manually when the catalogue gains stations in new water, then review the
 * context diff before committing:
 *   npm run fetch-water-bodies -w packages/stations
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { simplify } from "@slackwater/datums";
import KDBush from "kdbush";
import {
  areaKm2,
  WATER_BODY_MAX_KM,
  WATER_BODY_MAX_KM2,
  waterBodies,
  waterBodyName,
} from "./water-bodies.ts";
import { stationPositions } from "./load-catalogue.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(root, "metadata", "water-bodies.geojson");
const CACHE = join(root, "tmp", "water-bodies");
const OVERPASS = "https://overpass-api.de/api/interpreter";
const USER_AGENT =
  "tide-database (https://github.com/openwatersio/slackwater-database)";
// Either name tag qualifies: waterBodyName prefers name:en, and a handful of
// features carry that one alone.
const FILTER = '[natural~"^(bay|strait)$"][~"^name(:en)?$"~"."]';

type Ring = [number, number][];
interface OverpassElement {
  type: "way" | "relation" | "area";
  id: number;
  tags?: Record<string, string>;
  bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number };
  geometry?: { lat: number; lon: number }[];
  members?: {
    type: string;
    role: string;
    geometry?: { lat: number; lon: number }[];
  }[];
}

async function overpass(query: string, cacheKey: string, attempts = 5) {
  const cached = join(CACHE, `${cacheKey}.json`);
  if (existsSync(cached))
    return JSON.parse(readFileSync(cached, "utf8")) as {
      elements: OverpassElement[];
    };
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(OVERPASS, {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ data: query }),
    });
    // A busy server answers 200 with an XML error document, so cache the
    // response only once it parses as the JSON the query asked for.
    const text = response.ok ? await response.text() : "";
    if (text.startsWith("{")) {
      mkdirSync(CACHE, { recursive: true });
      writeFileSync(cached, text);
      return JSON.parse(text) as { elements: OverpassElement[] };
    }
    const status = response.ok ? "busy" : response.status;
    if (
      attempt >= attempts ||
      (!response.ok && ![429, 502, 503, 504].includes(response.status))
    )
      throw new Error(`Overpass request failed: ${status}`);
    console.log(`Overpass ${status}; retrying in ${attempt * 30}s`);
    await new Promise((resolve) => setTimeout(resolve, attempt * 30_000));
  }
}

/** Join a relation's outer member ways into closed rings. */
function outerRings(element: OverpassElement): Ring[] {
  const pieces: Ring[] = (element.members ?? [])
    .filter(
      ({ type, role, geometry }) =>
        type === "way" && (role === "outer" || role === "") && geometry,
    )
    .map(({ geometry }) => geometry!.map(({ lon, lat }) => [lon, lat]));
  const same = (a: [number, number], b: [number, number]) =>
    a[0] === b[0] && a[1] === b[1];
  const rings: Ring[] = [];
  while (pieces.length) {
    const ring = pieces.shift()!;
    let extended = true;
    while (!same(ring[0]!, ring.at(-1)!) && extended) {
      extended = false;
      for (let i = 0; i < pieces.length; i++) {
        const piece = pieces[i]!;
        if (same(ring.at(-1)!, piece[0]!)) ring.push(...piece.slice(1));
        else if (same(ring.at(-1)!, piece.at(-1)!))
          ring.push(...piece.reverse().slice(1));
        else continue;
        pieces.splice(i, 1);
        extended = true;
        break;
      }
    }
    if (same(ring[0]!, ring.at(-1)!) && ring.length >= 4) rings.push(ring);
  }
  return rings;
}

function rings(element: OverpassElement): Ring[] {
  if (element.type === "relation") return outerRings(element);
  const ring: Ring = (element.geometry ?? []).map(({ lon, lat }) => [lon, lat]);
  const closed =
    ring.length >= 4 &&
    ring[0]![0] === ring.at(-1)![0] &&
    ring[0]![1] === ring.at(-1)![1];
  return closed ? [ring] : [];
}

/** [minLon, minLat, maxLon, maxLat] of some rings. */
function bounds(rings: Ring[]): [number, number, number, number] {
  const box: [number, number, number, number] = [
    Infinity,
    Infinity,
    -Infinity,
    -Infinity,
  ];
  for (const ring of rings)
    for (const [lon, lat] of ring) {
      box[0] = Math.min(box[0], lon);
      box[1] = Math.min(box[1], lat);
      box[2] = Math.max(box[2], lon);
      box[3] = Math.max(box[3], lat);
    }
  return box;
}

/** Simplify to 1/1000 of the ring's extent, between ~10 m and ~1 km. */
function simplified(ring: Ring): Ring {
  const [minLon, minLat, maxLon, maxLat] = bounds([ring]);
  const extent = Math.max(maxLon - minLon, maxLat - minLat);
  const tolerance = Math.min(0.01, Math.max(0.0001, extent / 1000));
  return simplify(ring, tolerance).map(([lon, lat]) => [
    Number(lon.toFixed(5)),
    Number(lat.toFixed(5)),
  ]);
}

async function main() {
  const positions = stationPositions(root);
  const index = new KDBush(positions.length);
  for (const [lat, lon] of positions) index.add(lon, lat);
  index.finish();
  console.log(`${positions.length} station positions`);

  // Every named bay and strait with its bounds, then only those whose bounds
  // reach a station are downloaded with geometry.
  const { elements: bounded } = await overpass(
    `[out:json][timeout:900];(way${FILTER};relation${FILTER};);out ids bb;`,
    "bounds",
  );
  const pad = WATER_BODY_MAX_KM / 111;
  const candidates = { way: [] as number[], relation: [] as number[] };
  for (const { type, id, bounds } of bounded) {
    if (!bounds || (type !== "way" && type !== "relation")) continue;
    const padLon =
      pad / Math.max(Math.cos((bounds.minlat * Math.PI) / 180), 0.01);
    if (
      index.range(
        bounds.minlon - padLon,
        bounds.minlat - pad,
        bounds.maxlon + padLon,
        bounds.maxlat + pad,
      ).length
    )
      candidates[type].push(id);
  }
  console.log(
    `${bounded.length} named bays and straits; ${candidates.way.length} ways and ${candidates.relation.length} relations reach a station`,
  );

  // A chunk holding a very large relation can time out, so a failing chunk is
  // split in half until each piece succeeds.
  async function geometry(
    type: "way" | "relation",
    ids: number[],
  ): Promise<OverpassElement[]> {
    try {
      const result = await overpass(
        `[out:json][timeout:900];${type}(id:${ids.join(",")});out geom;`,
        `geom-${type}-${ids[0]}-${ids.length}`,
        ids.length > 1 ? 2 : 5,
      );
      return result.elements;
    } catch (error) {
      if (ids.length === 1) throw error;
      const middle = Math.ceil(ids.length / 2);
      return [
        ...(await geometry(type, ids.slice(0, middle))),
        ...(await geometry(type, ids.slice(middle))),
      ];
    }
  }

  const elements: OverpassElement[] = [];
  for (const type of ["way", "relation"] as const) {
    const list = candidates[type].sort((a, b) => a - b);
    for (let start = 0; start < list.length; start += 50) {
      elements.push(...(await geometry(type, list.slice(start, start + 50))));
      console.log(
        `${type}: ${Math.min(start + 50, list.length)}/${list.length}`,
      );
    }
  }

  const reachesStation = (outer: Ring[]) => {
    const body = waterBodies([{ name: "", rings: outer }]);
    const [minLon, minLat, maxLon, maxLat] = bounds(outer);
    const padLon = pad / Math.max(Math.cos((minLat * Math.PI) / 180), 0.01);
    return index
      .range(minLon - padLon, minLat - pad, maxLon + padLon, maxLat + pad)
      .some((id) => body.at(positions[id]![0], positions[id]![1]).length > 0);
  };

  const unique = new Map(
    elements.map((element) => [`${element.type}/${element.id}`, element]),
  );
  const features = [...unique.values()]
    .map((element) => {
      const name = waterBodyName(element.tags ?? {});
      const outer = rings(element);
      if (!name || !outer.length || areaKm2(outer) > WATER_BODY_MAX_KM2)
        return null;
      const simple = outer.map(simplified);
      if (!reachesStation(simple)) return null;
      return {
        type: "Feature",
        properties: {
          name,
          natural: element.tags!["natural"],
          osm: `${element.type}/${element.id}`,
        },
        geometry: {
          type: "MultiPolygon",
          coordinates: simple.map((ring) => [ring]),
        },
      };
    })
    .filter((feature) => feature !== null)
    .sort((a, b) =>
      a.properties.osm < b.properties.osm
        ? -1
        : a.properties.osm > b.properties.osm
          ? 1
          : 0,
    );

  const collection = {
    type: "FeatureCollection",
    // Foreign members: provenance for the committed file.
    source: "OpenStreetMap natural=bay and natural=strait, via Overpass API",
    license:
      "ODbL 1.0 — https://opendatacommons.org/licenses/odbl/1-0/ — © OpenStreetMap contributors",
    generated_by:
      "packages/stations/fetch-water-bodies.ts (outer rings only, simplified)",
    features,
  };
  writeFileSync(OUT, JSON.stringify(collection) + "\n");
  console.log(`Wrote ${features.length} water bodies to ${OUT}`);
}

main();
