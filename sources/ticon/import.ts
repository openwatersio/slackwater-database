#!/usr/bin/env node

import { readFile } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  parseCSV,
  groupBy,
  normalize,
  save,
  load,
  getSourceSuffix,
  NON_COMMERCIAL_SOURCES,
  roundConstituents,
  type PartialStationData,
} from "@slackwater/stations";
import {
  computeDatums,
  ensureGeslaData,
  loadRqdSamples,
  parseRqdId,
  rqdEnd,
  GESLA_DIR,
} from "@slackwater/datums";
import { fitHarmonics, isAnalyzable } from "@slackwater/harmonic-analysis";
import {
  parseTiconSamples,
  shiftEarlyGauge,
  hasMislabeledClock,
} from "./samples.ts";
import { matchMetadata, type TiconMetaRow } from "./meta.ts";
import { reduceTiconDatums, cachedDatumNotice } from "./datums.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const metaPath = join(__dirname, "..", "..", "tmp", "TICON-4", "meta.csv");
const dataPath = join(__dirname, "..", "..", "tmp", "TICON-4", "data.csv");
const gauges = groupBy(
  parseCSV<TiconRow>(await readFile(dataPath, "utf-8")),
  (r) => r.tide_gauge_name,
);
// Match against every gauge, not just this shard's: a misfiled row's rightful
// gauge can sit in another shard.
const metadata = matchMetadata(
  parseCSV<TiconMetaRow>(await readFile(metaPath, "utf-8")),
  new Map(
    Object.entries(gauges).map(([id, [row]]) => [
      id,
      { lat: parseFloat(row!.lat), lon: parseFloat(row!.lon) },
    ]),
  ),
);
// FORCE_DATUMS=1 recomputes every station's datums; a comma-separated list of
// source suffixes (e.g. FORCE_DATUMS=uhslc_rq) recomputes only those sources.
const FORCE_DATUMS = process.env["FORCE_DATUMS"] ?? "";
const forceDatums = (id: string) =>
  FORCE_DATUMS === "1" || FORCE_DATUMS.split(",").includes(getSourceSuffix(id));
const forceHarmonics = process.env["FORCE_HARMONICS"] === "1";
// SHARD=i/n imports every nth station, so `./import` can run one process per core.
const [shard = 0, shards = 1] = (process.env["SHARD"] ?? "0/1")
  .split("/")
  .map(Number);

// TICON-4's phase lag for these constituents is measured against an
// equilibrium argument that differs from the engine's by a constant: TICON's
// argument is the engine's plus this many degrees. Each was found by scoring
// TICON's constituent against the raw GESLA-4 record at its largest gauges
// (#239). Subtracting it restates the phase against the engine's argument.
const TICON_ARGUMENT_OFFSET: Record<string, number> = {
  M3: 180,
  SGM: 180,
  T3: 180,
  S3: 180,
  R3: -90,
  "3L2": -90,
  "2MK5": -90,
  "2MO5": 90,
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

// Ensure GESLA-4 data is available, but only the first time a station actually
// needs it (cache-reuse runs without FORCE_DATUMS never touch GESLA).
let geslaReady: Promise<string> | undefined;
const ensureGesla = () => (geslaReady ??= ensureGeslaData());

/**
 * Imports all TICON-4 stations as clean source data.
 *
 * Converts CSV rows to station objects, computes datums, and saves all
 * stations. Quality evaluation happens separately, in `npm run stations`.
 */
async function main() {
  if (shard === 0)
    console.log(
      `=== Importing TICON stations ===${FORCE_DATUMS ? ` (forcing datum recalculation: ${FORCE_DATUMS})` : ""}${forceHarmonics ? " (forcing harmonic re-analysis)" : ""}\n`,
    );

  const groups = Object.values(gauges).filter((_, i) => i % shards === shard);

  let saved = 0;
  let reused = 0;
  let errors = 0;

  for (const rows of groups) {
    if (!rows[0]) continue;

    const gesla = metadata[rows[0].tide_gauge_name];
    if (!gesla) throw new Error(`${rows[0].tide_gauge_name}: no meta.csv row`);

    const lat = parseFloat(rows[0].lat);
    const lon = parseFloat(rows[0].lon);
    const id = rows[0].tide_gauge_name;

    const csvHarmonics = rows.map((row) => ({
      name: row.con,
      amplitude: parseFloat(row.amp) / 100, // cm to m
      phase:
        (((parseFloat(row.pha) - (TICON_ARGUMENT_OFFSET[row.con] ?? 0)) % 360) +
          360) %
        360,
    }));

    // WSV, RWS and the early Hong Kong gauges have GESLA times that are not
    // UTC, so TICON's phases are not UTC-referenced; re-fit them from the raw
    // water levels. See #96 and #360.
    const harmonic_constituents = await getHarmonics(id, csvHarmonics);

    const epoch = {
      start: dayMonthYearToDate(rows[0].start_date),
      end: dayMonthYearToDate(rows[0].end_date),
    };

    try {
      const { datum_notice, ...datumResult } = await getDatums(
        id,
        epoch,
        harmonic_constituents,
      );
      const disclaimers = [rows[0].record_quality, datum_notice]
        .filter(Boolean)
        .join(" ");

      const candidate: PartialStationData = {
        name: gesla["SITE NAME"],
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

  const label = shards > 1 ? ` (shard ${shard + 1}/${shards})` : "";
  console.log(`\n\nDone${label}. Saved ${saved}/${groups.length} stations.`);
  if (reused > 0) console.log(`Reused existing datums: ${reused}.`);
  if (errors > 0) console.log(`Errors: ${errors}.`);
}

/**
 * Resolve a station's tidal datums.
 *
 * Prefers empirical mean datums derived from GESLA-4 water-level measurements
 * (NOAA CO-OPS first-reduction), or from UHSLC hourly RQD where it extends a
 * UHSLC research-quality record, keeping the astronomical HAT/LAT from harmonic
 * synthesis (observed extremes conflate storm surge) shifted into the observed
 * MSL frame. Falls back to harmonic datums, shifted by an available observation
 * gauge mean, when no continuous reduction window is supported. Reuses cached
 * datums unless FORCE_DATUMS selects the station or its constituents changed.
 */
async function getDatums(
  id: string,
  obsEpoch: { start: Date; end: Date },
  harmonic_constituents: PartialStationData["harmonic_constituents"],
) {
  if (!forceDatums(id)) {
    let existing: Awaited<ReturnType<typeof load>> | undefined;
    try {
      existing = await load("ticon", id);
    } catch {
      // no cached record; compute below
    }
    if (existing) {
      const datum_notice = cachedDatumNotice(existing);
      const cached = {
        ...(existing.datums_source
          ? { datums_source: existing.datums_source }
          : {}),
        epoch: existing.epoch ?? {
          start: toISODate(obsEpoch.start),
          end: toISODate(obsEpoch.end),
        },
        ...(existing.datum_epoch ? { datum_epoch: existing.datum_epoch } : {}),
        ...(existing.datum_frame ? { datum_frame: existing.datum_frame } : {}),
        ...(existing.datum_coverage
          ? { datum_coverage: existing.datum_coverage }
          : {}),
      };
      // Stored constituents are at the published precision, so compare the
      // parsed ones at that precision too, or float noise reads as a change.
      if (
        datum_notice &&
        sameConstituents(
          existing.harmonic_constituents,
          roundConstituents("ticon", harmonic_constituents),
        )
      )
        return { datums: existing.datums, ...cached, datum_notice };
    }
  }

  // Harmonic baseline: supplies astronomical HAT/LAT and the short-record
  // fallback. Predicted over the pinned DATUM_EPOCH, not the record period, so
  // regeneration is deterministic and annual statistics see only full years.
  const harmonic = computeDatums(harmonic_constituents, {});

  // Every TICON station has a GESLA-4 file (100% join), so read it directly — a
  // missing file is a data-prep error and should throw, not silently degrade.
  await ensureGesla();
  let samples = parseTiconSamples(
    id,
    await readFile(join(GESLA_DIR, id), "utf-8"),
  );
  // UHSLC research-quality records continue past their GESLA-4 copy. Where the
  // live record is longer, reduce datums from it instead (same record and
  // station zero, so the frame is unchanged). See #138.
  if (parseRqdId(id)) {
    const rqEnd = await rqdEnd(id);
    const geslaEnd = samples.reduce(
      (end, s) => Math.max(end, s.time.getTime()),
      -Infinity,
    );
    if (rqEnd && rqEnd.getTime() > geslaEnd) {
      samples = shiftEarlyGauge(id, await loadRqdSamples(id, rqEnd));
    }
  }
  const {
    datums,
    datums_source,
    datum_frame,
    datum_coverage,
    epoch,
    datum_epoch,
    datum_notice,
  } = reduceTiconDatums(
    samples,
    harmonic_constituents,
    harmonic.datums,
    obsEpoch,
  );
  return {
    datums,
    datums_source,
    datum_frame,
    ...(datum_coverage ? { datum_coverage } : {}),
    epoch,
    ...(datum_epoch ? { datum_epoch } : {}),
    datum_notice,
  };
}

/**
 * Resolve a station's harmonic constituents. For most sources these come
 * straight from TICON's published amplitude/phase. For stations whose GESLA
 * times are not UTC (see LOCAL_TIME_SOURCES and EARLY_GAUGES) the published
 * phases are not UTC-referenced, so re-fit amplitude + UTC phase from the raw
 * GESLA water levels. Throws when such a station can't be re-analyzed, so it is
 * skipped rather than saved with wrong phases. Cached like datums (reused
 * unless FORCE_HARMONICS=1; the fit is ~6s/station).
 */
async function getHarmonics(
  id: string,
  csvHarmonics: PartialStationData["harmonic_constituents"],
): Promise<PartialStationData["harmonic_constituents"]> {
  if (!hasMislabeledClock(id)) return csvHarmonics;

  if (!forceHarmonics) {
    try {
      const { harmonic_constituents } = await load("ticon", id);
      if (harmonic_constituents?.length) return harmonic_constituents;
    } catch {
      // no cached record; compute below
    }
  }

  await ensureGesla();
  const samples = parseTiconSamples(
    id,
    await readFile(join(GESLA_DIR, id), "utf-8"),
  ).map((p) => ({ t: +p.time, level: p.level }));
  const names = csvHarmonics.map((h) => h.name);
  if (!isAnalyzable(samples, names.length)) {
    throw new Error("record too short to re-analyze its non-UTC phases");
  }
  return fitHarmonics(samples, names);
}

function sameConstituents(
  a: PartialStationData["harmonic_constituents"],
  b: PartialStationData["harmonic_constituents"],
) {
  return (
    a.length === b.length &&
    a.every(
      (h, i) =>
        h.name === b[i]!.name &&
        h.amplitude === b[i]!.amplitude &&
        h.phase === b[i]!.phase,
    )
  );
}

function toISODate(date: Date) {
  return date.toISOString().split("T")[0]!;
}

main();
