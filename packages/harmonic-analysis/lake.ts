import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import type { Sample } from "./index.ts";

/**
 * Read observed water levels from the water-levels lake
 * (https://github.com/openwatersio/water-levels, docs/data.md): Parquet at
 * `obs/<source>/<source_id>[/<epoch>]/<year>.parquet`, listed in
 * `stations.parquet`. Which year files exist comes from the source's year list,
 * `stations/years/<source>.parquet`, so a listed year that can't be read is an
 * error, not a gap. Files are cached in tmp/water-levels/; a year file is fetched
 * again only when the list gives it a new version, and other files are
 * revalidated by ETag.
 * Import with `@slackwater/harmonic-analysis/lake`, so the fitting code alone
 * doesn't load DuckDB.
 *
 * Only the public lake is read. Restricted series live in a private bucket;
 * a series that stations.parquet does not list is an error.
 */

export const LAKE_URL =
  process.env["WATER_LEVELS_URL"] ?? "https://water-levels.openwaters.io";
export const LAKE_DIR =
  process.env["WATER_LEVELS_CACHE"] ??
  join(import.meta.dirname, "..", "..", "tmp", "water-levels");

// The lake's flags: 0 good, 1 interpolated, 2 preliminary, 3 suspect, 4 bad.
/** Values the agency has verified: what a harmonic fit takes, as NOAA computes
 *  an epoch only from data it has evaluated. The default. */
export const VERIFIED_FLAGS = [0];
/** Every measured value, verified or not yet: interpolated, suspect and bad
 *  ones are left out. */
export const MEASURED_FLAGS = [0, 2];
/** Verified values, and preliminary ones from before the station's
 *  `source_qc_start`: the agency will never check those, so they are as final
 *  as they get. Without a known start, preliminary values stay out. */
export const FINAL_FLAGS = "final";

export interface LakeEpoch {
  id: number;
  since: Date | null;
  until: Date | null;
  /** Metres to add to put this epoch's levels in the current datum; null when they can't be. */
  to_current: number | null;
  state: string;
}

export interface LakeStation {
  id: string;
  source: string;
  source_id: string;
  datum: string;
  first: Date | null;
  last: Date | null;
  preferred: string;
  same_as: string[];
  /** Preliminary values before this are final; null when the lake doesn't know such a point. */
  source_qc_start: Date | null;
  epochs: LakeEpoch[];
}

/**
 * Fetch `path` from the lake into the cache, returning its local path, or
 * undefined when the lake has no such file. With a `version` from the year
 * list, a cached copy stored with that version is used without asking the lake.
 */
export async function cachedLakeFile(
  path: string,
  version?: string,
): Promise<string | undefined> {
  const local = join(LAKE_DIR, path);
  const stamp = `${local}.version`;
  const md5 = (body: Buffer) => createHash("md5").update(body).digest("hex");
  const cached = await readFile(local).catch(() => undefined);
  // The stamp names the body it was written for, so a file another process
  // replaced since doesn't match it.
  if (
    version &&
    cached &&
    (await readFile(stamp, "utf8").catch(() => undefined)) ===
      `${version} ${md5(cached)}`
  )
    return local;
  // R2's ETag is the body's MD5, so the cached file is its own validator. An
  // ETag that isn't an MD5, as a multipart upload's isn't, never matches and
  // the file is fetched again.
  const etag = cached && `"${md5(cached)}"`;
  const res = await fetch(`${LAKE_URL}/${path}`, {
    headers: etag ? { "If-None-Match": etag } : {},
    signal: AbortSignal.timeout(120_000),
  });
  if (res.status === 404) {
    await rm(local, { force: true });
    await rm(stamp, { force: true });
    return undefined;
  }
  let body = cached!;
  if (res.status !== 304 || !cached) {
    if (!res.ok) throw new Error(`${LAKE_URL}/${path}: HTTP ${res.status}`);
    await mkdir(dirname(local), { recursive: true });
    // Rename, so a reader in another process never sees half a file.
    const partial = `${local}.${process.pid}`;
    body = Buffer.from(await res.arrayBuffer());
    await writeFile(partial, body);
    await rename(partial, local);
  }
  // The version was read from the year list before this download, so a file
  // rewritten in between holds newer rows than its stamp: one more download
  // next time, never a stale copy.
  if (version) await writeFile(stamp, `${version} ${md5(body)}`);
  return local;
}

let connection: Promise<DuckDBConnection> | undefined;
const db = () =>
  (connection ??= DuckDBInstance.create().then((i) => i.connect()));

const sqlString = (s: string) => `'${s.replaceAll("'", "''")}'`;
const toDate = (ms: unknown) =>
  ms === null || ms === undefined ? null : new Date(Number(ms));

let stations: Promise<Map<string, LakeStation>> | undefined;

/** Every station in the lake's public list, by id. */
export function lakeStations(): Promise<Map<string, LakeStation>> {
  return (stations ??= (async () => {
    const file = await cachedLakeFile("stations.parquet");
    if (!file) throw new Error(`${LAKE_URL}/stations.parquet is missing`);
    const reader = await (
      await db()
    ).runAndReadAll(`
      SELECT id, source, source_id, datum, preferred, same_as,
        epoch_ms(first) AS first, epoch_ms(last) AS last,
        epoch_ms(source_qc_start) AS source_qc_start,
        [{id: e.id, since: epoch_ms(e.since), until: epoch_ms(e.until),
          to_current: e.to_current, state: e.state}
         FOR e IN coalesce(epochs, [])] AS epochs
      FROM read_parquet(${sqlString(file)})`);
    return new Map(
      reader.getRowObjectsJS().map((row: any) => [
        row.id,
        {
          id: row.id,
          source: row.source,
          source_id: row.source_id,
          datum: row.datum,
          preferred: row.preferred ?? row.id,
          same_as: row.same_as ?? [],
          source_qc_start: toDate(row.source_qc_start),
          first: toDate(row.first),
          last: toDate(row.last),
          epochs: (row.epochs as any[]).map((e) => ({
            id: e.id,
            since: toDate(e.since),
            until: toDate(e.until),
            to_current: e.to_current,
            state: e.state,
          })),
        } satisfies LakeStation,
      ]),
    );
  })().catch((err) => {
    // Let a later call try again rather than keep the failure.
    stations = undefined;
    throw err;
  }));
}

/** A station's year files, each one's version by `<epoch> <year>`, or "marked"
 *  when a run may be writing them and they can't be trusted. */
export type LakeYears = Map<string, Map<string, string> | "marked">;

const yearLists = new Map<string, { md5: string; years: LakeYears }>();

/**
 * A source's year files by station, from `stations/years/<source>.parquet`,
 * revalidated on every call. Throws when the lake hasn't listed the source's
 * years yet.
 */
export async function lakeYears(source: string): Promise<LakeYears> {
  const path = `stations/years/${source}.parquet`;
  const file = await cachedLakeFile(path);
  if (!file)
    throw new Error(
      `${LAKE_URL}/${path} is missing: the lake hasn't listed ${source}'s years yet`,
    );
  const md5 = createHash("md5")
    .update(await readFile(file))
    .digest("hex");
  const memo = yearLists.get(source);
  if (memo?.md5 === md5) return memo.years;
  const rows = (
    await (
      await db()
    ).runAndReadAll(
      `SELECT id, epoch, year, coalesce(version, '') AS version FROM read_parquet(${sqlString(file)})`,
    )
  ).getRowObjectsJS() as {
    id: string;
    epoch: number | null;
    year: number | null;
    version: string;
  }[];
  const years: LakeYears = new Map();
  for (const r of rows) {
    const station = years.get(r.id) ?? new Map<string, string>();
    if (station === "marked") continue;
    if (r.epoch === null || r.year === null) years.set(r.id, "marked");
    else years.set(r.id, station.set(`${r.epoch} ${r.year}`, r.version));
  }
  yearLists.set(source, { md5, years });
  return years;
}

/** A station's listed year files; throws when they can't be trusted. */
async function stationYears(station: LakeStation) {
  const years = (await lakeYears(station.source)).get(station.id);
  if (years === "marked")
    throw new Error(
      `${station.id}: the lake is writing its year files; read again later`,
    );
  if (!years && station.first)
    throw new Error(
      `${station.id} has observations but no years in stations/years/${station.source}.parquet`,
    );
  const known = new Set(station.epochs.map((e) => String(e.id)).concat("1"));
  for (const key of years?.keys() ?? [])
    if (!known.has(key.split(" ")[0]!))
      throw new Error(
        `${station.id}: the year list has epoch ${key.split(" ")[0]}, which stations.parquet doesn't; read again later`,
      );
  return years ?? new Map<string, string>();
}

export async function lakeStation(
  id: string,
): Promise<LakeStation | undefined> {
  return (await lakeStations()).get(id);
}

/**
 * A lake series' levels with the given flags (or FINAL_FLAGS), verified ones by default, in [start, end), in metres in the station's
 * current datum. Each datum epoch's levels are moved by its `to_current`; an
 * epoch that can't be converted is left out. Where a rejected epoch and the
 * one before it share a time, the latter wins, as data.md's query does.
 */
export async function readLakeSamples(
  id: string,
  period: { start: Date; end: Date },
  flags: number[] | typeof FINAL_FLAGS = VERIFIED_FLAGS,
): Promise<Sample[]> {
  const station = await lakeStation(id);
  if (!station) throw new Error(`${id} is not in the public water-levels lake`);
  const epochs = station.epochs.length
    ? station.epochs
    : [{ id: 1, since: null, until: null, to_current: 0, state: "open" }];

  const years = await stationYears(station);
  const qcStart = station.source_qc_start;
  const where =
    flags !== FINAL_FLAGS
      ? `flag IN (${flags.join(", ")})`
      : qcStart
        ? `(flag IN (${VERIFIED_FLAGS.join(", ")}) OR (flag = 2 AND time < make_timestamptz(${+qcStart}::BIGINT * 1000)))`
        : `flag IN (${VERIFIED_FLAGS.join(", ")})`;

  const byTime = new Map<number, { level: number; rejected: boolean }>();
  for (const epoch of epochs) {
    if (epoch.to_current === null) continue;
    const start = Math.max(
      +period.start,
      +(epoch.since ?? -Infinity),
      +(station.first ?? -Infinity),
    );
    const end = Math.min(
      +period.end,
      +(epoch.until ?? Infinity),
      +(station.last ?? Infinity) + 1,
    );
    if (!(start < end)) continue;

    const dir = [
      "obs",
      station.source,
      encodeURIComponent(station.source_id),
      ...(epoch.id === 1 ? [] : [String(epoch.id)]),
    ].join("/");
    const files: string[] = [];
    const lastYear = new Date(end - 1).getUTCFullYear();
    for (let y = new Date(start).getUTCFullYear(); y <= lastYear; y++) {
      // A year the list doesn't have has no values.
      const version = years.get(`${epoch.id} ${y}`);
      if (version === undefined) continue;
      const path = `${dir}/${y}.parquet`;
      const file = await cachedLakeFile(path, version);
      if (!file) throw new Error(`${LAKE_URL}/${path} is listed but missing`);
      files.push(file);
    }
    if (!files.length) continue;

    const reader = await (
      await db()
    ).runAndReadAll(`
      SELECT epoch_ms(time) AS t, CAST(level_m AS DOUBLE) AS level
      FROM read_parquet([${files.map(sqlString).join(", ")}], union_by_name = true)
      WHERE ${where} AND level_m IS NOT NULL
        AND time >= make_timestamptz(${start}::BIGINT * 1000)
        AND time < make_timestamptz(${end}::BIGINT * 1000)`);
    const rejected = epoch.state === "rejected";
    for (const row of reader.getRowObjectsJS() as {
      t: bigint;
      level: number;
    }[]) {
      const t = Number(row.t);
      if (rejected && byTime.has(t)) continue;
      // float32 in the lake; round off the widening noise below 0.1 mm.
      const level = Math.round((row.level + epoch.to_current) * 1e4) / 1e4;
      byTime.set(t, { level, rejected });
    }
  }
  // A run that wrote the station's files while they were read marks it or
  // changes their versions.
  if (
    [...years].sort().join() !==
    [...(await stationYears(station))].sort().join()
  )
    throw new Error(
      `${station.id}: the lake changed its year files while they were read; read again`,
    );
  return [...byTime]
    .map(([t, { level }]) => ({ t, level }))
    .sort((a, b) => a.t - b.t);
}
