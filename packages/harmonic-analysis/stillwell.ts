import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import type { Sample } from "./index.ts";

/**
 * Read observed water levels from Stillwell
 * (https://openwatersio.github.io/stillwell/docs/reference/files/): Parquet at
 * `obs/<source>/<source_id>[/<epoch>]/<year>.parquet`, listed in
 * `stations.parquet`. Which year files exist comes from the source's year list,
 * `stations/years/<source>.parquet`, so a listed year that can't be read is an
 * error, not a gap. Files are cached in tmp/stillwell/; a year file is fetched
 * again only when the list gives it a new version, and other files are
 * revalidated by ETag.
 * Import with `@slackwater/harmonic-analysis/stillwell`, so the fitting code alone
 * doesn't load DuckDB.
 *
 * Only Stillwell's public store is read. Restricted series live in a private bucket;
 * a series that stations.parquet does not list is an error.
 */

export const STILLWELL_URL =
  process.env["STILLWELL_URL"] ?? "https://stillwell.openwaters.io";
// Stillwell refuses a request without a User-Agent naming the project.
const USER_AGENT =
  "slackwater-database (https://github.com/openwatersio/slackwater-database)";
export const STILLWELL_DIR =
  process.env["STILLWELL_CACHE"] ??
  join(import.meta.dirname, "..", "..", "tmp", "stillwell");

// Stillwell's flags: 0 good, 1 interpolated, 2 preliminary, 3 suspect, 4 bad.
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

export interface StillwellEpoch {
  id: number;
  since: Date | null;
  until: Date | null;
  /** Metres to add to put this epoch's levels in the current datum; null when they can't be. */
  to_current: number | null;
  state: string;
}

export interface StillwellStation {
  id: string;
  source: string;
  source_id: string;
  datum: string;
  first: Date | null;
  last: Date | null;
  preferred: string;
  same_as: string[];
  /** Preliminary values before this are final; null when Stillwell doesn't know such a point. */
  source_qc_start: Date | null;
  epochs: StillwellEpoch[];
}

/**
 * Fetch `path` from Stillwell into the cache, returning its local path, or
 * undefined when Stillwell has no such file. With a `version` from the year
 * list, a cached copy stored with that version is used without asking Stillwell.
 */
export async function cachedStillwellFile(
  path: string,
  version?: string,
): Promise<string | undefined> {
  // Paths are built from Stillwell's own ids, which must stay inside the cache.
  if (path.split("/").includes("..") || /[*?[\]{}]/.test(path))
    throw new Error(`refusing to read ${path} outside the cache`);
  const local = join(STILLWELL_DIR, path);
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
  const res = await fetch(`${STILLWELL_URL}/${path}`, {
    headers: {
      "User-Agent": USER_AGENT,
      ...(etag ? { "If-None-Match": etag } : {}),
    },
    signal: AbortSignal.timeout(120_000),
  });
  if (res.status === 404) {
    await rm(local, { force: true });
    await rm(stamp, { force: true });
    return undefined;
  }
  let body = cached!;
  if (res.status !== 304 || !cached) {
    if (!res.ok)
      throw new Error(`${STILLWELL_URL}/${path}: HTTP ${res.status}`);
    await mkdir(dirname(local), { recursive: true });
    // Rename, so a reader in another process never sees half a file.
    const partial = `${local}.${randomUUID()}`;
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
  (connection ??= DuckDBInstance.create().then(async (i) => {
    const c = await i.connect();
    // Period bounds compare in UTC whatever the machine's zone.
    await c.run("SET TimeZone = 'UTC'");
    return c;
  }));

const sqlString = (s: string) => `'${s.replaceAll("'", "''")}'`;
const toDate = (ms: unknown) =>
  ms === null || ms === undefined ? null : new Date(Number(ms));

let stations: Promise<Map<string, StillwellStation>> | undefined;
let stationsMd5: string | undefined;
const fileMd5 = async (file: string) =>
  createHash("md5")
    .update(await readFile(file))
    .digest("hex");

/** Revalidate the station list, and parse it again if Stillwell changed it. */
export async function refreshStations() {
  const file = await cachedStillwellFile("stations.parquet");
  if (file && stationsMd5 && (await fileMd5(file)) !== stationsMd5)
    stations = undefined;
}

/** Every station in Stillwell's public list, by id. */
export function stillwellStations(): Promise<Map<string, StillwellStation>> {
  return (stations ??= (async () => {
    const file = await cachedStillwellFile("stations.parquet");
    if (!file) throw new Error(`${STILLWELL_URL}/stations.parquet is missing`);
    stationsMd5 = await fileMd5(file);
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
            id: Number(e.id),
            since: toDate(e.since),
            until: toDate(e.until),
            to_current: e.to_current,
            state: e.state,
          })),
        } satisfies StillwellStation,
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
export type StillwellYears = Map<string, Map<string, string> | "marked">;

const yearLists = new Map<string, { md5: string; years: StillwellYears }>();

/**
 * A source's year files by station, from `stations/years/<source>.parquet`,
 * revalidated on every call. Throws when Stillwell hasn't listed the source's
 * years yet.
 */
export async function stillwellYears(source: string): Promise<StillwellYears> {
  const path = `stations/years/${source}.parquet`;
  const file = await cachedStillwellFile(path);
  if (!file)
    throw new Error(
      `${STILLWELL_URL}/${path} is missing: Stillwell hasn't listed ${source}'s years yet`,
    );
  const md5 = await fileMd5(file);
  const memo = yearLists.get(source);
  if (memo?.md5 === md5) return memo.years;
  const rows = (
    await (
      await db()
    ).runAndReadAll(
      `SELECT id, epoch, year, version FROM read_parquet(${sqlString(file)})`,
    )
  ).getRowObjectsJS() as {
    id: string;
    epoch: number | null;
    year: number | null;
    version: string | null;
  }[];
  const years: StillwellYears = new Map();
  for (const r of rows) {
    const station = years.get(r.id) ?? new Map<string, string>();
    if (station === "marked") continue;
    // A listed year without a version can't be checked, so it counts as unsettled too.
    if (r.epoch === null || r.year === null || r.version === null)
      years.set(r.id, "marked");
    else years.set(r.id, station.set(`${r.epoch} ${r.year}`, r.version));
  }
  yearLists.set(source, { md5, years });
  return years;
}

/** A station's listed year files; throws when they can't be trusted. */
async function stationYears(station: StillwellStation) {
  const years = (await stillwellYears(station.source)).get(station.id);
  if (years === "marked")
    throw new Error(
      `${station.id}: Stillwell is writing its year files; read again later`,
    );
  if (!years && station.first)
    throw new Error(
      `${station.id} has observations but no years in stations/years/${station.source}.parquet`,
    );
  const known = new Set(
    station.epochs.length ? station.epochs.map((e) => String(e.id)) : ["1"],
  );
  for (const key of years?.keys() ?? [])
    if (!known.has(key.split(" ")[0]!))
      throw new Error(
        `${station.id}: the year list has epoch ${key.split(" ")[0]}, which stations.parquet doesn't; read again later`,
      );
  return years ?? new Map<string, string>();
}

export async function stillwellStation(
  id: string,
): Promise<StillwellStation | undefined> {
  return (await stillwellStations()).get(id);
}

/**
 * An error Stillwell found in what a source publishes, from `errata.json`
 * (https://openwatersio.github.io/stillwell/docs/reference/errata/).
 */
export interface Erratum {
  id: string;
  source: string;
  /** Null for every station of the source. */
  stations: string[] | null;
  /** First UTC day of affected values; null for an open start or none. */
  since: string | null;
  /** UTC day after the last affected one; null for an open end or none. */
  until: string | null;
  handling:
    "corrected" | "flagged" | "dropped" | "refused" | "avoided" | "kept";
  error: string;
}

/** Every erratum in Stillwell, revalidated on each call. */
export async function stillwellErrata(): Promise<Erratum[]> {
  const file = await cachedStillwellFile("errata.json");
  if (!file) throw new Error(`${STILLWELL_URL}/errata.json is missing`);
  const errata = JSON.parse(await readFile(file, "utf8")) as Erratum[];
  // A date that doesn't parse would leave its erratum out of every read.
  const handlings = [
    "corrected",
    "flagged",
    "dropped",
    "refused",
    "avoided",
    "kept",
  ];
  for (const e of errata) {
    // A handling this reader doesn't know may need a decision it can't ask for.
    if (!handlings.includes(e.handling))
      throw new Error(
        `erratum ${e.id} has a handling this reader doesn't know: ${e.handling}`,
      );
    for (const day of [e.since, e.until])
      if (
        day !== null &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(day) ||
          !Number.isFinite(Date.parse(day)) ||
          new Date(Date.parse(day)).toISOString().slice(0, 10) !== day)
      )
        throw new Error(`erratum ${e.id} has a date that isn't one: ${day}`);
  }
  return errata;
}

/** The errata that touch `station` within `period`. */
export function errataFor(
  errata: readonly Erratum[],
  station: { id: string; source: string },
  period: { start: Date; end: Date },
): Erratum[] {
  return errata.filter(
    (e) =>
      e.source === station.source &&
      (e.stations === null || e.stations.includes(station.id)) &&
      (e.since === null || Date.parse(e.since) < +period.end) &&
      (e.until === null || Date.parse(e.until) > +period.start),
  );
}

/**
 * What a reader does with the span of a `kept` erratum, by erratum id: "drop"
 * leaves its values out, "keep" reads them as served. Stillwell keeps values
 * it can't correct, flag or drop, such as Vardø's five-minute lag or BODC's
 * gaps, so only the caller can say whether they still serve its purpose.
 */
export type ErrataDecisions = Record<string, "drop" | "keep">;

/** What a read used, so it can be reproduced: each year file's version by
 *  `<epoch> <year>`, the station's epochs and QC start as they were, and the
 *  errata in the period read, by id. */
export interface ReadInputs {
  versions: Record<string, string>;
  epochs?: Pick<
    StillwellEpoch,
    "id" | "since" | "until" | "to_current" | "state"
  >[];
  source_qc_start?: Date | null;
  errata: Record<string, Pick<Erratum, "handling" | "since" | "until">>;
}

export interface ReadOptions {
  /** Decisions on the period's `kept` errata. */
  errata?: ErrataDecisions;
  /** Only values stamped on the hour, picked before they reach JavaScript. */
  hourly?: boolean;
  /** Filled with what the read used, added to what it holds already. */
  inputs?: ReadInputs;
}

/** A source's entry in Stillwell's `sources.json`. */
export async function stillwellSource(
  source: string,
): Promise<{ id: string; finalizes: boolean }> {
  const file = await cachedStillwellFile("sources.json");
  if (!file) throw new Error(`${STILLWELL_URL}/sources.json is missing`);
  const entry = (
    JSON.parse(await readFile(file, "utf8")) as {
      id: string;
      finalizes: boolean;
    }[]
  ).find((s) => s.id === source);
  if (!entry) throw new Error(`Stillwell has no source ${source}`);
  return entry;
}

/**
 * A Stillwell series' levels with the given flags (or FINAL_FLAGS), verified ones by default, in [start, end), in metres in the station's
 * current datum. Each datum epoch's levels are moved by its `to_current`; an
 * epoch that can't be converted is left out. Where a rejected epoch and the
 * one before it share a time, the latter wins, as Stillwell's own query does.
 * Throws on a `kept` erratum in the period that `options.errata` doesn't
 * decide, so a read never uses values Stillwell knows are wrong without
 * saying so. FINAL_FLAGS is refused for a source that doesn't finalize its
 * values, whose final values depend on a revision window Stillwell doesn't
 * publish yet.
 */
export async function readStillwellSamples(
  id: string,
  period: { start: Date; end: Date },
  flags: number[] | typeof FINAL_FLAGS = VERIFIED_FLAGS,
  options: ReadOptions = {},
): Promise<Sample[]> {
  const decisions = options.errata ?? {};
  await refreshStations();
  const station = await stillwellStation(id);
  if (!station) throw new Error(`${id} is not in Stillwell's public store`);
  if (
    flags === FINAL_FLAGS &&
    !(await stillwellSource(station.source)).finalizes
  )
    throw new Error(
      `${station.source} doesn't finalize its values, and Stillwell doesn't publish its revision window yet`,
    );
  const touching = errataFor(await stillwellErrata(), station, period);
  const dropped = touching.filter((e) => {
    if (e.handling !== "kept") return false;
    if (!decisions[e.id])
      throw new Error(
        `${id}: Stillwell keeps erratum ${e.id} as the source serves it; decide whether to drop or keep its values`,
      );
    return decisions[e.id] === "drop";
  });
  const inDropped = (t: number) =>
    dropped.some(
      (e) =>
        (e.since === null || t >= Date.parse(e.since)) &&
        (e.until === null || t < Date.parse(e.until)),
    );
  // In id order, so a rejected epoch yields to the one before it.
  const epochs = station.epochs.length
    ? [...station.epochs].sort((a, b) => a.id - b.id)
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
  const read: string[] = [];
  for (const epoch of epochs) {
    if (epoch.to_current === null) continue;
    // The year list, not stations.parquet's first and last, which lag it,
    // says which years have values.
    const start = Math.max(+period.start, +(epoch.since ?? -Infinity));
    const end = Math.min(+period.end, +(epoch.until ?? Infinity));
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
      read.push(`${epoch.id} ${y}`);
      const version = years.get(`${epoch.id} ${y}`);
      if (version === undefined) continue;
      const path = `${dir}/${y}.parquet`;
      const file = await cachedStillwellFile(path, version);
      if (!file)
        throw new Error(`${STILLWELL_URL}/${path} is listed but missing`);
      files.push(file);
    }
    if (!files.length) continue;

    const reader = await (
      await db()
    ).runAndReadAll(`
      SELECT epoch_ms(time) AS t, CAST(level_m AS DOUBLE) AS level
      FROM read_parquet([${files.map(sqlString).join(", ")}], union_by_name = true)
      WHERE ${where} AND level_m IS NOT NULL
        ${options.hourly ? "AND epoch_ms(time) % 3600000 = 0" : ""}
        AND time >= make_timestamptz(${start}::BIGINT * 1000)
        AND time < make_timestamptz(${end}::BIGINT * 1000)`);
    const rejected = epoch.state === "rejected";
    for (const row of reader.getRowObjectsJS() as {
      t: bigint;
      level: number;
    }[]) {
      const t = Number(row.t);
      if (rejected && byTime.has(t)) continue;
      // float32 in Stillwell; round off the widening noise below 0.1 mm.
      const level = Math.round((row.level + epoch.to_current) * 1e4) / 1e4;
      byTime.set(t, { level, rejected });
    }
  }
  // A run that wrote the station's files while they were read marks it or
  // changes the years read.
  const after = await stationYears(station);
  if (read.some((key) => years.get(key) !== after.get(key)))
    throw new Error(
      `${station.id}: Stillwell changed its year files while they were read; read again`,
    );
  if (options.inputs) {
    for (const key of read) {
      const version = years.get(key);
      if (version !== undefined) options.inputs.versions[key] = version;
    }
    const used = epochs.map(({ id, since, until, to_current, state }) => ({
      id,
      since,
      until,
      to_current,
      state,
    }));
    // One record of inputs describes one state of the station.
    if (
      options.inputs.epochs &&
      (JSON.stringify(options.inputs.epochs) !== JSON.stringify(used) ||
        +(options.inputs.source_qc_start ?? 0) !==
          +(station.source_qc_start ?? 0))
    )
      throw new Error(
        `${station.id}: Stillwell changed the station's epochs or QC start between reads; read again`,
      );
    options.inputs.epochs = used;
    options.inputs.source_qc_start = station.source_qc_start;
    for (const { id, handling, since, until } of touching)
      options.inputs.errata[id] = { handling, since, until };
  }
  return [...byTime]
    .filter(([t]) => !inDropped(t))
    .map(([t, { level }]) => ({ t, level }))
    .sort((a, b) => a.t - b.t);
}

/**
 * A source's last whole year of final values, the same for every gauge of the
 * source: the latest year before the current one in which most of its
 * stations with values that year have no preliminary ones, over all their
 * epochs. A station whose year files are being written, or whose count of
 * preliminary values is missing, votes for no year. Only sources that
 * finalize their values have one; for the others, final values depend on a
 * revision window Stillwell doesn't publish yet.
 */
export async function sourceFinalYear(source: string): Promise<number> {
  const entry = await stillwellSource(source);
  if (!entry.finalizes)
    throw new Error(
      `${source} doesn't finalize its values, and Stillwell doesn't publish its revision window yet`,
    );
  const path = `stations/years/${source}.parquet`;
  const years = await cachedStillwellFile(path);
  if (!years) throw new Error(`${STILLWELL_URL}/${path} is missing`);
  const rows = (
    await (
      await db()
    ).runAndReadAll(`
      WITH rows AS (SELECT * FROM read_parquet(${sqlString(years)})),
      settled AS (
        SELECT id, year, bool_or(preliminary > 0) AS preliminary
        FROM rows
        WHERE id NOT IN (SELECT id FROM rows
          WHERE epoch IS NULL OR year IS NULL OR version IS NULL OR preliminary IS NULL)
        GROUP BY id, year)
      SELECT year FROM settled
      WHERE year < ${new Date().getUTCFullYear()}
      GROUP BY year
      HAVING count(*) FILTER (WHERE preliminary) * 2 < count(*)
      ORDER BY year DESC LIMIT 1`)
  ).getRowObjectsJS() as { year: number }[];
  if (!rows.length) throw new Error(`${source} has no year of final values`);
  return Number(rows[0]!.year);
}
