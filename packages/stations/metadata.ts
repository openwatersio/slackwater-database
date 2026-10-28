import countryLookup from "country-code-lookup";
import { countryByName } from "./country.ts";
import { find as findTimezone } from "geo-tz/all";
import { parse } from "yaml";
import type { ChsFitData, StationInput } from "@slackwater/database";
import { cleanName, isRegionContext } from "./name-cleanup.ts";
import type { GeocodeResult, Geocoder } from "./geocode.ts";
import type { MaritimeZones } from "./maritime-zones.ts";
import type { WaterBodies } from "./water-bodies.ts";

export const MAX_CORRECTION_KM = 5;
export const DERIVED_MAX_KM = 40;
/** Km of credit per tenfold of population over 1,000, so a known town beats a nearer neighbourhood. */
export const RECOGNITION_KM = 3;

const recognitionScore = ({ distance, place }: GeocodeResult) =>
  distance -
  RECOGNITION_KM * Math.log10(Math.max(place.population, 1000) / 1000);

/** GeoNames files these as countries whose regions are municipalities; a label names them like a state. */
const US_TERRITORIES = new Set(["AS", "GU", "MP", "PR", "VI"]);

export interface MetadataLocation {
  locality?: string;
  region?: string;
  /** null pins a station to no region, so a derived one cannot appear. */
  regionCode?: string | null;
  country?: string;
  countryCode?: string;
  continent?: string;
}

export interface Correction {
  name?: string;
  context?: string;
  aliases?: string[];
  cities?: string[];
  position?: [number, number];
  /** The published position is right although the coastline audit flags it. */
  positionVerified?: true;
  location?: MetadataLocation;
  /** A current's paired tide station, by record id. */
  tideReference?: string;
}

export interface RegistryRecord extends Correction {
  provider?: string;
  kind?: "tide" | "current";
  magnitudeNote?: string;
  chsFit?: ChsFitData;
  derived?: {
    reference: string;
    hwLagMinutes: number;
    lwLagMinutes: number;
  };
}

export type Corrections = Map<string, Correction>;
export type Registry = Map<string, RegistryRecord>;

export interface ResolvedStation extends StationInput {
  latitude: number;
  longitude: number;
  country: string;
  country_code: string;
  positionVerified?: true;
  routed?: boolean;
}

interface ResolveInputs {
  correction?: Correction;
  registry?: RegistryRecord;
  geocoder: Geocoder;
  waterBodies?: WaterBodies;
  maritimeZones?: MaritimeZones;
}

export function loadCorrections(text: string): Corrections {
  return loadMap<Correction>(text);
}

export function loadRegistry(text: string): Registry {
  return loadMap<RegistryRecord>(text);
}

function loadMap<T>(text: string): Map<string, T> {
  const value: unknown = parse(text) ?? {};
  if (!isRecord(value)) throw new Error("metadata must be a YAML object");
  return new Map(Object.entries(value) as [string, T][]);
}

export function validateMetadata(
  corrections: Corrections,
  registry: Registry,
  stations: StationInput[] = [],
  /** The records sharing each record's station; a curation fits any of them. */
  siblings: Map<string, string[]> = new Map(),
): string[] {
  const problems: string[] = [];
  const published = new Map(stations.map((station) => [station.id, station]));

  for (const [id, correction] of corrections) {
    validateCommon(id, correction, problems);
    if (
      correction.tideReference !== undefined &&
      !nonEmpty(correction.tideReference)
    )
      problems.push(`${id}: tideReference must be a non-empty string`);
    const records = (siblings.get(id) ?? [id]).flatMap(
      (sibling) => published.get(sibling) ?? [],
    );
    const names = records.flatMap(({ name }) => (nonEmpty(name) ? [name] : []));
    if (
      nonEmpty(correction.name) &&
      names.length &&
      !names.some((name) => sharesMeaningfulWord(correction.name!, name))
    )
      problems.push(
        `${id}: curated name ${JSON.stringify(correction.name)} shares no meaningful word with published name ${JSON.stringify(names.join(" / "))}`,
      );
    if (
      correction.position !== undefined &&
      validPosition(correction.position)
    ) {
      const distances = records.flatMap(({ latitude, longitude }) =>
        typeof latitude === "number" && typeof longitude === "number"
          ? [
              distanceKm(
                latitude,
                longitude,
                correction.position![0],
                correction.position![1],
              ),
            ]
          : [],
      );
      // The position applies to every record in the station, so it must fit
      // the farthest.
      const distance = Math.max(...distances);
      if (distances.length && distance > MAX_CORRECTION_KM)
        problems.push(
          `${id}: corrected position is ${distance.toFixed(1)} km from the published position (limit ${MAX_CORRECTION_KM} km)`,
        );
    }
    if (
      correction.position !== undefined &&
      correction.positionVerified !== undefined
    )
      problems.push(`${id}: position and positionVerified cannot both be set`);
  }

  for (const [id, record] of registry) {
    validateCommon(id, record, problems);
    if (!nonEmpty(record.name)) problems.push(`${id}: name is required`);
    if (!nonEmpty(record.provider))
      problems.push(`${id}: provider is required`);
    if (record.position === undefined)
      problems.push(`${id}: position is required`);
    if (
      record.kind !== undefined &&
      record.kind !== "tide" &&
      record.kind !== "current"
    )
      problems.push(`${id}: kind must be "tide" or "current"`);
    if (record.magnitudeNote !== undefined && !nonEmpty(record.magnitudeNote))
      problems.push(`${id}: magnitudeNote must be a non-empty string`);

    if (record.derived !== undefined) {
      const derived = record.derived;
      if (!isRecord(derived)) {
        problems.push(`${id}: derived must be an object`);
      } else {
        validateReference(
          id,
          "derived.reference",
          derived.reference,
          registry,
          problems,
        );
        for (const field of ["hwLagMinutes", "lwLagMinutes"] as const) {
          if (
            typeof derived[field] !== "number" ||
            !Number.isFinite(derived[field])
          )
            problems.push(`${id}: derived.${field} must be a number`);
        }
      }
      if (record.kind === "tide")
        problems.push(`${id}: a tide port cannot be derived`);
    }

    if (record.tideReference !== undefined) {
      validateReference(
        id,
        "tideReference",
        record.tideReference,
        registry,
        problems,
      );
      if (record.kind === "tide")
        problems.push(`${id}: a tide port cannot carry a tideReference`);
      if (record.derived !== undefined)
        problems.push(
          `${id}: a derived gate cannot also carry a tideReference`,
        );
    }
    if (corrections.has(id))
      problems.push(`${id}: declared in both corrections and registry`);
  }

  return problems;
}

function validateCommon(
  id: string,
  record: Correction,
  problems: string[],
): void {
  for (const field of ["name", "context"] as const) {
    const value = record[field];
    if (value !== undefined && !nonEmpty(value))
      problems.push(`${id}: ${field} must be a non-empty string`);
  }
  for (const field of ["aliases", "cities"] as const) {
    const value = record[field];
    if (
      value !== undefined &&
      (!Array.isArray(value) || !value.every((item) => nonEmpty(item)))
    )
      problems.push(`${id}: ${field} must be an array of non-empty strings`);
  }
  if (record.position !== undefined && !validPosition(record.position))
    problems.push(
      `${id}: position must be valid [latitude, longitude] numbers`,
    );
  if (
    typeof record.name === "string" &&
    typeof record.context === "string" &&
    namesOverlap(record.name, record.context)
  )
    problems.push(`${id}: context repeats the name`);
  if (
    typeof record.context === "string" &&
    Array.isArray(record.cities) &&
    record.cities.includes(record.context)
  )
    problems.push(
      `${id}: context ${JSON.stringify(record.context)} is also a city`,
    );
  validateLocation(id, record.location, problems);
}

function validateLocation(
  id: string,
  location: MetadataLocation | undefined,
  problems: string[],
): void {
  if (location === undefined) return;
  if (!isRecord(location)) {
    problems.push(`${id}: location must be an object`);
    return;
  }
  for (const field of [
    "locality",
    "region",
    "regionCode",
    "country",
    "countryCode",
    "continent",
  ] as const) {
    const value = location[field];
    if (field === "regionCode" && value === null) continue;
    if (value !== undefined && !nonEmpty(value))
      problems.push(`${id}: location.${field} must not be empty`);
  }
  if (
    typeof location.countryCode === "string" &&
    nonEmpty(location.countryCode)
  ) {
    if (
      !/^[A-Z]{2}$/.test(location.countryCode) ||
      !countryLookup.byIso(location.countryCode)
    )
      problems.push(
        `${id}: location.countryCode must be a recognized ISO 3166-1 alpha-2 code`,
      );
  }
  if (typeof location.country === "string" && nonEmpty(location.country)) {
    const info = countryByName(location.country);
    if (!info)
      problems.push(
        `${id}: location.country must be a recognized country name`,
      );
    else if (location.countryCode && info.iso2 !== location.countryCode)
      problems.push(
        `${id}: location.country and location.countryCode do not match`,
      );
  }
  if (
    typeof location.regionCode === "string" &&
    nonEmpty(location.regionCode)
  ) {
    if (!/^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(location.regionCode))
      problems.push(`${id}: location.regionCode must be an ISO 3166-2 code`);
    else if (
      location.countryCode &&
      !location.regionCode.startsWith(`${location.countryCode}-`)
    )
      problems.push(`${id}: location.regionCode must start with countryCode`);
  }
}

function validateReference(
  owner: string,
  field: string,
  reference: unknown,
  registry: Registry,
  problems: string[],
): void {
  if (!nonEmpty(reference)) {
    problems.push(`${owner}: ${field} must name a tide station`);
    return;
  }
  const target = registry.get(reference);
  if (!target)
    problems.push(
      `${owner}: ${field} ${JSON.stringify(reference)} is not a station in the registry`,
    );
  else if (target.kind !== "tide")
    problems.push(
      `${owner}: ${field} ${JSON.stringify(reference)} must reference a tide station`,
    );
}

export function resolveMetadata(
  station: StationInput,
  { correction, registry, geocoder, waterBodies, maritimeZones }: ResolveInputs,
): ResolvedStation {
  const isTicon = station.id.startsWith("ticon/");
  const authority = registry ?? correction;
  const position = registry?.position ??
    correction?.position ?? [station.latitude, station.longitude];
  if (!validPosition(position))
    throw new Error(`${station.id}: no valid position`);

  const nearby = geocoder.near(position[0], position[1], 10, 100);
  const nearest = nearby[0] ?? geocoder.nearest(position[0], position[1], 100);
  const explicitLocation = registry?.location ?? correction?.location;
  const zoneCountry = maritimeZones?.country(position[0], position[1]);
  const countryName =
    explicitLocation?.country ??
    (explicitLocation?.countryCode
      ? countryLookup.byIso(explicitLocation.countryCode)?.country
      : undefined) ??
    (zoneCountry ? countryLookup.byIso(zoneCountry)?.country : undefined) ??
    station.country ??
    (station.country_code
      ? countryLookup.byIso(station.country_code)?.country
      : undefined) ??
    nearest?.country;
  if (!nonEmpty(countryName)) throw new Error(`${station.id}: no country`);
  const country = countryByName(countryName);
  if (!country?.iso2)
    throw new Error(`${station.id}: no ISO country code for ${countryName}`);
  if (
    explicitLocation?.countryCode &&
    explicitLocation.countryCode !== country.iso2
  )
    throw new Error(
      `${station.id}: country does not match ${explicitLocation.countryCode}`,
    );
  if (
    station.country_code &&
    !registry &&
    !correction?.location?.country &&
    !correction?.location?.countryCode &&
    zoneCountry !== country.iso2 &&
    station.country_code !== country.iso2
  )
    throw new Error(
      `${station.id}: country does not match ${station.country_code}`,
    );

  // Across a strait the ten nearest places can all be foreign. When the
  // station's maritime zone confirms its country, look further for a place in
  // that country rather than leave the region empty.
  const sameCountry = (result: { place: { countryCode: string } }) =>
    result.place.countryCode === country.iso2;
  const place =
    nearby.find(sameCountry) ??
    (zoneCountry === country.iso2
      ? geocoder.near(position[0], position[1], 100, 100).find(sameCountry)
      : undefined);
  const noRegion = explicitLocation?.regionCode === null;
  const placeRegionCode = place
    ? isoSubdivisionCode(
        country.iso2,
        place.place.admin1,
        place.place.admin1Code,
      )
    : undefined;
  const authoritativeRegionCode = noRegion
    ? undefined
    : (explicitLocation?.regionCode ??
      station.region_code ??
      // The provider's own state code beats the nearest place, which can sit
      // across a state line or, on the Alaska panhandle, not exist within reach.
      (country.iso2 === "US" && /^[A-Z]{2}$/.test(station.region ?? "")
        ? `US-${station.region}`
        : undefined) ??
      // A provider's province takes priority over a nearby place across the border.
      (country.iso2 === "CA" && CANADIAN_SUBDIVISIONS[station.region ?? ""]
        ? `CA-${CANADIAN_SUBDIVISIONS[station.region ?? ""]}`
        : undefined));
  const cleaned = cleanName(
    station.name ?? registry?.name ?? "",
    country.country,
    authoritativeRegionCode ??
      (isTicon ? station.region : (placeRegionCode ?? station.region)),
    station.source?.name === "Canadian Hydrographic Service",
  );
  const regionCode =
    authoritativeRegionCode ??
    (cleaned.region && !noRegion
      ? `${country.iso2}-${cleaned.region}`
      : undefined) ??
    (noRegion ? undefined : placeRegionCode);
  const displayName =
    isTicon && cleaned.isOpaque && nearest && nearest.distance <= 50
      ? nearest.place.name
      : cleaned.name;
  // NOAA current qualifiers locate the gauge; they do not consistently name its water.
  const split =
    station.kind === "current" && station.id.startsWith("noaa/")
      ? { name: displayName }
      : splitQualifier(displayName);
  const name = registry?.name ?? correction?.name ?? split.name;
  if (!nonEmpty(name)) throw new Error(`${station.id}: no name`);

  const result: ResolvedStation = {
    ...station,
    id: station.id,
    name,
    latitude: position[0],
    longitude: position[1],
    country: country.country,
    country_code: country.iso2,
  };
  for (const key of [
    "continent",
    "locality",
    "region",
    "region_code",
    "context",
    "context_derived",
    "cities",
    "aliases",
  ] as const)
    delete result[key];
  setOptional(
    result,
    "continent",
    explicitLocation?.continent ??
      station.continent ??
      place?.continent ??
      country.continent,
  );
  setOptional(
    result,
    "locality",
    explicitLocation?.locality ??
      station.locality ??
      (place && place.distance <= DERIVED_MAX_KM
        ? place.place.name
        : undefined),
  );
  setOptional(
    result,
    "region",
    explicitLocation?.region ??
      normalizedRegion(station.region, country.iso2, place?.place.admin1) ??
      normalizedRegion(cleaned.region, country.iso2) ??
      normalizedRegion(
        (isTicon ? place?.region : undefined) ?? place?.place.admin1,
        country.iso2,
      ),
  );

  if (regionCode && !regionCode.startsWith(`${country.iso2}-`))
    throw new Error(
      `${station.id}: region code ${regionCode} does not match ${country.iso2}`,
    );
  setOptional(result, "region_code", regionCode);
  if (country.iso2 === "CA" && regionCode) {
    const expected = Object.entries(CANADIAN_SUBDIVISIONS).find(
      ([, code]) => `CA-${code}` === regionCode,
    );
    if (
      expected &&
      result.region !== expected[0] &&
      result.region !== expected[1]
    )
      throw new Error(
        `${station.id}: region ${result.region} does not match ${regionCode}`,
      );
  }

  const curatedContext = registry?.context ?? correction?.context;
  let context = curatedContext ?? station.context ?? split.context;
  let contextDerived = curatedContext
    ? false
    : station.context
      ? (station.context_derived ?? false)
      : context
        ? false
        : undefined;
  if (!context) {
    const water = waterBodies
      ?.at(position[0], position[1])
      // A NOAA current keeps its qualifier on the name ("Rich Passage, East
      // End"), so a water matching any part of it would restate the name.
      .find(
        (body) =>
          !name
            .split(",")
            .some((part) => foldName(part) === foldName(body.name)),
      );
    if (water) {
      context = water.name;
      contextDerived = true;
    }
  }
  const hasRegionQualifier =
    cleaned.region !== undefined ||
    cleaned.original.split(",").slice(1).some(isRegionContext);
  // A discarded region qualifier needs water; another town can misplace a gauge across a state line.
  const town =
    context || hasRegionQualifier
      ? undefined
      : geocoder
          .near(position[0], position[1], 100, DERIVED_MAX_KM)
          .filter(
            (r) =>
              sameCountry(r) &&
              r.distance <= DERIVED_MAX_KM &&
              !r.place.section,
          )
          .reduce<GeocodeResult | undefined>(
            (best, r) =>
              !best || recognitionScore(r) < recognitionScore(best) ? r : best,
            undefined,
          );
  if (!context && town) {
    const shortRegion = US_TERRITORIES.has(country.iso2)
      ? country.iso2
      : normalizedRegion(town.region ?? town.place.admin1Code, country.iso2);
    if (!namesOverlap(name, town.place.name))
      context = [town.place.name, shortRegion].filter(Boolean).join(", ");
    if (context) contextDerived = true;
  }
  setOptional(result, "context", context);
  if (context) result.context_derived = contextDerived ?? false;

  const aliases = authority?.aliases ?? station.aliases;
  result.aliases = unique([
    name.toLowerCase(),
    ...(aliases ?? []).map((alias) => alias.toLowerCase()),
  ]);
  const cities = authority?.cities ?? station.cities;
  if (cities?.length) result.cities = unique(cities);
  else delete result.cities;

  if (authority?.positionVerified) result.positionVerified = true;

  if (registry) {
    result.kind = registry.kind === "tide" ? "tide" : "current";
    if (!result.timezone) {
      const timezone = findTimezone(position[0], position[1])[0];
      if (timezone) result.timezone = timezone;
    }
    if (result.kind === "current") {
      result.current = { ...station.current };
      const tideReference =
        registry.tideReference ?? registry.derived?.reference;
      if (tideReference) result.current.tide_reference = tideReference;
      if (registry.magnitudeNote)
        result.current.magnitude_note = registry.magnitudeNote;
      if (registry.chsFit) result.current.chs_fit = registry.chsFit;
      if (registry.derived)
        result.current.derived = {
          reference: registry.derived.reference,
          high_water_lag_minutes: registry.derived.hwLagMinutes,
          low_water_lag_minutes: registry.derived.lwLagMinutes,
        };
    }
  } else if (correction?.tideReference && station.kind === "current") {
    result.current = {
      ...station.current,
      tide_reference: correction.tideReference,
    };
  }

  return result;
}

export function registryStations({
  registry,
  ...places
}: {
  registry: Registry;
  geocoder: Geocoder;
  waterBodies?: WaterBodies;
  maritimeZones?: MaritimeZones;
}): ResolvedStation[] {
  return [...registry].map(([id, record]) =>
    resolveMetadata(
      {
        id,
        name: record.name!,
        latitude: record.position![0],
        longitude: record.position![1],
        type: "reference",
        harmonic_constituents: [],
        source: {
          name:
            record.provider === "chs"
              ? "Canadian Hydrographic Service"
              : "US National Oceanic and Atmospheric Administration",
          id,
          published_harmonics: false,
          url: "https://github.com/openwatersio/slackwater-database/blob/main/stations/README.md#provenance",
        },
        license: {
          type: "MIT",
          commercial_use: true,
          url: "https://github.com/openwatersio/slackwater-database/blob/main/LICENSE",
        },
      },
      { registry: record, ...places },
    ),
  );
}

function splitQualifier(name: string): { name: string; context?: string } {
  const [primary = "", ...rest] = name.split(",").map((part) => part.trim());
  const context = rest
    .filter(
      (part) =>
        part && !isRegionContext(part) && part.toLowerCase() !== "puget sound",
    )
    .join(" · ");
  return { name: primary, ...(context ? { context } : {}) };
}

function setOptional<K extends keyof ResolvedStation>(
  station: ResolvedStation,
  key: K,
  value: ResolvedStation[K] | undefined,
): void {
  if (typeof value === "string" && value.trim())
    station[key] = value as ResolvedStation[K];
}

function validPosition(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    Number.isFinite(value[0]) &&
    value[0] >= -90 &&
    value[0] <= 90 &&
    typeof value[1] === "number" &&
    Number.isFinite(value[1]) &&
    value[1] >= -180 &&
    value[1] <= 180
  );
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function foldName(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase();
}

function namesOverlap(left: string, right: string): boolean {
  // Accents folded first: a provider's "Limon" and GeoNames' "Limón" are one name.
  const a = foldName(left);
  const b = foldName(right);
  const words = (text: string) => text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const contains = (whole: string[], part: string[]) =>
    whole.some((_, index) =>
      part.every((word, offset) => whole[index + offset] === word),
    );
  return contains(words(a), words(b)) || contains(words(b), words(a));
}

const NAME_STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "of",
  "and",
  "bay",
  "point",
  "island",
  "channel",
  "inlet",
  "harbor",
  "harbour",
  "sound",
  "strait",
  "passage",
  "narrows",
  "cove",
  "creek",
  "river",
  "entrance",
  "ent",
  "st",
  "pt",
]);

export const CANADIAN_SUBDIVISIONS: Record<string, string> = {
  Alberta: "AB",
  "British Columbia": "BC",
  Manitoba: "MB",
  "New Brunswick": "NB",
  "Newfoundland and Labrador": "NL",
  "Northwest Territories": "NT",
  "Nova Scotia": "NS",
  Nunavut: "NU",
  Ontario: "ON",
  "Prince Edward Island": "PE",
  Quebec: "QC",
  Saskatchewan: "SK",
  Yukon: "YT",
};

function normalizedRegion(
  region: string | undefined,
  countryCode: string,
  fallback?: string,
): string | undefined {
  if (!region) return undefined;
  const normalizedFallback = normalizedRegion(fallback, countryCode);
  if (countryCode === "CA") {
    if (CANADIAN_SUBDIVISIONS[region]) return region;
    return (
      Object.entries(CANADIAN_SUBDIVISIONS).find(
        ([, code]) => code === region.toUpperCase(),
      )?.[0] ?? normalizedFallback
    );
  }
  return /^\d+$/.test(region) ? normalizedFallback : region;
}

export function isoSubdivisionCode(
  countryCode: string,
  admin1: string,
  admin1Code: string,
): string | undefined {
  if (countryCode === "US" && /^[A-Z]{2}$/.test(admin1Code))
    return `US-${admin1Code}`;
  if (countryCode === "CA" && CANADIAN_SUBDIVISIONS[admin1])
    return `CA-${CANADIAN_SUBDIVISIONS[admin1]}`;
  return undefined;
}

function sharesMeaningfulWord(left: string, right: string): boolean {
  // Fold accents first, so a curated "Södertälje" matches a provider's ASCII
  // "Sodertalje" instead of splitting at each accented letter.
  const words = (text: string) =>
    text
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word && !NAME_STOP_WORDS.has(word));
  const rightWords = new Set(words(right));
  if (words(left).some((word) => rightWords.has(word))) return true;
  // Some providers squash a name into one word (LINZ's `PORTCHALMERS`), so a
  // curated word may sit inside the published letters instead.
  const letters = words(right).join("");
  if (words(left).some((word) => word.length >= 3 && letters.includes(word)))
    return true;
  // Some TICON records delete non-ASCII letters; require the remaining full name to match.
  const stripped = words(
    left.normalize("NFC").replace(/[^\x00-\x7F]/g, ""),
  ).join("");
  return stripped.length >= 3 && stripped === letters;
}

function distanceKm(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const radians = Math.PI / 180;
  const dLat = (bLat - aLat) * radians;
  const dLon = (bLon - aLon) * radians;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * radians) *
      Math.cos(bLat * radians) *
      Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}
