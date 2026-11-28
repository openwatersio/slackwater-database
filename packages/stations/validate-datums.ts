#!/usr/bin/env node

/**
 * Cross-check empirically-derived TICON datums against NOAA CO-OPS published
 * datums (issue #40).
 *
 * For every GESLA `-usa-noaa` station that pairs to a `data/noaa/<id>.json`
 * record, it derives datums two ways — observed (from GESLA water levels) and
 * harmonic (synthesized from the station's constituents) — and compares both
 * on the same supported station pairs to NOAA's authoritative datums. Since the vertical
 * reference frames differ (NOAA: station datum; ours: gauge/MSL), only
 * reference-invariant relationships are compared:
 *   MN  = MHW  − MLW    (mean range)
 *   GT  = MHHW − MLLW   (great diurnal range)
 *   dHi = MHW  − MSL
 *   dLo = MSL  − MLLW
 *
 * Run after the GESLA download (@slackwater/datum-data), or set GESLA_ARCHIVE to
 * read entries directly from a ZIP. Reads GESLA independently of the import.
 * Different observation and agency datum periods, hourly sampling, and weather
 * can all contribute to these residuals; they are not interpolation error alone.
 */

import { readFile, readdir, writeFile } from "fs/promises";
import { execFileSync } from "node:child_process";
import { join, basename } from "path";
import {
  computeDatums,
  computeDatumsFromObservations,
  type Datums,
} from "@slackwater/datums";
import {
  ensureGeslaData,
  parseGeslaSamples,
  GESLA_DIR,
} from "@slackwater/datum-data";
import { DATA_DIR } from "./station.ts";
import { predictionOptions } from "./sources.ts";
import type { StationData } from "@slackwater/database";

const TICON_DIR = join(DATA_DIR, "ticon");
const NOAA_DIR = join(DATA_DIR, "noaa");

const REL_KEYS = ["MN", "GT", "dHi", "dLo"] as const;
type Rels = Record<(typeof REL_KEYS)[number], number>;

function relationships(d: Datums): Rels | null {
  const { MHW, MLW, MHHW, MLLW, MSL } = d;
  if ([MHW, MLW, MHHW, MLLW, MSL].some((v) => v === undefined)) return null;
  return {
    MN: MHW! - MLW!,
    GT: MHHW! - MLLW!,
    dHi: MHW! - MSL!,
    dLo: MSL! - MLLW!,
  };
}

function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function mae(xs: number[]): number {
  return xs.length ? xs.reduce((a, v) => a + Math.abs(v), 0) / xs.length : NaN;
}

async function loadJSON<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

async function fileText(path: string): Promise<string | null> {
  const archive = process.env["GESLA_ARCHIVE"];
  if (archive) {
    try {
      // unzip treats member names as patterns, even without a shell.
      const member = basename(path).replace(/[\\*?\[\]]/g, "\\$&");
      return execFileSync("unzip", ["-p", archive, member], {
        encoding: "utf8",
        maxBuffer: 1024 ** 3,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      if ((error as { status?: number }).status === 11) return null;
      throw error;
    }
  }
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

async function main() {
  if (!process.env["GESLA_ARCHIVE"]) await ensureGeslaData();

  const files = (await readdir(TICON_DIR)).filter((f) => f.endsWith(".json"));

  // Accumulate residuals (ours − NOAA) per relationship, for each method.
  const resid = {
    observed: { MN: [], GT: [], dHi: [], dLo: [] } as Record<string, number[]>,
    harmonic: { MN: [], GT: [], dHi: [], dLo: [] } as Record<string, number[]>,
    harmonicAll: { MN: [], GT: [], dHi: [], dLo: [] } as Record<
      string,
      number[]
    >,
    published: { MN: [], GT: [], dHi: [], dLo: [] } as Record<string, number[]>,
    fallback: { MN: [], GT: [], dHi: [], dLo: [] } as Record<string, number[]>,
  };
  const report: object[] = [];
  let pairs = 0;
  let observedCount = 0;

  for (const file of files) {
    const id = file.replace(/\.json$/, "");
    const m = id.match(/-(\d{6,7})-usa-noaa$/);
    if (!m) continue;

    const noaa = await loadJSON<StationData>(join(NOAA_DIR, `${m[1]}.json`));
    if (!noaa?.datums) continue;
    const noaaRels = relationships(noaa.datums);
    if (!noaaRels) continue;

    const station = await loadJSON<StationData>(join(TICON_DIR, file));
    if (!station) continue;
    pairs++;

    // Harmonic (old method) — synthesize from the station's constituents.
    const harmonic = computeDatums(
      station.harmonic_constituents,
      {},
      predictionOptions(station),
    );
    const hRels = relationships(harmonic.datums);
    const published = relationships(station.datums);
    if (hRels)
      for (const k of REL_KEYS)
        resid.harmonicAll[k]!.push(hRels[k] - noaaRels[k]);
    if (published) {
      for (const k of REL_KEYS) {
        resid.published[k]!.push(published[k] - noaaRels[k]);
        if (station.datums_source === "harmonic")
          resid.fallback[k]!.push(published[k] - noaaRels[k]);
      }
      report.push({
        id,
        source: station.datums_source,
        epoch: station.epoch,
        datum_epoch: station.datum_epoch,
        residual: Object.fromEntries(
          REL_KEYS.map((k) => [k, published[k] - noaaRels[k]]),
        ),
      });
    }

    // Observed (new method) — derive from GESLA water levels.
    const text = await fileText(join(GESLA_DIR, id));
    if (text) {
      const obs = computeDatumsFromObservations(
        parseGeslaSamples(text),
        station.harmonic_constituents,
        predictionOptions(station),
      );
      const oRels = obs && relationships(obs.datums);
      if (oRels && hRels) {
        observedCount++;
        for (const k of REL_KEYS) {
          resid.harmonic[k]!.push(hRels[k] - noaaRels[k]);
          resid.observed[k]!.push(oRels[k] - noaaRels[k]);
        }
      }
    }
  }

  console.log(
    `\nNOAA cross-check: ${pairs} TICON↔NOAA pairs, ${observedCount} shared usable pairs (${pairs - observedCount} excluded).\n`,
  );
  console.log("Residual vs NOAA (meters): median (|bias|) and MAE\n");
  console.log(
    "rel    harmonic median   harmonic MAE   observed median   observed MAE",
  );
  for (const k of REL_KEYS) {
    const h = resid.harmonic[k]!;
    const o = resid.observed[k]!;
    console.log(
      `${k.padEnd(6)} ${median(h).toFixed(3).padStart(14)} ${mae(h)
        .toFixed(3)
        .padStart(14)} ${median(o).toFixed(3).padStart(17)} ${mae(o)
        .toFixed(3)
        .padStart(14)}`,
    );
  }

  console.log(
    `\nPublished datums: ${resid.published["MN"]!.length} pairs, including ${resid.fallback["MN"]!.length} harmonic fallbacks.\n`,
  );
  console.log(
    "rel      all-harmonic MAE   published median   published MAE   fallback median   fallback MAE",
  );
  for (const k of REL_KEYS)
    console.log(
      `${k.padEnd(6)} ${mae(resid.harmonicAll[k]!).toFixed(3).padStart(17)} ${median(resid.published[k]!).toFixed(3).padStart(18)} ${mae(resid.published[k]!).toFixed(3).padStart(15)} ${median(resid.fallback[k]!).toFixed(3).padStart(17)} ${mae(resid.fallback[k]!).toFixed(3).padStart(14)}`,
    );
  if (process.env["DATUM_REPORT_PATH"])
    await writeFile(
      process.env["DATUM_REPORT_PATH"],
      JSON.stringify(report, null, 2) + "\n",
    );

  // Spot-check the stations named in issue #40 (no NOAA pair — eyeball vs
  // Admiralty EasyTide / CHS). Print observed vs harmonic datums.
  const spotIds = [
    "rosslare-ros-irl-mi_c",
    "wexford_harbour-wex-irl-mi_c",
    "dundalk-dun-irl-cmems",
    "spencers_island-242-can-meds",
    "liverpool-440-can-meds",
  ];
  console.log("\nIssue #40 spot-check stations (observed vs harmonic):\n");
  for (const id of spotIds) {
    const station = await loadJSON<StationData>(join(TICON_DIR, `${id}.json`));
    const text = await fileText(join(GESLA_DIR, id));
    if (!station || !text) {
      console.log(`${id}: missing`);
      continue;
    }
    const harmonic = computeDatums(
      station.harmonic_constituents,
      {},
      predictionOptions(station),
    );
    const obs = computeDatumsFromObservations(
      parseGeslaSamples(text),
      station.harmonic_constituents,
      predictionOptions(station),
    );
    const fmt = (d?: Datums | null) =>
      d
        ? ["MHHW", "MHW", "MSL", "MLW", "MLLW"]
            .map((k) => `${k}=${d[k]?.toFixed(3)}`)
            .join(" ")
        : "n/a";
    console.log(`${id}`);
    console.log(`  observed: ${fmt(obs?.datums)}`);
    console.log(`  harmonic: ${fmt(harmonic.datums)}`);
  }
}

main();
