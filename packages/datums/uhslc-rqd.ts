import { access, mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import createFetch from "make-fetch-happen";
import { resolveEpoch, type Sample } from "./datum.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Cached UHSLC hourly RQD downloads, one CSV per station (gitignored). */
export const UHSLC_DIR = join(__dirname, "..", "..", "tmp", "UHSLC");

const RQDS =
  "https://uhslc.soest.hawaii.edu/erddap/tabledap/global_hourly_rqds";

const fetch = createFetch.defaults({ retry: 5 });

/**
 * UHSLC id and station version for a TICON `uhslc_rq` id, e.g.
 * "christmas-011b-aus-uhslc_rq" -> { uhslcId: 11, version: "B" }.
 */
export function parseRqdId(
  id: string,
): { uhslcId: number; version: string } | undefined {
  const m = id.match(/-(\d+)([a-z])-[a-z]+-uhslc_rq$/);
  if (!m) return undefined;
  return { uhslcId: parseInt(m[1]!, 10), version: m[2]!.toUpperCase() };
}

/** Parse ERDDAP `time,sea_level` CSV (millimetres) into samples in metres. */
export function parseRqdSamples(csv: string): Sample[] {
  const samples: Sample[] = [];
  // Skip the column-name and units rows.
  for (const line of csv.split(/\r?\n/).slice(2)) {
    const [time, mm] = line.split(",");
    const level = Number(mm) / 1000;
    if (!time || !mm || !Number.isFinite(level)) continue;
    samples.push({ time: new Date(time), level });
  }
  return samples;
}

function query(id: string) {
  const rqd = parseRqdId(id);
  if (!rqd) throw new Error(`not a UHSLC RQD id: ${id}`);
  return `uhslc_id=${rqd.uhslcId}&version=%22${rqd.version}%22`;
}

async function get(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`UHSLC ERDDAP ${res.status}: ${url}`);
  return res.text();
}

/**
 * Time of the last RQD observation for a TICON `uhslc_rq` id, or undefined
 * when UHSLC no longer publishes that station version.
 */
export async function rqdEnd(id: string): Promise<Date | undefined> {
  const url = `${RQDS}.csv?time&${query(id)}&sea_level!=NaN&orderByMax(%22time%22)`;
  const res = await fetch(url);
  // ERDDAP answers a query with no matching rows with 404.
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`UHSLC ERDDAP ${res.status}: ${url}`);
  const time = (await res.text()).split(/\r?\n/)[2];
  return time ? new Date(time) : undefined;
}

/**
 * Hourly RQD samples covering the datum window that ends at `end`, cached
 * under UHSLC_DIR. UHSLC QC-accepts every published RQD value, so no flag
 * filtering is needed.
 */
export async function loadRqdSamples(id: string, end: Date): Promise<Sample[]> {
  const path = join(UHSLC_DIR, `${id}.csv`);
  try {
    await access(path);
  } catch {
    const { start } = resolveEpoch({ end });
    const csv = await get(
      `${RQDS}.csv?time,sea_level&${query(id)}&time>=${start.toISOString()}&sea_level!=NaN`,
    );
    await mkdir(UHSLC_DIR, { recursive: true });
    await writeFile(path, csv);
  }
  return parseRqdSamples(await readFile(path, "utf-8"));
}
