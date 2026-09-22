import { describe, expect, test } from "vitest";
import * as flatbuffers from "flatbuffers";
import { buildRwsPredictions } from "../src/rws-predictions/builder.ts";
import { openRwsPredictions } from "../src/rws-predictions/reader.ts";
import { Root } from "../src/generated/fbs/neaps-rws.ts";
import type { RwsPredictionsInput } from "../src/rws-predictions/types.ts";

const startMs = Date.parse("2026-07-01T00:00:00.000Z");

const input: RwsPredictionsInput = {
  formatMajor: 1,
  datasetVersion: "fixture-v1",
  retrievedAtMs: Date.parse("2026-09-21T12:00:00.000Z"),
  catalogRequest: '{"catalog":true}',
  catalogSha256: "fixture-sha256",
  sourceUrl: "https://example.test/rws",
  licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
  supportedStartMs: startMs,
  supportedEndMs: startMs + 3 * 600_000,
  refreshAfterMs: startMs + 3 * 600_000,
  stations: [
    {
      id: "rws/nap",
      name: "NAP fixture",
      latitude: 53.45,
      longitude: 5.77,
      datum: "NAP",
      startMs,
      cadenceSeconds: 600,
      heightsCm: [0, null, 17],
      sourceMetadata: {
        qualityCode: "00",
        status: "Ongecontroleerd",
        commissioningOrganization: "RIKZMON_WAT",
        samplingHeight: -999_999_999,
        referencePlane: "NVT",
      },
      events: [
        { timestampMs: startMs, type: "hoogwater", heightCm: 91 },
        {
          timestampMs: startMs + 600_000,
          type: "laagwater",
          heightCm: -34,
        },
        {
          timestampMs: startMs + 1_200_000,
          type: "dubbel-laagwater",
          heightCm: -31,
        },
      ],
    },
    {
      id: "rws/msl",
      name: "MSL fixture",
      latitude: 52,
      longitude: 3.28,
      datum: "MSL",
      tcdbStationId: "ticon/europlatform-rws",
      startMs,
      cadenceSeconds: 600,
      heightsCm: [4, 5, 6],
      sourceMetadata: {
        qualityCode: "00",
        status: "Ongecontroleerd",
        commissioningOrganization: "RIKZMON_WAT",
        samplingHeight: -999_999_999,
        referencePlane: "NVT",
      },
      events: [],
    },
  ],
};

describe("RWS predictions companion", () => {
  test("round-trips keyed stations, gaps, metadata, and ordered events", () => {
    const bytes = buildRwsPredictions(input);
    const db = openRwsPredictions(bytes);

    expect(db.formatMajor).toBe(1);
    expect(db.datasetVersion).toBe("fixture-v1");
    expect(db.retrievedAtMs).toBe(input.retrievedAtMs);
    expect(db.supportedStartMs).toBe(input.supportedStartMs);
    expect(db.supportedEndMs).toBe(input.supportedEndMs);
    expect(db.refreshAfterMs).toBe(input.refreshAfterMs);

    const nap = db.station("rws/nap")!;
    expect(nap).toMatchObject({
      id: "rws/nap",
      name: "NAP fixture",
      latitude: 53.45,
      longitude: 5.77,
      datum: "NAP",
      startMs,
      endMs: startMs + 3 * 600_000,
      cadenceSeconds: 600,
      sampleCount: 3,
      sourceMetadata: input.stations[0]!.sourceMetadata,
    });
    expect(nap.height(0)).toBe(0);
    expect(nap.height(1)).toBeNull();
    expect(nap.height(2)).toBe(17);
    expect(nap.events()).toEqual(input.stations[0]!.events);

    expect(db.station("rws/msl")).toMatchObject({
      datum: "MSL",
      tcdbStationId: "ticon/europlatform-rws",
    });
    expect(db.station("rws/missing")).toBeUndefined();
    expect(buildRwsPredictions(input)).toEqual(bytes);
  });

  test.each([
    {
      name: "duplicate station id",
      mutate: (value: RwsPredictionsInput) =>
        value.stations.push(structuredClone(value.stations[0]!)),
      error: /duplicate station id rws\/nap/,
    },
    {
      name: "wrong cadence",
      mutate: (value: RwsPredictionsInput) =>
        Object.assign(value.stations[0]!, { cadenceSeconds: 300 }),
      error: /rws\/nap.*cadence.*600/,
    },
    {
      name: "height outside int16",
      mutate: (value: RwsPredictionsInput) => {
        value.stations[0]!.heightsCm[0] = 32_768;
      },
      error: /rws\/nap.*height 0.*int16/,
    },
    {
      name: "event height outside int16",
      mutate: (value: RwsPredictionsInput) => {
        value.stations[0]!.events[0]!.heightCm = -32_769;
      },
      error: /rws\/nap.*event 0.*height.*int16/,
    },
    {
      name: "events out of order",
      mutate: (value: RwsPredictionsInput) => {
        value.stations[0]!.events[1]!.timestampMs = startMs - 1;
      },
      error: /rws\/nap.*event timestamps.*ordered/,
    },
    {
      name: "unsafe root timestamp",
      mutate: (value: RwsPredictionsInput) => {
        value.retrievedAtMs = Number.MAX_SAFE_INTEGER + 1;
      },
      error: /retrievedAtMs.*safe integer/,
    },
    {
      name: "event type index overflow",
      mutate: (value: RwsPredictionsInput) => {
        value.stations[0]!.events = Array.from(
          { length: 65_537 },
          (_, index) => ({
            timestampMs: startMs,
            type: `type-${index}`,
            heightCm: 0,
          }),
        );
      },
      error: /event type count 65537.*ushort/,
    },
  ])("rejects $name", ({ mutate, error }) => {
    const invalid = structuredClone(input);
    mutate(invalid);
    expect(() => buildRwsPredictions(invalid)).toThrow(error);
  });

  test("rejects corrupt headers and unsupported versions", () => {
    const bytes = buildRwsPredictions(input);

    const wrongMagic = bytes.slice();
    wrongMagic[8] = "X".charCodeAt(0);
    expect(() => openRwsPredictions(wrongMagic)).toThrow(/wrong magic/);

    for (const length of [bytes.length - 5, bytes.length - 3]) {
      const wrongSize = bytes.slice();
      new DataView(wrongSize.buffer).setUint32(0, length, true);
      expect(() => openRwsPredictions(wrongSize)).toThrow(/size prefix/);
    }

    const wrongVersion = bytes.slice();
    const root = Root.getSizePrefixedRootAsRoot(
      new flatbuffers.ByteBuffer(wrongVersion),
    );
    const offset = root.bb!.__offset(root.bb_pos, 4);
    new DataView(wrongVersion.buffer).setUint16(root.bb_pos + offset, 2, true);
    expect(() => openRwsPredictions(wrongVersion)).toThrow(
      /unsupported format major 2/,
    );

    expect(() => openRwsPredictions(bytes.subarray(0, 8))).toThrow(/truncated/);
  });

  test("rejects invalid height and event type indexes", () => {
    const bytes = buildRwsPredictions(input);
    const db = openRwsPredictions(bytes);
    const station = db.station("rws/nap")!;
    expect(() => station.height(-1)).toThrow(/rws\/nap.*-1.*out of range/);
    expect(() => station.height(station.sampleCount)).toThrow(
      /rws\/nap.*3.*out of range/,
    );

    const corrupt = bytes.slice();
    const root = Root.getSizePrefixedRootAsRoot(
      new flatbuffers.ByteBuffer(corrupt),
    );
    const event = root.stations(1)!.events(0)!;
    new DataView(corrupt.buffer).setUint16(
      event.bb_pos + 8,
      root.eventTypesLength(),
      true,
    );
    expect(() =>
      openRwsPredictions(corrupt).station("rws/nap")!.events(),
    ).toThrow(/rws\/nap.*event type index.*out of range/);
  });
});
