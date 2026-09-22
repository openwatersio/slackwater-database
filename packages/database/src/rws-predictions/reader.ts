import * as flatbuffers from "flatbuffers";
import { Datum, Root, Station } from "../generated/fbs/neaps-rws.ts";
import type { RwsDatum, RwsEventInput, RwsSourceMetadata } from "./types.ts";

export function openRwsPredictions(bytes: Uint8Array): RwsPredictionsReader {
  if (bytes.length < 12)
    throw new Error("Invalid RWS predictions buffer: truncated header");
  const size = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(
    0,
    true,
  );
  if (size !== bytes.length - 4)
    throw new Error("Invalid RWS predictions buffer: size prefix mismatch");
  if (String.fromCharCode(...bytes.subarray(8, 12)) !== "RWSP")
    throw new Error("Invalid RWS predictions buffer: wrong magic");

  try {
    const root = Root.getSizePrefixedRootAsRoot(
      new flatbuffers.ByteBuffer(bytes),
    );
    if (root.formatMajor() !== 1)
      throw new Error(`unsupported format major ${root.formatMajor()}`);
    return new RwsPredictionsReader(root);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid RWS predictions buffer: ${message}`);
  }
}

export class RwsPredictionsReader {
  readonly formatMajor: number;
  readonly datasetVersion: string;
  readonly retrievedAtMs: number;
  readonly catalogRequest: string;
  readonly catalogSha256: string;
  readonly sourceUrl: string;
  readonly licenseUrl: string;
  readonly supportedStartMs: number;
  readonly supportedEndMs: number;
  readonly refreshAfterMs: number;

  constructor(private readonly root: Root) {
    this.formatMajor = root.formatMajor();
    this.datasetVersion = required(root.datasetVersion(), "datasetVersion");
    this.retrievedAtMs = Number(root.retrievedAtMs());
    this.catalogRequest = required(root.catalogRequest(), "catalogRequest");
    this.catalogSha256 = required(root.catalogSha256(), "catalogSha256");
    this.sourceUrl = required(root.sourceUrl(), "sourceUrl");
    this.licenseUrl = required(root.licenseUrl(), "licenseUrl");
    this.supportedStartMs = Number(root.supportedStartMs());
    this.supportedEndMs = Number(root.supportedEndMs());
    this.refreshAfterMs = Number(root.refreshAfterMs());
  }

  station(id: string): RwsStationReader | undefined {
    let low = 0;
    let high = this.root.stationsLength() - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const station = this.root.stations(middle)!;
      const candidate = required(station.id(), `station ${middle} id`);
      if (candidate === id) return new RwsStationReader(this.root, station);
      if (candidate < id) low = middle + 1;
      else high = middle - 1;
    }
    return undefined;
  }
}

export class RwsStationReader {
  readonly id: string;
  readonly name: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly datum: RwsDatum;
  readonly tcdbStationId?: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly cadenceSeconds: number;
  readonly sampleCount: number;
  readonly sourceMetadata: RwsSourceMetadata;

  constructor(
    private readonly root: Root,
    private readonly station: Station,
  ) {
    this.id = required(station.id(), "station id");
    this.name = required(station.name(), `${this.id} name`);
    this.latitude = station.latitude();
    this.longitude = station.longitude();
    this.datum = station.datum() === Datum.NAP ? "NAP" : "MSL";
    const tcdbStationId = station.tcdbStationId();
    if (tcdbStationId !== null) this.tcdbStationId = tcdbStationId;
    this.startMs = Number(station.startMs());
    this.cadenceSeconds = station.cadenceSeconds();
    this.sampleCount = station.heightsCmLength();
    this.endMs = this.startMs + this.sampleCount * this.cadenceSeconds * 1000;
    const metadata = station.sourceMetadata();
    if (!metadata) throw new Error(`${this.id} has no source metadata`);
    this.sourceMetadata = {
      qualityCode: required(metadata.qualityCode(), `${this.id} quality code`),
      status: required(metadata.status(), `${this.id} status`),
      commissioningOrganization: required(
        metadata.commissioningOrganization(),
        `${this.id} commissioning organization`,
      ),
      samplingHeight: metadata.samplingHeight(),
      referencePlane: required(
        metadata.referencePlane(),
        `${this.id} reference plane`,
      ),
    };
  }

  height(index: number): number | null {
    if (!Number.isInteger(index) || index < 0 || index >= this.sampleCount)
      throw new RangeError(`${this.id} height index ${index} is out of range`);
    const byte = this.station.missing(index >> 3) ?? 0;
    return byte & (1 << (index & 7)) ? null : this.station.heightsCm(index)!;
  }

  events(): RwsEventInput[] {
    return Array.from({ length: this.station.eventsLength() }, (_, index) => {
      const event = this.station.events(index)!;
      const typeIndex = event.typeIndex();
      if (typeIndex >= this.root.eventTypesLength())
        throw new RangeError(
          `${this.id} event type index ${typeIndex} is out of range`,
        );
      return {
        timestampMs: Number(event.timestampMs()),
        type: required(
          this.root.eventTypes(typeIndex),
          `${this.id} event type`,
        ),
        heightCm: event.heightCm(),
      };
    });
  }
}

function required(value: string | null, name: string): string {
  if (value === null)
    throw new Error(`Invalid RWS predictions buffer: missing ${name}`);
  return value;
}
