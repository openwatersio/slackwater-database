#!/usr/bin/env node
/**
 * Generates an SQLite database from station JSON data.
 *
 * The database is a normalized, self-contained replacement for the TCD format,
 * with tables for stations, constituents, datums, offsets, and precomputed
 * equilibrium arguments and node factors for tide prediction.
 */

import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { DatabaseSync } from "node:sqlite";
import tidePredictor, { astro } from "@neaps/tide-predictor";
import {
  stations,
  constituents as constituentDefs,
  type Station,
} from "@neaps/tide-database";

const tpConstituents = tidePredictor.constituents;

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "dist");
const dbPath = join(outDir, "tides.tidebase");
const SCHEMA = readFileSync(join(__dirname, "schema.sql"), "utf-8");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const START_YEAR = 1970;
const END_YEAR = 2100;

// ---------------------------------------------------------------------------
// Helpers (reused from packages/tcd/build.ts)
// ---------------------------------------------------------------------------

function modulus(a: number, b: number): number {
  return ((a % b) + b) % b;
}

function computeEquilibriumArgument(name: string, time: Date): number {
  const constituent = tpConstituents[name];
  if (!constituent) return 0;
  const astroData = astro(time);
  const V0 = constituent.value(astroData);
  const { u } = constituent.correction(astroData);
  return modulus(V0 + u, 360);
}

function computeNodeFactor(name: string, time: Date): number {
  const constituent = tpConstituents[name];
  if (!constituent) return 1;
  const astroData = astro(time);
  const { f } = constituent.correction(astroData);
  return f;
}

/**
 * Resolve a station constituent name to its canonical name in tide-predictor.
 * Returns canonical name or null if not found.
 */
function resolveConstituentName(
  stationName: string,
  knownNames: Set<string>,
): string | null {
  if (knownNames.has(stationName)) return stationName;
  const tp = tpConstituents[stationName];
  if (tp && knownNames.has(tp.name)) return tp.name;
  return null;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function main() {
  console.error("Loading stations...");

  const referenceStations = stations.filter(
    (s: Station) => s.type === "reference",
  );
  const subordinateStations = stations.filter(
    (s: Station) => s.type === "subordinate",
  );

  console.error(
    `Found ${stations.length} stations (${referenceStations.length} reference, ${subordinateStations.length} subordinate)`,
  );

  // -----------------------------------------------------------------------
  // Build constituent list: canonical tide-predictor constituents + any
  // additional constituents found only in station data
  // -----------------------------------------------------------------------

  // Start with all constituents from the canonical definitions file
  const constituentMap = new Map<
    string,
    { description: string | null; speed: number }
  >();
  for (const c of constituentDefs) {
    constituentMap.set(c.name, { description: c.description, speed: c.speed });
  }

  // Scan station data for any constituents not in the canonical list
  for (const station of referenceStations) {
    for (const hc of station.harmonic_constituents) {
      // Try to resolve to canonical name
      const tp = tpConstituents[hc.name];
      const canonicalName = tp ? tp.name : hc.name;
      if (!constituentMap.has(canonicalName)) {
        constituentMap.set(canonicalName, {
          description: null,
          speed: tp?.speed ?? hc.speed ?? 0,
        });
      }
    }
  }

  const constituentNames = [...constituentMap.keys()];
  console.error(`Constituent list: ${constituentNames.length} constituents`);

  // Build set for resolution lookups
  const constituentNameSet = new Set(constituentNames);

  // -----------------------------------------------------------------------
  // Open database
  // -----------------------------------------------------------------------

  console.error(`Creating database at ${dbPath}...`);
  const db = new DatabaseSync(dbPath);

  // Performance pragmas for bulk loading
  db.exec("PRAGMA journal_mode = OFF");
  db.exec("PRAGMA synchronous = OFF");
  db.exec("PRAGMA locking_mode = EXCLUSIVE");
  db.exec("PRAGMA cache_size = -64000"); // 64MB cache

  // Create schema
  db.exec(SCHEMA);

  // -----------------------------------------------------------------------
  // Insert data in a transaction
  // -----------------------------------------------------------------------

  db.exec("BEGIN TRANSACTION");

  // --- Metadata ---
  const insertMeta = db.prepare(
    "INSERT INTO metadata (key, value) VALUES (?, ?)",
  );
  insertMeta.run(
    "generator",
    "tide-database (https://openwaters.io/tides/database)",
  );
  insertMeta.run("generated_at", new Date().toISOString());
  insertMeta.run("start_year", String(START_YEAR));
  insertMeta.run("end_year", String(END_YEAR));

  // --- Constituents ---
  console.error("Inserting constituents...");
  const insertConstituent = db.prepare(
    "INSERT INTO constituents (name, description, speed) VALUES (?, ?, ?)",
  );
  for (const [name, { description, speed }] of constituentMap) {
    insertConstituent.run(name, description, speed);
  }

  // --- Sources (deduplicated) ---
  console.error("Inserting sources...");
  const insertSource = db.prepare(
    "INSERT INTO sources (name, url) VALUES (?, ?)",
  );
  const getSourceId = db.prepare(
    "SELECT id FROM sources WHERE name = ? AND url = ?",
  );
  const sourceIdCache = new Map<string, number>();

  function getOrCreateSource(source: Station["source"]): number {
    const cacheKey = `${source.name}|${source.url}`;
    let id = sourceIdCache.get(cacheKey);
    if (id !== undefined) return id;

    insertSource.run(source.name, source.url);
    const row = getSourceId.get(source.name, source.url) as { id: number };
    id = row.id;
    sourceIdCache.set(cacheKey, id);
    return id;
  }

  // --- Stations ---
  console.error("Inserting stations...");
  const insertStation = db.prepare(`
    INSERT INTO stations (
      station_id, name, type, latitude, longitude,
      continent, country, region, timezone, disclaimers,
      source_id, source_station_id,
      license, commercial_use, license_url, license_notes,
      epoch_start, epoch_end
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  // Map from text station_id to integer id
  const stationIdMap = new Map<string, number>();

  for (const station of stations) {
    const sourceId = getOrCreateSource(station.source);
    const result = insertStation.run(
      station.id,
      station.name,
      station.type,
      station.latitude,
      station.longitude,
      station.continent,
      station.country,
      station.region ?? null,
      station.timezone,
      station.disclaimers || null,
      sourceId,
      station.source.id,
      station.license.type,
      station.license.commercial_use ? 1 : 0,
      station.license.url,
      station.license.notes ?? null,
      station.epoch?.start ?? null,
      station.epoch?.end ?? null,
    );

    const intId = Number(result.lastInsertRowid);
    stationIdMap.set(station.id, intId);
  }

  // --- Station constituents ---
  console.error("Inserting station constituents...");
  const insertStationConstituent = db.prepare(
    "INSERT INTO station_constituents (station_id, constituent, amplitude, phase) VALUES (?, ?, ?, ?)",
  );

  let totalHC = 0;
  let insertedHC = 0;

  for (const station of referenceStations) {
    const intId = stationIdMap.get(station.id)!;
    for (const hc of station.harmonic_constituents) {
      totalHC++;
      const resolved = resolveConstituentName(hc.name, constituentNameSet);
      if (resolved) {
        insertStationConstituent.run(
          intId,
          resolved,
          hc.amplitude,
          modulus(hc.phase, 360),
        );
        insertedHC++;
      }
    }
  }
  console.error(
    `  Constituent coverage: ${insertedHC}/${totalHC} (${((insertedHC / totalHC) * 100).toFixed(1)}%)`,
  );

  // --- Station offsets ---
  console.error("Inserting station offsets...");
  const insertOffset = db.prepare(`
    INSERT INTO station_offsets (
      station_id, reference_id, height_type,
      height_high, height_low, time_high, time_low
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  let offsetCount = 0;
  for (const station of subordinateStations) {
    if (!station.offsets) continue;
    const intId = stationIdMap.get(station.id)!;
    const refIntId = stationIdMap.get(station.offsets.reference);
    if (!refIntId) {
      console.error(
        `WARNING: Subordinate "${station.name}" references unknown station "${station.offsets.reference}", skipping`,
      );
      continue;
    }

    const offsets = station.offsets;
    insertOffset.run(
      intId,
      refIntId,
      offsets.height.type,
      offsets.height.high,
      offsets.height.low,
      offsets.time.high,
      offsets.time.low,
    );
    offsetCount++;
  }
  console.error(`  Inserted ${offsetCount} subordinate offsets`);

  // --- Station datums ---
  console.error("Inserting station datums...");
  const insertDatum = db.prepare(
    "INSERT INTO station_datums (station_id, datum, value) VALUES (?, ?, ?)",
  );

  let datumCount = 0;
  for (const station of stations) {
    if (!station.datums) continue;
    const intId = stationIdMap.get(station.id)!;
    for (const [name, value] of Object.entries(station.datums)) {
      insertDatum.run(intId, name, value);
      datumCount++;
    }
  }
  console.error(`  Inserted ${datumCount} datum values`);

  // --- Equilibrium arguments ---
  console.error("Computing equilibrium arguments...");
  const insertEqArg = db.prepare(
    "INSERT INTO equilibrium_arguments (constituent, year, value) VALUES (?, ?, ?)",
  );

  let eqCount = 0;
  for (const name of constituentNames) {
    // Only compute for constituents known to tide-predictor
    if (!tpConstituents[name]) continue;
    for (let year = START_YEAR; year <= END_YEAR; year++) {
      const time = new Date(Date.UTC(year, 0, 1, 0, 0, 0));
      const value = computeEquilibriumArgument(name, time);
      insertEqArg.run(name, year, value);
      eqCount++;
    }
  }
  console.error(`  Inserted ${eqCount} equilibrium arguments`);

  // --- Node factors ---
  console.error("Computing node factors...");
  const insertNodeFactor = db.prepare(
    "INSERT INTO node_factors (constituent, year, value) VALUES (?, ?, ?)",
  );

  let nfCount = 0;
  for (const name of constituentNames) {
    if (!tpConstituents[name]) continue;
    for (let year = START_YEAR; year <= END_YEAR; year++) {
      const time = new Date(Date.UTC(year, 6, 1, 0, 0, 0));
      const value = computeNodeFactor(name, time);
      insertNodeFactor.run(name, year, value);
      nfCount++;
    }
  }
  console.error(`  Inserted ${nfCount} node factors`);

  // --- Final metadata ---
  insertMeta.run("station_count", String(stations.length));
  insertMeta.run("constituent_count", String(constituentNames.length));

  db.exec("COMMIT");

  // -----------------------------------------------------------------------
  // Finalize
  // -----------------------------------------------------------------------

  console.error("Running ANALYZE...");
  db.exec("ANALYZE");

  console.error("Running VACUUM...");
  db.exec("VACUUM");

  db.close();

  console.error(`\nDatabase written to ${dbPath}`);
  console.error(`  Stations: ${stations.length}`);
  console.error(`  Constituents: ${constituentNames.length}`);
  console.error(`  Station constituents: ${insertedHC}`);
  console.error(`  Station offsets: ${offsetCount}`);
  console.error(`  Station datums: ${datumCount}`);
  console.error(`  Equilibrium arguments: ${eqCount}`);
  console.error(`  Node factors: ${nfCount}`);
}

main();
