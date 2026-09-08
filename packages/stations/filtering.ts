/**
 * Shared utilities for station filtering and deduplication
 */

/**
 * Source quality priority for TICON stations (lower = better quality)
 *
 * When multiple stations exist at the same location, this priority determines
 * which source to keep. Higher priority sources are more reliable, more recent,
 * or more authoritative.
 */
export const SOURCE_PRIORITY: Record<string, number> = {
  // Tier 0: Authoritative national source (included directly)
  noaa: 0, // NOAA CO-OPS

  // Tier 1: Highest priority - most reliable and current
  uhslc_fd: 1, // University of Hawaii Sea Level Center - Fast Delivery
  bodc: 2, // British Oceanographic Data Centre

  // Tier 2: High quality national/regional services
  meds: 4, // Canadian Marine Environmental Data Service
  refmar: 5, // French Reference Network
  bom: 6, // Australian Bureau of Meteorology
  jodc_jma: 7, // Japan Meteorological Agency
  smhi: 8, // Swedish Meteorological Institute
  nhs: 9, // Norwegian Hydrographic Service
  ieo: 10, // Spanish Oceanographic Institute

  // Tier 3: Regional services
  wsv: 20,
  rws: 21,
  fmi: 23,
  dmi: 24,
  ispra: 25,
  noc: 26,
  eseas: 27,
  bfg: 28,
  icg: 29,

  // Tier 4: US regional sources
  usgs: 40,
  crms: 41,
  cdwr: 42,
  sfwmd: 43,
  nwfwmd: 44,
  ncdem: 45,
  hct: 46,
  cm: 47,

  // Tier 5: Lower priority - older versions or research quality
  uhslc_rq: 80, // Research Quality - older UHSLC version
  unam: 85,
  unam_hist: 86,
  jodc_pahb: 87,
  jodc_jcg: 88,
  jodc_giaj: 89,
  ttw: 90,
  mi_c: 91,
  mi_r: 92,
  cco: 93,
  da_idh: 94,
  da_mm: 95,
  gloss: 96,

  // Tier 6: Non-commercial GESLA sources (research use only per GESLA license)
  cmems: 97, // Copernicus Marine Environment Monitoring Service
  cv: 97, // City of Venice
  uz: 97, // University of Zagreb

  // Tier 7: Lowest priority - often duplicates
  da_sat: 99, // Satellite-derived, often duplicates NOAA
};

/** Default priority for unknown sources */
export const DEFAULT_PRIORITY = 50;

/** GESLA sources that restrict commercial/consultancy use */
export const NON_COMMERCIAL_SOURCES = ["cmems", "cv", "uz"];

/**
 * Extract the source suffix from a TICON source ID
 * Example: "abashiri-347-jpn-uhslc_fd" -> "uhslc_fd"
 */
export function getSourceSuffix(sourceId: string): string {
  const parts = sourceId.toString().split("-");
  return parts[parts.length - 1]!;
}

/**
 * Get the priority value for a source ID
 * Lower numbers = higher priority
 */
export function getSourcePriority(sourceId: string): number {
  const suffix = getSourceSuffix(sourceId);
  return SOURCE_PRIORITY[suffix] ?? DEFAULT_PRIORITY;
}

/**
 * Derive a physical-gauge key from a TICON source ID by dropping the source
 * suffix and stripping any trailing record-segment letter from the station code.
 *
 * TICON IDs are structured `<name>-<code>-<country>-<source>`, where a single
 * physical gauge is often split across several records that share the same
 * station code but differ by segment letter and/or source:
 *   "las_palmas-217-esp-uhslc_fd"  -> "las_palmas-217-esp"
 *   "las_palmas-217a-esp-uhslc_rq" -> "las_palmas-217-esp"
 *   "aberdeen-abe-gbr-bodc"        -> "aberdeen-abe-gbr"
 *   "aberdeen-abe-gbr-cmems"       -> "aberdeen-abe-gbr"
 *
 * Records sharing this key are the same physical gauge measured over different
 * periods (fast-delivery vs research-quality segments) or delivered by different
 * providers — so they should be deduplicated regardless of coordinate drift.
 */
export function gaugeKey(sourceId: string): string {
  const parts = sourceId.toString().split("-");
  if (parts.length < 3) return sourceId.toString();
  parts.pop(); // drop the source suffix (e.g. uhslc_fd)
  const codeIdx = parts.length - 2; // code sits just before the country code
  // Strip a single trailing letter from a numeric code: 217a -> 217, 082c -> 082.
  // Non-numeric codes (e.g. "abe", "h033007a") are left untouched.
  parts[codeIdx] = parts[codeIdx]!.replace(/^(\d+)[a-z]$/i, "$1");
  return parts.join("-");
}

/** Radius around Null Island (0°, 0°) within which a station's coordinates are
 *  treated as a missing/placeholder fix rather than a real position (in degrees).
 *  Records that fail to geolocate frequently default to (0, 0), which lands in
 *  the Gulf of Guinea and cannot be deduplicated against the real gauge. */
export const NULL_ISLAND_RADIUS = 0.05;

/** Count the decimal places in a coordinate value (e.g. 28.148 -> 3, 28.1 -> 1). */
function decimalPlaces(n: number): number {
  const s = n.toString();
  const dot = s.indexOf(".");
  return dot === -1 ? 0 : s.length - dot - 1;
}

/** Coordinate precision of a station, as the limiting (minimum) number of decimal
 *  places across latitude and longitude. Coarsely-rounded 0.1° records score 1;
 *  precisely surveyed positions score higher. Used only to break ties between
 *  otherwise equal-quality duplicate records so the survivor keeps the better
 *  location. */
export function coordinatePrecision(
  latitude: number,
  longitude: number,
): number {
  return Math.min(decimalPlaces(latitude), decimalPlaces(longitude));
}

/**
 * Check if a station has quality control issues based on its disclaimers
 */
export function hasQualityIssues(disclaimers?: string): boolean {
  return disclaimers?.includes("quality control issues") ?? false;
}

/**
 * Compute observation years from an epoch object
 */
export function epochYears(epoch?: { start: string; end: string }): number {
  if (!epoch) return 0;
  const start = new Date(epoch.start);
  const end = new Date(epoch.end);
  return (end.getTime() - start.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
}

/**
 * Calculate distance between two points using Haversine formula
 * @returns Distance in kilometers
 */
export function distance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/** Maximum distance to consider two stations as potential duplicates (in km) */
export const MAX_DEDUP_DISTANCE = 0.5; // 500 meters

/** Distance below which stations are always considered duplicates (in km) */
export const MIN_DEDUP_DISTANCE = 0.05; // 50 meters

/** Minimum M2 amplitude ratio to consider two reference stations as duplicates.
 *  Pairs within MAX_DEDUP_DISTANCE but above MIN_DEDUP_DISTANCE are only
 *  deduplicated if their M2 amplitudes are similar (ratio >= this threshold). */
export const MIN_AMPLITUDE_RATIO = 0.9;

/** Distance fallback for subordinate stations and reference stations where one has
 *  accepted subordinates. Used when harmonic comparison is unavailable or inapplicable. */
export const FALLBACK_DEDUP_DISTANCE = 0.1; // 100 meters

/** Maximum offset difference for two subordinate stations to be treated as the
 *  same station. Subordinate records predict from a reference plus height/time
 *  offsets, so two subordinates sharing (often coarse or placeholder) coordinates
 *  are only true duplicates when they'd produce the same prediction — same
 *  reference, height offsets within MAX_OFFSET_HEIGHT_DELTA, and time offsets
 *  within MAX_OFFSET_TIME_DELTA. Suwarrow Island, mislocated on Hao Island's exact
 *  coordinates but with a +64 min vs −315 min offset, is the case this separates. */
export const MAX_OFFSET_HEIGHT_DELTA = 0.1; // ratio (or metres for fixed offsets)
export const MAX_OFFSET_TIME_DELTA = 10; // minutes

/** Minimum tidal range (MHW - MLW) to consider a station useful for tide prediction */
export const MIN_TIDAL_RANGE = 0.02; // 2cm

// ── Seasonal-contamination gate ──────────────────────────────────────────
// A harmonic analysis of a short, gappy, or datum-shifted sea-level record can
// absorb spurious energy into the seasonal band (SA and its M2 satellites),
// inflating the predicted extreme range. SA is a meteorological/steric signal
// that varies smoothly along a coast, so a station whose SA amplitude wildly
// exceeds that of a hydraulically-connected neighbour in the same tidal regime
// is almost certainly contaminated rather than physically distinct.

/** Radius within which a same-regime neighbour can vouch for a station's
 *  seasonal amplitude (in km). Kept tight so comparisons stay within one
 *  local regime rather than across an estuary gradient. */
export const SEASONAL_OUTLIER_RADIUS = 25;

/** Only stations whose SA amplitude exceeds this (in metres) are checked. Below
 *  it, seasonal energy is too small to meaningfully distort the range. */
export const SEASONAL_OUTLIER_MIN_SA = 0.5;

/** A station's SA must exceed the median SA of its same-regime neighbours by at
 *  least this factor to be gated as contaminated. */
export const SEASONAL_OUTLIER_RATIO = 5;
