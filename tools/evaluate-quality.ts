#!/usr/bin/env node

/**
 * Evaluates station quality and produces quality.json
 *
 * Pipeline:
 *   1. Load all stations (NOAA + TICON)
 *   2. Compute quality factors for each station
 *   3. Apply hard gates (datum ordering, tidal range, superseded source,
 *      missing constituents, seasonal contamination)
 *   4. Deduplicate TICON stations by proximity
 *   5. Compute composite score and write results
 *
 * Output:
 *   quality.json — all stations with factors, score, and accept/reject status
 *
 * Usage:
 *   node tools/evaluate-quality.ts
 */

import { readdir, readFile, writeFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { DATA_DIR } from "./station.ts";
import { NODAL_CYCLE_DAYS } from "./datum.ts";
import {
  distance,
  getSourceSuffix,
  getSourcePriority,
  gaugeKey,
  coordinatePrecision,
  hasQualityIssues,
  epochYears,
  NULL_ISLAND_RADIUS,
  MAX_DEDUP_DISTANCE,
  MIN_DEDUP_DISTANCE,
  FALLBACK_DEDUP_DISTANCE,
  MAX_OFFSET_HEIGHT_DELTA,
  MAX_OFFSET_TIME_DELTA,
  MIN_AMPLITUDE_RATIO,
  MIN_TIDAL_RANGE,
  SEASONAL_OUTLIER_RADIUS,
  SEASONAL_OUTLIER_MIN_SA,
  SEASONAL_OUTLIER_RATIO,
} from "./filtering.ts";
import type { StationData } from "../src/types.js";

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

interface QualityResult {
  id: string;
  accepted: boolean;
  score: number;
  factors: Factors;
  issues: string[];
  reason?: string;
  redundant?: string;
}

// Sources superseded by better datasets in this database
const SUPERSEDED_SOURCES = ["noaa", "rws_hist"];

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
  const startYear = new Date(epoch.start).getFullYear();
  const endYear = new Date(epoch.end).getFullYear();
  // Year 0 or negative years are placeholder/invalid data
  return startYear > 0 && endYear > 0;
}

// ── Gates (pass/fail) ────────────────────────────────────────────────────

/** Check datum ordering. Returns fatal issues (gate failures) and warnings. */
function checkDatumOrdering(
  station: Station,
  stationMap: Map<string, Station>,
): { fatal: string[]; warnings: string[] } {
  const datums = resolveDatums(station, stationMap);
  if (!datums || Object.keys(datums).length === 0)
    return { fatal: [], warnings: [] };

  const fatal: string[] = [];
  const warnings: string[] = [];
  const { MHHW, MHW, MSL, MTL, MLW, MLLW, LAT, HAT } = datums;

  // Core ordering: MHW > MSL > MLW — fatal gate
  if (MHW !== undefined && MSL !== undefined && MHW <= MSL) {
    fatal.push(`MHW (${MHW}) <= MSL (${MSL})`);
  }
  if (MSL !== undefined && MLW !== undefined && MSL <= MLW) {
    fatal.push(`MSL (${MSL}) <= MLW (${MLW})`);
  }
  if (MLW !== undefined && LAT !== undefined && MLW < LAT) {
    fatal.push(`MLW (${MLW}) < LAT (${LAT})`);
  }
  // MHW must exceed MLLW (mean higher high > mean lower low)
  if (MHW !== undefined && MLLW !== undefined && MHW < MLLW) {
    fatal.push(`MHW (${MHW}) < MLLW (${MLLW})`);
  }
  // HAT is the highest possible tide — must be >= mean higher high water
  if (HAT !== undefined && MHHW !== undefined && HAT < MHHW) {
    fatal.push(`HAT (${HAT}) < MHHW (${MHHW})`);
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
function checkTidalRange(
  station: Station,
  stationMap: Map<string, Station>,
): string | null {
  const datums = resolveDatums(station, stationMap);
  const high = datums["MHW"];
  const low = datums["MLW"];
  if (high === undefined || low === undefined) return null; // can't evaluate
  const range = high - low;
  if (range < MIN_TIDAL_RANGE) {
    return `Tidal range ${(range * 100).toFixed(1)}cm < ${MIN_TIDAL_RANGE * 100}cm threshold`;
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

/** Check if source is superseded. */
function checkSuperseded(station: Station): string | null {
  if (!station.id.startsWith("ticon/")) return null;
  const suffix = getSourceSuffix(station.source.id);
  if (SUPERSEDED_SOURCES.includes(suffix)) {
    return `Superseded source: ${suffix}`;
  }
  return null;
}

/** Essential constituents needed for tide prediction. */
const ESSENTIAL_CONSTITUENTS = ["M2", "S2", "K1", "O1"];

/** Check that reference stations have the essential constituents for prediction. */
function checkConstituents(station: Station): string | null {
  if (station.type === "subordinate") return null;

  const names = new Set(station.harmonic_constituents.map((c) => c.name));
  const missing = ESSENTIAL_CONSTITUENTS.filter((c) => !names.has(c));
  if (missing.length > 0) {
    return `Missing constituents for prediction: ${missing.join(", ")}`;
  }

  // A constituent with zero amplitude provides no tidal signal — treat as missing
  const zeroAmplitude = ESSENTIAL_CONSTITUENTS.filter((c) => {
    const constituent = station.harmonic_constituents.find((h) => h.name === c);
    return constituent !== undefined && constituent.amplitude === 0;
  });
  if (zeroAmplitude.length > 0) {
    return `Essential constituents with zero amplitude: ${zeroAmplitude.join(", ")}`;
  }

  // P1 > K1 is physically impossible — P1/K1 ≈ 0.331 in equilibrium theory
  const k1Amp =
    station.harmonic_constituents.find((c) => c.name === "K1")?.amplitude ?? 0;
  const p1Amp =
    station.harmonic_constituents.find((c) => c.name === "P1")?.amplitude ?? 0;
  if (k1Amp > 0 && p1Amp > k1Amp) {
    return `P1 amplitude (${p1Amp.toFixed(4)}) exceeds K1 (${k1Amp.toFixed(4)}): physically impossible`;
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
  // Authoritative sources (NOAA) are trusted; this targets harmonic fits
  // (TICON's, and our own from IOC observations).
  if (station.id.startsWith("noaa/")) return null;
  if (station.type === "subordinate") return null;

  const sa = getAmplitude(station, "SA");
  if (sa < SEASONAL_OUTLIER_MIN_SA) return null;
  if (getAmplitude(station, "M2") <= 0) return null; // no tidal regime to compare

  const neighbourSA: number[] = [];
  for (const other of allStations) {
    if (other.id === station.id) continue;
    if (other.type === "subordinate") continue;
    // Only neighbours with a genuine (positive) SA term can vouch. Treating an
    // SA=0 placeholder as a valid comparator would drag the median toward zero
    // and silently disable the gate where such placeholders are common.
    const otherSA = other.harmonic_constituents.find((c) => c.name === "SA");
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

// ── Scored Factors (each returns 0.0–1.0) ────────────────────────────────

/** Epoch: years/19 capped at 1.0. Subordinates inherit from reference.
 *  Stations with placeholder dates (year 0000) get benefit of the doubt. */
function scoreEpoch(
  station: Station,
  stationMap: Map<string, Station>,
): number {
  const epoch =
    station.epoch ?? stationMap.get(station.offsets?.reference ?? "")?.epoch;
  if (epoch && !hasValidEpoch(epoch)) return 1;
  const years = epochYears(epoch);
  return toFixed(Math.min(1, years / (NODAL_CYCLE_DAYS / 365.2425)));
}

/** Recency: how recent is the epoch end date? Stations with data from the
 *  current era score higher. Uses a sigmoid-like curve where data from
 *  ~2000+ scores well, and very old data (pre-1950) scores poorly.
 *  Subordinates inherit from reference.
 *  Stations with placeholder dates (year 0000) get benefit of the doubt. */
function scoreRecency(
  station: Station,
  stationMap: Map<string, Station>,
): number {
  const epoch =
    station.epoch ?? stationMap.get(station.offsets?.reference ?? "")?.epoch;
  if (!epoch?.end) return 0;
  if (!hasValidEpoch(epoch)) return 1;

  const endYear = new Date(epoch.end).getFullYear();
  const currentYear = new Date().getFullYear();
  const age = currentYear - endYear;

  // Linear decay: 0 years old = 1.0, 100+ years old = 0.0
  return toFixed(Math.max(0, Math.min(1, 1 - age / 100)));
}

/** Source confidence: mapped from SOURCE_PRIORITY. */
function scoreSource(station: Station): number {
  const priority = station.id.startsWith("noaa/")
    ? 0
    : getSourcePriority(station.source.id);
  return toFixed(Math.max(0, 1 - priority / 99));
}

/** Quality flags: 1.0 if no issues, 0.0 if flagged. */
function scoreQuality(station: Station): number {
  return hasQualityIssues(station.disclaimers) ? 0 : 1;
}

/** Amplitude plausibility. Start at 1.0, subtract 0.25 per violation. */
function scoreAmplitude(station: Station): { score: number; issues: string[] } {
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
    // Only check if both are present and parent is non-zero
    if (parentAmp > 0 && childAmp > 0 && childAmp > parentAmp) {
      issues.push(
        `${child} amplitude (${childAmp.toFixed(4)}) exceeds ${parent} (${parentAmp.toFixed(4)})`,
      );
      score -= 0.25;
    }
  }

  // Form number sanity: F = (K1+O1)/(M2+S2) should be in (0, 25]
  const m2 = getAmplitude(station, "M2");
  const s2 = getAmplitude(station, "S2");
  const k1 = getAmplitude(station, "K1");
  const o1 = getAmplitude(station, "O1");
  const semidiurnal = m2 + s2;
  const diurnal = k1 + o1;

  if (semidiurnal > 0 && diurnal > 0) {
    const F = diurnal / semidiurnal;
    if (F > 25) {
      issues.push(`Form number ${F.toFixed(2)} exceeds 25`);
      score -= 0.25;
    }
  } else if (semidiurnal === 0 && diurnal === 0) {
    issues.push("No diurnal or semidiurnal constituents with amplitude > 0");
    score -= 0.25;
  }

  return { score: toFixed(Math.max(0, score)), issues };
}

/** Coverage: nearest-neighbor distance. Computed separately (needs all stations). */
function scoreCoverage(station: Station, allStations: Station[]): number {
  let minDist = Infinity;
  for (const other of allStations) {
    if (other.id === station.id) continue;
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

async function loadAllStations(): Promise<Station[]> {
  const stations: Station[] = [];
  const sources = await readdir(DATA_DIR);

  for (const source of sources) {
    const sourceDir = join(DATA_DIR, source);
    let files: string[];
    try {
      files = await readdir(sourceDir);
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

/** Check if two reference stations have similar M2 amplitudes. */
function hasSimilarM2(stationA: Station, stationB: Station): boolean {
  const m2A = stationA.harmonic_constituents.find((c) => c.name === "M2");
  const m2B = stationB.harmonic_constituents.find((c) => c.name === "M2");
  if (!m2A || !m2B || m2A.amplitude <= 0 || m2B.amplitude <= 0) return false;
  const ratio =
    Math.min(m2A.amplitude, m2B.amplitude) /
    Math.max(m2A.amplitude, m2B.amplitude);
  return ratio >= MIN_AMPLITUDE_RATIO;
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

/** Unified deduplication: for all pairs within range, keep the higher-scoring station.
 *  A reference station with accepted subordinates beats one without, regardless of score. */
function deduplicate(
  stationIds: string[],
  stationMap: Map<string, Station>,
  resultsMap: Map<string, QualityResult>,
  subordinateCounts: Map<string, number>,
): void {
  const rejected = new Set<string>();

  for (let i = 0; i < stationIds.length; i++) {
    const idA = stationIds[i]!;
    if (rejected.has(idA)) continue;
    const stationA = stationMap.get(idA)!;

    for (let j = i + 1; j < stationIds.length; j++) {
      const idB = stationIds[j]!;
      if (rejected.has(idB)) continue;
      const stationB = stationMap.get(idB)!;

      const dist = distance(
        stationA.latitude,
        stationA.longitude,
        stationB.latitude,
        stationB.longitude,
      );

      const [winner, loser] = pickWinner(
        idA,
        idB,
        stationMap,
        resultsMap,
        subordinateCounts,
      );

      const winnerHasSubs = (subordinateCounts.get(winner) ?? 0) > 0;
      if (!areDuplicates(stationA, stationB, dist, winnerHasSubs)) continue;

      const result = resultsMap.get(loser)!;
      result.accepted = false;
      result.reason = "duplicate";
      result.redundant = winner;
      rejected.add(loser);
    }
  }
}

/** Pick the winner between two stations: a reference with accepted subordinates
 *  beats one without; otherwise the higher composite score wins. Ties on score
 *  fall to the more precisely located record, so the survivor keeps the better
 *  coordinates rather than an older coarsely-rounded fix. */
function pickWinner(
  idA: string,
  idB: string,
  stationMap: Map<string, Station>,
  resultsMap: Map<string, QualityResult>,
  subordinateCounts: Map<string, number>,
): [winner: string, loser: string] {
  const subsA = subordinateCounts.get(idA) ?? 0;
  const subsB = subordinateCounts.get(idB) ?? 0;
  if (subsA > 0 && subsB === 0) return [idA, idB];
  if (subsB > 0 && subsA === 0) return [idB, idA];
  const scoreA = resultsMap.get(idA)!.score;
  const scoreB = resultsMap.get(idB)!.score;
  if (scoreA !== scoreB) return scoreA > scoreB ? [idA, idB] : [idB, idA];
  const a = stationMap.get(idA)!;
  const b = stationMap.get(idB)!;
  const precA = coordinatePrecision(a.latitude, a.longitude);
  const precB = coordinatePrecision(b.latitude, b.longitude);
  return precA >= precB ? [idA, idB] : [idB, idA];
}

/** Deduplicate TICON records that share a physical-gauge key (same station code,
 *  differing only by record segment or provider). Coordinate drift — coarse
 *  rounding in older sources, or slightly different survey points between
 *  providers — pushes these same-gauge records beyond the spatial dedup radius,
 *  so proximity alone never catches them (openwatersio/tide-database#112). The
 *  shared code is a deterministic same-gauge signal, so we merge them regardless
 *  of distance and keep the single best record per gauge. */
function deduplicateByGauge(
  stationIds: string[],
  stationMap: Map<string, Station>,
  resultsMap: Map<string, QualityResult>,
  subordinateCounts: Map<string, number>,
): void {
  const groups = new Map<string, string[]>();
  for (const id of stationIds) {
    const station = stationMap.get(id)!;
    if (!id.startsWith("ticon/")) continue;
    const key = gaugeKey(station.source.id);
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(id);
  }

  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    // Resolve the single survivor first so every rejected record's `redundant`
    // pointer references the final winner rather than an intermediate one.
    let winner = ids[0]!;
    for (let i = 1; i < ids.length; i++) {
      [winner] = pickWinner(
        winner,
        ids[i]!,
        stationMap,
        resultsMap,
        subordinateCounts,
      );
    }
    for (const id of ids) {
      if (id === winner) continue;
      const result = resultsMap.get(id)!;
      result.accepted = false;
      result.reason = "duplicate";
      result.redundant = winner;
    }
  }
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log("Loading stations...");
  const stations = await loadAllStations();
  const stationMap = new Map(stations.map((s) => [s.id, s]));

  const noaaCount = stations.filter((s) => s.id.startsWith("noaa/")).length;
  const ticonCount = stations.filter((s) => s.id.startsWith("ticon/")).length;
  console.log(
    `Loaded ${stations.length} stations (NOAA: ${noaaCount}, TICON: ${ticonCount})\n`,
  );

  // Step 1: Compute factors and apply gates
  console.log("Computing quality factors...");
  const resultsMap = new Map<string, QualityResult>();

  for (const station of stations) {
    const issues: string[] = [];

    // Gates
    const coordinateIssue = checkCoordinates(station);
    const datumIssues = checkDatumOrdering(station, stationMap);
    const rangeIssue = checkTidalRange(station, stationMap);
    const supersededIssue = checkSuperseded(station);
    const constituentIssue = checkConstituents(station);
    const seasonalIssue = checkSeasonalContamination(station, stations);

    // Diurnal pair warnings are non-fatal
    issues.push(...datumIssues.warnings);

    let gateReason: string | undefined;
    if (coordinateIssue) {
      issues.push(coordinateIssue);
      gateReason = "coordinates";
    } else if (datumIssues.fatal.length > 0) {
      issues.push(...datumIssues.fatal);
      gateReason = "datum";
    } else if (rangeIssue) {
      issues.push(rangeIssue);
      gateReason = "range";
    } else if (supersededIssue) {
      issues.push(supersededIssue);
      gateReason = "superseded";
    } else if (constituentIssue) {
      issues.push(constituentIssue);
      gateReason = "constituents";
    } else if (seasonalIssue) {
      issues.push(seasonalIssue);
      gateReason = "seasonal";
    }

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
    };

    resultsMap.set(station.id, result);
  }

  // Step 2: Compute coverage (needs all stations)
  console.log("Computing coverage...");
  for (const station of stations) {
    const result = resultsMap.get(station.id)!;
    result.factors.coverage = scoreCoverage(station, stations);
  }

  // Step 3: Compute composite scores
  for (const result of resultsMap.values()) {
    if (result.accepted) {
      result.score = computeCompositeScore(result.factors);
    }
    // Gate failures keep score = 0
  }

  // Step 4: Deduplicate
  console.log("Deduplicating...");
  const subordinateCounts = countSubordinates(stations, resultsMap);

  // 4a: Collapse same-gauge records (shared station code) regardless of distance.
  const acceptedIds = stations
    .filter((s) => resultsMap.get(s.id)!.accepted)
    .map((s) => s.id);
  deduplicateByGauge(acceptedIds, stationMap, resultsMap, subordinateCounts);

  // 4b: Deduplicate the survivors by proximity and harmonic similarity.
  const survivingIds = acceptedIds.filter((id) => resultsMap.get(id)!.accepted);
  deduplicate(survivingIds, stationMap, resultsMap, subordinateCounts);

  // Collect and sort results
  const results = [...resultsMap.values()].sort((a, b) =>
    a.id.localeCompare(b.id),
  );

  // Write output
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const outPath = join(__dirname, "..", "quality.json");
  await writeFile(outPath, JSON.stringify(results, null, 2) + "\n");

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

  console.log(`\nWrote quality.json (${results.length} entries)`);
}

main();
