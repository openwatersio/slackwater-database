#!/usr/bin/env node

/**
 * Compares the UHSLC ERDDAP hourly datasets with the stations already in the
 * database, before any UHSLC data changes generated station files. See #138.
 *
 * Writes one row per RQD and FD record to tmp/uhslc-inventory.csv and prints a
 * summary. Read-only: nothing under data/ is modified.
 */

import { mkdir, readdir, readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import createFetch from "make-fetch-happen";
import {
  DATA_DIR,
  MAX_DEDUP_DISTANCE,
  distance,
  getSourceSuffix,
} from "@neaps/stations";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const OUT = join(ROOT, "tmp", "uhslc-inventory.csv");
const ERDDAP = "https://uhslc.soest.hawaii.edu/erddap/tabledap";

// Same bar as computeDatumsFromObservations: a year of span and 4,000 hourly
// values supports both an observed datum reduction and a constituent fit.
const MIN_DAYS = 365;
const MIN_HOURS = 4000;

// An existing accepted station within this radius already gives a prediction
// close enough that the record adds little coverage.
const NEARBY_KM = 10;

const fetch = createFetch.defaults({ retry: 5 });

type Row = Record<string, string | number | null | undefined>;

/** Query ERDDAP tabledap as JSON and return rows keyed by column name. */
async function erddap(dataset: string, query: string): Promise<Row[]> {
  const res = await fetch(`${ERDDAP}/${dataset}.json?${query}`);
  if (!res.ok) throw new Error(`${dataset}?${query}: HTTP ${res.status}`);
  const { table } = (await res.json()) as {
    table: { columnNames: string[]; rows: Row[keyof Row][][] };
  };
  return table.rows.map((r) =>
    Object.fromEntries(table.columnNames.map((c, i) => [c, r[i] ?? null])),
  );
}

/** Span and valid-value count for one record. Per-record, because a
 *  whole-dataset orderByMinMax exceeds the ERDDAP gateway's 60 s timeout. */
async function span(dataset: string, recordId: number) {
  const where = `&record_id=${recordId}`;
  const [times, counts] = await Promise.all([
    erddap(dataset, `time${where}&orderByMinMax(%22time%22)`),
    erddap(dataset, `sea_level${where}&sea_level!=NaN&orderByCount(%22%22)`),
  ]);
  const start = String(times[0]?.["time"] ?? "");
  const end = String(times[1]?.["time"] ?? start);
  const hours = Number(counts[0]?.["sea_level"] ?? 0);
  const days = (Date.parse(end) - Date.parse(start)) / 86_400_000;
  return {
    start: start.slice(0, 10),
    end: end.slice(0, 10),
    hours,
    adequate: days >= MIN_DAYS && hours >= MIN_HOURS,
  };
}

/** Run `fn` over `items` with a fixed number of requests in flight. */
async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>) {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
        if (i % 50 === 0) process.stdout.write(".");
      }
    }),
  );
  return out;
}

const lon180 = (lon: number) => (lon > 180 ? lon - 360 : lon);

/** UHSLC id + version as TICON writes it: 347 + "A" -> "347a", 82 -> "082". */
const ticonCode = (uhslcId: number, version = "") =>
  String(uhslcId).padStart(3, "0") + version.toLowerCase();

interface Station {
  key: string; // e.g. "ticon/abashiri-347a-jpn-uhslc_rq"
  lat: number;
  lon: number;
  epochEnd: string;
}

async function loadStations(source: string): Promise<Station[]> {
  const files = (await readdir(join(DATA_DIR, source))).filter((f) =>
    f.endsWith(".json"),
  );
  return Promise.all(
    files.map(async (f) => {
      const s = JSON.parse(await readFile(join(DATA_DIR, source, f), "utf-8"));
      const key = `${source}/${f.slice(0, -5)}`;
      return {
        key,
        lat: s.latitude,
        lon: s.longitude,
        epochEnd: s.epoch?.end ?? "",
      };
    }),
  );
}

async function main() {
  const quality = new Map<string, { accepted: boolean; issues: string[] }>(
    JSON.parse(await readFile(join(ROOT, "quality.json"), "utf-8")).map(
      (q: { id: string; accepted: boolean; issues: string[] }) => [q.id, q],
    ),
  );
  const stations = [
    ...(await loadStations("noaa")),
    ...(await loadStations("ticon")),
  ];
  const accepted = stations.filter((s) => quality.get(s.key)?.accepted);

  // TICON UHSLC records by "<code>-<suffix>", e.g. "347a-uhslc_rq".
  const ticonByCode = new Map<string, string>();
  for (const s of stations) {
    const m = s.key.match(/^ticon\/.*-(\d+[a-z]?)-[a-z]+-(uhslc_rq|uhslc_fd)$/);
    if (m) ticonByCode.set(`${m[1]}-${m[2]}`, s.key);
  }

  function nearest(lat: number, lon: number, exclude?: string) {
    let best: { key: string; km: number } | undefined;
    for (const s of accepted) {
      if (s.key === exclude) continue;
      const km = distance(lat, lon, s.lat, s.lon);
      if (!best || km < best.km) best = { key: s.key, km };
    }
    return best;
  }

  const meta =
    "record_id,uhslc_id,gloss_id,ssc_id,station_name,station_country_code,latitude,longitude";
  console.log("Fetching UHSLC ERDDAP inventories...");
  const [rqds, fast, gesla] = await Promise.all([
    erddap("global_hourly_rqds", `${meta},version,reference_datum&distinct()`),
    erddap("global_hourly_fast", `${meta},last_rq_date&distinct()`),
    erddap("global_hourly_gesla", "record_id,agency_id&distinct()"),
  ]);

  process.stdout.write(
    `Fetching spans for ${rqds.length + fast.length} records`,
  );
  const rqSpans = await pool(rqds, 6, (r) =>
    span("global_hourly_rqds", Number(r["record_id"])),
  );
  const fdSpans = await pool(fast, 6, (r) =>
    span("global_hourly_fast", Number(r["record_id"])),
  );
  console.log();

  const adequateRq = new Set(
    rqds.filter((_, i) => rqSpans[i]!.adequate).map((r) => r["uhslc_id"]),
  );

  const rows: Row[] = [];
  const add = (
    dataset: "rqds" | "fast",
    r: Row,
    s: Awaited<ReturnType<typeof span>>,
  ) => {
    const uhslcId = Number(r["uhslc_id"]);
    const lat = Number(r["latitude"]);
    const lon = lon180(Number(r["longitude"]));
    const suffix = dataset === "rqds" ? "uhslc_rq" : "uhslc_fd";
    const version = dataset === "rqds" ? String(r["version"]) : "";
    const ticon = ticonByCode.get(`${ticonCode(uhslcId, version)}-${suffix}`);
    const q = ticon ? quality.get(ticon) : undefined;
    const near = nearest(lat, lon, ticon);
    // Another record of this UHSLC gauge (other version, or FD) is accepted.
    const code = ticonCode(uhslcId);
    const sameGauge = accepted.some((a) =>
      new RegExp(`-${code}[a-z]?-[a-z]+-uhslc_(rq|fd)$`).test(a.key),
    );

    let category: string;
    if (q) category = q.accepted ? "ticon-accepted" : "ticon-rejected";
    else if (dataset === "fast" && adequateRq.has(r["uhslc_id"]))
      category = "rq-preferred";
    else if (!s.adequate) category = "too-short";
    else if (sameGauge) category = "same-gauge";
    else if (near && near.km <= MAX_DEDUP_DISTANCE) category = "duplicate";
    else if (near && near.km <= NEARBY_KM) category = "nearby";
    else category = "new-coverage";

    rows.push({
      dataset,
      category,
      record_id: r["record_id"],
      uhslc_id: uhslcId,
      version,
      gloss_id: r["gloss_id"],
      ssc_id: r["ssc_id"],
      name: r["station_name"],
      country: r["station_country_code"],
      latitude: lat,
      longitude: lon,
      start: s.start,
      end: s.end,
      hours: s.hours,
      last_rq_date: String(r["last_rq_date"] ?? "").slice(0, 10),
      reference_datum: r["reference_datum"] ?? "",
      ticon_id: ticon ?? "",
      ticon_epoch_end: stations.find((st) => st.key === ticon)?.epochEnd ?? "",
      ticon_issues: q?.issues.join("; ") ?? "",
      nearest_id: near?.key ?? "",
      nearest_km: near ? Math.round(near.km * 100) / 100 : "",
    });
  };
  rqds.forEach((r, i) => add("rqds", r, rqSpans[i]!));
  fast.forEach((r, i) => add("fast", r, fdSpans[i]!));

  const cell = (v: Row[keyof Row]) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const header = Object.keys(rows[0]!);
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(
    OUT,
    [header, ...rows.map((r) => header.map((h) => cell(r[h])))]
      .map((r) => r.join(","))
      .join("\n") + "\n",
  );

  // Summary
  const tally = (keys: string[]) => {
    const counts: Record<string, number> = {};
    for (const k of keys) counts[k] = (counts[k] ?? 0) + 1;
    return counts;
  };
  const byCategory = (dataset: string) =>
    tally(
      rows
        .filter((r) => r["dataset"] === dataset)
        .map((r) => String(r["category"])),
    );
  console.log(`\nRQD records: ${rqds.length}`, byCategory("rqds"));
  console.log(`FD records: ${fast.length}`, byCategory("fast"));

  // Matched TICON records whose observations stop a year or more before the
  // live RQD record does, i.e. candidates for a newer observed datum epoch.
  const YEAR_MS = 365.25 * 86_400_000;
  const extended = rows.filter(
    (r) =>
      r["dataset"] === "rqds" &&
      r["ticon_epoch_end"] &&
      Date.parse(String(r["end"])) - Date.parse(String(r["ticon_epoch_end"])) >=
        YEAR_MS,
  ).length;
  console.log(
    `RQD records extending their TICON epoch by ≥1 year: ${extended}`,
  );

  const ticonIds = stations
    .filter((s) => s.key.startsWith("ticon/"))
    .map((s) => s.key.slice("ticon/".length));
  const ticonSet = new Set(ticonIds);
  const geslaIds = new Set(gesla.map((g) => String(g["record_id"])));
  const missing = ticonIds.filter((id) => !geslaIds.has(id));
  console.log(
    `\nGESLA records: ${gesla.length}; TICON stations missing from them: ${missing.length}/${ticonIds.length}`,
  );
  console.log("  missing, by source:", tally(missing.map(getSourceSuffix)));
  console.log(
    "  GESLA records without a TICON station, by agency:",
    tally(
      gesla
        .filter((g) => !ticonSet.has(String(g["record_id"])))
        .map((g) => String(g["agency_id"])),
    ),
  );
  console.log(`\nWrote ${OUT}`);
}

main();
