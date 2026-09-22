import { afterEach, describe, expect, test, vi } from "vitest";
import * as flatbuffers from "flatbuffers";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRwsPredictions } from "../src/rws-predictions/builder.ts";
import { openRwsPredictions } from "../src/rws-predictions/reader.ts";
import { Root } from "../src/generated/fbs/neaps-rws.ts";
import {
  discoverRwsSeries,
  normalizeEvents,
  normalizeHeightChunks,
  runRwsPrototype,
} from "../../../sources/rws/prototype.ts";
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

const bounds = { startMs, endMs: startMs + 1_800_000 };

const metadata = (
  id: number,
  datum: string,
  grouping = "",
  process = "astronomisch",
) => ({
  AquoMetadata_MessageID: id,
  Eenheid: { Code: "cm", Omschrijving: "centimeter" },
  Groepering: { Code: grouping, Omschrijving: grouping },
  Grootheid: { Code: "WATHTE", Omschrijving: "Waterhoogte" },
  Hoedanigheid: { Code: datum, Omschrijving: datum },
  ProcesType: process,
});

const catalogFixture = {
  Succesvol: true,
  AquoMetadataLijst: [
    metadata(313, "MSL"),
    metadata(315, "MSL", "GETETBRKDMSL2"),
    metadata(317, "NAP"),
    metadata(321, "NAP", "GETETBRKD2"),
    metadata(999, "NAP", "", "meting"),
  ],
  LocatieLijst: [
    {
      Locatie_MessageID: 1,
      Code: "nap",
      Coordinatenstelsel: "ETRS89",
      Lat: 53.45,
      Lon: 5.77,
      Naam: "NAP fixture",
      Omschrijving: "NAP fixture",
    },
    {
      Locatie_MessageID: 2,
      Code: "msl",
      Coordinatenstelsel: "ETRS89",
      Lat: 52,
      Lon: 3.28,
      Naam: "MSL fixture",
      Omschrijving: "MSL fixture",
    },
  ],
  AquoMetadataLocatieLijst: [
    { AquoMetaData_MessageID: 317, Locatie_MessageID: 1 },
    { AquoMetaData_MessageID: 321, Locatie_MessageID: 1 },
    { AquoMetaData_MessageID: 313, Locatie_MessageID: 2 },
    { AquoMetaData_MessageID: 315, Locatie_MessageID: 2 },
    { AquoMetaData_MessageID: 999, Locatie_MessageID: 1 },
  ],
};

type SampleFixture = {
  time: string;
  value: number;
  quality?: string;
  status?: string;
  organization?: string;
  samplingHeight?: string;
  referencePlane?: string;
};

function heightResponse(code: string, datum: string, samples: SampleFixture[]) {
  return {
    Succesvol: true,
    WaarnemingenLijst: [
      {
        AquoMetadata: {
          Eenheid: { Code: "cm" },
          Groepering: { Code: "" },
          Grootheid: { Code: "WATHTE" },
          Hoedanigheid: { Code: datum },
          ProcesType: "astronomisch",
        },
        Locatie: { Code: code },
        MetingenLijst: samples.map((sample) => ({
          Meetwaarde: {
            Waarde_Alfanumeriek: String(sample.value),
            Waarde_Numeriek: sample.value,
          },
          Tijdstip: sample.time,
          WaarnemingMetadata: {
            Bemonsteringshoogte: sample.samplingHeight ?? "-999999999",
            Kwaliteitswaardecode: sample.quality ?? "00",
            OpdrachtgevendeInstantie: sample.organization ?? "RIKZMON_WAT",
            Referentievlak: sample.referencePlane ?? "NVT",
            Statuswaarde: sample.status ?? "Ongecontroleerd",
          },
        })),
      },
    ],
  };
}

function eventResponse(
  code: string,
  datum: string,
  grouping: string,
  events: { time: string; type: string; height: number }[],
) {
  const channel = (type: boolean) => ({
    AquoMetadata: {
      Eenheid: { Code: type ? "DIMSLS" : "cm" },
      Groepering: { Code: grouping },
      Grootheid: { Code: type ? "NVT" : "WATHTE" },
      Hoedanigheid: { Code: type ? "NVT" : datum },
      ProcesType: "astronomisch",
      Typering: { Code: type ? "GETETTPE" : "NVT" },
    },
    Locatie: { Code: code },
    MetingenLijst: events.map((event) => ({
      Meetwaarde: {
        Waarde_Alfanumeriek: type ? event.type : String(event.height),
        Waarde_Numeriek: type ? 0 : event.height,
      },
      Tijdstip: event.time,
      WaarnemingMetadata: {
        Bemonsteringshoogte: "-999999999",
        Kwaliteitswaardecode: "00",
        OpdrachtgevendeInstantie: "RIKZMON_WAT",
        Referentievlak: "NVT",
        Statuswaarde: "Ongecontroleerd",
      },
    })),
  });
  return {
    Succesvol: true,
    WaarnemingenLijst: [channel(true), channel(false)],
  };
}

function validHeightChunks() {
  return [
    heightResponse("nap", "NAP", [
      { time: "2026-07-01T01:00:00.000+01:00", value: 0 },
      {
        time: "2026-07-01T01:10:00.000+01:00",
        value: -999_999_999,
        quality: "99",
      },
      { time: "2026-07-01T01:20:00.000+01:00", value: 17 },
    ]),
    heightResponse("nap", "NAP", [
      { time: "2026-07-01T01:20:00.000+01:00", value: 17 },
      { time: "2026-07-01T01:30:00.000+01:00", value: 20 },
    ]),
  ];
}

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function prototypePaths() {
  const root = await mkdtemp(join(tmpdir(), "rws-prototype-test-"));
  temporaryDirectories.push(root);
  return { cacheDir: join(root, "cache"), outPath: join(root, "fixture.rwsp") };
}

function providerTime(timestampMs: number): string {
  return new Date(timestampMs + 3_600_000).toISOString().replace("Z", "+01:00");
}

function runHeightResponse(code: string, datum: string) {
  return heightResponse(
    code,
    datum,
    [0, 600_000, 1_200_000, 1_800_000].map((offset, index) => ({
      time: providerTime(startMs + offset),
      value: index,
    })),
  );
}

function runEventResponse(code: string, datum: string, grouping: string) {
  return eventResponse(code, datum, grouping, [
    {
      time: providerTime(startMs + 300_000),
      type: "hoogwater",
      height: 91,
    },
    {
      time: providerTime(startMs + 900_000),
      type: "laagwater",
      height: -34,
    },
  ]);
}

function rwsFetch(failHeightCode?: string, failHeightStatus = 500) {
  const bodies: unknown[] = [];
  const fetch = vi.fn(
    async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      if (body.CatalogusFilter)
        return new Response(JSON.stringify(catalogFixture), { status: 200 });
      const code = body.Locatie.Code as string;
      const grouping = body.AquoPlusWaarnemingMetadata.AquoMetadata.Groepering
        ?.Code as string | undefined;
      if (!grouping && code === failHeightCode)
        return new Response(failHeightStatus === 204 ? null : "service error", {
          status: failHeightStatus,
        });
      const datum = code === "nap" ? "NAP" : "MSL";
      return new Response(
        JSON.stringify(
          grouping
            ? runEventResponse(code, datum, grouping)
            : runHeightResponse(code, datum),
        ),
        { status: 200 },
      );
    },
  );
  return { fetch: fetch as unknown as typeof globalThis.fetch, bodies };
}

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

describe("RWS response normalization", () => {
  test("discovers astronomical height series and matching datum events", () => {
    expect(discoverRwsSeries(catalogFixture)).toEqual([
      {
        code: "msl",
        name: "MSL fixture",
        latitude: 52,
        longitude: 3.28,
        datum: "MSL",
        heightMetadataId: "313",
        eventGrouping: "GETETBRKDMSL2",
      },
      {
        code: "nap",
        name: "NAP fixture",
        latitude: 53.45,
        longitude: 5.77,
        datum: "NAP",
        heightMetadataId: "317",
        eventGrouping: "GETETBRKD2",
      },
    ]);
  });

  test("deduplicates inclusive chunks and preserves zero beside a gap", () => {
    const series = discoverRwsSeries(catalogFixture)[1]!;
    expect(normalizeHeightChunks(series, validHeightChunks(), bounds)).toEqual({
      id: "rws/nap",
      name: "NAP fixture",
      latitude: 53.45,
      longitude: 5.77,
      datum: "NAP",
      startMs,
      cadenceSeconds: 600,
      heightsCm: [0, null, 17],
      sourceMetadata: input.stations[0]!.sourceMetadata,
      events: [],
    });
  });

  test("pairs open-ended event types with heights in provider order", () => {
    const series = discoverRwsSeries(catalogFixture)[1]!;
    const response = eventResponse("nap", "NAP", "GETETBRKD2", [
      {
        time: "2026-07-01T01:05:00.000+01:00",
        type: "hoogwater",
        height: 91,
      },
      {
        time: "2026-07-01T01:15:00.000+01:00",
        type: "laagwater",
        height: -34,
      },
      {
        time: "2026-07-01T01:25:00.000+01:00",
        type: "dubbel-laagwater",
        height: -31,
      },
      {
        time: "2026-07-01T01:30:00.000+01:00",
        type: "boundary",
        height: 0,
      },
    ]);

    expect(normalizeEvents(series, response, bounds)).toEqual([
      { timestampMs: startMs + 300_000, type: "hoogwater", heightCm: 91 },
      { timestampMs: startMs + 900_000, type: "laagwater", heightCm: -34 },
      {
        timestampMs: startMs + 1_500_000,
        type: "dubbel-laagwater",
        heightCm: -31,
      },
    ]);
  });

  test("rejects unknown catalog and mismatched response datums", () => {
    const unknown = structuredClone(catalogFixture);
    unknown.AquoMetadataLijst[2]!.Hoedanigheid.Code = "LAT";
    expect(() => discoverRwsSeries(unknown)).toThrow(/unknown.*datum LAT/);

    const series = discoverRwsSeries(catalogFixture)[1]!;
    expect(() =>
      normalizeHeightChunks(
        series,
        [
          heightResponse("nap", "MSL", [
            { time: "2026-07-01T01:00:00.000+01:00", value: 0 },
            { time: "2026-07-01T01:30:00.000+01:00", value: 1 },
          ]),
        ],
        bounds,
      ),
    ).toThrow(/nap.*datum.*NAP/);
  });

  test("rejects unexpected quality and station metadata variation", () => {
    const series = discoverRwsSeries(catalogFixture)[1]!;
    const quality = validHeightChunks();
    for (const chunk of quality)
      for (const sample of chunk.WaarnemingenLijst[0]!.MetingenLijst)
        sample.WaarnemingMetadata.Kwaliteitswaardecode = "77";
    expect(() => normalizeHeightChunks(series, quality, bounds)).toThrow(
      /nap.*quality code 77/,
    );

    const allMissing = validHeightChunks();
    for (const chunk of allMissing)
      for (const sample of chunk.WaarnemingenLijst[0]!.MetingenLijst)
        sample.WaarnemingMetadata.Kwaliteitswaardecode = "99";
    expect(() => normalizeHeightChunks(series, allMissing, bounds)).toThrow(
      /nap.*no present height/,
    );

    const changed = validHeightChunks();
    changed[0]!.WaarnemingenLijst[0]!.MetingenLijst[1]!.WaarnemingMetadata.Statuswaarde =
      "Gecontroleerd";
    expect(() => normalizeHeightChunks(series, changed, bounds)).toThrow(
      /nap.*status varies/,
    );
  });

  test("deduplicates only matching chunk boundaries", () => {
    const series = discoverRwsSeries(catalogFixture)[1]!;
    const conflicting = validHeightChunks();
    conflicting[1]!.WaarnemingenLijst[0]!.MetingenLijst[0]!.Meetwaarde.Waarde_Numeriek = 18;
    expect(() => normalizeHeightChunks(series, conflicting, bounds)).toThrow(
      /nap.*conflicting duplicate timestamp/,
    );

    const withinChunk = validHeightChunks();
    withinChunk[0]!.WaarnemingenLijst[0]!.MetingenLijst.splice(
      2,
      0,
      structuredClone(withinChunk[0]!.WaarnemingenLijst[0]!.MetingenLijst[1]!),
    );
    expect(() => normalizeHeightChunks(series, withinChunk, bounds)).toThrow(
      /nap.*duplicate timestamp/,
    );
  });

  test.each([
    ["5-minute", "2026-07-01T01:05:00.000+01:00"],
    ["20-minute", "2026-07-01T01:20:00.000+01:00"],
  ])("rejects %s height cadence", (_name, secondTime) => {
    const series = discoverRwsSeries(catalogFixture)[1]!;
    const response = heightResponse("nap", "NAP", [
      { time: "2026-07-01T01:00:00.000+01:00", value: 0 },
      { time: secondTime, value: 1 },
      { time: "2026-07-01T01:30:00.000+01:00", value: 2 },
    ]);
    expect(() => normalizeHeightChunks(series, [response], bounds)).toThrow(
      /nap.*cadence.*600/,
    );
  });

  test("rejects heights outside int16", () => {
    const series = discoverRwsSeries(catalogFixture)[1]!;
    const chunks = validHeightChunks();
    chunks[0]!.WaarnemingenLijst[0]!.MetingenLijst[0]!.Meetwaarde.Waarde_Numeriek = 32_768;
    expect(() => normalizeHeightChunks(series, chunks, bounds)).toThrow(
      /nap.*height 0.*int16/,
    );
  });

  test("rejects incomplete or unpaired event channels", () => {
    const series = discoverRwsSeries(catalogFixture)[1]!;
    const events = [
      {
        time: "2026-07-01T01:05:00.000+01:00",
        type: "hoogwater",
        height: 91,
      },
    ];
    const missingType = eventResponse("nap", "NAP", "GETETBRKD2", events);
    missingType.WaarnemingenLijst.shift();
    expect(() => normalizeEvents(series, missingType, bounds)).toThrow(
      /nap.*type channel.*missing/,
    );

    const missingHeight = eventResponse("nap", "NAP", "GETETBRKD2", events);
    missingHeight.WaarnemingenLijst.pop();
    expect(() => normalizeEvents(series, missingHeight, bounds)).toThrow(
      /nap.*height channel.*missing/,
    );

    const unequal = eventResponse("nap", "NAP", "GETETBRKD2", events);
    unequal.WaarnemingenLijst[1]!.MetingenLijst.push(
      structuredClone(unequal.WaarnemingenLijst[1]!.MetingenLijst[0]!),
    );
    expect(() => normalizeEvents(series, unequal, bounds)).toThrow(
      /nap.*lengths.*match/,
    );

    const mismatched = eventResponse("nap", "NAP", "GETETBRKD2", events);
    mismatched.WaarnemingenLijst[1]!.MetingenLijst[0]!.Tijdstip =
      "2026-07-01T01:06:00.000+01:00";
    expect(() => normalizeEvents(series, mismatched, bounds)).toThrow(
      /nap.*timestamps.*pair/,
    );
  });

  test("rejects duplicate catalog location codes", () => {
    const duplicate = structuredClone(catalogFixture);
    duplicate.LocatieLijst.push({
      ...structuredClone(duplicate.LocatieLijst[0]!),
      Locatie_MessageID: 3,
    });
    duplicate.AquoMetadataLocatieLijst.push({
      AquoMetaData_MessageID: 317,
      Locatie_MessageID: 3,
    });
    expect(() => discoverRwsSeries(duplicate)).toThrow(
      /duplicate RWS location code nap/,
    );
  });
});

describe("RWS prototype run", () => {
  test("fetches, caches, builds, measures, and replays deterministically", async () => {
    const paths = await prototypePaths();
    const source = rwsFetch();
    const options = {
      ...paths,
      fetch: source.fetch,
      startMs,
      endMs: bounds.endMs,
      targetStartMs: startMs,
      targetEndMs: startMs + 3_600_000,
      nowMs: Date.parse("2026-09-21T12:00:00.000Z"),
    };

    const measurements = await runRwsPrototype(options);
    const bytes = await readFile(paths.outPath);
    const database = openRwsPredictions(bytes);
    expect(database.station("rws/nap")?.height(0)).toBe(0);
    expect(database.station("rws/msl")?.datum).toBe("MSL");
    expect(source.bodies).toHaveLength(5);
    expect(source.bodies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ CatalogusFilter: expect.any(Object) }),
        expect.objectContaining({ Locatie: { Code: "nap" } }),
        expect.objectContaining({ Locatie: { Code: "msl" } }),
        expect.objectContaining({
          AquoPlusWaarnemingMetadata: {
            AquoMetadata: { Groepering: { Code: "GETETBRKD2" } },
          },
        }),
        expect.objectContaining({
          AquoPlusWaarnemingMetadata: {
            AquoMetadata: { Groepering: { Code: "GETETBRKDMSL2" } },
          },
        }),
      ]),
    );
    const cacheFiles = await readdir(paths.cacheDir);
    expect(cacheFiles).toHaveLength(5);
    const cached = JSON.parse(
      await readFile(join(paths.cacheDir, cacheFiles[0]!), "utf8"),
    );
    expect(cached).toEqual({
      fetchedAtMs: options.nowMs,
      url: expect.any(String),
      body: expect.any(Object),
      status: 200,
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      responseText: expect.any(String),
    });
    expect(
      (await readdir(join(paths.outPath, ".."))).some((name) =>
        name.includes(".tmp-"),
      ),
    ).toBe(false);
    expect(measurements.measured).toMatchObject({
      stationCount: 2,
      napStationCount: 1,
      mslStationCount: 1,
      sampleCount: 6,
      eventCount: 4,
    });
    for (const value of [
      measurements.measured.encodedBytes,
      measurements.measured.gzipBytes,
      measurements.measured.bytesPerStation,
      measurements.measured.bytesPerSample,
      measurements.measured.independentStationGzipBytes,
      measurements.measured.buildMilliseconds,
      measurements.measured.lookupMicroseconds,
      measurements.projected.rawBytes,
      measurements.projected.gzipBytes,
    ])
      expect(value).toBeGreaterThan(0);
    expect(measurements.projected.sampleCount).toBe(12);

    const offline = vi.fn(async () => {
      throw new Error("network must not be used");
    }) as unknown as typeof globalThis.fetch;
    const replay = await runRwsPrototype({
      ...options,
      fetch: offline,
      nowMs: options.nowMs + 1,
    });
    expect(offline).not.toHaveBeenCalled();
    expect(await readFile(paths.outPath)).toEqual(bytes);
    expect(replay.measured.encodedBytes).toBe(
      measurements.measured.encodedBytes,
    );
  });

  test("rejects a corrupt cache entry before parsing it", async () => {
    const paths = await prototypePaths();
    const source = rwsFetch();
    const options = {
      ...paths,
      fetch: source.fetch,
      startMs,
      endMs: bounds.endMs,
      targetStartMs: startMs,
      targetEndMs: startMs + 3_600_000,
      nowMs: Date.parse("2026-09-21T12:00:00.000Z"),
    };
    await runRwsPrototype(options);
    const file = join(paths.cacheDir, (await readdir(paths.cacheDir))[0]!);
    const cached = JSON.parse(await readFile(file, "utf8"));
    cached.responseText += " ";
    await writeFile(file, JSON.stringify(cached));
    await expect(runRwsPrototype(options)).rejects.toThrow(/cache.*checksum/);
  });

  test("preserves an existing artifact after a partial HTTP failure", async () => {
    const paths = await prototypePaths();
    await writeFile(paths.outPath, "known-good");
    const source = rwsFetch("nap");
    await expect(
      runRwsPrototype({
        ...paths,
        fetch: source.fetch,
        startMs,
        endMs: bounds.endMs,
        targetStartMs: startMs,
        targetEndMs: startMs + 3_600_000,
        nowMs: Date.parse("2026-09-21T12:00:00.000Z"),
      }),
    ).rejects.toThrow(/HTTP 500/);
    expect(await readFile(paths.outPath, "utf8")).toBe("known-good");
    expect(
      (await readdir(join(paths.outPath, ".."))).some((name) =>
        name.includes(".tmp-"),
      ),
    ).toBe(false);
  });

  test("skips only explicitly audited stations with no interval data", async () => {
    const paths = await prototypePaths();
    const source = rwsFetch("nap", 204);
    const options = {
      ...paths,
      fetch: source.fetch,
      startMs,
      endMs: bounds.endMs,
      targetStartMs: startMs,
      targetEndMs: startMs + 3_600_000,
      nowMs: Date.parse("2026-09-21T12:00:00.000Z"),
    };

    await expect(runRwsPrototype(options)).rejects.toThrow(/HTTP 204/);
    await expect(
      runRwsPrototype({
        ...options,
        expectedCatalogStationCount: 3,
        knownUnavailableCodes: ["nap"],
      }),
    ).rejects.toThrow(/expected 3.*found 2/);
    const measurements = await runRwsPrototype({
      ...options,
      expectedCatalogStationCount: 2,
      knownUnavailableCodes: ["nap"],
    });

    expect(measurements.measured).toMatchObject({
      catalogStationCount: 2,
      stationCount: 1,
      unavailableStationCodes: ["nap"],
    });
    expect(
      openRwsPredictions(await readFile(paths.outPath)).station("rws/nap"),
    ).toBeUndefined();
  });
});
