import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { astro, constituents } from "@neaps/tide-predictor";
import { expect, test } from "vitest";
import {
  eventMetrics,
  parseEvents,
  parseHeightChunks,
  readCachedJson,
  selectExtraConstituents,
  spreadSample,
  trainingSamplesBefore,
  validationGates,
} from "./harmonics.js";

function heightResponse(
  times: string[],
  values: number[],
  datum: "NAP" | "MSL",
) {
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
        Locatie: { Code: "nap" },
        MetingenLijst: times.map((Tijdstip, index) => ({
          Tijdstip,
          Meetwaarde: { Waarde_Numeriek: values[index] },
          WaarnemingMetadata: { Kwaliteitswaardecode: "00" },
        })),
      },
    ],
  };
}

function eventResponse(
  typeTimes: string[],
  heightTimes: string[],
  datum: "NAP" | "MSL",
  grouping: string,
) {
  const metadata = (type: boolean) => ({
    Eenheid: { Code: type ? "DIMSLS" : "cm" },
    Groepering: { Code: grouping },
    Grootheid: { Code: type ? "NVT" : "WATHTE" },
    Hoedanigheid: { Code: type ? "NVT" : datum },
    ProcesType: "astronomisch",
    Typering: { Code: type ? "GETETTPE" : "NVT" },
  });
  return {
    Succesvol: true,
    WaarnemingenLijst: [
      {
        AquoMetadata: metadata(true),
        Locatie: { Code: "nap" },
        MetingenLijst: typeTimes.map((Tijdstip, index) => ({
          Tijdstip,
          Meetwaarde: {
            Waarde_Alfanumeriek: index % 2 ? "laagwater" : "hoogwater",
          },
          WaarnemingMetadata: { Kwaliteitswaardecode: "00" },
        })),
      },
      {
        AquoMetadata: metadata(false),
        Locatie: { Code: "nap" },
        MetingenLijst: heightTimes.map((Tijdstip, index) => ({
          Tijdstip,
          Meetwaarde: { Waarde_Numeriek: index % 2 ? -30 : 90 },
          WaarnemingMetadata: { Kwaliteitswaardecode: "00" },
        })),
      },
    ],
  };
}

function excludeOtherSpeeds(...speeds: number[]) {
  return [
    ...new Map(
      Object.values(constituents).map((model) => [model.name, model]),
    ).values(),
  ]
    .filter((model) => !speeds.includes(model.speed))
    .map(({ name }) => name);
}

test("spread sampling and residual ranking are deterministic", () => {
  const screenSamples = Array.from({ length: 400 }, (_, index) => ({
    t: Date.UTC(2020, 0, 1) + index * 3_600_000,
    level: 0,
  }));
  const residuals = screenSamples.map(({ t }) => {
    const astronomy = astro(new Date(t));
    return [
      ["M2", 1],
      ["S2", 0.5],
    ].reduce((level, [name, amplitude]) => {
      const model = constituents[String(name)]!;
      const { f, u } = model.correction(astronomy);
      return (
        level +
        Number(amplitude) *
          f *
          Math.cos((model.value(astronomy) + u) * (Math.PI / 180))
      );
    }, 0);
  });
  expect(spreadSample([...Array(20).keys()], 5, 3)).toEqual([3, 4, 9, 14, 19]);
  const selected = selectExtraConstituents(
    screenSamples,
    residuals,
    excludeOtherSpeeds(constituents["M2"]!.speed, constituents["S2"]!.speed),
    2,
  );
  expect(selected.map((name) => constituents[name]!.speed)).toEqual([
    constituents["M2"]!.speed,
    constituents["S2"]!.speed,
  ]);
});

test("training selections exclude the validation boundary", () => {
  const validationStart = Date.parse("2025-01-01T00:00:00Z");
  const samples = [
    { t: validationStart - 600_000, level: 1 },
    { t: validationStart, level: 2 },
  ];

  expect(trainingSamplesBefore(samples, validationStart)).toEqual([samples[0]]);
});

test("selects at most one extra constituent per exact speed", () => {
  const samples = Array.from({ length: 400 }, (_, index) => ({
    t: Date.UTC(2020, 0, 1) + index * 3_600_000,
    level: 0,
  }));
  const residuals = samples.map(({ t }) => {
    const astronomy = astro(new Date(t));
    return [
      ["2MK2", 1],
      ["M2", 0.5],
    ].reduce((level, [name, amplitude]) => {
      const model = constituents[String(name)]!;
      const { f, u } = model.correction(astronomy);
      return (
        level +
        Number(amplitude) *
          f *
          Math.cos((model.value(astronomy) + u) * (Math.PI / 180))
      );
    }, 0);
  });
  const selected = selectExtraConstituents(
    samples,
    residuals,
    excludeOtherSpeeds(constituents["2MK2"]!.speed, constituents["M2"]!.speed),
    2,
  );
  expect(selected.map((name) => constituents[name]!.speed)).toEqual([
    constituents["2MK2"]!.speed,
    constituents["M2"]!.speed,
  ]);
});

const bounds = {
  startMs: Date.parse("2026-07-01T00:00:00Z"),
  endMs: Date.parse("2026-07-01T00:30:00Z"),
};
const matchingBoundary = [
  heightResponse(
    [
      "2026-07-01T01:00:00+01:00",
      "2026-07-01T01:10:00+01:00",
      "2026-07-01T01:20:00+01:00",
    ],
    [0, 1, 2],
    "NAP",
  ),
  heightResponse(
    ["2026-07-01T01:20:00+01:00", "2026-07-01T01:30:00+01:00"],
    [2, 3],
    "NAP",
  ),
];
const conflictingBoundary = structuredClone(matchingBoundary);
conflictingBoundary[1]!.WaarnemingenLijst[0]!.MetingenLijst[0]!.Meetwaarde.Waarde_Numeriek = 9;
const noOffset = structuredClone(matchingBoundary);
noOffset[0]!.WaarnemingenLijst[0]!.MetingenLijst[0]!.Tijdstip =
  "2026-07-01T00:00:00";

test("requires offsets and accepts only identical chunk boundaries", () => {
  expect(() => parseHeightChunks("nap", "NAP", noOffset, bounds)).toThrow(
    /explicit offset/,
  );
  expect(
    parseHeightChunks("nap", "NAP", matchingBoundary, bounds),
  ).toHaveLength(4);
  expect(() =>
    parseHeightChunks("nap", "NAP", conflictingBoundary, bounds),
  ).toThrow(/conflicting duplicate timestamp/);
});

test("sorts height measurements within each response chunk", () => {
  const response = heightResponse(
    [
      "2026-07-01T00:00:00Z",
      "2026-07-01T00:20:00Z",
      "2026-07-01T00:10:00Z",
      "2026-07-01T00:30:00Z",
    ],
    [0, 2, 1, 3],
    "NAP",
  );

  expect(parseHeightChunks("nap", "NAP", [response], bounds)).toEqual([
    { t: bounds.startMs, level: 0 },
    { t: bounds.startMs + 600_000, level: 0.01 },
    { t: bounds.startMs + 1_200_000, level: 0.02 },
    { t: bounds.endMs, level: 0.03 },
  ]);
});

test("rejects changed datum, cadence, and non-finite heights", () => {
  const mslResponse = structuredClone(matchingBoundary);
  mslResponse[0]!.WaarnemingenLijst[0]!.AquoMetadata.Hoedanigheid.Code = "MSL";
  const fiveMinute = structuredClone(matchingBoundary);
  fiveMinute[0]!.WaarnemingenLijst[0]!.MetingenLijst[1]!.Tijdstip =
    "2026-07-01T01:05:00+01:00";
  const nonFinite = structuredClone(matchingBoundary);
  nonFinite[0]!.WaarnemingenLijst[0]!.MetingenLijst[0]!.Meetwaarde.Waarde_Numeriek =
    Number.NaN;
  expect(() => parseHeightChunks("nap", "NAP", mslResponse, bounds)).toThrow(
    /datum.*NAP/,
  );
  expect(() => parseHeightChunks("nap", "NAP", fiveMinute, bounds)).toThrow(
    /cadence.*600/,
  );
  expect(() => parseHeightChunks("nap", "NAP", nonFinite, bounds)).toThrow(
    /finite/,
  );
});

test("requires paired event channels and explicit offsets", () => {
  const valid = eventResponse(
    ["2026-07-01T01:05:00+01:00"],
    ["2026-07-01T01:05:00+01:00"],
    "NAP",
    "GETETBRKD2",
  );
  const unequal = structuredClone(valid);
  const unequalHeights = unequal.WaarnemingenLijst[1]!.MetingenLijst as Array<{
    Tijdstip: string;
    Meetwaarde: {
      Waarde_Alfanumeriek?: string;
      Waarde_Numeriek?: number;
    };
  }>;
  unequalHeights.push(structuredClone(unequalHeights[0]!));
  const misaligned = structuredClone(valid);
  misaligned.WaarnemingenLijst[1]!.MetingenLijst[0]!.Tijdstip =
    "2026-07-01T01:06:00+01:00";
  const noOffsetEvent = structuredClone(valid);
  noOffsetEvent.WaarnemingenLijst[0]!.MetingenLijst[0]!.Tijdstip =
    "2026-07-01T00:05:00";
  expect(() =>
    parseEvents("nap", "NAP", "GETETBRKD2", unequal, bounds),
  ).toThrow(/lengths.*match/);
  expect(() =>
    parseEvents("nap", "NAP", "GETETBRKD2", misaligned, bounds),
  ).toThrow(/timestamps.*pair/);
  expect(() =>
    parseEvents("nap", "NAP", "GETETBRKD2", noOffsetEvent, bounds),
  ).toThrow(/explicit offset/);
});

test("requires quality 00 in both event channels", () => {
  const valid = eventResponse(
    ["2026-07-01T00:05:00Z"],
    ["2026-07-01T00:05:00Z"],
    "NAP",
    "GETETBRKD2",
  );

  for (const channel of valid.WaarnemingenLijst) {
    const quality99 = structuredClone(valid);
    quality99.WaarnemingenLijst[
      valid.WaarnemingenLijst.indexOf(channel)
    ]!.MetingenLijst[0]!.WaarnemingMetadata.Kwaliteitswaardecode = "99";
    expect(() =>
      parseEvents("nap", "NAP", "GETETBRKD2", quality99, bounds),
    ).toThrow(/quality.*00/);
  }
});

test("rejects duplicate event timestamps", () => {
  const duplicate = eventResponse(
    ["2026-07-01T00:05:00Z", "2026-07-01T00:05:00Z"],
    ["2026-07-01T00:05:00Z", "2026-07-01T00:05:00Z"],
    "NAP",
    "GETETBRKD2",
  );

  expect(() =>
    parseEvents("nap", "NAP", "GETETBRKD2", duplicate, bounds),
  ).toThrow(/duplicate event timestamp/);
});

test("rejects invalid event type values", () => {
  const invalid = eventResponse(
    ["2026-07-01T00:05:00Z"],
    ["2026-07-01T00:05:00Z"],
    "NAP",
    "GETETBRKD2",
  );
  invalid.WaarnemingenLijst[0]!.MetingenLijst[0]!.Meetwaarde.Waarde_Alfanumeriek =
    "NVT";

  expect(() =>
    parseEvents("nap", "NAP", "GETETBRKD2", invalid, bounds),
  ).toThrow(/event type.*invalid/);
});

test("rejects corrupt or mismatched cache entries", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rws-cache-test-"));
  const cachePath = join(directory, "entry.json");
  const url = "https://example.test/rws";
  const body = { Locatie: { Code: "nap" } };
  const responseText = "{}";
  const valid = {
    url,
    body,
    status: 200,
    responseText,
    sha256: createHash("sha256").update(responseText).digest("hex"),
  };
  await writeFile(cachePath, JSON.stringify({ ...valid, sha256: "bad" }));
  await expect(readCachedJson(cachePath, url, body)).rejects.toThrow(
    /cache.*checksum/,
  );
  await writeFile(
    cachePath,
    JSON.stringify({ ...valid, body: { Locatie: { Code: "other" } } }),
  );
  await expect(readCachedJson(cachePath, url, body)).rejects.toThrow(
    /cache.*request/,
  );
  expect(await readFile(cachePath, "utf8")).toContain("other");
  await rm(directory, { recursive: true, force: true });
});

test("applies height and event gates independently", () => {
  const gates = validationGates({ rms: 0.018, p95: 0.035, max: 0.09 }, 0.004, {
    provider: 100,
    predicted: 130,
    matched: 94,
    meanMinutes: 4,
    maxMinutes: 14,
  });
  expect(gates).toEqual({
    height: true,
    events: false,
    publishable: false,
  });
});

test("matches the nearest unused event of the same type within 60 minutes", () => {
  const minute = 60_000;
  const events = eventMetrics(
    [
      { t: 0, type: "hoogwater", level: 0 },
      { t: 10 * minute, type: "hoogwater", level: 0 },
      { t: 120 * minute, type: "laagwater", level: 0 },
      { t: 300 * minute, type: "laagwater", level: 0 },
    ],
    [
      { t: 0, type: "laagwater", level: 0 },
      { t: 50 * minute, type: "hoogwater", level: 0 },
      { t: 4 * minute, type: "hoogwater", level: 0 },
      { t: 180 * minute, type: "laagwater", level: 0 },
      { t: 361 * minute, type: "laagwater", level: 0 },
    ],
  );
  expect(events).toEqual({
    provider: 4,
    predicted: 5,
    matched: 3,
    meanMinutes: 104 / 3,
    maxMinutes: 60,
  });
});
