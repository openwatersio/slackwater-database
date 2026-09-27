/**
 * Regenerate metadata/places.json: the GeoNames cities500 places the catalogue
 * derives locality, region and a fallback context from, taking the
 * PLACES_PER_STATION nearest places and nearest non-section places within
 * PLACES_MAX_KM of every catalogue station.
 *
 * Names are GeoNames' own, accents included ("Mayagüez", "Hale‘iwa"). A section
 * of a city (feature code PPLX: "Chinatown", "South Boston") carries
 * `section: true`: it still places a station for locality and region, but is
 * never its label, since GeoNames gives some sections the whole city's
 * population.
 *
 * Run manually, review the metadata diff, and record the printed checksums in
 * metadata/PROVENANCE.md:
 *   npm run fetch-places -w packages/stations
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import KDBush from "kdbush";
import { around } from "geokdbush";
import type { Place } from "./geocode.ts";
import { stationPositions } from "./load-catalogue.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(root, "metadata", "places.json");
const CACHE = join(root, "tmp", "geonames");
const GEONAMES = "https://download.geonames.org/export/dump";
const PLACES_PER_STATION = 10;
const PLACES_MAX_KM = 100;

async function download(file: string): Promise<string> {
  const path = join(CACHE, file);
  if (!existsSync(path)) {
    const response = await fetch(`${GEONAMES}/${file}`);
    if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
    mkdirSync(CACHE, { recursive: true });
    writeFileSync(path, Buffer.from(await response.arrayBuffer()));
  }
  const sha = createHash("sha256").update(readFileSync(path)).digest("hex");
  console.log(`${file} sha256 ${sha}`);
  return path;
}

const byCodepoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

async function main() {
  // Columns: code ("US.WA"), name, ASCII name, geonameid.
  const admin1 = new Map(
    readFileSync(await download("admin1CodesASCII.txt"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split("\t") as [string, string]),
  );
  // cities500.txt is the GeoNames main table: name at 1, feature code at 7,
  // country at 8, admin1 at 10, population at 14.
  const places: Place[] = execFileSync(
    "unzip",
    ["-p", await download("cities500.zip"), "cities500.txt"],
    { maxBuffer: 1 << 28 },
  )
    .toString("utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\t"))
    .map((c) => ({
      name: c[1]!,
      admin1: admin1.get(`${c[8]}.${c[10]}`) ?? c[10]!,
      admin1Code: c[10]!,
      countryCode: c[8]!,
      latitude: Number(c[4]),
      longitude: Number(c[5]),
      population: Number(c[14]) || 0,
      ...(c[7] === "PPLX" && { section: true }),
    }));

  const index = new KDBush(places.length);
  for (const place of places) index.add(place.longitude, place.latitude);
  index.finish();

  const positions = stationPositions(root);
  const kept = new Set<number>();
  const town = (id: number) => !places[id]!.section;
  for (const [lat, lon] of positions)
    // Nearest overall for locality and region; nearest towns too, so a dense
    // city's sections cannot crowd the city itself out of the label candidates.
    for (const id of [
      ...around(index, lon, lat, PLACES_PER_STATION, PLACES_MAX_KM),
      ...around(index, lon, lat, PLACES_PER_STATION, PLACES_MAX_KM, town),
    ] as number[])
      kept.add(id);

  const out = [...kept]
    .map((id) => places[id]!)
    .sort(
      (a, b) =>
        byCodepoint(a.countryCode, b.countryCode) ||
        byCodepoint(a.name, b.name) ||
        a.latitude - b.latitude ||
        a.longitude - b.longitude,
    );
  writeFileSync(OUT, JSON.stringify(out) + "\n");
  console.log(
    `${positions.length} station positions; wrote ${out.length} places to ${OUT}`,
  );
}

main();
