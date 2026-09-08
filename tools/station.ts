import type { StationData } from "@neaps/tide-database";
import { find as findTz } from "geo-tz/all";
import countryLookup from "country-code-lookup";
import { join, dirname } from "path";
import { mkdir, writeFile, readFile } from "fs/promises";
import sortObject from "sort-object-keys";
import { isBaltic } from "@tide-database/datums";

const __dirname = new URL(".", import.meta.url).pathname;
export const DATA_DIR = join(__dirname, "..", "data");

const sortOrder: (keyof StationData)[] = [
  "name",
  "region",
  "country",
  "continent",
  "latitude",
  "longitude",
  "timezone",
  "source",
  "license",
  "disclaimers",
  "datums",
  "datums_source",
  "chart_datum",
  "type",
  "harmonic_constituents",
  "offsets",
];

// Preferred chart datum by country. Names must match country-code-lookup output.
// Countries not listed default to LAT (the IHO international recommendation).
// Sources: IHO Resolution (LAT, or a closely-equivalent datum, as chart datum)
// and the IHO TWCWG "List of Vertical Datums used by IHO Member States to
// describe Chart Datum" (2021):
// https://iho.int/uploads/user/Services%20and%20Standards/TWCWG/MISC/TWCWG_Vertical_Datums_v1.0.pdf
const CHART_DATUMS: Record<string, string> = {
  // Mean Lower Low Water (US low-water convention and Pacific territories)
  "United States": "MLLW",
  "The Bahamas": "MLLW",
  Philippines: "MLLW",
  "Marshall Islands": "MLLW",
  Palau: "MLLW",
  "Federated States of Micronesia": "MLLW",
  // Lower Low Water, Large Tide (Canadian Hydrographic Service)
  Canada: "LLWLT",
  // Nearly / Approximate Lowest Low Water ≈ Indian Spring Low Water
  Japan: "NLLW",
  "South Korea": "ALLW",
  // Theoretical Lowest Tide (China's theoretical depth datum)
  China: "TLT",
  // Mean Low Water Springs (per the IHO TWCWG list)
  Brazil: "MLWS",
  Italy: "MLWS",
  Chile: "MLWS",
  // Baltic Sea Chart Datum ≈ mean sea level (non-tidal Baltic). Sweden is
  // whole-country BSCD2000 by national policy; other Baltic-basin stations
  // (incl. Denmark's inner waters/Kattegat and Germany's Baltic coast) are
  // handled by the isBaltic() override in getChartDatum().
  Sweden: "MSL",
};

// Datums that are specific to one country and shouldn't be persisted elsewhere.
// (MLWS/MHWS are standard tidal levels and kept for all stations.)
const COUNTRY_SPECIFIC_DATUMS: Record<string, string> = {
  LLWLT: "Canada",
  TLT: "China",
  NLLW: "Japan",
  ALLW: "South Korea",
};

/**
 * Drop country-specific datums (LLWLT/TLT/NLLW/ALLW) from stations that don't
 * use them as their chart datum, so a UK station never carries a stray TLT.
 */
export function pruneDatums(
  country: string,
  datums: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, value] of Object.entries(datums)) {
    const owner = COUNTRY_SPECIFIC_DATUMS[name];
    if (owner && owner !== country) continue;
    out[name] = value;
  }
  return out;
}

/**
 * Determine the chart datum for a station from its location and available
 * datums. Baltic-basin stations use MSL (≈ BSCD2000); otherwise the country's
 * preferred datum is used when present, falling back to LAT.
 */
export function getChartDatum(
  country: string,
  availableDatums: Record<string, number>,
  latitude?: number,
  longitude?: number,
): string {
  if (
    latitude !== undefined &&
    longitude !== undefined &&
    isBaltic(latitude, longitude) &&
    "MSL" in availableDatums
  ) {
    return "MSL";
  }
  const preferred = CHART_DATUMS[country];
  return preferred && preferred in availableDatums ? preferred : "LAT";
}

// `datums` is optional here because subordinate stations carry none (their
// committed JSON omits the key, despite StationData declaring it required).
type OptionalProperties = "timezone" | "continent" | "chart_datum" | "datums";
export type PartialStationData = Omit<StationData, OptionalProperties> &
  Partial<Pick<StationData, OptionalProperties>>;

export function normalize(station: PartialStationData): StationData {
  const { iso2, continent, country } =
    countryLookup.byCountry(station.country) ||
    countryLookup.byIso(station.country) ||
    {};

  if (!iso2 || !continent || !country) {
    throw new Error(
      `Unable to find country info for station: ${station.name} (${station.country})`,
    );
  }

  const timezone = findTz(station.latitude, station.longitude)[0];

  if (!timezone) {
    throw new Error(
      `Unable to find timezone for station: ${station.name} (${station.latitude}, ${station.longitude})`,
    );
  }

  // Subordinate stations carry no datums of their own; leave the key absent.
  const datums = station.datums && pruneDatums(country, station.datums);

  return sortObject(
    {
      ...station,
      timezone,
      continent,
      country,
      ...(datums ? { datums } : {}),
      chart_datum:
        station.chart_datum ??
        getChartDatum(
          country,
          datums ?? {},
          station.latitude,
          station.longitude,
        ),
      // Cast: subordinates legitimately omit `datums` (see OptionalProperties).
    } as StationData,
    sortOrder,
  );
}

export async function save(source: string, data: StationData) {
  const filePath = join(DATA_DIR, source, `${data.source.id}.json`);
  const directory = dirname(filePath);

  // Create directory if it doesn't exist
  await mkdir(directory, { recursive: true });

  // Write the JSON file
  return writeFile(filePath, JSON.stringify(data, null, 2) + "\n");
}

export async function load(source: string, id: string): Promise<StationData> {
  const filePath = join(DATA_DIR, source, `${id}.json`);
  return JSON.parse(await readFile(filePath, "utf-8"));
}
