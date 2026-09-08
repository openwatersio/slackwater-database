#!/usr/bin/env node

import { access, mkdir } from "fs/promises";
import { execFileSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";
import createFetch from "make-fetch-happen";
import { pipeline } from "stream/promises";
import { createWriteStream } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Canonical location for the extracted GESLA-4 station files (gitignored). */
export const GESLA_DIR = join(__dirname, "..", "..", "tmp", "GESLA");

// GESLA-4 is published only as an iCloud Drive share (not scriptable). We mirror
// the zip to an R2 bucket for CI/fresh checkouts; a local zip is preferred.
const GESLA_URL =
  process.env["GESLA_URL"] ??
  "https://pub-71451f37552642aeb221675a99f4ecf1.r2.dev/GESLA4_ALL.zip";
const GESLA_ZIP =
  process.env["GESLA_ZIP"] ?? join(homedir(), "Downloads", "GESLA4_ALL.zip");

const fetch = createFetch.defaults({
  cachePath: "node_modules/.cache",
  retry: 5,
});

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure the GESLA-4 dataset is available at GESLA_DIR, returning its path.
 *
 * Resolves in order: extracted dir → local zip (GESLA_ZIP) → download from R2
 * (GESLA_URL). Used by import-ticon.ts and validate-datums.ts.
 */
export async function ensureGeslaData(): Promise<string> {
  if (await fileExists(GESLA_DIR)) return GESLA_DIR;

  // Ensure tmp/ exists for the downloaded zip; `unzip -d` creates GESLA_DIR
  // itself (only after a successful extract, so an empty dir never looks done).
  await mkdir(dirname(GESLA_DIR), { recursive: true });

  let zip = GESLA_ZIP;
  if (!(await fileExists(zip))) {
    console.log(`Downloading GESLA-4 from ${GESLA_URL} ...`);
    const res = await fetch(GESLA_URL);
    if (!res.ok || !res.body) {
      throw new Error(
        `Failed to download GESLA-4 (${res.status}).\n` +
          `GESLA-4 is published as an iCloud Drive share (https://gesla787883612.wordpress.com/downloads/).\n` +
          `Download GESLA4_ALL.zip manually to ${GESLA_ZIP} (or set GESLA_ZIP), then re-run.`,
      );
    }
    zip = join(GESLA_DIR, "..", "GESLA4_ALL.zip");
    await pipeline(res.body, createWriteStream(zip));
  }

  console.log(`Extracting ${zip} → ${GESLA_DIR} ...`);
  // Flat zip (no internal directory), so files land directly in GESLA_DIR.
  execFileSync("unzip", ["-o", "-q", zip, "-d", GESLA_DIR], {
    stdio: "inherit",
  });

  return GESLA_DIR;
}

// Run directly: node tools/download-gesla.ts
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`GESLA-4 ready: ${await ensureGeslaData()}`);
}
