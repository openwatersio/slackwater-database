import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";
import { fileURLToPath } from "node:url";
import type { StationData } from "@slackwater/database";
import { computeDatums } from "@slackwater/datums";
import {
  DATA_DIR,
  normalize,
  predictionOptions,
  withPublishedPrecision,
} from "@slackwater/stations";
import {
  API,
  CADENCE,
  SOURCE,
  TERMS,
  matchProvenance,
  parseInventory,
  parsePrediction,
  seriesSamples,
  type DmiStation,
  type Provenance,
} from "./dmi.ts";
import {
  fitSeries,
  heightGate,
  storedHeight,
  type Metrics,
} from "./harmonics.ts";
import provenance from "./provenance.json" with { type: "json" };
import snapshot from "./validation.json" with { type: "json" };

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const CACHE = join(ROOT, "tmp", "dmi");
const START = Date.parse("2026-01-02T00:00:00Z");
const SPLIT = Date.parse("2027-01-05T00:00:00Z");
const END = Date.parse("2027-12-31T00:00:00Z");

async function checksum(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function cachedDownload(
  url: string,
  path: string,
  expectedSha256: string | null,
) {
  if (existsSync(path)) {
    const manifest = JSON.parse(await readFile(`${path}.json`, "utf8")) as {
      url: string;
      sha256: string;
    };
    if (manifest.url !== url || manifest.sha256 !== (await checksum(path)))
      throw new Error(`Cache request/checksum mismatch: ${path}`);
    if (expectedSha256 !== null && manifest.sha256 !== expectedSha256)
      throw new Error(`Pinned input checksum mismatch: ${url}`);
    return path;
  }
  await mkdir(dirname(path), { recursive: true });
  const response = await fetch(url, { signal: AbortSignal.timeout(600_000) });
  if (!response.ok || !response.body)
    throw new Error(`DMI HTTP ${response.status}: ${url}`);
  const temporary = `${path}.part-${process.pid}`;
  try {
    await pipeline(
      Readable.fromWeb(response.body as ReadableStream),
      createWriteStream(temporary, { flags: "wx" }),
    );
    const sha256 = await checksum(temporary);
    if (expectedSha256 !== null && sha256 !== expectedSha256)
      throw new Error(`Pinned input checksum mismatch: ${url}`);
    await writeFile(
      `${temporary}.json`,
      JSON.stringify({ url, sha256 }) + "\n",
    );
    await rename(temporary, path);
    await rename(`${temporary}.json`, `${path}.json`);
  } finally {
    await rm(temporary, { force: true });
    await rm(`${temporary}.json`, { force: true });
  }
  return path;
}

export function downloadPinned(url: string, path: string) {
  const input = [...snapshot.inputs, ...snapshot.inventoryInputs].find(
    (input) => input.url === url,
  );
  if (!input) throw new Error(`Unpinned DMI input URL: ${url}`);
  // Inventory responses carry a request timestamp; their parsed content is pinned below.
  return cachedDownload(
    url,
    path,
    snapshot.inputs.some((archive) => archive.url === url)
      ? input.sha256
      : null,
  );
}

export function verifyInventory(
  stations: DmiStation[],
  expectedSha256: string,
) {
  const canonical = [...stations]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(({ id, name, country, latitude, longitude, lat, mlws }) => ({
      id,
      name,
      country,
      latitude,
      longitude,
      lat,
      mlws,
    }));
  const sha256 = createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex");
  if (sha256 !== expectedSha256)
    throw new Error("Pinned inventory checksum mismatch");
  return sha256;
}

async function inventory() {
  const stations: DmiStation[] = [];
  const inputs: { url: string; sha256: string }[] = [];
  for (let offset = 0; ;) {
    const url = `${API}/collections/tidewaterstation/items?limit=1000&offset=${offset}`;
    const path = await downloadPinned(
      url,
      join(CACHE, `stations-${offset}.json`),
    );
    const page = parseInventory(JSON.parse(await readFile(path, "utf8")));
    inputs.push(JSON.parse(await readFile(`${path}.json`, "utf8")));
    if (!page.length) break;
    stations.push(...page);
    offset += page.length;
    if (offset > 10000)
      throw new Error("DMI station pagination did not terminate");
  }
  if (
    !stations.length ||
    new Set(stations.map((s) => s.id)).size !== stations.length
  )
    throw new Error("Empty or duplicate DMI station inventory");
  verifyInventory(stations, snapshot.inventorySha256);
  return {
    stations: stations.sort((a, b) => a.id.localeCompare(b.id)),
    inputs,
  };
}

export async function readArchives(
  paths: string[],
  stations: DmiStation[],
  start: number,
  end: number,
) {
  const count = (end - start) / CADENCE;
  if (!Number.isSafeInteger(count) || count <= 0)
    throw new Error("Invalid archive range");
  const map = new Map(stations.map((s) => [s.id, s]));
  const series = new Map(
    stations.map((s) => [s.id, new Float64Array(count).fill(NaN)]),
  );
  for (const path of paths) {
    const entries = execFileSync("unzip", ["-Z1", path], {
      encoding: "utf8",
      maxBuffer: 1_000_000,
      stdio: ["ignore", "pipe", "pipe"],
    })
      .trim()
      .split("\n");
    if (
      entries.some((n) => !/^\d{4}-\d{2}-\d{2}\.txt$/.test(n)) ||
      new Set(entries).size !== entries.length
    )
      throw new Error(`Unexpected ZIP entries: ${path}`);
    const child = spawn("unzip", ["-p", path], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + String(chunk)).slice(-4000);
    });
    const exited = new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`ZIP read failed (${code}): ${stderr}`)),
      );
    });
    void exited.catch(() => {});
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        if (!line.trim()) continue;
        const sample = parsePrediction(JSON.parse(line), map);
        if (!sample || sample.t < start || sample.t >= end) continue;
        const values = series.get(sample.id)!,
          index = (sample.t - start) / CADENCE;
        if (Number.isFinite(values[index]))
          throw new Error(`${sample.id}: duplicate prediction at ${sample.t}`);
        values[index] = sample.level;
      }
      await exited;
    } finally {
      lines.close();
      child.kill();
      await exited.catch(() => {});
    }
  }
  return series;
}

async function loadSeries(paths: string[], stations: DmiStation[]) {
  const key = createHash("sha256")
    .update(
      JSON.stringify({
        // Bump when parsing or binary encoding changes; old cached samples must not survive it.
        version: 1,
        start: START,
        end: END,
        stations,
        archives: await Promise.all(paths.map(checksum)),
      }),
    )
    .digest("hex");
  const dir = join(CACHE, `series-${key}`),
    manifest = join(dir, "manifest.json");
  if (existsSync(manifest)) {
    const hashes = JSON.parse(await readFile(manifest, "utf8")) as Record<
      string,
      string
    >;
    const result = new Map<string, Float64Array>();
    for (const station of stations) {
      const path = join(dir, `${station.id}.bin`),
        buf = await readFile(path);
      if (
        buf.length !== ((END - START) / CADENCE) * 8 ||
        hashes[station.id] !== (await checksum(path))
      )
        throw new Error(`Corrupt series cache: ${station.id}`);
      result.set(
        station.id,
        new Float64Array(
          buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        ),
      );
    }
    return result;
  }
  console.log("Reading DMI annual archives");
  const series = await readArchives(paths, stations, START, END);
  await mkdir(dir, { recursive: true });
  const hashes: Record<string, string> = {};
  for (const [id, values] of series) {
    const path = join(dir, `${id}.bin`);
    await writeFile(path, Buffer.from(values.buffer));
    hashes[id] = await checksum(path);
  }
  await writeFile(manifest, JSON.stringify(hashes) + "\n");
  return series;
}

export function buildStation(
  station: DmiStation,
  harmonics: StationData["harmonic_constituents"],
  offset: number,
  origin: { note: string },
  computed: Record<string, number>,
): StationData {
  const terms = [
    ...harmonics,
    ...(offset === 0
      ? []
      : [
          {
            name: "Zo",
            amplitude: Math.abs(offset),
            phase: offset < 0 ? 180 : 0,
          },
        ]),
  ];
  const data = withPublishedPrecision(
    "dmi",
    normalize({
      name: station.name,
      latitude: station.latitude,
      longitude: station.longitude,
      country: station.country,
      type: "reference",
      source: {
        name: SOURCE,
        id: station.id,
        published_harmonics: false,
        url: `${API}/collections/tidewaterstation/items?stationId=${station.id}`,
      },
      license: {
        type: "cc-by-4.0",
        commercial_use: true,
        url: "https://creativecommons.org/licenses/by/4.0/",
        notes: `DMI API and bulk data terms: ${TERMS}. Harmonics fitted from predictions; centimetres converted to metres.`,
      },
      disclaimers: [
        "Harmonics fitted by Slackwater from DMI astronomical predictions, not published DMI constants.",
        "Held-out height validation: 2027-01-05 through 2027-12-30 UTC. Accuracy outside that span has not been checked.",
        origin.note,
      ]
        .filter(Boolean)
        .join(" "),
      harmonic_constituents: terms,
      datums: { ...computed, MSL: 0, LAT: station.lat, MLWS: station.mlws },
      datums_source: "harmonic",
    }),
  );
  // A fit without a resolved annual term cannot establish an annual extreme envelope.
  if (
    !data.harmonic_constituents.some(
      (c) => /^(sa|ssa)$/i.test(c.name) && c.amplitude > 0,
    )
  )
    delete data.datums["HAT"];
  return data;
}

export async function writeStations(records: StationData[], out: string) {
  if (!records.length) throw new Error("Refusing an empty DMI import");
  const ids = records.map((s) => s.source.id);
  if (ids.some((id) => !/^\d+$/.test(id)) || new Set(ids).size !== ids.length)
    throw new Error("Invalid or duplicate output station IDs");
  await mkdir(dirname(out), { recursive: true });
  const lock = join(dirname(dirname(out)), ".dmi-import.lock");
  await mkdir(lock);
  let stage: string | undefined, backup: string | undefined;
  try {
    const old = existsSync(out) ? await readdir(out) : [];
    const lost = old.filter(
      (n) => n.endsWith(".json") && !ids.includes(n.slice(0, -5)),
    );
    if (lost.length)
      throw new Error(
        `DMI refresh would drop existing stations: ${lost.join(", ")}`,
      );
    stage = await mkdtemp(join(dirname(dirname(out)), ".dmi-stage-"));
    for (const record of records)
      await writeFile(
        join(stage, `${record.source.id}.json`),
        JSON.stringify(record, null, 2) + "\n",
      );
    await chmod(stage, 0o755);
    if (existsSync(out)) {
      backup = `${stage}-previous`;
      await rename(out, backup);
    }
    try {
      await rename(stage, out);
    } catch (error) {
      if (backup) await rename(backup, out);
      throw error;
    }
    if (backup) await rm(backup, { recursive: true });
  } finally {
    if (stage) await rm(stage, { recursive: true, force: true });
    await rm(lock, { recursive: true });
  }
}

async function run() {
  const args = process.argv.slice(2),
    validate = args.includes("--validate");
  if (args.some((a) => a !== "--validate" && !/^--station=\d+$/.test(a)))
    throw new Error("Usage: import.ts [--validate [--station=ID ...]]");
  const selected = args
    .filter((a) => a.startsWith("--station="))
    .map((a) => a.slice(10));
  if (selected.length && !validate)
    throw new Error("Station selection is supported only for validation");
  const { stations, inputs: inventoryInputs } = await inventory();
  if (selected.some((id) => !stations.some((s) => s.id === id)))
    throw new Error("Unknown selected station");
  const paths = await Promise.all(
    [2026, 2027].map((y) =>
      downloadPinned(
        `${API}/bulk/tidewater/${y}/${y}.zip`,
        join(CACHE, `${y}.zip`),
      ),
    ),
  );
  const series = await loadSeries(paths, stations),
    records: StationData[] = [],
    report: unknown[] = [];
  let storedFailures = 0;
  for (const station of stations.filter(
    (s) => !selected.length || selected.includes(s.id),
  )) {
    try {
      const origin = matchProvenance(station, provenance as Provenance[]);
      const values = series.get(station.id)!;
      const split = (SPLIT - START) / CADENCE;
      const fit = fitSeries(
        seriesSamples(values, START, 0, split),
        seriesSamples(values, START, split, values.length),
      );
      const { constituents, ...metrics } = fit;
      const storedPath = join(DATA_DIR, "dmi", `${station.id}.json`);
      let committedHeight: Metrics | undefined;
      if (validate && existsSync(storedPath)) {
        const stored = JSON.parse(
          await readFile(storedPath, "utf8"),
        ) as StationData;
        committedHeight = storedHeight(
          stored.harmonic_constituents,
          seriesSamples(values, START, split, values.length),
        );
        if (!heightGate(committedHeight, fit.stabilityRms)) storedFailures++;
      }
      if (fit.accepted && !validate) {
        const { datums } = computeDatums(
          constituents,
          {},
          predictionOptions({
            source: { name: SOURCE },
            latitude: station.latitude,
          }),
        );
        records.push(
          buildStation(station, constituents, fit.offset, origin, datums),
        );
      }
      report.push({
        id: station.id,
        name: station.name,
        country: station.country,
        provenance: origin,
        terms: constituents.length,
        ...metrics,
        ...(committedHeight ? { storedHeight: committedHeight } : {}),
      });
      console.log(
        `${station.id} ${station.name}: ${fit.accepted ? "PASS" : "EXCLUDED"} rms=${fit.height.rms.toFixed(4)} p95=${fit.height.p95.toFixed(4)} max=${fit.height.max.toFixed(4)} stability=${fit.stabilityRms.toFixed(4)}`,
      );
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      if (validate && existsSync(join(DATA_DIR, "dmi", `${station.id}.json`)))
        storedFailures++;
      console.log(`${station.id} ${station.name}: EXCLUDED ${error.message}`);
      report.push({
        id: station.id,
        name: station.name,
        country: station.country,
        accepted: false,
        error: error.message,
      });
    }
  }
  const result = {
    predictionYears: [2026, 2027],
    trainingStart: new Date(START).toISOString(),
    validationStart: new Date(SPLIT).toISOString(),
    endExclusive: new Date(END).toISOString(),
    inventory: stations.length,
    inventorySha256: snapshot.inventorySha256,
    inventoryInputs,
    stations: report,
    inputs: await Promise.all(
      paths.map(
        async (path) =>
          JSON.parse(await readFile(`${path}.json`, "utf8")) as {
            url: string;
            sha256: string;
          },
      ),
    ),
    provenanceSha256: await checksum(
      fileURLToPath(new URL("./provenance.json", import.meta.url)),
    ),
  };
  await writeFile(
    join(CACHE, "validation.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  if (!validate) {
    await writeStations(records, join(DATA_DIR, "dmi"));
    await writeFile(
      new URL("./validation.json", import.meta.url),
      JSON.stringify(result, null, 2) + "\n",
    );
    console.log(
      `Imported ${records.length}/${stations.length} DMI stations; exclusions in sources/dmi/validation.json`,
    );
  }
  if (storedFailures)
    throw new Error(`${storedFailures} stored DMI records failed validation`);
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
