import type {
  RwsEventInput,
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
