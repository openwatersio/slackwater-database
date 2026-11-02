/**
 * Shared utilities for station filtering and deduplication
 */

import { sourceMetadata } from "./sources.ts";

/** NOAA publishes observed means even when its mixed datum table has no method flag. */
export function hasObservedMeanDatums(station: {
  id: string;
  datums_source?: "observed" | "harmonic";
}): boolean {
  return (
    station.datums_source === "observed" ||
    (station.datums_source === undefined && station.id.startsWith("noaa/"))
  );
}

/**
 * Source quality priority for TICON stations (lower = better quality)
 *
 * When multiple stations exist at the same location, this priority determines
 * which source to keep. Higher priority sources are more reliable, more recent,
 * or more authoritative.
 */
export const SOURCE_PRIORITY: Record<string, number> = {
  // TICON's reanalysis of a NOAA gauge that NOAA publishes without harmonic
  // constants, or whose NOAA record fails a check (a direct record supersedes
  // the relay otherwise). The
  // data are NOAA's, but the analysis is a relay's, so it ranks with the
  // national services rather than with NOAA.
  noaa: 4,

  // Tier 1: Highest priority - most reliable and current
  // University of Hawaii Sea Level Center. Research quality is the delayed-mode
  // series that has had UHSLC's full quality control and replaces fast delivery
  // as it becomes available; fast delivery is more recent. They rank equally,
  // so record length and recency decide between them.
  uhslc_fd: 1,
  uhslc_rq: 1,
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
  cm: 47,

  // Tier 5: Lower priority - historical series and smaller contributors
  unam: 85,
  unam_hist: 86,
  rws_hist: 86,
  jodc_pahb: 87,
  jodc_jcg: 88,
  jodc_giaj: 89,
  ttw: 90,
  mi_c: 91,
  mi_r: 92,
  cco: 93,
  // Historical records contributed to GESLA by individual researchers
  // (Haigh, Marcos, Talke), often of gauges an agency also relays.
  da_idh: 94,
  da_mm: 95,
  gloss: 96,

  // Tier 6: Non-commercial GESLA sources (research use only per GESLA license)
  cmems: 97, // Copernicus Marine Environment Monitoring Service
  cv: 97, // City of Venice
  uz: 97, // University of Zagreb

  // Tier 7: Lowest priority - historical records of gauges, mostly NOAA's, that
  // Stefan Talke contributed to GESLA
  da_sat: 99,
};

/** Default priority for unknown sources */
export const DEFAULT_PRIORITY = 50;

/** TICON sources whose record times are off by a measured amount, with the
 *  measurement. A record from one is rejected: its predictions would publish
 *  high and low water at the wrong time. */
export const CLOCK_ERROR_SOURCES: Record<string, string> = {
  // Harris County Flood Control District. Against the nearest NOAA or USGS
  // gauge within 5 km, its 9 comparable records run a median 44 minutes late
  // on M2 and about 30 on K1 and O1; USGS (591 pairs) and California DWR (97)
  // run within a minute by the same comparison. Every one of its records has
  // a NOAA harmonic station within 15 km.
  hct: "runs 23 to 71 minutes behind every NOAA and USGS gauge near it",
};

/** GESLA sources that restrict commercial/consultancy use */
export const NON_COMMERCIAL_SOURCES = ["cmems", "cv", "uz"];

/** A record a source's metadata.yaml marks authoritative, as against a relay. */
export function isAuthoritative(record: {
  source?: { name: string };
}): boolean {
  return !!record.source && sourceMetadata(record.source.name).authoritative;
}

type SourcedRecord = {
  id: string;
  source?: { name: string };
  type?: string;
  country?: string;
};

/** Whether a record's authority holds when choosing among duplicates. An
 *  authoritative source's subordinate station outside its jurisdiction is a
 *  legacy foreign table predicted from a distant reference, not a gauge the
 *  source operates, so it does not outrank a local record on authority. */
export function winsOnAuthority(record: SourcedRecord): boolean {
  if (!isAuthoritative(record)) return false;
  if (record.type !== "subordinate") return true;
  const { jurisdiction } = sourceMetadata(record.source!.name);
  return !jurisdiction || jurisdiction.includes(record.country ?? "");
}

/** Prefer the authoritative record when exactly one duplicate wins on authority. */
export function authoritativeDuplicateWinner(
  a: SourcedRecord,
  b: SourcedRecord,
): string | undefined {
  const directA = winsOnAuthority(a);
  const directB = winsOnAuthority(b);
  return directA === directB ? undefined : directA ? a.id : b.id;
}

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
 * Roseau's country-code error is corrected so its UHSLC records share a key.
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
  const key = parts.join("-");
  // TICON mislabels UHSLC's Roseau station 786 as Dominican Republic (#328).
  return key === "roseau-786-dom" ? "roseau-786-dma" : key;
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

/** How far apart two constituent amplitudes must be, in metres, before a
 *  quality gate treats the difference as real.
 *
 *  Harmonic analysis judges a constituent by its error estimate, not by the
 *  digits it is printed to (Pawlowicz, Beardsley & Lentz 2002, T_TIDE; Codiga
 *  2011, UTide). For a year or more of hourly data that error is about 1 mm at
 *  a quiet site and about 3 mm where wind and river flow add non-tidal noise,
 *  and more for shorter records. Only TICON publishes per-constituent errors,
 *  and they look like formal least-squares errors that run low, so every
 *  source is held to the noisy-site figure. Stored digits follow the publisher
 *  (see PUBLISHED_PRECISION) and say nothing about this. */
export const AMPLITUDE_TOLERANCE = 0.003;

/** Project screening allowance for observed means versus harmonic bounds from
 * different periods, including weather. Masked-record changes and NOAA paired
 * mean-level residuals are centimetre-scale. This 5 cm allowance is a
 * conservative diagnostic threshold, not a station accuracy guarantee. */
export const OBSERVED_BOUND_ALLOWANCE = 0.05;

/** Whether amplitude `a` exceeds `b` by more than AMPLITUDE_TOLERANCE. The
 *  difference is rounded to the nanometre first, so float noise in a value
 *  stored to whole millimetres cannot tip a difference of exactly 3 mm. */
export function exceeds(a: number, b: number): boolean {
  return Number((a - b).toFixed(9)) > AMPLITUDE_TOLERANCE;
}

/** Smallest P1 amplitude, in metres, at which P1 > K1 marks a bad fit.
 *
 *  In the gravitational tide P1/K1 is 0.331 (Cartwright & Tayler 1971), so P1
 *  above K1 cannot come from it. Radiational forcing puts energy on both
 *  frequencies, though, and where the diurnal tide is a few millimetres it can
 *  bring P1 level with K1: Aladga in the Caspian, and S1 matching P1 across the
 *  Baltic (Medvedev, Rabinovich & Kulikov 2016). That explains P1 near K1 at a
 *  few millimetres, not a resolved P1 well above K1, so the gate applies once
 *  P1 reaches 10 mm. Baltic K1 runs about 4 to 30 mm. */
export const RESOLVED_P1 = 0.01;

/** How far apart, in km, a relay and the record it declares as its
 *  originator can be and still be the same gauge. Older relays round
 *  positions to 0.1°, about 11 km; beyond this the declaration is more likely
 *  wrong than the coordinates. */
export const MAX_PROVENANCE_KM = 10;

/** How far apart two records' M2 can be, as a vector difference relative to
 *  the larger amplitude, and still describe the same tide: about 8.6° of
 *  phase at equal amplitudes, or 15% of amplitude at equal phases. Across 447
 *  NOAA gauges, NOAA's own M2 against TICON's reanalysis of the same gauge
 *  has a 95th percentile of 0.137, which 0.15 rounds up. It is this project's
 *  definition, derived from those pairs. Beyond it, two merged
 *  records disagree by more than one gauge analyzed twice does, most often
 *  because one record's clock is off. */
export const SAME_GAUGE_M2_DIFFERENCE = 0.15;

/** Whether two records' M2 amplitudes contradict a claim that they are one
 *  gauge: both measurable, and apart by more than both MIN_AMPLITUDE_RATIO
 *  and AMPLITUDE_TOLERANCE. A record without M2, such as a subordinate, or
 *  with NOAA's 0 for a constituent it did not determine, has nothing to
 *  contradict. Quality evaluation and the merge report share it,
 *  so a relay superseded by its operator's record also joins its route. */
export function m2Contradicts(
  a: { harmonic_constituents?: { name: string; amplitude: number }[] },
  b: { harmonic_constituents?: { name: string; amplitude: number }[] },
): boolean {
  const m2 = (s: typeof a) =>
    s.harmonic_constituents?.find(({ name }) => name === "M2")?.amplitude;
  const [ma, mb] = [m2(a), m2(b)];
  if (!ma || !mb) return false;
  const low = Math.min(ma, mb);
  const high = Math.max(ma, mb);
  return exceeds(high, low) && low / high < MIN_AMPLITUDE_RATIO;
}

/** Minimum M2 amplitude ratio to consider two reference stations as duplicates.
 *  Pairs within MAX_DEDUP_DISTANCE but above MIN_DEDUP_DISTANCE are only
 *  deduplicated if their M2 amplitudes are similar: at least this ratio, or
 *  within AMPLITUDE_TOLERANCE of each other where M2 is measurable. */
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

// ── Seasonal dominance label ─────────────────────────────────────────────
// A different question from the gate above, and the two are easy to confuse.
// That gate asks whether a station's SA is anomalous *against its neighbours*,
// which catches a bad harmonic fit. This asks whether the seasonal curve is
// large against the station's *own* principal tide, which catches water that has no meaningful tide
// to begin with: a Great Lakes gauge, a river reach, a Baltic bodden. The
// contamination gate deliberately excludes these by comparing only within a
// tidal regime, so nothing else in the pass sees them.
//
// It labels rather than rejects. The predictions are correct — the annual
// cycle is really the dominant signal — so the record is not faulty and a
// consumer that knows what the water is can say so. Cobourg on Lake Ontario
// carries SA 0.289 m against a principal tide of 0.004 m and
// passes every other gate, including the 2 cm range floor.

/** The principal tidal constituents. Their amplitudes sum to the tide's
 *  height above mean level when spring and tropic tides coincide, an upper
 *  scale for its daily swing that leaves out the smaller constituents. The long-period terms (MM, MSF, MF) are left
 *  out on both sides: they are neither the daily tide nor the seasonal signal. */
export const PRINCIPAL_TIDAL_CONSTITUENTS = ["M2", "S2", "K1", "O1"];

type Term = { name: string; amplitude: number; phase: number };

/** Longitude of perihelion p′ in degrees: 282.94° at J2000 (Meeus 1998),
 *  advancing 1.72° a century, so 283.4° through the 2020s. */
const PERIHELION_LONGITUDE = 283.4;

/** A station's annual and semi-annual terms, under every name the sources
 *  use: SA and SSA (NOAA, TICON), Sa and Ssa (LINZ), and Kartverket's SA_KV
 *  with Ssa. SA_KV's argument is h − p′ rather than h, so its phase is moved
 *  by p′ to read on the same clock as SA. */
export function seasonalTerms(constituents: Term[]): {
  annual: Term | undefined;
  semiannual: Term | undefined;
} {
  const find = (...names: string[]) =>
    constituents.find((c) => names.includes(c.name));
  const kv = find("SA_KV");
  return {
    annual:
      find("SA", "Sa") ??
      (kv && { ...kv, phase: (kv.phase + PERIHELION_LONGITUDE) % 360 }),
    semiannual: find("SSA", "Ssa"),
  };
}

/** Largest departure from mean level of the seasonal curve
 *  SA·cos(θ − g_SA) + SSA·cos(2θ − g_SSA) over a year, sampled every half
 *  degree of θ. Phases matter: the two terms peak together only at some
 *  stations, so the larger amplitude understates the curve and their sum
 *  overstates it. */
export function seasonalPeak(constituents: Term[]): number {
  const { annual, semiannual } = seasonalTerms(constituents);
  const rad = Math.PI / 180;
  let peak = 0;
  for (let step = 0; step < 720; step++) {
    const theta = step / 2;
    const level =
      (annual ? annual.amplitude * Math.cos((theta - annual.phase) * rad) : 0) +
      (semiannual
        ? semiannual.amplitude * Math.cos((2 * theta - semiannual.phase) * rad)
        : 0);
    peak = Math.max(peak, Math.abs(level));
  }
  return peak;
}

/** How far the seasonal curve's peak (seasonalPeak) must exceed the principal
 *  tide before a station is labelled seasonal.
 *
 *  Sa and Ssa are mostly meteorological, steric and river-driven rather than
 *  astronomical (NOAA CO-OPS 2000, Tide and Current Glossary; Tsimplis &
 *  Woodworth 1994). At 1 the yearly swing is larger than the largest daily
 *  swing of the tide, which is the statement the label makes and the reason a
 *  tide table is the wrong frame for the station. No published criterion sets
 *  this line, so it is this project's definition, not a standard. Comparing
 *  against one constituent instead understates a mixed tide and labelled tidal
 *  stations such as Nome and Port Aransas.
 *
 *  A consumer that wants a stricter presentation threshold computes the ratio
 *  from the constituents it already ships. It is deliberately not a field here:
 *  the point of putting the verdict in the database is that two consumers
 *  describe the same water the same way, and a numeric ratio on the record is an
 *  invitation to pick a second threshold per consumer. `issues` states both
 *  heights in metres for a human reading the record, which is not a machine
 *  interface. */
export const SEASONAL_DOMINANCE_RATIO = 1;
