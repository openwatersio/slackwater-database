#!/usr/bin/env node

import { readFile } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { parseCSV, indexBy, groupBy } from "./util.ts";
import { normalize, save, load, type PartialStationData } from "./station.ts";
import {
  computeDatums,
  computeDatumsFromObservations,
  mergeObservedDatums,
  parseGeslaSamples,
} from "./datum.ts";
import { ensureGeslaData, GESLA_DIR } from "./download-gesla.ts";
import {
  parseGeslaSamplesInZone,
  fitHarmonics,
  isAnalyzable,
} from "./harmonic-analysis.ts";
import { getSourceSuffix, NON_COMMERCIAL_SOURCES } from "./filtering.ts";
import { cleanName } from "./name-cleanup.ts";
import { loadGeocoder } from "./geocode.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const metaPath = join(__dirname, "..", "tmp", "TICON-4", "meta.csv");
const dataPath = join(__dirname, "..", "tmp", "TICON-4", "data.csv");
const metadata = indexBy(
  parseCSV<TiconMetaRow>(await readFile(metaPath, "utf-8")),
  "FILE NAME",
);
const data = await readFile(dataPath, "utf-8");
const forceDatums = process.env["FORCE_DATUMS"] === "1";
const forceHarmonics = process.env["FORCE_HARMONICS"] === "1";

type TiconMetaRow = {
  "FILE NAME": string;
  "SITE NAME": string;
};

interface TiconRow {
  lat: string;
  lon: string;
  tide_gauge_name: string;
  type: string;
  country: string;
  gesla_source: string;
  record_quality: string;
  datum_information: string;
  years_of_obs: string;
  start_date: string;
  end_date: string;
  con: string;
  amp: string;
  pha: string;
  amp_std: string;
  pha_std: string;
  missing_obs: string;
  no_of_obs: string;
}

function dayMonthYearToDate(date: string) {
  const [day, month, year] = date.split("/").map((v) => parseInt(v, 10));
  if (!day || !month || !year) {
    throw new Error(`Invalid date: ${date}`);
  }
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
}

// Load geocoder
const geocoder = await loadGeocoder();

// Ensure GESLA-4 data is available, but only the first time a station actually
// needs it (cache-reuse runs without FORCE_DATUMS never touch GESLA).
let geslaReady: Promise<string> | undefined;
const ensureGesla = () => (geslaReady ??= ensureGeslaData());

/**
 * Imports all TICON-4 stations as clean source data.
 *
 * Converts CSV rows to station objects, computes datums, and saves all
 * stations. Quality evaluation happens separately via evaluate-quality.ts.
 */
async function main() {
  console.log(
    `=== Importing TICON stations ===${forceDatums ? " (forcing datum recalculation)" : ""}${forceHarmonics ? " (forcing harmonic re-analysis)" : ""}\n`,
  );

  const groups = Object.values(
    groupBy(parseCSV<TiconRow>(data), (r) => r.tide_gauge_name),
  );

  let saved = 0;
  let reused = 0;
  let errors = 0;

  for (const rows of groups) {
    if (!rows[0]) continue;

    const gesla = metadata[rows[0].tide_gauge_name];

    const cleaned = cleanName(gesla["SITE NAME"], rows[0].country);
    const lat = parseFloat(rows[0].lat);
    const lon = parseFloat(rows[0].lon);

    // Geocode: resolve opaque names and fill region
    let name = cleaned.name;
    let region = cleaned.region;
    const geo = geocoder.nearest(lat, lon, 50);
    if (cleaned.isOpaque && geo) {
      name = geo.place.name;
    }
    if (!region && geo?.region) {
      region = geo.region;
    }

    const id = rows[0].tide_gauge_name;

    const csvHarmonics = rows.map((row) => ({
      name: row.con,
      amplitude: parseFloat(row.amp) / 100, // cm to m
      phase: ((parseFloat(row.pha) % 360) + 360) % 360,
    }));

    // WSV (and other local-time-mislabeled GESLA sources) publish phases that
    // are not UTC-referenced; re-fit them from the raw water levels. See #96.
    const harmonic_constituents = await getHarmonics(id, csvHarmonics);

    const epoch = {
      start: dayMonthYearToDate(rows[0].start_date),
      end: dayMonthYearToDate(rows[0].end_date),
    };

    try {
      const datumResult = await getDatums(id, epoch, harmonic_constituents);
      // Fully-synthetic datums mean the observed record was too short/sparse for
      // an empirical reduction, so the datums (and the chart-datum reference)
      // carry higher uncertainty.
      const disclaimers = [
        rows[0].record_quality,
        datumResult.datums_source === "harmonic"
          ? "Datums derived from harmonic prediction; the observation record is too short for an empirical reduction, so datum values carry higher uncertainty."
          : "",
      ]
        .filter(Boolean)
        .join(" ");

      const candidate: PartialStationData = {
        name,
        ...(region ? { region } : {}),
        country: rows[0].country,
        latitude: lat,
        longitude: lon,
        type: "reference",
        disclaimers,
        source: {
          name: "TICON-4",
          url: "https://www.seanoe.org/data/00980/109129/",
          id,
          published_harmonics: true,
        },
        license: NON_COMMERCIAL_SOURCES.includes(getSourceSuffix(id))
          ? {
              type: "cc-by-nc-4.0",
              commercial_use: false,
              url: "https://creativecommons.org/licenses/by-nc/4.0/",
              notes:
                "Upstream GESLA data provider restricts commercial use. See https://gesla787883612.wordpress.com/license/",
            }
          : {
              type: "cc-by-4.0",
              commercial_use: true,
              url: "https://creativecommons.org/licenses/by/4.0/",
            },
        harmonic_constituents,
        ...datumResult,
      };

      await save("ticon", normalize(candidate));
      process.stdout.write(`.`);
      saved++;
    } catch (err: any) {
      console.error(`\nError processing ${id}: ${err.message}`);
      errors++;
      process.stdout.write(`x`);
    }

    if ((saved + errors) % 100 === 0) {
      process.stdout.write(`.${saved + errors}/${groups.length}\n`);
    }
  }

  console.log(`\n\nDone. Saved ${saved}/${groups.length} stations.`);
  if (reused > 0) console.log(`Reused existing datums: ${reused}.`);
  if (errors > 0) console.log(`Errors: ${errors}.`);
}

/**
 * Resolve a station's tidal datums.
 *
 * Prefers empirical mean datums derived from GESLA-4 water-level measurements
 * (NOAA CO-OPS first-reduction), keeping the astronomical HAT/LAT from harmonic
 * synthesis (observed extremes conflate storm surge) shifted into the observed
 * MSL frame. Falls back to fully synthetic datums when no usable observations
 * exist. Reuses cached datums unless FORCE_DATUMS=1.
 */
async function getDatums(
  id: string,
  obsEpoch: { start: Date; end: Date },
  harmonic_constituents: PartialStationData["harmonic_constituents"],
) {
  if (!forceDatums) {
    try {
      const existing = await load("ticon", id);
      return {
        datums: existing.datums,
        ...(existing.datums_source
          ? { datums_source: existing.datums_source }
          : {}),
        epoch: existing.epoch ?? {
          start: toISODate(obsEpoch.start),
          end: toISODate(obsEpoch.end),
        },
      };
    } catch {
      // no cached record; compute below
    }
  }

  // Harmonic baseline: supplies astronomical HAT/LAT and the short-record
  // fallback. Predicted over the pinned DATUM_EPOCH, not the record period, so
  // regeneration is deterministic and annual statistics see only full years.
  const harmonic = computeDatums(harmonic_constituents, {});

  // Every TICON station has a GESLA-4 file (100% join), so read it directly — a
  // missing file is a data-prep error and should throw, not silently degrade.
  await ensureGesla();
  const samples = parseGeslaSamples(
    await readFile(join(GESLA_DIR, id), "utf-8"),
  );
  const obs = computeDatumsFromObservations(samples);
  if (obs) {
    return {
      datums: mergeObservedDatums(harmonic.datums, obs.datums),
      datums_source: "observed" as const,
      epoch: { start: toISODate(obs.start), end: toISODate(obs.end) },
    };
  }

  // GESLA record too short/sparse for empirical datums → synthetic fallback.
  // `epoch` records the constituent-fit period (the TICON record), not the
  // pinned prediction window.
  return {
    datums: harmonic.datums,
    datums_source: "harmonic" as const,
    epoch: { start: toISODate(obsEpoch.start), end: toISODate(obsEpoch.end) },
  };
}

// GESLA sources whose files are timestamped in local legal time but mislabeled
// "TIME ZONE HOURS 0" (UTC). Their harmonics are re-fit in the correct zone
// (then optionally shifted, see `shiftHours`) so phases are UTC-referenced like
// the rest of the database.
//
// - `wsv` (pegelonline.wsv.de): files are full German legal time (MEZ/MESZ)
//   mislabeled UTC. Reinterpret in Europe/Berlin. See issue #96.
// - `rws` (Rijkswaterstaat/waterinfo.rws.nl): files were converted from Dutch
//   legal time to "UTC" by subtracting a FIXED 1 h (the standard CET offset)
//   instead of a DST-aware conversion. So winter (CET) records are already true
//   UTC, but summer (CEST) records are left 1 h fast. Season-split re-analysis
//   confirms it: vs a UTC-correct CMEMS neighbour, winter Δphase ≈ 0 while
//   summer ≈ +1 h across M2/S2/N2, plus a ~3% semidiurnal amplitude loss from
//   blending the two halves in a single fit. Invert with Amsterdam's own DST
//   calendar: reinterpret in Europe/Amsterdam (subtracts {1,2} h) then add back
//   the 1 h that was wrongly removed (`shiftHours: 1`), netting a DST-only
//   correction ({0,1} h). The sibling `rws_hist` source is already UTC-correct
//   and is deliberately not listed here. See issue #98.
type LocalTimeSource = { zone: string; shiftHours?: number };
const LOCAL_TIME_SOURCES: Record<string, LocalTimeSource> = {
  wsv: { zone: "Europe/Berlin" },
  rws: { zone: "Europe/Amsterdam", shiftHours: 1 },
};

/**
 * Resolve a station's harmonic constituents. For most sources these come
 * straight from TICON's published amplitude/phase. For local-time-mislabeled
 * sources (see LOCAL_TIME_SOURCES) the published phases are not UTC-referenced,
 * so re-fit amplitude + UTC phase from the raw GESLA water levels. Throws when a
 * mislabeled source can't be re-analyzed, so the station is skipped rather than
 * saved with wrong phases. Cached like datums (reused unless FORCE_HARMONICS=1;
 * the fit is ~6s/station).
 */
async function getHarmonics(
  id: string,
  csvHarmonics: PartialStationData["harmonic_constituents"],
): Promise<PartialStationData["harmonic_constituents"]> {
  const src = LOCAL_TIME_SOURCES[getSourceSuffix(id)];
  if (!src) return csvHarmonics;

  if (!forceHarmonics) {
    try {
      const { harmonic_constituents } = await load("ticon", id);
      if (harmonic_constituents?.length) return harmonic_constituents;
    } catch {
      // no cached record; compute below
    }
  }

  await ensureGesla();
  let samples = parseGeslaSamplesInZone(
    await readFile(join(GESLA_DIR, id), "utf-8"),
    src.zone,
  );
  // Undo any fixed offset baked into the source before it was mislabeled UTC
  // (e.g. rws had a flat 1 h removed, so re-add it after the DST-aware parse).
  if (src.shiftHours) {
    const ms = src.shiftHours * 3_600_000;
    samples = samples.map((s) => ({ t: s.t + ms, level: s.level }));
  }
  const names = csvHarmonics.map((h) => h.name);
  if (!isAnalyzable(samples, names.length)) {
    throw new Error(`record too short to re-analyze ${src.zone} phases`);
  }
  return fitHarmonics(samples, names);
}

function toISODate(date: Date) {
  return date.toISOString().split("T")[0]!;
}

main();
