#!/usr/bin/env node

// Synthesize LAT/HAT for NOAA reference stations that don't publish them; see
// lat-hat.ts for the method and what gets skipped.
//
// Idempotent: stations that already have both are skipped, and the epoch is
// pinned, so re-running produces no diff. Chain it AFTER
// the NOAA import (sources/noaa), which rewrites `datums` wholesale.

import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { save, DATA_DIR } from "./station.ts";
import { backfillLatHat } from "./lat-hat.ts";
import type { StationData } from "@slackwater/database";

const NOAA_DIR = join(DATA_DIR, "noaa");

async function main() {
  const files = (await readdir(NOAA_DIR)).filter((f) => f.endsWith(".json"));
  let filled = 0;
  const skipped: string[] = [];

  for (const file of files.sort()) {
    const station: StationData = JSON.parse(
      await readFile(join(NOAA_DIR, file), "utf-8"),
    );
    const result = backfillLatHat(station);
    if (result.skipped) skipped.push(`${file} (${result.skipped})`);
    if (!result.filled) continue;

    await save("noaa", result.station);
    filled++;
    console.log(`${station.name} (${station.source.id}): LAT/HAT synthesized`);
  }

  console.log(`\nFilled ${filled} station${filled === 1 ? "" : "s"}.`);
  if (skipped.length) {
    console.log(`Skipped ${skipped.length}:`);
    for (const s of skipped) console.log(`  ${s}`);
  }
}

await main();
