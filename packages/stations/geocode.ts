import { readFile, mkdir, access } from "fs/promises";
import { execFileSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import createFetch from "make-fetch-happen";
import { pipeline } from "stream/promises";
import { createWriteStream } from "fs";
import KDBush from "kdbush";
import { around, distance } from "geokdbush";
import countryLookup from "country-code-lookup";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GEONAMES_DIR = join(__dirname, "..", "..", "tmp", "geonames");
const CITIES_URL = "https://download.geonames.org/export/dump/cities500.zip";
const ADMIN1_URL =
  "https://download.geonames.org/export/dump/admin1CodesASCII.txt";

const fetch = createFetch.defaults({
  cachePath: "node_modules/.cache",
  retry: 5,
});

export interface Place {
  name: string;
  admin1: string;
  admin1Code: string;
  countryCode: string;
  latitude: number;
  longitude: number;
  population: number;
}

export interface GeocodeResult {
  place: Place;
  distance: number; // km
  country?: string | undefined;
  continent?: string | undefined;
  region?: string | undefined;
}

export interface Geocoder {
  nearest(lat: number, lon: number, maxDistance?: number): GeocodeResult | null;
  near(
    lat: number,
    lon: number,
    maxResults?: number,
    maxDistance?: number,
  ): GeocodeResult[];
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Download GeoNames data files to tmp/geonames/ if not already present.
 */
async function downloadData(): Promise<void> {
  await mkdir(GEONAMES_DIR, { recursive: true });

  const citiesPath = join(GEONAMES_DIR, "cities500.txt");
  const admin1Path = join(GEONAMES_DIR, "admin1CodesASCII.txt");

  if (!(await fileExists(citiesPath))) {
    console.log("Downloading cities500.zip...");
    const zipPath = join(GEONAMES_DIR, "cities500.zip");
    const res = await fetch(CITIES_URL);
    if (!res.ok || !res.body)
      throw new Error(`Failed to download cities500.zip: ${res.status}`);
    await pipeline(res.body, createWriteStream(zipPath));
    console.log("Extracting cities500.txt...");
    execFileSync("unzip", ["-o", zipPath, "cities500.txt", "-d", GEONAMES_DIR]);
  }

  if (!(await fileExists(admin1Path))) {
    console.log("Downloading admin1CodesASCII.txt...");
    const res = await fetch(ADMIN1_URL);
    if (!res.ok || !res.body)
      throw new Error(`Failed to download admin1CodesASCII.txt: ${res.status}`);
    await pipeline(res.body, createWriteStream(admin1Path));
  }
}

/**
 * Load admin1 code → name mapping from admin1CodesASCII.txt.
 * Format: "CC.code\tname\tasciiname\tgeonameId"
 */
async function loadAdmin1Codes(): Promise<Map<string, string>> {
  const path = join(GEONAMES_DIR, "admin1CodesASCII.txt");
  const content = await readFile(path, "utf-8");
  const map = new Map<string, string>();

  for (const line of content.trim().split("\n")) {
    const [code, , asciiname] = line.split("\t");
    if (code && asciiname) {
      map.set(code, asciiname);
    }
  }

  return map;
}

// GeoNames cities500.txt column indices (TSV, 0-indexed)
const COL = {
  NAME: 1,
  ASCIINAME: 2,
  LAT: 4,
  LON: 5,
  COUNTRY_CODE: 8,
  ADMIN1_CODE: 10,
  POPULATION: 14,
} as const;

/**
 * Load GeoNames cities500.txt into memory and build a KDBush spatial index.
 * Downloads data files automatically if not already present.
 */
export async function loadGeocoder(): Promise<Geocoder> {
  await downloadData();

  const citiesPath = join(GEONAMES_DIR, "cities500.txt");
  const admin1Map = await loadAdmin1Codes();
  const content = await readFile(citiesPath, "utf-8");
  const lines = content.trim().split("\n");

  const places: Place[] = [];

  for (const line of lines) {
    const cols = line.split("\t");
    const countryCode = cols[COL.COUNTRY_CODE]!;
    const admin1Code = cols[COL.ADMIN1_CODE]!;
    const admin1Key = `${countryCode}.${admin1Code}`;

    places.push({
      name: cols[COL.ASCIINAME]!,
      admin1: admin1Map.get(admin1Key) ?? admin1Code,
      admin1Code,
      countryCode,
      latitude: parseFloat(cols[COL.LAT]!),
      longitude: parseFloat(cols[COL.LON]!),
      population: parseInt(cols[COL.POPULATION]!, 10) || 0,
    });
  }

  // Build KDBush spatial index
  const index = new KDBush(places.length);
  for (const place of places) {
    index.add(place.longitude, place.latitude);
  }
  index.finish();

  console.log(`Loaded ${places.length} places into geocoder`);

  function near(
    lat: number,
    lon: number,
    maxResults = 5,
    maxDistance = 100,
  ): GeocodeResult[] {
    const ids = around(index, lon, lat, maxResults, maxDistance) as number[];
    return ids.map((id) => {
      const place = places[id];
      if (!place) throw new Error(`Invalid place index: ${id}`);
      return {
        place,
        distance: distance(lon, lat, place.longitude, place.latitude),
        country: countryFromPlace(place),
        continent: continentFromPlace(place),
        region: regionFromPlace(place),
      };
    });
  }

  return {
    nearest(lat: number, lon: number, maxDistance = 100): GeocodeResult | null {
      return near(lat, lon, 1, maxDistance)[0] ?? null;
    },
    near,
  };
}

/**
 * Derive region from a geocode result.
 * US/Canada: 2-letter admin1 code (e.g., "CA", "BC"). Other countries: full admin1 name.
 */
function regionFromPlace(place: Place): string | undefined {
  // US/CA admin1 codes are the familiar 2-letter abbreviations (CA, NY, BC, ON)
  // which match what NOAA and TICON data sources use
  if (place.countryCode === "US" || place.countryCode === "CA") {
    return place.admin1Code || undefined;
  }
  // Other countries: use the full admin1 name (e.g., "Brittany", "Queensland")
  // since admin1Code is often a numeric/opaque code
  if (place.admin1 && place.admin1 !== place.admin1Code) {
    return place.admin1;
  }
  return undefined;
}

/**
 * Derive country name from a geocode result's country code.
 */
function countryFromPlace(place: Place): string | undefined {
  const info = countryLookup.byIso(place.countryCode);
  return info?.country;
}

/**
 * Derive continent from a geocode result's country code.
 */
function continentFromPlace(place: Place): string | undefined {
  const info = countryLookup.byIso(place.countryCode);
  return info?.continent;
}
