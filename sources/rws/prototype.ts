import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildRwsPredictions } from "../../packages/database/src/rws-predictions/builder.ts";
import { openRwsPredictions } from "../../packages/database/src/rws-predictions/reader.ts";
import type {
  RwsEventInput,
  RwsPredictionsInput,
  RwsSourceMetadata,
  RwsStationInput,
} from "../../packages/database/src/rws-predictions/types.ts";

export type RwsSeries = {
  code: string;
  name: string;
  latitude: number;
  longitude: number;
  datum: "NAP" | "MSL";
  heightMetadataId: string;
  eventGrouping?: "GETETBRKD2" | "GETETBRKDMSL2";
};

type Bounds = { startMs: number; endMs: number };
type JsonRecord = Record<string, unknown>;

export type PrototypeOptions = {
  fetch: typeof fetch;
  cacheDir: string;
  outPath: string;
  startMs: number;
  endMs: number;
  targetStartMs: number;
  targetEndMs: number;
  nowMs: number;
};

export type PrototypeMeasurements = {
  measured: {
    startMs: number;
    endMs: number;
    stationCount: number;
    napStationCount: number;
    mslStationCount: number;
    sampleCount: number;
    eventCount: number;
    encodedBytes: number;
    gzipBytes: number;
    bytesPerStation: number;
    bytesPerSample: number;
    independentStationGzipBytes: number;
    buildMilliseconds: number;
    lookupMicroseconds: number;
  };
  projected: {
    startMs: number;
    endMs: number;
    sampleCount: number;
    rawBytes: number;
    gzipBytes: number;
    gate: "one-file" | "full-window-required" | "shards-required";
  };
};

const CATALOG_URL =
  "https://ddapi20-waterwebservices.rijkswaterstaat.nl/METADATASERVICES/OphalenCatalogus";
const OBSERVATIONS_URL =
  "https://ddapi20-waterwebservices.rijkswaterstaat.nl/ONLINEWAARNEMINGENSERVICES/OphalenWaarnemingen";
const SOURCE_URL = "https://rijkswaterstaatdata.nl/waterdata/";
const LICENSE_URL = "https://creativecommons.org/publicdomain/zero/1.0/";

export async function runRwsPrototype(
  options: PrototypeOptions,
): Promise<PrototypeMeasurements> {
  const catalogBody = {
    CatalogusFilter: {
      Compartimenten: true,
      Grootheden: true,
      Eenheden: true,
      Hoedanigheden: true,
      ProcesTypes: true,
      Groeperingen: true,
    },
  };
  const catalog = await fetchCachedJson(CATALOG_URL, catalogBody, options);
  const series = discoverRwsSeries(catalog.value);
  if (series.length === 0)
    throw new Error("RWS catalog contains no height stations");
  const stations: RwsStationInput[] = [];
  let retrievedAtMs = catalog.fetchedAtMs;
  for (const item of series) {
    const height = await fetchCachedJson(
      OBSERVATIONS_URL,
      observationBody(item.code, options, {
        Grootheid: { Code: "WATHTE" },
        ProcesType: "astronomisch",
      }),
      options,
    );
    retrievedAtMs = Math.max(retrievedAtMs, height.fetchedAtMs);
    const station = normalizeHeightChunks(item, [height.value], options);
    if (item.eventGrouping) {
      const events = await fetchCachedJson(
        OBSERVATIONS_URL,
        observationBody(item.code, options, {
          Groepering: { Code: item.eventGrouping },
        }),
        options,
      );
      retrievedAtMs = Math.max(retrievedAtMs, events.fetchedAtMs);
      station.events = normalizeEvents(item, events.value, options);
    }
    stations.push(station);
  }
  if (stations.length !== series.length)
    throw new Error(
      `built ${stations.length} of ${series.length} RWS stations`,
    );

  const rootInput: RwsPredictionsInput = {
    formatMajor: 1,
    datasetVersion: "rws-prototype-2026-07",
    retrievedAtMs,
    catalogRequest: JSON.stringify({ url: CATALOG_URL, body: catalogBody }),
    catalogSha256: catalog.sha256,
    sourceUrl: SOURCE_URL,
    licenseUrl: LICENSE_URL,
    supportedStartMs: options.startMs,
    supportedEndMs: options.endMs,
    refreshAfterMs: options.endMs,
    stations,
  };
  const buildStarted = performance.now();
  const bytes = buildRwsPredictions(rootInput);
  const buildMilliseconds = performance.now() - buildStarted;
  const database = openRwsPredictions(bytes);
  const lookupId = stations[Math.floor(stations.length / 2)]!.id;
  const lookupStarted = performance.now();
  for (let index = 0; index < 1_000; index++) {
    if (database.station(lookupId)?.id !== lookupId)
      throw new Error(`keyed lookup failed for ${lookupId}`);
  }
  const lookupMicroseconds =
    ((performance.now() - lookupStarted) * 1_000) / 1_000;

  let independentStationGzipBytes = 0;
  for (const station of stations) {
    independentStationGzipBytes += gzipSync(
      buildRwsPredictions({ ...rootInput, stations: [station] }),
      { level: 9 },
    ).length;
  }
  const sampleCount = stations.reduce(
    (total, station) => total + station.heightsCm.length,
    0,
  );
  const eventCount = stations.reduce(
    (total, station) => total + station.events.length,
    0,
  );
  const ratio =
    (options.targetEndMs - options.targetStartMs) /
    (options.endMs - options.startMs);
  const projectedSampleCount = Math.round(sampleCount * ratio);
  const projectedGzipBytes = Math.ceil(independentStationGzipBytes * ratio);
  const gate =
    projectedGzipBytes <= 8_000_000
      ? "one-file"
      : projectedGzipBytes <= 10_000_000
        ? "full-window-required"
        : "shards-required";
  const measurements: PrototypeMeasurements = {
    measured: {
      startMs: options.startMs,
      endMs: options.endMs,
      stationCount: stations.length,
      napStationCount: stations.filter((station) => station.datum === "NAP")
        .length,
      mslStationCount: stations.filter((station) => station.datum === "MSL")
        .length,
      sampleCount,
      eventCount,
      encodedBytes: bytes.length,
      gzipBytes: gzipSync(bytes, { level: 9 }).length,
      bytesPerStation: bytes.length / stations.length,
      bytesPerSample: bytes.length / sampleCount,
      independentStationGzipBytes,
      buildMilliseconds,
      lookupMicroseconds,
    },
    projected: {
      startMs: options.targetStartMs,
      endMs: options.targetEndMs,
      sampleCount: projectedSampleCount,
      rawBytes: Math.ceil((bytes.length / sampleCount) * projectedSampleCount),
      gzipBytes: projectedGzipBytes,
      gate,
    },
  };

  await mkdir(dirname(options.outPath), { recursive: true });
  const temporary = `${options.outPath}.tmp-${process.pid}`;
  try {
    await writeFile(temporary, bytes);
    await rename(temporary, options.outPath);
  } finally {
    await rm(temporary, { force: true });
  }
  return measurements;
}

export function discoverRwsSeries(catalog: unknown): RwsSeries[] {
  const root = record(catalog, "catalog");
  if (root["Succesvol"] !== true)
    throw new Error("RWS catalog was not successful");
  const metadata = array(root["AquoMetadataLijst"], "AquoMetadataLijst").map(
    (value, index) => record(value, `AquoMetadataLijst[${index}]`),
  );
  const locations = new Map(
    array(root["LocatieLijst"], "LocatieLijst").map((value, index) => {
      const location = record(value, `LocatieLijst[${index}]`);
      return [
        number(location["Locatie_MessageID"], "Locatie_MessageID"),
        location,
      ];
    }),
  );
  const links = array(
    root["AquoMetadataLocatieLijst"],
    "AquoMetadataLocatieLijst",
  ).map((value, index) => record(value, `AquoMetadataLocatieLijst[${index}]`));

  const byMetadata = new Map<number, Set<number>>();
  for (const link of links) {
    const metadataId = number(
      link["AquoMetaData_MessageID"],
      "AquoMetaData_MessageID",
    );
    const locationId = number(link["Locatie_MessageID"], "Locatie_MessageID");
    const ids = byMetadata.get(metadataId) ?? new Set<number>();
    ids.add(locationId);
    byMetadata.set(metadataId, ids);
  }

  const events = metadata.filter((entry) => {
    const grouping = code(entry, "Groepering");
    return grouping === "GETETBRKD2" || grouping === "GETETBRKDMSL2";
  });
  const found: RwsSeries[] = [];
  for (const entry of metadata) {
    if (code(entry, "Grootheid") !== "WATHTE") continue;
    if (entry["ProcesType"] !== "astronomisch") continue;
    if (code(entry, "Groepering") !== "") continue;
    const datum = code(entry, "Hoedanigheid");
    if (datum !== "NAP" && datum !== "MSL")
      throw new Error(`unknown RWS height datum ${datum}`);
    const metadataId = number(
      entry["AquoMetadata_MessageID"],
      "AquoMetadata_MessageID",
    );
    for (const locationId of byMetadata.get(metadataId) ?? []) {
      const location = locations.get(locationId);
      if (!location) throw new Error(`missing RWS location ${locationId}`);
      if (location["Coordinatenstelsel"] !== "ETRS89")
        throw new Error(`RWS location ${locationId} is not ETRS89`);
      const matchingGrouping = datum === "NAP" ? "GETETBRKD2" : "GETETBRKDMSL2";
      const hasEvents = events.some((event) => {
        const eventId = number(
          event["AquoMetadata_MessageID"],
          "AquoMetadata_MessageID",
        );
        return (
          code(event, "Groepering") === matchingGrouping &&
          code(event, "Hoedanigheid") === datum &&
          byMetadata.get(eventId)?.has(locationId)
        );
      });
      found.push({
        code: string(location["Code"], `location ${locationId} code`),
        name: string(location["Naam"], `location ${locationId} name`),
        latitude: number(location["Lat"], `location ${locationId} latitude`),
        longitude: number(location["Lon"], `location ${locationId} longitude`),
        datum,
        heightMetadataId: String(metadataId),
        ...(hasEvents ? { eventGrouping: matchingGrouping } : {}),
      });
    }
  }
  found.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  found.forEach((series, index) => {
    if (index > 0 && found[index - 1]!.code === series.code)
      throw new Error(`duplicate RWS location code ${series.code}`);
  });
  return found;
}

export function normalizeHeightChunks(
  series: RwsSeries,
  chunks: unknown[],
  bounds: Bounds,
): RwsStationInput {
  const deduplicated: HeightSample[] = [];
  chunks.forEach((chunk, chunkIndex) => {
    const samples = heightSamples(series, chunk, `height chunk ${chunkIndex}`);
    samples.forEach((sample, sampleIndex) => {
      const previous = deduplicated.at(-1);
      if (previous?.timestampMs === sample.timestampMs) {
        if (chunkIndex > 0 && sampleIndex === 0) {
          if (JSON.stringify(previous) !== JSON.stringify(sample))
            throw new Error(
              `${series.code} has conflicting duplicate timestamp ${sample.timestampMs}`,
            );
          return;
        }
        throw new Error(
          `${series.code} has duplicate timestamp ${sample.timestampMs}`,
        );
      }
      deduplicated.push(sample);
    });
  });
  if (deduplicated[0]?.timestampMs !== bounds.startMs)
    throw new Error(
      `${series.code} height series does not start at ${bounds.startMs}`,
    );
  if (deduplicated.at(-1)?.timestampMs !== bounds.endMs)
    throw new Error(
      `${series.code} height series does not end at ${bounds.endMs}`,
    );
  deduplicated.forEach((sample, index) => {
    if (
      index > 0 &&
      sample.timestampMs - deduplicated[index - 1]!.timestampMs !== 600_000
    )
      throw new Error(
        `${series.code} height cadence is not 600 seconds at ${sample.timestampMs}`,
      );
  });

  const encoded = deduplicated.slice(0, -1);
  const firstPresent = encoded.find((sample) => sample.qualityCode !== "99");
  if (!firstPresent)
    throw new Error(`${series.code} has no present height sample`);
  const sourceMetadata = metadataOf(firstPresent);
  for (const sample of encoded) {
    if (
      sample.qualityCode !== "99" &&
      sample.qualityCode !== sourceMetadata.qualityCode
    )
      throw new Error(
        `${series.code} quality code varies at ${sample.timestampMs}`,
      );
    for (const [name, actual, expected] of [
      ["status", sample.status, sourceMetadata.status],
      [
        "commissioning organization",
        sample.commissioningOrganization,
        sourceMetadata.commissioningOrganization,
      ],
      ["sampling height", sample.samplingHeight, sourceMetadata.samplingHeight],
      ["reference plane", sample.referencePlane, sourceMetadata.referencePlane],
    ] as const) {
      if (actual !== expected)
        throw new Error(
          `${series.code} ${name} varies at ${sample.timestampMs}`,
        );
    }
  }

  return {
    id: `rws/${series.code}`,
    name: series.name,
    latitude: series.latitude,
    longitude: series.longitude,
    datum: series.datum,
    startMs: bounds.startMs,
    cadenceSeconds: 600,
    heightsCm: encoded.map((sample) =>
      sample.qualityCode === "99" ? null : sample.value,
    ),
    sourceMetadata,
    events: [],
  };
}

export function normalizeEvents(
  series: RwsSeries,
  response: unknown,
  bounds: Bounds,
): RwsEventInput[] {
  if (!series.eventGrouping) return [];
  const channels = responseChannels(series, response, "events");
  const typeChannel = channels.find(
    (channel) =>
      code(record(channel["AquoMetadata"], "AquoMetadata"), "Typering") ===
      "GETETTPE",
  );
  const heightChannel = channels.find(
    (channel) =>
      code(record(channel["AquoMetadata"], "AquoMetadata"), "Grootheid") ===
      "WATHTE",
  );
  if (!typeChannel)
    throw new Error(`${series.code} event type channel is missing`);
  if (!heightChannel)
    throw new Error(`${series.code} event height channel is missing`);
  const heightMetadata = record(
    heightChannel["AquoMetadata"],
    "height metadata",
  );
  if (code(heightMetadata, "Hoedanigheid") !== series.datum)
    throw new Error(
      `${series.code} event datum does not match ${series.datum}`,
    );
  if (
    code(heightMetadata, "Groepering") !== series.eventGrouping ||
    code(record(typeChannel["AquoMetadata"], "type metadata"), "Groepering") !==
      series.eventGrouping
  )
    throw new Error(
      `${series.code} event grouping does not match ${series.eventGrouping}`,
    );

  const types = array(typeChannel["MetingenLijst"], "event types");
  const heights = array(heightChannel["MetingenLijst"], "event heights");
  if (types.length !== heights.length)
    throw new Error(`${series.code} event channel lengths do not match`);
  const result = types.map((typeValue, index) => {
    const type = measurement(typeValue, `${series.code} event type ${index}`);
    const height = measurement(
      heights[index],
      `${series.code} event height ${index}`,
    );
    if (type.timestampMs !== height.timestampMs)
      throw new Error(
        `${series.code} event timestamps do not pair at index ${index}`,
      );
    if (type.timestampMs < bounds.startMs || type.timestampMs > bounds.endMs)
      throw new Error(
        `${series.code} event timestamp is outside requested bounds`,
      );
    if (!isInt16(height.value))
      throw new Error(
        `${series.code} event height ${index} is outside int16 range`,
      );
    return {
      timestampMs: type.timestampMs,
      type: string(type.alphanumeric, "event type"),
      heightCm: height.value,
    };
  });
  return result.filter((event) => event.timestampMs < bounds.endMs);
}

type HeightSample = RwsSourceMetadata & {
  timestampMs: number;
  value: number;
};

function heightSamples(
  series: RwsSeries,
  response: unknown,
  label: string,
): HeightSample[] {
  const channels = responseChannels(series, response, label);
  const channel = channels.find((candidate) => {
    const metadata = record(candidate["AquoMetadata"], `${label} metadata`);
    return (
      code(metadata, "Grootheid") === "WATHTE" &&
      code(metadata, "Groepering") === ""
    );
  });
  if (!channel) throw new Error(`${series.code} height channel is missing`);
  const metadata = record(channel["AquoMetadata"], `${label} metadata`);
  if (code(metadata, "Hoedanigheid") !== series.datum)
    throw new Error(
      `${series.code} height datum does not match ${series.datum}`,
    );
  return array(channel["MetingenLijst"], `${label} measurements`).map(
    (value, index) => {
      const parsed = measurement(value, `${label} measurement ${index}`);
      const observation = record(
        parsed.measurement["WaarnemingMetadata"],
        `${label} observation metadata ${index}`,
      );
      const qualityCode = string(
        observation["Kwaliteitswaardecode"],
        "Kwaliteitswaardecode",
      );
      if (qualityCode !== "00" && qualityCode !== "99")
        throw new Error(
          `${series.code} has unexpected quality code ${qualityCode}`,
        );
      if (qualityCode !== "99" && !isInt16(parsed.value))
        throw new Error(
          `${series.code} height ${index} is outside int16 range`,
        );
      return {
        timestampMs: parsed.timestampMs,
        value: parsed.value,
        qualityCode,
        status: string(observation["Statuswaarde"], "Statuswaarde"),
        commissioningOrganization: string(
          observation["OpdrachtgevendeInstantie"],
          "OpdrachtgevendeInstantie",
        ),
        samplingHeight: parseInteger(
          observation["Bemonsteringshoogte"],
          "Bemonsteringshoogte",
        ),
        referencePlane: string(observation["Referentievlak"], "Referentievlak"),
      };
    },
  );
}

function responseChannels(
  series: RwsSeries,
  response: unknown,
  label: string,
): JsonRecord[] {
  const root = record(response, label);
  if (root["Succesvol"] !== true)
    throw new Error(`${series.code} ${label} was not successful`);
  return array(root["WaarnemingenLijst"], `${label} WaarnemingenLijst`).map(
    (value, index) => {
      const channel = record(value, `${label} channel ${index}`);
      const location = record(channel["Locatie"], `${label} location ${index}`);
      if (location["Code"] !== series.code)
        throw new Error(
          `${series.code} ${label} returned location ${String(location["Code"])}`,
        );
      return channel;
    },
  );
}

function measurement(value: unknown, label: string) {
  const item = record(value, label);
  const timestamp = string(item["Tijdstip"], `${label} Tijdstip`);
  const timestampMs = Date.parse(timestamp);
  if (!Number.isFinite(timestampMs))
    throw new Error(`${label} has invalid timestamp ${timestamp}`);
  const measure = record(item["Meetwaarde"], `${label} Meetwaarde`);
  return {
    measurement: item,
    timestampMs,
    alphanumeric: measure["Waarde_Alfanumeriek"],
    value: number(measure["Waarde_Numeriek"], `${label} Waarde_Numeriek`),
  };
}

function metadataOf(sample: HeightSample): RwsSourceMetadata {
  return {
    qualityCode: sample.qualityCode,
    status: sample.status,
    commissioningOrganization: sample.commissioningOrganization,
    samplingHeight: sample.samplingHeight,
    referencePlane: sample.referencePlane,
  };
}

function code(parent: JsonRecord, field: string): string {
  return string(record(parent[field], field)["Code"], `${field}.Code`);
}

function record(value: unknown, name: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${name} must be an object`);
  return value as JsonRecord;
}

function array(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  return value;
}

function string(value: unknown, name: string): string {
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  return value;
}

function number(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`${name} must be a finite number`);
  return value;
}

function parseInteger(value: unknown, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${name} must be an integer`);
  return parsed;
}

function isInt16(value: number): boolean {
  return Number.isInteger(value) && value >= -32_768 && value <= 32_767;
}

function observationBody(
  code: string,
  options: Pick<PrototypeOptions, "startMs" | "endMs">,
  metadata: JsonRecord,
) {
  return {
    Locatie: { Code: code },
    AquoPlusWaarnemingMetadata: { AquoMetadata: metadata },
    Periode: {
      Begindatumtijd: new Date(options.startMs).toISOString(),
      Einddatumtijd: new Date(options.endMs).toISOString(),
    },
  };
}

async function fetchCachedJson(
  url: string,
  body: JsonRecord,
  options: PrototypeOptions,
): Promise<{
  value: unknown;
  fetchedAtMs: number;
  responseText: string;
  sha256: string;
}> {
  const request = JSON.stringify({ url, body });
  const key = sha256(request);
  const path = join(options.cacheDir, `${key}.json`);
  try {
    const cached = record(
      JSON.parse(await readFile(path, "utf8")),
      "cache entry",
    );
    const responseText = string(cached["responseText"], "cache responseText");
    const checksum = string(cached["sha256"], "cache sha256");
    if (checksum !== sha256(responseText))
      throw new Error(`cache checksum mismatch for ${key}`);
    if (
      cached["url"] !== url ||
      JSON.stringify(cached["body"]) !== JSON.stringify(body)
    )
      throw new Error(`cache request mismatch for ${key}`);
    return {
      value: JSON.parse(responseText),
      fetchedAtMs: number(cached["fetchedAtMs"], "cache fetchedAtMs"),
      responseText,
      sha256: checksum,
    };
  } catch (error) {
    if (!isErrno(error, "ENOENT")) throw error;
  }

  const response = await options.fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response.status !== 200)
    throw new Error(`RWS ${url} returned HTTP ${response.status}`);
  const responseText = await response.text();
  if (!responseText) throw new Error(`RWS ${url} returned an empty response`);
  const value: unknown = JSON.parse(responseText);
  const checksum = sha256(responseText);
  const entry = {
    fetchedAtMs: options.nowMs,
    url,
    body,
    sha256: checksum,
    responseText,
  };
  await mkdir(options.cacheDir, { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  try {
    await writeFile(temporary, JSON.stringify(entry));
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
  return {
    value,
    fetchedAtMs: options.nowMs,
    responseText,
    sha256: checksum,
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isErrno(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

const executable = process.argv[1];
if (executable && import.meta.url === pathToFileURL(executable).href) {
  const directory = resolve("tmp/rws");
  runRwsPrototype({
    fetch: globalThis.fetch,
    cacheDir: join(directory, "cache"),
    outPath: join(directory, "rws-predictions.rwsp"),
    startMs: Date.parse("2026-07-01T00:00:00.000Z"),
    endMs: Date.parse("2026-07-31T00:00:00.000Z"),
    targetStartMs: Date.parse("2025-01-01T00:00:00.000Z"),
    targetEndMs: Date.parse("2027-01-01T00:00:00.000Z"),
    nowMs: Date.now(),
  })
    .then((measurements) => {
      console.log(JSON.stringify(measurements, null, 2));
      console.log(measurements.projected.gate);
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
