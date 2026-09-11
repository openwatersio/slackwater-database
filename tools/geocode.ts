import { readFile } from "node:fs/promises";
import KDBush from "kdbush";
import { around, distance } from "geokdbush";
import countryLookup from "country-code-lookup";

const PLACES_URL = new URL("../metadata/places.json", import.meta.url);

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
  distance: number;
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

/** Load the reviewed GeoNames snapshot and build its spatial index. */
export async function loadGeocoder(): Promise<Geocoder> {
  const places = JSON.parse(await readFile(PLACES_URL, "utf8")) as Place[];
  const index = new KDBush(places.length);
  for (const place of places) index.add(place.longitude, place.latitude);
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
      const country = countryLookup.byIso(place.countryCode);
      return {
        place,
        distance: distance(lon, lat, place.longitude, place.latitude),
        country: country?.country,
        continent: country?.continent,
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

function regionFromPlace(place: Place): string | undefined {
  if (place.countryCode === "US" && /^[A-Z]{2}$/.test(place.admin1Code))
    return place.admin1Code;
  return place.admin1 && place.admin1 !== place.admin1Code
    ? place.admin1
    : undefined;
}
