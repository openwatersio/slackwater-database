import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fitHarmonics, type Sample } from "@slackwater/harmonic-analysis";
import {
  astro,
  constituents,
  createTidePredictor,
  type Constituent,
  type HarmonicConstituent,
} from "@slackwater/engine";

type Bounds = { startMs: number; endMs: number };
type JsonRecord = Record<string, unknown>;
export type RwsEvent = { t: number; type: string; level: number };
export type ErrorMetrics = { rms: number; p95: number; max: number };
export type EventMetrics = {
  provider: number;
  predicted: number;
  matched: number;
  meanMinutes: number;
  maxMinutes: number;
};
export type ValidationGates = {
  height: boolean;
  events: boolean;
  publishable: boolean;
};
export type ValidationOptions = {
  fetch: typeof fetch;
  cacheDir: string;
  reportPath: string;
  nowMs: number;
};
export type StationReport = {
  station: string;
  terms: number;
  samples: { train: number; validation: number };
  height: ErrorMetrics;
  stabilityRms: number;
  amplitudeMax: number;
  amplitudeSum: number;
  events: EventMetrics;
  gates: ValidationGates;
};
export type ValidationReport = {
  stations: StationReport[];
  heightPass: boolean;
  eventPass: boolean;
  publishable: boolean;
};

const OBSERVATIONS_URL =
  "https://ddapi20-waterwebservices.rijkswaterstaat.nl/ONLINEWAARNEMINGENSERVICES/OphalenWaarnemingen";
const STATIONS = [
  {
    code: "ameland.nes",
    datum: "NAP",
    grouping: "GETETBRKD2",
    ticon: "data/ticon/nes-nes-nld-rws_hist.json",
  },
  {
    code: "hoekvanholland",
    datum: "NAP",
    grouping: "GETETBRKD2",
    ticon: "data/ticon/hoek_van_holland-hoekvhld-nld-rws_hist.json",
  },
  {
    code: "denhelder.marsdiep",
    datum: "NAP",
    grouping: "GETETBRKD2",
    ticon: "data/ticon/den_helder-denhdr-nld-rws_hist.json",
  },
] as const;

const modelByName = new Map<string, Constituent>();
for (const [key, model] of Object.entries(constituents)) {
  modelByName.set(key.toUpperCase(), model);
  modelByName.set(model.name.toUpperCase(), model);
  for (const alias of model.aliases)
    modelByName.set(alias.toUpperCase(), model);
}
const canonicalModels = [
  ...new Map(
    Object.values(constituents)
      .filter((model) => model.speed > 0)
      .map((model) => [model.name, model]),
  ).values(),
];

export function spreadSample<T>(
  points: readonly T[],
  count: number,
  salt: number,
): T[] {
  if (points.length <= count) return [...points];
  return Array.from({ length: count }, (_, index) => {
    const low = Math.floor((index * points.length) / count);
    const high = Math.floor(((index + 1) * points.length) / count);
    return points[low + ((index * 104_729 + salt) % Math.max(1, high - low))]!;
  });
}

export function trainingSamplesBefore<T extends { t: number }>(
  points: readonly T[],
  validationStartMs: number,
): T[] {
  return points.filter(({ t }) => t < validationStartMs);
}

export function parseHeightChunks(
  station: string,
  datum: "NAP" | "MSL",
  chunks: unknown[],
  bounds: Bounds,
): Sample[] {
  const result: Sample[] = [];
  chunks.forEach((chunk, chunkIndex) => {
    const channels = responseChannels(
      station,
      chunk,
      `height chunk ${chunkIndex}`,
    );
    const channel = channels.find((candidate) => {
      const metadata = record(candidate["AquoMetadata"], "height metadata");
      return (
        code(metadata, "Grootheid") === "WATHTE" &&
        code(metadata, "Groepering") === ""
      );
    });
    if (!channel) throw new Error(`${station} height channel is missing`);
    const metadata = record(channel["AquoMetadata"], "height metadata");
    if (code(metadata, "Hoedanigheid") !== datum)
      throw new Error(`${station} height datum does not match ${datum}`);
    if (code(metadata, "Eenheid") !== "cm")
      throw new Error(`${station} height unit is not cm`);
    if (metadata["ProcesType"] !== "astronomisch")
      throw new Error(`${station} height process is not astronomisch`);

    const measurements = array(channel["MetingenLijst"], "height measurements")
      .map((value, sampleIndex) => {
        const item = record(value, `height measurement ${sampleIndex}`);
        const t = timestamp(
          item["Tijdstip"],
          `height measurement ${sampleIndex}`,
        );
        const measure = record(item["Meetwaarde"], "height Meetwaarde");
        const level =
          number(measure["Waarde_Numeriek"], "height Waarde_Numeriek") / 100;
        const observation = record(
          item["WaarnemingMetadata"],
          "height WaarnemingMetadata",
        );
        if (observation["Kwaliteitswaardecode"] !== "00")
          throw new Error(`${station} height series contains a gap`);
        return { t, level };
      })
      .sort((left, right) => left.t - right.t);
    measurements.forEach(({ t, level }, sampleIndex) => {
      const previous = result.at(-1);
      if (previous?.t === t) {
        if (chunkIndex > 0 && sampleIndex === 0) {
          if (previous.level !== level)
            throw new Error(
              `${station} has conflicting duplicate timestamp ${t}`,
            );
          return;
        }
        throw new Error(`${station} has duplicate timestamp ${t}`);
      }
      result.push({ t, level });
    });
  });
  if (result[0]?.t !== bounds.startMs)
    throw new Error(
      `${station} height series does not start at ${bounds.startMs}`,
    );
  if (result.at(-1)?.t !== bounds.endMs)
    throw new Error(`${station} height series does not end at ${bounds.endMs}`);
  result.forEach((sample, index) => {
    if (index > 0 && sample.t - result[index - 1]!.t !== 600_000)
      throw new Error(
        `${station} height cadence is not 600 seconds at ${sample.t}`,
      );
  });
  return result;
}

export function parseEvents(
  station: string,
  datum: "NAP" | "MSL",
  grouping: string,
  response: unknown,
  bounds: Bounds,
): RwsEvent[] {
  const channels = responseChannels(station, response, "events");
  const typeChannel = channels.find((channel) =>
    metadataCode(channel, "Typering", "GETETTPE"),
  );
  const heightChannel = channels.find((channel) =>
    metadataCode(channel, "Grootheid", "WATHTE"),
  );
  if (!typeChannel) throw new Error(`${station} event type channel is missing`);
  if (!heightChannel)
    throw new Error(`${station} event height channel is missing`);
  const typeMetadata = record(
    typeChannel["AquoMetadata"],
    "event type metadata",
  );
  const heightMetadata = record(
    heightChannel["AquoMetadata"],
    "event height metadata",
  );
  if (
    code(typeMetadata, "Eenheid") !== "DIMSLS" ||
    code(typeMetadata, "Grootheid") !== "NVT" ||
    code(typeMetadata, "Hoedanigheid") !== "NVT" ||
    code(typeMetadata, "Typering") !== "GETETTPE"
  )
    throw new Error(`${station} event type metadata is invalid`);
  if (code(heightMetadata, "Eenheid") !== "cm")
    throw new Error(`${station} event height unit is not cm`);
  if (code(heightMetadata, "Hoedanigheid") !== datum)
    throw new Error(`${station} event datum does not match ${datum}`);
  if (
    typeMetadata["ProcesType"] !== "astronomisch" ||
    heightMetadata["ProcesType"] !== "astronomisch"
  )
    throw new Error(`${station} event process is not astronomisch`);
  if (
    code(typeMetadata, "Groepering") !== grouping ||
    code(heightMetadata, "Groepering") !== grouping
  )
    throw new Error(`${station} event grouping does not match ${grouping}`);

  const types = array(typeChannel["MetingenLijst"], "event types");
  const heights = array(heightChannel["MetingenLijst"], "event heights");
  if (types.length !== heights.length)
    throw new Error(`${station} event channel lengths do not match`);
  const timestamps = new Set<number>();
  return types.map((typeValue, index) => {
    const typeItem = record(typeValue, `event type ${index}`);
    const heightItem = record(heights[index], `event height ${index}`);
    const typeTime = timestamp(typeItem["Tijdstip"], `event type ${index}`);
    const heightTime = timestamp(
      heightItem["Tijdstip"],
      `event height ${index}`,
    );
    if (typeTime !== heightTime)
      throw new Error(
        `${station} event timestamps do not pair at index ${index}`,
      );
    if (typeTime < bounds.startMs || typeTime > bounds.endMs)
      throw new Error(`${station} event timestamp is outside requested bounds`);
    if (timestamps.has(typeTime))
      throw new Error(`${station} has duplicate event timestamp ${typeTime}`);
    timestamps.add(typeTime);
    for (const [item, label] of [
      [typeItem, "event type"],
      [heightItem, "event height"],
    ] as const) {
      const observation = record(
        item["WaarnemingMetadata"],
        `${label} WaarnemingMetadata`,
      );
      if (observation["Kwaliteitswaardecode"] !== "00")
        throw new Error(`${station} ${label} quality must be 00`);
    }
    const type = string(
      record(typeItem["Meetwaarde"], "event type Meetwaarde")[
        "Waarde_Alfanumeriek"
      ],
      "event type",
    );
    if (type !== "hoogwater" && type !== "laagwater")
      throw new Error(`${station} event type is invalid`);
    const level =
      number(
        record(heightItem["Meetwaarde"], "event height Meetwaarde")[
          "Waarde_Numeriek"
        ],
        "event height",
      ) / 100;
    return { t: typeTime, type, level };
  });
}

export function selectExtraConstituents(
  samples: Sample[],
  residuals: number[],
  excludedNames: readonly string[],
  count: number,
): string[] {
  if (samples.length !== residuals.length)
    throw new Error("sample and residual lengths do not match");
  const excluded = new Set(
    excludedNames.map(
      (name) => modelByName.get(name.toUpperCase())?.name ?? name,
    ),
  );
  const usedSpeeds = excludedNames.flatMap((name) => {
    const model = modelByName.get(name.toUpperCase());
    return model ? [model.speed] : [];
  });
  return canonicalModels
    .filter((model) => !excluded.has(model.name))
    .flatMap((model) => {
      let cc = 0;
      let cs = 0;
      let ss = 0;
      let cy = 0;
      let sy = 0;
      samples.forEach((sample, index) => {
        const astronomy = astro(new Date(sample.t));
        const { f, u } = model.correction(astronomy);
        const argument = (model.value(astronomy) + u) * (Math.PI / 180);
        const cosine = f * Math.cos(argument);
        const sine = f * Math.sin(argument);
        cc += cosine * cosine;
        cs += cosine * sine;
        ss += sine * sine;
        cy += cosine * residuals[index]!;
        sy += sine * residuals[index]!;
      });
      const determinant = cc * ss - cs * cs;
      if (determinant === 0) return [];
      const p = (cy * ss - sy * cs) / determinant;
      const q = (sy * cc - cy * cs) / determinant;
      return [
        { name: model.name, speed: model.speed, amplitude: Math.hypot(p, q) },
      ];
    })
    .sort((left, right) =>
      right.amplitude === left.amplitude
        ? left.name.localeCompare(right.name)
        : right.amplitude - left.amplitude,
    )
    .filter(({ speed }) => {
      if (usedSpeeds.some((used) => Math.abs(used - speed) <= 1e-9))
        return false;
      usedSpeeds.push(speed);
      return true;
    })
    .slice(0, count)
    .map(({ name }) => name);
}

export async function readCachedJson(
  path: string,
  expectedUrl: string,
  expectedBody: JsonRecord,
): Promise<unknown> {
  const cached = record(
    JSON.parse(await readFile(path, "utf8")),
    "cache entry",
  );
  const responseText = string(cached["responseText"], "cache responseText");
  if (cached["sha256"] !== sha256(responseText))
    throw new Error("cache checksum mismatch");
  if (
    cached["url"] !== expectedUrl ||
    JSON.stringify(cached["body"]) !== JSON.stringify(expectedBody)
  )
    throw new Error("cache request mismatch");
  if (cached["status"] !== 200)
    throw new Error(`cache HTTP status is ${String(cached["status"])}`);
  if (!responseText.trim()) throw new Error("cache response is empty");
  return JSON.parse(responseText);
}

export function validationGates(
  height: ErrorMetrics,
  stabilityRms: number,
  events: EventMetrics,
): ValidationGates {
  const heightPass =
    height.rms <= 0.02 &&
    height.p95 <= 0.04 &&
    height.max <= 0.1 &&
    stabilityRms <= 0.005;
  const eventPass =
    events.provider > 0 &&
    events.matched / events.provider >= 0.95 &&
    events.meanMinutes < 5 &&
    events.maxMinutes < 15;
  return {
    height: heightPass,
    events: eventPass,
    publishable: heightPass && eventPass,
  };
}

export async function runRwsHarmonicValidation(
  options: ValidationOptions,
): Promise<ValidationReport> {
  const stations: StationReport[] = [];
  for (const station of STATIONS) {
    const trainBounds = bounds("2019-01-01", "2025-01-01");
    const validationBounds = bounds("2025-01-01", "2027-01-01");
    const training = parseHeightChunks(
      station.code,
      station.datum,
      [
        await fetchObservations(
          station.code,
          bounds("2019-01-01", "2022-01-01"),
          { Grootheid: { Code: "WATHTE" }, ProcesType: "astronomisch" },
          options,
        ),
        await fetchObservations(
          station.code,
          bounds("2022-01-01", "2025-01-01"),
          { Grootheid: { Code: "WATHTE" }, ProcesType: "astronomisch" },
          options,
        ),
      ],
      trainBounds,
    );
    const validation = parseHeightChunks(
      station.code,
      station.datum,
      [
        await fetchObservations(
          station.code,
          validationBounds,
          { Grootheid: { Code: "WATHTE" }, ProcesType: "astronomisch" },
          options,
        ),
      ],
      validationBounds,
    );
    const providerEvents = parseEvents(
      station.code,
      station.datum,
      station.grouping,
      await fetchObservations(
        station.code,
        validationBounds,
        { Groepering: { Code: station.grouping } },
        options,
      ),
      validationBounds,
    );
    const fitTraining = trainingSamplesBefore(
      training,
      validationBounds.startMs,
    );
    const baselineNames = await readTiconNames(station.ticon);
    const baselineRows = spreadSample(fitTraining, 12_000, station.code.length);
    const baselineFit = fitHarmonics(baselineRows, baselineNames);
    const baselineOffset = meanOffset(baselineRows, baselineFit);
    const scoreRows = spreadSample(
      fitTraining,
      24_000,
      station.code.length * 17,
    );
    const baselinePredictor = createTidePredictor(baselineFit, {
      offset: baselineOffset,
    });
    const residuals = scoreRows.map(
      (sample) =>
        sample.level -
        baselinePredictor.getWaterLevelAtTime({ time: new Date(sample.t) })
          .level,
    );
    const extraNames = selectExtraConstituents(
      scoreRows,
      residuals,
      baselineNames,
      50,
    );
    const names = [...baselineNames, ...extraNames];
    const firstRows = spreadSample(
      fitTraining,
      4_000,
      station.code.length * 97,
    );
    const secondRows = spreadSample(
      fitTraining,
      4_000,
      station.code.length * 97 + 1,
    );
    const firstFit = fitHarmonics(firstRows, names, { solver: "svd" });
    const secondFit = fitHarmonics(secondRows, names, { solver: "svd" });
    const firstPredictor = createTidePredictor(firstFit, {
      offset: meanOffset(firstRows, firstFit),
    });
    const secondPredictor = createTidePredictor(secondFit, {
      offset: meanOffset(secondRows, secondFit),
    });
    const firstLevels = validation.map(
      ({ t }) =>
        firstPredictor.getWaterLevelAtTime({ time: new Date(t) }).level,
    );
    const secondLevels = validation.map(
      ({ t }) =>
        secondPredictor.getWaterLevelAtTime({ time: new Date(t) }).level,
    );
    const height = errorMetrics(
      validation.map(({ level }, index) => firstLevels[index]! - level),
    );
    const stabilityRms = rms(
      firstLevels.map((level, index) => level - secondLevels[index]!),
    );
    const predictedEvents = firstPredictor
      .getExtremesPrediction({
        start: new Date(validationBounds.startMs),
        end: new Date(validationBounds.endMs),
      })
      .map((event) => ({
        t: event.time.getTime(),
        type: event.high ? "hoogwater" : "laagwater",
        level: event.level,
      }));
    const events = eventMetrics(providerEvents, predictedEvents);
    const gates = validationGates(height, stabilityRms, events);
    stations.push({
      station: station.code,
      terms: firstFit.length,
      samples: { train: fitTraining.length, validation: validation.length },
      height,
      stabilityRms,
      amplitudeMax: Math.max(...firstFit.map(({ amplitude }) => amplitude)),
      amplitudeSum: firstFit.reduce((sum, { amplitude }) => sum + amplitude, 0),
      events,
      gates,
    });
  }
  const report = {
    stations,
    heightPass: stations.every(({ gates }) => gates.height),
    eventPass: stations.every(({ gates }) => gates.events),
    publishable: stations.every(({ gates }) => gates.publishable),
  };
  await mkdir(dirname(options.reportPath), { recursive: true });
  await writeFile(options.reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function responseChannels(
  station: string,
  response: unknown,
  label: string,
): JsonRecord[] {
  const root = record(response, label);
  if (root["Succesvol"] !== true)
    throw new Error(`${station} ${label} was not successful`);
  return array(root["WaarnemingenLijst"], `${label} WaarnemingenLijst`).map(
    (value, index) => {
      const channel = record(value, `${label} channel ${index}`);
      const location = record(channel["Locatie"], `${label} location ${index}`);
      if (location["Code"] !== station)
        throw new Error(
          `${station} ${label} returned location ${String(location["Code"])}`,
        );
      return channel;
    },
  );
}

function metadataCode(channel: JsonRecord, field: string, expected: string) {
  return (
    code(record(channel["AquoMetadata"], "AquoMetadata"), field) === expected
  );
}

function code(parent: JsonRecord, field: string): string {
  return string(record(parent[field], field)["Code"], `${field}.Code`);
}

function timestamp(value: unknown, label: string): number {
  const text = string(value, `${label} Tijdstip`);
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(text))
    throw new Error(`${label} timestamp requires an explicit offset`);
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed))
    throw new Error(`${label} has invalid timestamp`);
  return parsed;
}

function record(value: unknown, label: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value as JsonRecord;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return value;
}

function number(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`${label} must be finite`);
  return value;
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

async function fetchObservations(
  station: string,
  range: Bounds,
  metadata: JsonRecord,
  options: ValidationOptions,
): Promise<unknown> {
  const body = {
    Locatie: { Code: station },
    AquoPlusWaarnemingMetadata: { AquoMetadata: metadata },
    Periode: {
      Begindatumtijd: new Date(range.startMs).toISOString(),
      Einddatumtijd: new Date(range.endMs).toISOString(),
    },
  };
  const key = sha256(JSON.stringify({ url: OBSERVATIONS_URL, body }));
  const path = join(options.cacheDir, `${key}.json`);
  try {
    return await readCachedJson(path, OBSERVATIONS_URL, body);
  } catch (error) {
    if (!isErrno(error, "ENOENT")) throw error;
  }
  const response = await options.fetch(OBSERVATIONS_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response.status !== 200)
    throw new Error(`RWS ${OBSERVATIONS_URL} returned HTTP ${response.status}`);
  const responseText = await response.text();
  if (!responseText.trim()) throw new Error("RWS returned an empty response");
  const value: unknown = JSON.parse(responseText);
  const entry = {
    fetchedAtMs: options.nowMs,
    url: OBSERVATIONS_URL,
    body,
    status: response.status,
    responseText,
    sha256: sha256(responseText),
  };
  await mkdir(options.cacheDir, { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  try {
    await writeFile(temporary, JSON.stringify(entry));
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
  return value;
}

async function readTiconNames(path: string): Promise<string[]> {
  const value = record(
    JSON.parse(
      await readFile(new URL(`../../${path}`, import.meta.url), "utf8"),
    ),
    path,
  );
  return array(value["harmonic_constituents"], "harmonic_constituents").map(
    (item, index) =>
      string(
        record(item, `harmonic constituent ${index}`)["name"],
        `harmonic constituent ${index} name`,
      ),
  );
}

function meanOffset(samples: Sample[], fit: HarmonicConstituent[]): number {
  const predictor = createTidePredictor(fit, { offset: false });
  return (
    samples.reduce(
      (sum, sample) =>
        sum +
        sample.level -
        predictor.getWaterLevelAtTime({ time: new Date(sample.t) }).level,
      0,
    ) / samples.length
  );
}

function errorMetrics(errors: number[]): ErrorMetrics {
  const absolute = errors.map(Math.abs).sort((left, right) => left - right);
  return {
    rms: rms(errors),
    p95: absolute[Math.max(0, Math.ceil(absolute.length * 0.95) - 1)]!,
    max: absolute.at(-1)!,
  };
}

function rms(values: number[]): number {
  return Math.sqrt(
    values.reduce((sum, value) => sum + value * value, 0) / values.length,
  );
}

export function eventMetrics(
  provider: RwsEvent[],
  predicted: RwsEvent[],
): EventMetrics {
  const used = new Set<number>();
  const differences: number[] = [];
  for (const event of provider) {
    let match = -1;
    let difference = Infinity;
    predicted.forEach((candidate, index) => {
      const candidateDifference = Math.abs(candidate.t - event.t) / 60_000;
      if (
        !used.has(index) &&
        candidate.type === event.type &&
        candidateDifference <= 60 &&
        candidateDifference < difference
      ) {
        match = index;
        difference = candidateDifference;
      }
    });
    if (match >= 0) {
      used.add(match);
      differences.push(difference);
    }
  }
  return {
    provider: provider.length,
    predicted: predicted.length,
    matched: differences.length,
    meanMinutes:
      differences.reduce((sum, value) => sum + value, 0) /
      Math.max(1, differences.length),
    maxMinutes: differences.length ? Math.max(...differences) : 0,
  };
}

function bounds(start: string, end: string): Bounds {
  return {
    startMs: Date.parse(`${start}T00:00:00Z`),
    endMs: Date.parse(`${end}T00:00:00Z`),
  };
}

const executable = process.argv[1];
if (executable && import.meta.url === pathToFileURL(resolve(executable)).href) {
  const root = new URL("../../", import.meta.url);
  const cacheDir = new URL("tmp/rws/cache/", root);
  const reportPath = new URL("tmp/rws/harmonics-report.json", root);
  runRwsHarmonicValidation({
    fetch: globalThis.fetch,
    cacheDir: cacheDir.pathname,
    reportPath: reportPath.pathname,
    nowMs: Date.now(),
  })
    .then((report) => {
      console.log(reportPath.pathname);
      for (const station of report.stations) {
        console.log(
          `${station.station}: height rms=${station.height.rms.toFixed(4)} p95=${station.height.p95.toFixed(4)} max=${station.height.max.toFixed(4)}; events ${station.events.matched}/${station.events.provider} mean=${station.events.meanMinutes.toFixed(1)}m max=${station.events.maxMinutes.toFixed(1)}m`,
        );
      }
      if (!report.publishable) process.exitCode = 1;
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
