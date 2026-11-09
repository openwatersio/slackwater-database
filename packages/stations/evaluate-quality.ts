#!/usr/bin/env node

/**
 * Evaluates the quality of every provider tide record. `npm run stations`
 * writes the results into each station file's `computed` block.
 *
 * Pipeline (docs/quality-evaluation.md describes each rule):
 *   1. Load every record under data/
 *   2. Apply the rejection checks (position, datum ordering, tidal range,
 *      superseded relay, constituents, seasonal contamination)
 *   3. Compute the scored factors and the composite score
 *   4. Deduplicate: TICON records of one gauge, then records of every source
 *      by position and tide
 *
 * Run directly to print a summary:
 *   npm run report:quality -w packages/stations
 */

import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { DATA_DIR } from "./station.ts";
import { DATUM_EPOCH, M2_SPEED, NODAL_CYCLE_DAYS } from "@slackwater/datums";
import {
  distance,
  authoritativeDuplicateWinner,
  getSourceSuffix,
  getSourcePriority,
  MISFILED_RECORDS,
  constituentsDigest,
  scoresWorse,
  gaugeKey,
  coordinatePrecision,
  isAuthoritative,
  hasQualityIssues,
  epochYears,
  NULL_ISLAND_RADIUS,
  MAX_DEDUP_DISTANCE,
  MIN_DEDUP_DISTANCE,
  FALLBACK_DEDUP_DISTANCE,
  MAX_OFFSET_HEIGHT_DELTA,
  MAX_OFFSET_TIME_DELTA,
  MIN_AMPLITUDE_RATIO,
  AMPLITUDE_TOLERANCE,
  OBSERVED_BOUND_ALLOWANCE,
  hasObservedMeanDatums,
  SAME_GAUGE_M2_DIFFERENCE,
  CLOCK_ERROR_SOURCES,
  MAX_PROVENANCE_KM,
  m2Contradicts,
  RESOLVED_P1,
  seasonalPeak,
  seasonalTerms,
  exceeds,
  MIN_TIDAL_RANGE,
  SEASONAL_OUTLIER_RADIUS,
  SEASONAL_OUTLIER_MIN_SA,
  SEASONAL_OUTLIER_RATIO,
  SEASONAL_DOMINANCE_RATIO,
  PRINCIPAL_TIDAL_CONSTITUENTS,
} from "./filtering.ts";
import type { StationData } from "@slackwater/database";
import {
  declaredOriginator,
  hasUhslcMetadata,
} from "../../sources/ticon/provenance.ts";

// ── Types ───────────────────────────────────────────────────────────────

interface Station extends StationData {
  id: string;
}

interface Factors {
  epoch: number;
  recency: number;
  source: number;
  quality: number;
  amplitude: number;
  coverage: number;
}

export interface QualityResult {
  id: string;
  accepted: boolean;
  score: number;
  factors: Factors;
  issues: string[];
  reason?: string;
  redundant?: string;
  /** Seasonal curve peak above the principal tide — see checkSeasonalDominance. */
  seasonal_dominant?: boolean;
}

// TICON sources superseded outright: the current Rijkswaterstaat series covers
// the gauges of its historical one.
const SUPERSEDED_SOURCES = ["rws_hist"];

// Weights for composite score (must sum to 100)
const WEIGHTS = {
  epoch: 20,
  recency: 10,
  source: 20,
  quality: 15,
  amplitude: 20,
  coverage: 15,
};

// ── Helpers ──────────────────────────────────────────────────────────────

/** Resolve datums, falling back to the reference station for subordinates. */
function resolveDatums(
  station: Station,
  stationMap: Map<string, Station>,
): Record<string, number> {
  const datums = station.datums ?? {};
  if (Object.keys(datums).length > 0) return datums;
  return stationMap.get(station.offsets?.reference ?? "")?.datums ?? {};
}

/** Get a constituent amplitude by name, or 0 if not present. */
function getAmplitude(station: Station, name: string): number {
  const c = station.harmonic_constituents.find((c) => c.name === name);
  return c?.amplitude ?? 0;
}

function toFixed(n: number, precision = 3): number {
  const factor = 10 ** precision;
  return Math.round(n * factor) / factor;
}

/** Detect placeholder epoch dates like 0000-01-01. */
function hasValidEpoch(epoch?: { start: string; end: string }): boolean {
  if (!epoch) return false;
  const startYear = new Date(epoch.start).getUTCFullYear();
  const endYear = new Date(epoch.end).getUTCFullYear();
  // Year 0 or negative years are placeholder/invalid data
  return startYear > 0 && endYear > 0;
}

// ── Gates (pass/fail) ────────────────────────────────────────────────────

/** Check datum ordering. Returns fatal issues (gate failures) and warnings. */
export function checkDatumOrdering(
  station: Station,
  stationMap: Map<string, Station>,
): { fatal: string[]; warnings: string[] } {
  const datums = resolveDatums(station, stationMap);
  if (!datums || Object.keys(datums).length === 0)
    return { fatal: [], warnings: [] };

  const fatal: string[] = [];
  const warnings: string[] = [];
  // A finite observed mean includes weather and may cover a different period
  // from the pinned astronomical prediction. Their bounds are diagnostic,
  // not an exact physical ordering invariant. Keep small mismatches as
  // warnings, while large disagreements still reject an unsuitable model.
  const datumRecord = station.offsets?.reference
    ? stationMap.get(station.offsets.reference)
    : station;
  const astronomicalIssues = (difference: number) =>
    datumRecord &&
    hasObservedMeanDatums(datumRecord) &&
    Number(difference.toFixed(9)) <= OBSERVED_BOUND_ALLOWANCE
      ? warnings
      : fatal;
  const { MHHW, MHW, MSL, MTL, MLW, MLLW, LAT, HAT } = datums;

  // Core ordering: MHW > MSL > MLW — fatal gate
  if (MHW !== undefined && MSL !== undefined && MHW <= MSL) {
    fatal.push(`MHW (${MHW}) <= MSL (${MSL})`);
  }
  if (MSL !== undefined && MLW !== undefined && MSL <= MLW) {
    fatal.push(`MSL (${MSL}) <= MLW (${MLW})`);
  }
  if (MLW !== undefined && LAT !== undefined && MLW < LAT) {
    astronomicalIssues(LAT - MLW).push(`MLW (${MLW}) < LAT (${LAT})`);
  }
  // MHW must exceed MLLW (mean higher high > mean lower low)
  if (MHW !== undefined && MLLW !== undefined && MHW < MLLW) {
    fatal.push(`MHW (${MHW}) < MLLW (${MLLW})`);
  }
  // HAT is the highest possible tide — must be >= mean higher high water
  if (HAT !== undefined && MHHW !== undefined && HAT < MHHW) {
    astronomicalIssues(MHHW - HAT).push(`HAT (${HAT}) < MHHW (${MHHW})`);
  }

  // MTL between MHW and MLW — fatal gate
  if (MHW !== undefined && MTL !== undefined && MHW < MTL) {
    fatal.push(`MHW (${MHW}) < MTL (${MTL})`);
  }
  if (MTL !== undefined && MLW !== undefined && MTL < MLW) {
    fatal.push(`MTL (${MTL}) < MLW (${MLW})`);
  }

  // Diurnal pairs — warnings only (converge at weakly diurnal stations)
  if (MHHW !== undefined && MHW !== undefined && MHHW < MHW) {
    warnings.push(`MHHW (${MHHW}) < MHW (${MHW})`);
  }
  if (MLW !== undefined && MLLW !== undefined && MLW < MLLW) {
    warnings.push(`MLW (${MLW}) < MLLW (${MLLW})`);
  }

  // Extra chart datums — bounded/relational sanity checks (warnings only). These
  // do not belong in the strict monotonic chain above: the low-water cluster
  // (LAT / ISLW / LLWLT / TLT / MLWS) has no station-independent total order —
  // e.g. the ISLW-family datums fall below LAT at ~3% of stations by design.
  const { MLWS, MHWS, NLLW, ALLW, LLWLT, TLT } = datums;
  if (MLWS !== undefined && MLW !== undefined && MLWS > MLW) {
    warnings.push(`MLWS (${MLWS}) > MLW (${MLW})`);
  }
  if (MHWS !== undefined && MHW !== undefined && MHWS < MHW) {
    warnings.push(`MHWS (${MHWS}) < MHW (${MHW})`);
  }
  // Low chart datums should sit in a sane band: not above mean low water, and
  // not implausibly far below the lowest astronomical tide.
  const EPSILON = 0.5;
  for (const [name, value] of Object.entries({ NLLW, ALLW, LLWLT, TLT })) {
    if (value === undefined) continue;
    if (MLW !== undefined && value > MLW) {
      warnings.push(`${name} (${value}) > MLW (${MLW})`);
    }
    if (LAT !== undefined && value < LAT - EPSILON) {
      warnings.push(`${name} (${value}) < LAT (${LAT}) - ${EPSILON}`);
    }
  }

  return { fatal, warnings };
}

/** Check tidal range gate. Returns issue string or null. */
export function checkTidalRange(
  station: Station,
  stationMap: Map<string, Station>,
): string | null {
  const datums = resolveDatums(station, stationMap);
  const high = datums["MHW"];
  const low = datums["MLW"];
  if (high === undefined || low === undefined) return null; // can't evaluate
  const range = Number((high - low).toFixed(9));
  if (range < MIN_TIDAL_RANGE) {
    return `Tidal range ${(range * 100).toFixed(2)}cm < ${MIN_TIDAL_RANGE * 100}cm threshold`;
  }
  return null;
}

/** Reject stations whose coordinates sit on Null Island (0°, 0°). A record that
 *  fails to geolocate upstream commonly defaults to (0, 0), which places a gauge
 *  in the Gulf of Guinea far from its true location — where it can neither be
 *  deduplicated against the real station nor used for prediction. */
function checkCoordinates(station: Station): string | null {
  if (
    Math.abs(station.latitude) < NULL_ISLAND_RADIUS &&
    Math.abs(station.longitude) < NULL_ISLAND_RADIUS
  ) {
    return `Invalid coordinates near Null Island (${station.latitude}, ${station.longitude})`;
  }
  return null;
}

/** Reject a record from a source whose times are off by a measured amount. */
function checkTiming(station: Station): string | null {
  if (!station.id.startsWith("ticon/")) return null;
  const suffix = getSourceSuffix(station.source.id);
  const error = CLOCK_ERROR_SOURCES[suffix];
  return error ? `Clock error in source ${suffix}: ${error}` : null;
}

/** Reject a TICON record fitted from another gauge's data. */
function checkMisfiled(station: Station): string | null {
  if (!station.id.startsWith("ticon/")) return null;
  const error = MISFILED_RECORDS[station.source.id];
  return error ? `Misfiled data: ${error}` : null;
}

/** Each TICON gauge's declared originator, for the records of the gauge that
 *  have no UHSLC metadata of their own: UHSLC's metadata covers only its
 *  research-quality series, so its fast-delivery series follows a
 *  research-quality sibling. A record the metadata covers speaks for itself,
 *  even when no rule accepts what it names: Bermuda's 259A gives St. George's
 *  under UHSLC's own data source, so it declares nothing rather than taking
 *  259B's Ferry Reach. */
function originatorsByGauge(stations: Station[]): Map<string, string> {
  const originators = new Map<string, string>();
  for (const station of stations) {
    if (!station.id.startsWith("ticon/")) continue;
    const originator = declaredOriginator(station.id);
    if (!originator) continue;
    const key = gaugeKey(station.source.id);
    const other = originators.get(key);
    if (other && other !== originator)
      throw new Error(`${key} declares both ${other} and ${originator}`);
    originators.set(key, originator);
  }
  return originators;
}

/** A relay is superseded when the gauge's operator publishes its own
 *  harmonic constants and they pass every check here: the operator's analysis
 *  is the primary source. A relay of a gauge whose operator publishes no
 *  constants, or whose record is rejected, stands in for it. */
function checkSuperseded(
  station: Station,
  stationMap: Map<string, Station>,
  originators: Map<string, string>,
  failures: Map<string, Gate[]>,
): Gate | null {
  if (!station.id.startsWith("ticon/")) return null;
  const suffix = getSourceSuffix(station.source.id);
  if (SUPERSEDED_SOURCES.includes(suffix)) {
    return { reason: "superseded", issues: [`Superseded source: ${suffix}`] };
  }
  const originator =
    declaredOriginator(station.id) ??
    (hasUhslcMetadata(station.id)
      ? undefined
      : originators.get(gaugeKey(station.source.id)));
  const direct = originator ? stationMap.get(originator) : undefined;
  if (!direct?.harmonic_constituents?.length) return null;
  if (failures.get(direct.id)!.length > 0) return null;
  const apart = distance(
    station.latitude,
    station.longitude,
    direct.latitude,
    direct.longitude,
  );
  if (apart > MAX_PROVENANCE_KM) return null;
  // Amplitudes that contradict one gauge leave the pair to deduplication.
  // The merge report still joins a relay whose own id, or a NOAA station
  // number from NOAA, names the record, since the number says which gauge it
  // is (see planMerges).
  if (m2Contradicts(station, direct)) return null;
  const conflict = tideConflict(station, direct);
  return {
    reason: "superseded",
    issues: [
      `Superseded by ${direct.id}, its operator's own record`,
      ...(conflict ? [`${conflict} in ${direct.id}`] : []),
    ],
    by: direct.id,
  };
}

interface Gate {
  reason: string;
  issues: string[];
  /** The record that publishes this gauge instead, for a superseded relay. */
  by?: string;
}

/** Every check a record fails, in the order the reason is taken from, except
 *  the superseded relay check, which needs these results for the direct
 *  record. Datum warnings are not failures and are returned separately. */
function checkGates(
  station: Station,
  stationMap: Map<string, Station>,
  stations: Station[],
): { failures: Gate[]; warnings: string[] } {
  const failures: Gate[] = [];
  const fail = (reason: string, issue: string | null) => {
    if (issue) failures.push({ reason, issues: [issue] });
  };
  fail("coordinates", checkCoordinates(station));
  fail("timing", checkTiming(station));
  fail("misfiled", checkMisfiled(station));
  const datum = checkDatumOrdering(station, stationMap);
  if (datum.fatal.length > 0)
    failures.push({ reason: "datum", issues: datum.fatal });
  fail("range", checkTidalRange(station, stationMap));
  fail("constituents", checkConstituents(station));
  fail("seasonal", checkSeasonalContamination(station, stations));
  return { failures, warnings: datum.warnings };
}

/** Essential constituents needed for tide prediction. */
const ESSENTIAL_CONSTITUENTS = ["M2", "S2", "K1", "O1"];

/** Whether the source marks a constituent as not determined: NOAA publishes
 *  amplitude 0 with phase 0 for a constituent it left out of its analysis. */
function isNotDetermined(station: Station, name: string): boolean {
  const c = station.harmonic_constituents.find((h) => h.name === name);
  return station.id.startsWith("noaa/") && c?.amplitude === 0 && c.phase === 0;
}

/** Whether the record lists a constituent, at any amplitude. */
function hasConstituent(station: Station, name: string): boolean {
  return station.harmonic_constituents.some((c) => c.name === name);
}

/** Check that reference stations have the essential constituents for prediction. */
export function checkConstituents(station: Station): string | null {
  if (station.type === "subordinate") return null;

  const essential = isAuthoritative(station)
    ? ESSENTIAL_CONSTITUENTS.filter((name) => name !== "K1")
    : ESSENTIAL_CONSTITUENTS;
  const names = new Set(station.harmonic_constituents.map((c) => c.name));
  const missing = essential.filter((c) => !names.has(c));
  if (missing.length > 0) {
    return `Missing constituents for prediction: ${missing.join(", ")}`;
  }

  // NOAA publishes amplitude 0 with phase 0 for a constituent it did not
  // determine, so that pair is missing, not a measured zero. Any other small
  // amplitude is a real value below detection and predicts correctly.
  const notDetermined = essential.filter((c) => isNotDetermined(station, c));
  if (notDetermined.length > 0) {
    return `Essential constituents not determined by the source: ${notDetermined.join(", ")}`;
  }

  // The gravitational tide keeps P1 at a third of K1, so a resolved P1 above
  // K1 marks a bad fit (see RESOLVED_P1). The same physics holds whoever
  // published the record.
  const k1Amp = getAmplitude(station, "K1");
  const p1Amp = getAmplitude(station, "P1");
  if (p1Amp >= RESOLVED_P1 && exceeds(p1Amp, k1Amp)) {
    return `P1 amplitude (${p1Amp.toFixed(4)}) exceeds K1 (${k1Amp.toFixed(4)}): inconsistent with the gravitational tide`;
  }

  return null;
}

/** Median of a numeric array. Returns 0 for empty input. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Seasonal-contamination gate.
 *
 * A harmonic analysis of a short, gappy, or datum-shifted record can absorb
 * spurious energy into the seasonal band (the annual SA constituent), inflating
 * the predicted extreme range without any physical basis. SA is a
 * meteorological/steric signal that varies smoothly along a coast, so a station
 * whose SA amplitude grossly exceeds that of a hydraulically-connected
 * neighbour is almost certainly contaminated rather than physically distinct.
 *
 * Comparison is restricted to neighbours in the same tidal regime (similar M2)
 * so a genuine river-freshet station — large, real SA atop a small tide — is
 * only ever compared against other such stations, not the open coast. This
 * keeps the gate targeted at the failure mode the CHS range benchmark surfaces:
 * strongly tidal stations whose charted range is overstated.
 */
function checkSeasonalContamination(
  station: Station,
  allStations: Station[],
): string | null {
  // Authoritative sources (NOAA) are trusted; this targets TICON harmonic fits
  // and the water-levels lake fits of TICON's gauges.
  const gauge = ticonGauge(station);
  if (!gauge) return null;
  if (station.type === "subordinate") return null;

  const sa =
    seasonalTerms(station.harmonic_constituents).annual?.amplitude ?? 0;
  if (sa < SEASONAL_OUTLIER_MIN_SA) return null;
  if (getAmplitude(station, "M2") <= 0) return null; // no tidal regime to compare

  const neighbourSA: number[] = [];
  for (const other of allStations) {
    if (other.id === station.id) continue;
    if (other.type === "subordinate") continue;
    // A lake fit carries its TICON record's SA, so it can't vouch for that
    // record, and its record already votes for it anywhere else.
    if (!other.id.startsWith("ticon/") && other.source?.gauge) continue;
    if (!station.id.startsWith("ticon/") && ticonGauge(other) === gauge)
      continue;
    // Only neighbours with a genuine (positive) SA term can vouch. Treating an
    // SA=0 placeholder as a valid comparator would drag the median toward zero
    // and silently disable the gate where such placeholders are common.
    const otherSA = seasonalTerms(other.harmonic_constituents).annual;
    if (otherSA === undefined || otherSA.amplitude <= 0) continue;
    if (!hasSimilarM2(station, other)) continue; // same tidal regime only
    const d = distance(
      station.latitude,
      station.longitude,
      other.latitude,
      other.longitude,
    );
    if (d <= SEASONAL_OUTLIER_RADIUS) neighbourSA.push(otherSA.amplitude);
  }

  if (neighbourSA.length === 0) return null; // no same-regime neighbour to check
  const med = median(neighbourSA);
  if (med <= 0) return null;
  const ratio = sa / med;
  if (ratio < SEASONAL_OUTLIER_RATIO) return null;

  return (
    `SA amplitude (${sa.toFixed(3)}m) is ${ratio.toFixed(1)}x the median SA ` +
    `of ${neighbourSA.length} same-regime neighbour(s) within ` +
    `${SEASONAL_OUTLIER_RADIUS}km (${med.toFixed(3)}m): seasonal contamination`
  );
}

/**
 * Seasonal-dominance label.
 *
 * NOT the gate above it, and the difference is the whole point.
 * `checkSeasonalContamination` asks whether a station's SA is anomalous against
 * its *neighbours*, which catches a harmonic fit that absorbed spurious energy
 * into the seasonal band. This asks whether the seasonal curve is large against
 * the station's *own* principal tide, which catches water with no meaningful tide at all: a
 * Great Lakes gauge, a river reach, a Baltic bodden. The contamination gate
 * compares only within a tidal regime precisely so it does not fire on these,
 * so nothing else in the pass sees them.
 *
 * It labels and does not reject, which is why it sits outside the gate chain.
 * The predictions are right — the annual cycle really is the dominant signal —
 * so the record is not faulty. What it cannot survive is being presented as a
 * tide table: a consumer quoting a high and a low from the constituent sum is
 * reporting this year's river or lake level in the vocabulary of a tide, and an
 * entire 24-hour window can sit below the annual mean, which is where a
 * negative high above chart datum comes from.
 *
 * Every consumer inherits this, so the verdict belongs here rather than in each
 * one: two consumers picking their own ratio is how the same water gets
 * described two ways. `issues` carries the numbers for a human reading the
 * record; a consumer that wants its own, stricter presentation threshold
 * computes the ratio from the constituents it already ships rather than parsing
 * them back out of prose.
 *
 * A subordinate is measured on its reference's model, because that is the model
 * it predicts from: the reader fills a subordinate's `harmonic_constituents`
 * from its reference, so evaluating the raw record — which carries none — would
 * label the reference and leave its subordinates reading as ordinary tides on
 * the same water. The height offsets do not enter it: a ratio scales SA and the
 * tidal terms together and a fixed offset moves the datum, so neither changes
 * which band dominates.
 */
export function checkSeasonalDominance(
  station: Station,
  stationMap: Map<string, Station>,
): string | null {
  const model = station.harmonic_constituents?.length
    ? station
    : stationMap.get(station.offsets?.reference ?? "");
  // Nothing to measure: a current station, or a subordinate whose reference is
  // missing — which `checkConstituents` and the route builder already reject.
  if (!model?.harmonic_constituents?.length) return null;

  const seasonal = seasonalPeak(model.harmonic_constituents);
  if (seasonal === 0) return null;

  let tidal = 0;
  for (const name of PRINCIPAL_TIDAL_CONSTITUENTS) {
    tidal += Math.abs(getAmplitude(model, name));
  }

  // A difference inside the tolerance is not dominance. A principal tide of
  // zero still compares: the seasonal band need only be measurable.
  if (!exceeds(seasonal, tidal * SEASONAL_DOMINANCE_RATIO)) return null;

  // Named when the numbers are not in this station's own record, so a reader
  // of a subordinate's issues can find them.
  const measured = model === station ? "" : ` (from reference ${model.id})`;
  return (
    `Seasonal curve peak (${seasonal.toFixed(3)}m) exceeds the principal tide ` +
    `M2+S2+K1+O1 (${tidal.toFixed(3)}m)${measured}: ` +
    `the yearly swing exceeds the daily one`
  );
}

// ── Scored Factors (each returns 0.0–1.0) ────────────────────────────────

/** Epoch: the analyzed span over one nodal cycle (18.61 years), capped at 1.
 *  Subordinates inherit from their reference. A placeholder period (year
 *  0000) says nothing about the record, so it scores as no period. */
function scoreEpoch(
  station: Station,
  stationMap: Map<string, Station>,
): number {
  const epoch =
    station.epoch ?? stationMap.get(station.offsets?.reference ?? "")?.epoch;
  if (!hasValidEpoch(epoch)) return 0;
  const years = epochYears(epoch);
  return toFixed(Math.min(1, years / (NODAL_CYCLE_DAYS / 365.2425)));
}

/** Recency is measured against the pinned datum epoch, not today's date, so
 *  a re-run gives the same scores in any year. It moves when DATUM_EPOCH is
 *  bumped, which regenerates everything anyway. */
export const RECENCY_YEAR = DATUM_EPOCH.end.getUTCFullYear();

/** Recency: falls linearly from 1 for a period ending in RECENCY_YEAR to 0 a
 *  century earlier. Subordinates inherit from their reference. A placeholder
 *  period (year 0000) scores as no period. */
export function scoreRecency(
  station: Station,
  stationMap: Map<string, Station>,
): number {
  const epoch =
    station.epoch ?? stationMap.get(station.offsets?.reference ?? "")?.epoch;
  if (!epoch?.end || !hasValidEpoch(epoch)) return 0;

  // UTC, because epoch dates are bare dates parsed as UTC midnight. A local
  // getFullYear() reads "2025-01-01" as 2024 west of Greenwich, so the score
  // would differ between a laptop and CI.
  const endYear = new Date(epoch.end).getUTCFullYear();
  const age = RECENCY_YEAR - endYear;

  // Linear decay: 0 years old = 1.0, 100+ years old = 0.0
  return toFixed(Math.max(0, Math.min(1, 1 - age / 100)));
}

/** Source confidence: agency authority, DMI prediction-fit rank, or TICON provider priority. */
export function scoreSource(station: Station): number {
  // Prediction fits have no gauge-authority claim; their midrank is independent of TICON suffixes.
  const priority = isAuthoritative(station)
    ? 0
    : station.id.startsWith("dmi/")
      ? 50
      : // A fit from the water-levels lake ranks as the relay of its gauge.
        getSourcePriority(station.source.gauge ?? station.source.id);
  return toFixed(Math.max(0, 1 - priority / 99));
}

/** Quality flags: 1.0 if no issues, 0.0 if flagged. */
function scoreQuality(station: Station): number {
  return hasQualityIssues(station.disclaimers) ? 0 : 1;
}

/** Amplitude plausibility. Start at 1.0, subtract 0.25 per violation. */
export function scoreAmplitude(station: Station): {
  score: number;
  issues: string[];
} {
  // Subordinate stations inherit predictions from their reference
  if (station.type === "subordinate") {
    return { score: 1, issues: [] };
  }

  // If gated out by checkConstituents, this still runs but won't find issues
  if (station.harmonic_constituents.length === 0) {
    return { score: 0, issues: [] };
  }

  let score = 1;
  const issues: string[] = [];

  // Parent/child amplitude ordering (P1>K1 is handled as a fatal gate in checkConstituents)
  const pairs: [string, string][] = [
    ["M2", "N2"],
    ["S2", "K2"],
    ["O1", "Q1"],
  ];

  for (const [parent, child] of pairs) {
    const parentAmp = getAmplitude(station, parent);
    const childAmp = getAmplitude(station, child);
    if (
      hasConstituent(station, parent) &&
      hasConstituent(station, child) &&
      !isNotDetermined(station, parent) &&
      !isNotDetermined(station, child) &&
      exceeds(childAmp, parentAmp)
    ) {
      issues.push(
        `${child} amplitude (${childAmp.toFixed(4)}) exceeds ${parent} (${parentAmp.toFixed(4)})`,
      );
      score -= 0.25;
    }
  }

  // The form number (K1+O1)/(M2+S2) has no upper bound (Courtier 1938; NOAA
  // CO-OPS 2000): NOAA's own Gulf stations exceed 25. It is not a quality
  // signal, so only a record with no diurnal or semidiurnal tide at all is.
  const principal = PRINCIPAL_TIDAL_CONSTITUENTS.reduce(
    (sum, name) => sum + getAmplitude(station, name),
    0,
  );
  if (principal === 0) {
    issues.push("No diurnal or semidiurnal constituents with amplitude > 0");
    score -= 0.25;
  }

  return { score: toFixed(Math.max(0, score)), issues };
}

/** The TICON gauge a record describes: a TICON record's own, or the one a
 *  fit from the water-levels lake names. */
function ticonGauge(station: Station): string | undefined {
  const id = station.id.startsWith("ticon/")
    ? station.source.id
    : station.source?.gauge;
  return id ? gaugeKey(id) : undefined;
}

/** Coverage: distance to the nearest other gauge that passed every check.
 *  A record of the same TICON gauge is not another gauge, and a rejected
 *  record adds nothing to the map, so neither counts. */
export function scoreCoverage(station: Station, neighbors: Station[]): number {
  const gauge = ticonGauge(station);
  let minDist = Infinity;
  for (const other of neighbors) {
    if (other.id === station.id) continue;
    if (gauge && ticonGauge(other) === gauge) continue;
    const d = distance(
      station.latitude,
      station.longitude,
      other.latitude,
      other.longitude,
    );
    if (d < minDist) {
      minDist = d;
      if (d < 0.001) break; // essentially co-located, no need to keep searching
    }
  }
  return toFixed(Math.min(1, minDist / 50));
}

// ── Composite Score ──────────────────────────────────────────────────────

function computeCompositeScore(factors: Factors): number {
  return Math.round(
    factors.epoch * WEIGHTS.epoch +
      factors.recency * WEIGHTS.recency +
      factors.source * WEIGHTS.source +
      factors.quality * WEIGHTS.quality +
      factors.amplitude * WEIGHTS.amplitude +
      factors.coverage * WEIGHTS.coverage,
  );
}

// ── I/O ─────────────────────────────────────────────────────────────────

/** Every provider tide record, in id order: dedup is greedy, so the order in
 *  which records are weighed decides ties, and readdir order varies by
 *  filesystem. */
export async function loadAllStations(): Promise<Station[]> {
  const stations: Station[] = [];
  const sources = (await readdir(DATA_DIR)).sort();

  for (const source of sources) {
    const sourceDir = join(DATA_DIR, source);
    let files: string[];
    try {
      files = (await readdir(sourceDir)).sort();
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const data = JSON.parse(
        await readFile(join(sourceDir, file), "utf-8"),
      ) as StationData;
      stations.push({
        ...data,
        id: `${source}/${file.replace(/\.json$/, "")}`,
      });
    }
  }

  return stations;
}

// ── Deduplication ────────────────────────────────────────────────────────

/** Check if two reference stations have similar M2 amplitudes: within the
 *  ratio, or within AMPLITUDE_TOLERANCE where M2 is too small for a ratio to
 *  mean anything. Two M2 values both inside the tolerance carry no evidence
 *  either way, so they do not make a pair similar. */
export function hasSimilarM2(stationA: Station, stationB: Station): boolean {
  const m2A = stationA.harmonic_constituents.find((c) => c.name === "M2");
  const m2B = stationB.harmonic_constituents.find((c) => c.name === "M2");
  if (!m2A || !m2B) return false;
  const low = Math.min(m2A.amplitude, m2B.amplitude);
  const high = Math.max(m2A.amplitude, m2B.amplitude);
  if (high <= AMPLITUDE_TOLERANCE) return false;
  return !exceeds(high, low) || low / high >= MIN_AMPLITUDE_RATIO;
}

/** Check if two subordinate stations would produce the same tide prediction:
 *  same reference station and matching height/time offsets within tolerance.
 *  Two subordinates can share (coarse or placeholder) coordinates while
 *  predicting entirely differently, so proximity alone must not merge them. */
function hasSimilarOffsets(stationA: Station, stationB: Station): boolean {
  const a = stationA.offsets;
  const b = stationB.offsets;
  if (!a || !b) return false;
  if (a.reference !== b.reference) return false;
  if (a.height.type !== b.height.type) return false;
  return (
    Math.abs(a.height.high - b.height.high) <= MAX_OFFSET_HEIGHT_DELTA &&
    Math.abs(a.height.low - b.height.low) <= MAX_OFFSET_HEIGHT_DELTA &&
    Math.abs(a.time.high - b.time.high) <= MAX_OFFSET_TIME_DELTA &&
    Math.abs(a.time.low - b.time.low) <= MAX_OFFSET_TIME_DELTA
  );
}

/** Check if two stations are duplicates based on distance and harmonic similarity.
 *
 *  - Two subordinate stations: duplicates only if within FALLBACK_DEDUP_DISTANCE and
 *    predicting the same tide (same reference + equivalent offsets), since
 *    distinct subordinates can share placeholder coordinates
 *    (proximity alone is insufficient for subordinates)
 *  - Between MIN_DEDUP_DISTANCE and MAX_DEDUP_DISTANCE: duplicates only if
 *    both are reference stations with similar M2 amplitudes (ratio >= 0.9)
 *  - Beyond MAX_DEDUP_DISTANCE: never duplicates
 */
function areDuplicates(
  stationA: Station,
  stationB: Station,
  dist: number,
  winnerHasSubordinates = false,
): boolean {
  if (dist > MAX_DEDUP_DISTANCE) return false;

  // Two subordinate stations at (near-)identical coordinates can still be
  // different places — a mislocated record inherits another station's fix while
  // keeping its own offsets. Keep the existing proximity threshold, but only
  // merge them when they'd also predict the same tide.
  if (stationA.type === "subordinate" && stationB.type === "subordinate") {
    return (
      dist <= FALLBACK_DEDUP_DISTANCE && hasSimilarOffsets(stationA, stationB)
    );
  }

  if (dist <= MIN_DEDUP_DISTANCE) return true;

  // For the middle range, require harmonic similarity between reference stations.
  // If the winner has subordinates, also accept a 100m distance fallback — a
  // reference station with dependents should knock out a nearby station even
  // when M2 amplitudes are very small and the ratio falls slightly below 0.9.
  if (stationA.type === "reference" && stationB.type === "reference") {
    if (winnerHasSubordinates && dist <= FALLBACK_DEDUP_DISTANCE) return true;
    return hasSimilarM2(stationA, stationB);
  }

  // Subordinate stations in the middle range: use a tighter distance threshold
  // since we can't compare harmonics
  return dist <= FALLBACK_DEDUP_DISTANCE; // 100m fallback for subordinates
}

/** Count accepted subordinate stations per reference station. */
function countSubordinates(
  stations: Station[],
  resultsMap: Map<string, QualityResult>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const station of stations) {
    if (station.type !== "subordinate") continue;
    if (!resultsMap.get(station.id)!.accepted) continue;
    const ref = station.offsets?.reference;
    if (ref) counts.set(ref, (counts.get(ref) ?? 0) + 1);
  }
  return counts;
}

/** Proximity deduplication. Records are taken best first (see `precedence`);
 *  each one still accepted absorbs every later record that duplicates it. A
 *  record that has lost never absorbs another, so the outcome does not depend
 *  on the order the records were loaded in.
 *
 *  Two records are as close as any of the positions recorded for their
 *  gauges: the records of one TICON gauge can place it kilometers apart, and
 *  the one kept is not always the one beside a neighboring record. */
function deduplicate(
  stationIds: string[],
  stationMap: Map<string, Station>,
  resultsMap: Map<string, QualityResult>,
  subordinateCounts: Map<string, number>,
  positions: Map<string, Station[]>,
): void {
  const ranked = [...stationIds].sort(
    precedence(stationMap, resultsMap, subordinateCounts),
  );
  const rejected = new Set<string>();

  for (let i = 0; i < ranked.length; i++) {
    const idA = ranked[i]!;
    if (rejected.has(idA)) continue;
    const stationA = stationMap.get(idA)!;
    const hasSubs = (subordinateCounts.get(idA) ?? 0) > 0;

    for (let j = i + 1; j < ranked.length; j++) {
      const idB = ranked[j]!;
      if (rejected.has(idB)) continue;
      const stationB = stationMap.get(idB)!;

      const own = distance(
        stationA.latitude,
        stationA.longitude,
        stationB.latitude,
        stationB.longitude,
      );
      if (!areDuplicates(stationA, stationB, own, hasSubs)) {
        // Through another record of the same gauge, two records can meet
        // where their own positions do not. Two reference stations must then
        // also agree on tide, so a historical record placed at a modern gauge
        // does not absorb that gauge. A subordinate has no constants of its
        // own to compare and keeps the position rule.
        let dist = Infinity;
        for (const a of positions.get(idA) ?? [stationA])
          for (const b of positions.get(idB) ?? [stationB])
            dist = Math.min(
              dist,
              distance(a.latitude, a.longitude, b.latitude, b.longitude),
            );
        if (dist === own) continue;
        if (!areDuplicates(stationA, stationB, dist, hasSubs)) continue;
        if (
          stationA.type === "reference" &&
          stationB.type === "reference" &&
          tideConflict(stationB, stationA)
        )
          continue;
      }

      markDuplicate(resultsMap, stationMap, idB, idA);
      rejected.add(idB);
    }
  }
}

function markDuplicate(
  results: Map<string, QualityResult>,
  stationMap: Map<string, Station>,
  loser: string,
  winner: string,
): void {
  const result = results.get(loser)!;
  result.accepted = false;
  result.reason = "duplicate";
  result.redundant = winner;
  const a = stationMap.get(loser)!;
  const b = stationMap.get(winner)!;
  const kept = tideConflict(a, b);
  if (kept) result.issues.push(`${kept} in ${winner}, which this duplicates`);
  const duplicate = tideConflict(b, a);
  if (duplicate)
    results.get(winner)!.issues.push(`${duplicate} in ${loser}, a duplicate`);
}

/** How record `a`'s M2 disagrees with `b`'s, when they disagree by more than
 *  one gauge analyzed twice does (SAME_GAUGE_M2_DIFFERENCE), with the phase
 *  difference as time.
 *  The pair stays merged: a disagreement this close is most often one
 *  record's clock error, which publishing both would not fix. */
export function tideConflict(a: Station, b: Station): string | null {
  const m2A = a.harmonic_constituents?.find((c) => c.name === "M2");
  const m2B = b.harmonic_constituents?.find((c) => c.name === "M2");
  if (!m2A || !m2B) return null;
  const rad = Math.PI / 180;
  const difference = Math.hypot(
    m2A.amplitude * Math.cos(m2A.phase * rad) -
      m2B.amplitude * Math.cos(m2B.phase * rad),
    m2A.amplitude * Math.sin(m2A.phase * rad) -
      m2B.amplitude * Math.sin(m2B.phase * rad),
  );
  const larger = Math.max(m2A.amplitude, m2B.amplitude);
  if (
    difference <= AMPLITUDE_TOLERANCE ||
    difference <= SAME_GAUGE_M2_DIFFERENCE * larger
  )
    return null;
  const phase = ((m2A.phase - m2B.phase + 540) % 360) - 180;
  const minutes = Math.round((phase / M2_SPEED) * 60);
  const mm = Math.round((m2A.amplitude - m2B.amplitude) * 1000);
  return (
    `M2 here (${m2A.amplitude.toFixed(3)} m, ${m2A.phase.toFixed(1)}°) ` +
    `differs from (${m2B.amplitude.toFixed(3)} m, ${m2B.phase.toFixed(1)}°) ` +
    `by ${mm >= 0 ? "+" : ""}${mm} mm and ${Math.abs(minutes)} min ` +
    `${minutes >= 0 ? "later" : "earlier"}`
  );
}

/** The order in which duplicates are kept, best first:
 *
 *  1. A record that wins on authority (`winsOnAuthority`) beats a relay.
 *  2. A reference station beats a subordinate. A subordinate predicts from a
 *     distant reference plus offsets; a reference was analyzed at the gauge.
 *  3. A reference with accepted subordinates beats one without, so they keep
 *     the reference they predict from.
 *  4. The higher score wins.
 *  5. At an equal score, any other record beats a CMEMS one. CMEMS relays
 *     European agencies' gauges, and its data is for non-commercial use only;
 *     a better-scored CMEMS record, longer or without a quality flag, still
 *     wins.
 *  6. The more precisely located record wins, keeping the surveyed fix over a
 *     coarsely rounded one.
 *  7. Otherwise the lower id, so the result is the same on every machine. */
function precedence(
  stationMap: Map<string, Station>,
  resultsMap: Map<string, QualityResult>,
  subordinateCounts: Map<string, number>,
): (idA: string, idB: string) => number {
  return (idA, idB) => {
    const a = stationMap.get(idA)!;
    const b = stationMap.get(idB)!;
    const authority = authoritativeDuplicateWinner(a, b);
    if (authority) return authority === idA ? -1 : 1;
    if (a.type !== b.type) return a.type === "reference" ? -1 : 1;
    const subsA = (subordinateCounts.get(idA) ?? 0) > 0;
    const subsB = (subordinateCounts.get(idB) ?? 0) > 0;
    if (subsA !== subsB) return subsA ? -1 : 1;
    const score = resultsMap.get(idB)!.score - resultsMap.get(idA)!.score;
    if (score !== 0) return score;
    const relayA = getSourceSuffix(a.source.id) === "cmems";
    const relayB = getSourceSuffix(b.source.id) === "cmems";
    if (relayA !== relayB) return relayA ? 1 : -1;
    const precision =
      coordinatePrecision(b.latitude, b.longitude) -
      coordinatePrecision(a.latitude, a.longitude);
    if (precision !== 0) return precision;
    return idA < idB ? -1 : idA > idB ? 1 : 0;
  };
}

/** Shared TICON gauge IDs unify moved segments (#112); supersession must retain that identity and each relay’s own declaration. */
export function deduplicateByGauge(
  stationIds: string[],
  stationMap: Map<string, Station>,
  resultsMap: Map<string, QualityResult>,
  subordinateCounts: Map<string, number>,
): void {
  const groups = new Map<string, string[]>();
  for (const id of stationIds) {
    if (!id.startsWith("ticon/")) continue;
    const key = gaugeKey(stationMap.get(id)!.source.id);
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(id);
  }

  const order = precedence(stationMap, resultsMap, subordinateCounts);
  for (const ids of groups.values()) {
    const accepted = ids.filter((id) => resultsMap.get(id)!.accepted);
    const operators = new Set(
      ids
        .filter((id) => resultsMap.get(id)!.reason === "superseded")
        .flatMap((id) => resultsMap.get(id)!.redundant ?? []),
    );
    if (operators.size > 1)
      throw new Error(
        `Conflicting operators for gauge ${gaugeKey(stationMap.get(ids[0]!)!.source.id)}`,
      );
    const superseded = ids.find(
      (id) =>
        resultsMap.get(id)!.reason === "superseded" &&
        resultsMap.get(id)!.redundant,
    );
    // A relay's own UHSLC metadata outranks a sibling's operator declaration.
    const inherited = superseded
      ? accepted.filter((id) => !hasUhslcMetadata(id))
      : [];
    for (const id of inherited)
      markDuplicate(
        resultsMap,
        stationMap,
        id,
        resultsMap.get(superseded!)!.redundant!,
      );
    const [winner, ...losers] = accepted
      .filter((id) => !inherited.includes(id))
      .sort(order);
    if (!winner) continue;
    for (const id of losers) markDuplicate(resultsMap, stationMap, id, winner);
  }
}

/** A fit from the water-levels lake against the TICON records of its gauge,
 *  as the lake files them, on its held-out year. A fit worse than an
 *  accepted record beyond the tolerance is a duplicate of the best of them.
 *  Otherwise every accepted one is a duplicate of the fit: it comes from the
 *  agency's own series and can be refitted, and TICON's can't. Scores taken
 *  against constants that have since changed decide nothing. */
export function decideHeldOut(
  stationIds: string[],
  stationMap: Map<string, Station>,
  resultsMap: Map<string, QualityResult>,
): void {
  for (const id of stationIds) {
    const held_out = stationMap.get(id)!.source?.held_out;
    if (!held_out || !resultsMap.get(id)!.accepted) continue;
    const scored = Object.entries(held_out.ticon).flatMap(([ticon, score]) => {
      const relay = stationMap.get(`ticon/${ticon}`);
      if (!relay || !resultsMap.get(relay.id)!.accepted) return [];
      // The lake's filing is trusted only as far as a declared originator is.
      const fit = stationMap.get(id)!;
      const apart = distance(
        fit.latitude,
        fit.longitude,
        relay.latitude,
        relay.longitude,
      );
      if (apart > MAX_PROVENANCE_KM) {
        resultsMap
          .get(id)!
          .issues.push(
            `The lake files ${relay.id} under this series, ${apart.toFixed(1)} km away; not compared`,
          );
        return [];
      }
      if (score.digest !== constituentsDigest(relay.harmonic_constituents)) {
        resultsMap
          .get(id)!
          .issues.push(
            `Held-out scores were taken against ${relay.id}'s constants as they were before; re-run the water-levels import with FORCE_HARMONICS=1`,
          );
        return [];
      }
      // A standard error that couldn't be measured is stored as null; such a
      // difference is never resolved.
      return [{ id: relay.id, rms: score.rms, se: score.se ?? Infinity }];
    });
    const best = scored
      .filter((s) => scoresWorse(held_out.rms, s.rms, s.se))
      .sort((a, b) => a.rms - b.rms)[0];
    if (best) markDuplicate(resultsMap, stationMap, id, best.id);
    else
      for (const { id: relay } of scored)
        markDuplicate(resultsMap, stationMap, relay, id);
  }
}

/** Point every duplicate at the record that is published for its gauge. A
 *  gauge's best record can itself lose to a nearby record in the proximity
 *  pass, which would otherwise leave its own duplicates pointing at a record
 *  that is not published. */
function resolveRedundant(resultsMap: Map<string, QualityResult>): void {
  for (const result of resultsMap.values()) {
    let target = result.redundant;
    const seen = new Set<string>();
    while (target && !resultsMap.get(target)!.accepted && !seen.has(target)) {
      seen.add(target);
      target = resultsMap.get(target)!.redundant;
    }
    if (target) result.redundant = target;
  }
}

// ── Main ────────────────────────────────────────────────────────────────

/** Every provider tide record's quality, sorted by id. */
export async function evaluateQuality(): Promise<QualityResult[]> {
  const stations = await loadAllStations();
  const stationMap = new Map(stations.map((s) => [s.id, s]));

  // Step 1: Compute factors and apply gates
  const resultsMap = new Map<string, QualityResult>();

  const gates = new Map(
    stations.map((s) => [s.id, checkGates(s, stationMap, stations)]),
  );
  const failures = new Map(
    [...gates].map(([id, { failures }]) => [id, failures]),
  );
  const originators = originatorsByGauge(stations);

  for (const station of stations) {
    const { warnings } = gates.get(station.id)!;
    const failed = [...failures.get(station.id)!];
    const superseded = checkSuperseded(
      station,
      stationMap,
      originators,
      failures,
    );
    if (superseded) {
      // Taken after a record's own data checks and before its constituents.
      const at = failed.findIndex((g) =>
        ["constituents", "seasonal"].includes(g.reason),
      );
      failed.splice(at === -1 ? failed.length : at, 0, superseded);
    }

    // Every failed check is listed, so fixing one cannot reveal another that
    // was never reported; the first sets `reason`. Datum warnings are not
    // failures.
    const issues: string[] = [...warnings];
    const gateReason = failed[0]?.reason;
    for (const gate of failed) issues.push(...gate.issues);

    // A label, deliberately outside the gate chain above: a seasonal-dominated
    // station is accepted, and its consumers decide how to present water whose
    // yearly swing exceeds its daily one.
    //
    // Set whenever it is true, including on a station some gate rejected. It is
    // a statement about the water rather than permission to publish, so it does
    // not depend on the verdict — and it could not cleanly anyway, since
    // deduplication rejects stations after this loop has run.
    const dominanceIssue = checkSeasonalDominance(station, stationMap);
    if (dominanceIssue) issues.push(dominanceIssue);

    // Scored factors
    const amplitudeResult = scoreAmplitude(station);
    issues.push(...amplitudeResult.issues);

    const factors: Factors = {
      epoch: scoreEpoch(station, stationMap),
      recency: scoreRecency(station, stationMap),
      source: scoreSource(station),
      quality: scoreQuality(station),
      amplitude: amplitudeResult.score,
      coverage: 0, // computed in step 2
    };

    const result: QualityResult = {
      id: station.id,
      accepted: !gateReason,
      score: 0, // computed after coverage
      factors,
      issues,
      ...(gateReason ? { reason: gateReason } : {}),
      ...(failed[0]?.by ? { redundant: failed[0].by } : {}),
      ...(dominanceIssue ? { seasonal_dominant: true } : {}),
    };

    resultsMap.set(station.id, result);
  }

  // Step 2: Compute coverage (needs every record's checks)
  const passed = stations.filter((s) => resultsMap.get(s.id)!.accepted);
  for (const station of stations) {
    const result = resultsMap.get(station.id)!;
    result.factors.coverage = scoreCoverage(station, passed);
  }

  // Step 3: Compute composite scores
  for (const result of resultsMap.values()) {
    if (result.accepted) {
      result.score = computeCompositeScore(result.factors);
    }
    // Gate failures keep score = 0
  }

  // Step 4: Deduplicate
  const subordinateCounts = countSubordinates(stations, resultsMap);

  // 4a: Collapse same-gauge records (shared station code) regardless of distance.
  const acceptedIds = stations
    .filter((s) => resultsMap.get(s.id)!.accepted)
    .map((s) => s.id);
  const gaugeIds = stations
    .filter((s) => {
      const result = resultsMap.get(s.id)!;
      return result.accepted || result.reason === "superseded";
    })
    .map((s) => s.id);
  // A lake fit settles its gauge's TICON records on its held-out year first.
  decideHeldOut(acceptedIds, stationMap, resultsMap);
  deduplicateByGauge(
    gaugeIds.filter(
      (id) =>
        resultsMap.get(id)!.accepted ||
        resultsMap.get(id)!.reason === "superseded",
    ),
    stationMap,
    resultsMap,
    subordinateCounts,
  );

  // 4b: Deduplicate the survivors by proximity and harmonic similarity.
  const survivingIds = acceptedIds.filter((id) => resultsMap.get(id)!.accepted);
  const positions = new Map<string, Station[]>();
  for (const id of acceptedIds) {
    const result = resultsMap.get(id)!;
    const kept = result.accepted ? id : result.redundant!;
    (positions.get(kept) ?? positions.set(kept, []).get(kept)!).push(
      stationMap.get(id)!,
    );
  }
  deduplicate(
    survivingIds,
    stationMap,
    resultsMap,
    subordinateCounts,
    positions,
  );
  resolveRedundant(resultsMap);

  // Codepoint order, not localeCompare: the output must not depend on the
  // machine's ICU locale.
  return [...resultsMap.values()].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
}

async function main() {
  const results = await evaluateQuality();

  // Summary
  const accepted = results.filter((r) => r.accepted);
  const rejected = results.filter((r) => !r.accepted);
  const reasonCounts: Record<string, number> = {};
  for (const r of rejected) {
    reasonCounts[r.reason!] = (reasonCounts[r.reason!] ?? 0) + 1;
  }

  console.log("\n=== Quality Evaluation Summary ===\n");
  console.log(
    `Accepted: ${accepted.length} (NOAA: ${accepted.filter((r) => r.id.startsWith("noaa/")).length}, TICON: ${accepted.filter((r) => r.id.startsWith("ticon/")).length})`,
  );
  console.log(`Rejected: ${rejected.length}`);
  for (const [reason, count] of Object.entries(reasonCounts).sort()) {
    console.log(`  ${reason}: ${count}`);
  }

  // Score distribution
  const scores = accepted.map((r) => r.score);
  scores.sort((a, b) => a - b);
  const p25 = scores[Math.floor(scores.length * 0.25)] ?? 0;
  const p50 = scores[Math.floor(scores.length * 0.5)] ?? 0;
  const p75 = scores[Math.floor(scores.length * 0.75)] ?? 0;
  const min = scores[0] ?? 0;
  const max = scores[scores.length - 1] ?? 0;

  console.log(`\nScore distribution (accepted stations):`);
  console.log(
    `  Min: ${min}  P25: ${p25}  Median: ${p50}  P75: ${p75}  Max: ${max}`,
  );

  // Issues summary
  const stationsWithIssues = results.filter(
    (r) => r.accepted && r.issues.length > 0,
  );
  console.log(`\nAccepted stations with issues: ${stationsWithIssues.length}`);
}

if (import.meta.main) await main();
