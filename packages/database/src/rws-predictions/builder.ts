import * as flatbuffers from "flatbuffers";
import {
  Datum,
  Event,
  Root,
  SourceMetadata,
  Station,
} from "../generated/fbs/neaps-rws.ts";
import type { RwsPredictionsInput, RwsStationInput } from "./types.ts";

const INT16_MIN = -32_768;
const INT16_MAX = 32_767;

export function buildRwsPredictions(input: RwsPredictionsInput): Uint8Array {
  validateInput(input);
  const stations = [...input.stations].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  const eventTypes = [
    ...new Set(stations.flatMap((s) => s.events.map((e) => e.type))),
  ].sort();
  if (eventTypes.length > 65_536)
    throw new Error(
      `event type count ${eventTypes.length} exceeds ushort range`,
    );
  const eventTypeIndexes = new Map(
    eventTypes.map((type, index) => [type, index]),
  );

  const builder = new flatbuffers.Builder(1024);
  const stationOffsets = stations.map((station) =>
    buildStation(builder, station, eventTypeIndexes),
  );
  const eventTypesOffset = Root.createEventTypesVector(
    builder,
    eventTypes.map((type) => builder.createString(type)),
  );
  const stationsOffset = Root.createStationsVector(builder, stationOffsets);
  const root = Root.createRoot(
    builder,
    input.formatMajor,
    builder.createString(input.datasetVersion),
    BigInt(input.retrievedAtMs),
    builder.createString(input.catalogRequest),
    builder.createString(input.catalogSha256),
    builder.createString(input.sourceUrl),
    builder.createString(input.licenseUrl),
    BigInt(input.supportedStartMs),
    BigInt(input.supportedEndMs),
    BigInt(input.refreshAfterMs),
    eventTypesOffset,
    stationsOffset,
  );
  Root.finishSizePrefixedRootBuffer(builder, root);
  return builder.asUint8Array();
}

function buildStation(
  builder: flatbuffers.Builder,
  station: RwsStationInput,
  eventTypeIndexes: Map<string, number>,
): flatbuffers.Offset {
  let events = 0;
  if (station.events.length > 0) {
    Station.startEventsVector(builder, station.events.length);
    for (let index = station.events.length - 1; index >= 0; index--) {
      const event = station.events[index]!;
      Event.createEvent(
        builder,
        BigInt(event.timestampMs),
        eventTypeIndexes.get(event.type)!,
        event.heightCm,
      );
    }
    events = builder.endVector();
  }

  const heights = new Int16Array(station.heightsCm.length);
  const missing = new Uint8Array(Math.ceil(station.heightsCm.length / 8));
  station.heightsCm.forEach((height, index) => {
    if (height === null) missing[index >> 3]! |= 1 << (index & 7);
    else heights[index] = height;
  });
  const heightsOffset = Station.createHeightsCmVector(builder, heights);
  const missingOffset = Station.createMissingVector(builder, missing);

  const metadata = station.sourceMetadata;
  const sourceMetadata = SourceMetadata.createSourceMetadata(
    builder,
    builder.createString(metadata.qualityCode),
    builder.createString(metadata.status),
    builder.createString(metadata.commissioningOrganization),
    metadata.samplingHeight,
    builder.createString(metadata.referencePlane),
  );
  const id = builder.createString(station.id);
  const name = builder.createString(station.name);
  const tcdbStationId = station.tcdbStationId
    ? builder.createString(station.tcdbStationId)
    : 0;

  Station.startStation(builder);
  Station.addId(builder, id);
  Station.addName(builder, name);
  Station.addLatitude(builder, station.latitude);
  Station.addLongitude(builder, station.longitude);
  Station.addDatum(builder, station.datum === "NAP" ? Datum.NAP : Datum.MSL);
  Station.addTcdbStationId(builder, tcdbStationId);
  Station.addStartMs(builder, BigInt(station.startMs));
  Station.addCadenceSeconds(builder, station.cadenceSeconds);
  Station.addHeightsCm(builder, heightsOffset);
  Station.addMissing(builder, missingOffset);
  Station.addSourceMetadata(builder, sourceMetadata);
  Station.addEvents(builder, events);
  return Station.endStation(builder);
}

function validateInput(input: RwsPredictionsInput): void {
  if (input.formatMajor !== 1) throw new Error("formatMajor must be 1");
  for (const [name, value] of Object.entries({
    datasetVersion: input.datasetVersion,
    catalogRequest: input.catalogRequest,
    catalogSha256: input.catalogSha256,
    sourceUrl: input.sourceUrl,
    licenseUrl: input.licenseUrl,
  })) {
    if (!value) throw new Error(`${name} must not be empty`);
  }
  for (const [name, value] of Object.entries({
    retrievedAtMs: input.retrievedAtMs,
    supportedStartMs: input.supportedStartMs,
    supportedEndMs: input.supportedEndMs,
    refreshAfterMs: input.refreshAfterMs,
  })) {
    if (!Number.isSafeInteger(value))
      throw new Error(`${name} must be a safe integer`);
  }
  if (input.supportedStartMs >= input.supportedEndMs)
    throw new Error("supportedStartMs must be before supportedEndMs");
  if (input.refreshAfterMs > input.supportedEndMs)
    throw new Error("refreshAfterMs must not exceed supportedEndMs");

  const sorted = [...input.stations].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  sorted.forEach((station, index) => {
    validateStation(station);
    if (index > 0 && sorted[index - 1]!.id === station.id)
      throw new Error(`duplicate station id ${station.id}`);
  });
}

function validateStation(station: RwsStationInput): void {
  if (!station.id.startsWith("rws/") || station.id.length === 4)
    throw new Error(
      `station id ${station.id || "<empty>"} must start with rws/`,
    );
  if (!station.name) throw new Error(`${station.id} name must not be empty`);
  if (!Number.isFinite(station.latitude) || !Number.isFinite(station.longitude))
    throw new Error(`${station.id} coordinates must be finite`);
  if (!Number.isSafeInteger(station.startMs))
    throw new Error(`${station.id} startMs must be a safe integer`);
  if (station.cadenceSeconds !== 600)
    throw new Error(`${station.id} cadence must be 600 seconds`);
  if (station.heightsCm.length === 0)
    throw new Error(`${station.id} heights must not be empty`);
  station.heightsCm.forEach((height, index) => {
    if (height !== null && !isInt16(height))
      throw new Error(`${station.id} height ${index} is outside int16 range`);
  });
  let previous = -Infinity;
  station.events.forEach((event, index) => {
    if (!event.type)
      throw new Error(`${station.id} event ${index} has no type`);
    if (!Number.isSafeInteger(event.timestampMs))
      throw new Error(
        `${station.id} event ${index} timestamp must be a safe integer`,
      );
    if (event.timestampMs < previous)
      throw new Error(`${station.id} event timestamps are not ordered`);
    if (!isInt16(event.heightCm))
      throw new Error(
        `${station.id} event ${index} height is outside int16 range`,
      );
    previous = event.timestampMs;
  });
  if (!Number.isInteger(station.sourceMetadata.samplingHeight))
    throw new Error(`${station.id} sampling height must be an integer`);
}

function isInt16(value: number): boolean {
  return Number.isInteger(value) && value >= INT16_MIN && value <= INT16_MAX;
}
