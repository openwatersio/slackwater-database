#!/usr/bin/env node

/**
 * Cross-check empirically-derived TICON datums against NOAA CO-OPS published
 * datums (issue #40).
 *
 * For every GESLA `-usa-noaa` station that pairs to a `data/noaa/<id>.json`
 * record, it derives datums two ways — observed (from GESLA water levels) and
 * harmonic (synthesized from the station's constituents, the old approach) —
 * and compares both to NOAA's authoritative datums. Since the vertical
 * reference frames differ (NOAA: station datum; ours: gauge/MSL), only
 * reference-invariant relationships are compared:
 *   MN  = MHW  − MLW    (mean range)
 *   GT  = MHHW − MLLW   (great diurnal range)
 *   dHi = MHW  − MSL
 *   dLo = MSL  − MLLW
 *
 * A drop in the |median| residual from harmonic → observed is the fix #40 asks
 * for. Run after the GESLA download (@neaps/datums). Reads GESLA directly, so it
 * does not depend on `import-ticon` having been run.
 */

import { readFile, readdir } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  computeDatums,
  computeDatumsFromObservations,
  parseGeslaSamples,
  type Datums,
} from "@neaps/datums";
import { ensureGeslaData, GESLA_DIR } from "@neaps/datums";
import type { StationData } from "@neaps/tide-database";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TICON_DIR = join(__dirname, "..", "data", "ticon");
const NOAA_DIR = join(__dirname, "..", "data", "noaa");

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
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

async function main() {
  await ensureGeslaData();

  const files = (await readdir(TICON_DIR)).filter((f) => f.endsWith(".json"));

  // Accumulate residuals (ours − NOAA) per relationship, for each method.
  const resid = {
    observed: { MN: [], GT: [], dHi: [], dLo: [] } as Record<string, number[]>,
    harmonic: { MN: [], GT: [], dHi: [], dLo: [] } as Record<string, number[]>,
  };
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
    const end = station.epoch?.end ? new Date(station.epoch.end) : new Date();
    const harmonic = computeDatums(station.harmonic_constituents, { end });
    const hRels = relationships(harmonic.datums);
    if (hRels) {
      for (const k of REL_KEYS) resid.harmonic[k]!.push(hRels[k] - noaaRels[k]);
    }

    // Observed (new method) — derive from GESLA water levels.
    const text = await fileText(join(GESLA_DIR, id));
    if (text) {
      const obs = computeDatumsFromObservations(parseGeslaSamples(text));
      const oRels = obs && relationships(obs.datums);
      if (oRels) {
        observedCount++;
        for (const k of REL_KEYS)
          resid.observed[k]!.push(oRels[k] - noaaRels[k]);
      }
    }
  }

  console.log(
    `\nNOAA cross-check: ${pairs} TICON↔NOAA pairs, ${observedCount} with usable observations.\n`,
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
    const end = station.epoch?.end ? new Date(station.epoch.end) : new Date();
    const harmonic = computeDatums(station.harmonic_constituents, { end });
    const obs = computeDatumsFromObservations(parseGeslaSamples(text));
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
