#!/usr/bin/env node
/**
 * Fit harmonic constants and reduce datums for each contributor's gauges
 * from their series in the water-levels lake, writing data/<contributor>/.
 * The gauges are the contributor's TICON records, so run the TICON import
 * first. A record's name and position are its TICON record's.
 *
 * Usage: npm run import -w sources/water-levels
 */
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  DATA_DIR,
  getSourceSuffix,
  load,
  MISFILED_RECORDS,
  normalize,
  save,
  type PartialStationData,
} from "@slackwater/stations";
import { computeDatums } from "@slackwater/datums";
import { reduceTiconDatums } from "@slackwater/ticon/datums";
import {
  MEASURED_FLAGS,
  readLakeSamples,
} from "@slackwater/harmonic-analysis/lake";
import { CONTRIBUTORS, fitFromLake, lakeRelays, lakeSeries } from "./lake.ts";

const ticonIds = (await readdir(join(DATA_DIR, "ticon")))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.slice(0, -".json".length))
  .filter((id) => CONTRIBUTORS.has(getSourceSuffix(id)))
  .sort();
if (!ticonIds.length)
  throw new Error("No TICON records of a contributor; run the TICON import");

// A year file that 404s mid-backfill reads as a gap, so a run can see less of
// a series than an earlier one did. A gauge the lake can't fit keeps any record
// it has, and so does one whose new fit has fewer hours than its saved one, unless
// FORCE_HARMONICS=1. Removing a record is a decision made by hand.
const force = process.env["FORCE_HARMONICS"] === "1";
let errors = 0;
for (const id of ticonIds) {
  const contributor = getSourceSuffix(id);
  try {
    const series = await lakeSeries(id);
    if (!series) {
      console.log(`${id}: no ${contributor} series in the lake`);
      continue;
    }
    const sourceId = series.slice(contributor.length + 1);
    const saved = await load(contributor, sourceId).catch(() => undefined);
    const ticon = await load("ticon", id);
    // Every TICON record of the gauge, as the lake files them, is scored.
    const relays = await Promise.all(
      (await lakeRelays(series)).map(async (relay) => ({
        id: relay,
        constituents: (await load("ticon", relay).catch(() => undefined))
          ?.harmonic_constituents,
      })),
    );
    const scored = relays.flatMap((r) =>
      r.constituents ? [{ id: r.id, constituents: r.constituents }] : [],
    );
    // The long-period constituents come from a TICON record of the gauge
    // that isn't another gauge's data, or from the fit where none is.
    const longPeriod = MISFILED_RECORDS[id]
      ? (scored.find((r) => !MISFILED_RECORDS[r.id])?.constituents ?? null)
      : ticon.harmonic_constituents;
    const lake = await fitFromLake(
      series,
      ticon.harmonic_constituents,
      ticon.epoch && new Date(ticon.epoch.end),
      scored,
      longPeriod,
    );
    if (!lake) {
      console.log(`${series} (${id}): too short to fit and score`);
      if (saved) console.log(`  keeps ${contributor}/${sourceId}.json`);
      continue;
    }
    const savedHours = saved?.source.fit_hours;
    if (!force && savedHours && lake.fit.hours < savedHours) {
      console.log(
        `${series} (${id}): fits ${lake.fit.hours} hours, fewer than the saved ${savedHours}; keeps it`,
      );
      continue;
    }
    const epoch = {
      start: new Date(lake.fit.start),
      end: new Date(lake.fit.end),
    };
    // Datums take preliminary values too: a mean over more months outweighs
    // the checks an agency has yet to make, and in an older SMHI series those
    // are years it may never verify.
    const samples = await readLakeSamples(series, lake.window, MEASURED_FLAGS);
    const { datum_notice, ...datums } = reduceTiconDatums(
      samples.map((s) => ({ time: new Date(s.t), level: s.level })),
      lake.constituents,
      computeDatums(lake.constituents, {}).datums,
      epoch,
    );
    const record: PartialStationData = {
      name: ticon.name,
      country: ticon.country,
      latitude: ticon.latitude,
      longitude: ticon.longitude,
      type: "reference",
      disclaimers: datum_notice,
      source: {
        name: CONTRIBUTORS.get(contributor)!.name,
        url: "https://github.com/openwatersio/water-levels",
        id: sourceId,
        published_harmonics: false,
        series,
        gauge: id,
        fit_hours: lake.fit.hours,
        held_out: lake.held_out,
      },
      license: CONTRIBUTORS.get(contributor)!.license,
      harmonic_constituents: lake.constituents,
      ...datums,
    };
    await save(contributor, normalize(record));
    console.log(
      `${series} (${id}): held-out rms ${lake.held_out.rms} m; ${Object.entries(
        lake.held_out.ticon,
      )
        .map(([r, { rms }]) => `${r} ${rms} m`)
        .join(", ")}`,
    );
  } catch (err: any) {
    console.error(`${id}: ${err.message}`);
    errors++;
  }
}

if (errors) {
  console.error(`${errors} errors`);
  process.exit(1);
}
