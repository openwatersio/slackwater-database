import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "vitest";
import type { StationData } from "@slackwater/database";
import { computeDatums } from "@slackwater/datums";
import { buildStation } from "../../../sources/linz/linz.ts";
import {
  CONSTITUENT_FRAME_NOTICE,
  HARMONIC_DATUM_NOTICE,
  OBSERVED_DATUM_NOTICE,
  OBSERVED_OFFSET_NOTICE,
  HARMONIC_REDUCTION_NOTICE,
} from "../../../sources/ticon/datums.ts";
import {
  mergeHarmonicDatums,
  parseShard,
  regenerateDirectory,
} from "../regenerate-harmonic-datums.ts";

type Overrides = { [K in keyof StationData]?: StationData[K] | undefined };
const station = (overrides: Overrides = {}): StationData => {
  const value: StationData = {
    name: "Test gauge",
    country: "Canada",
    continent: "North America",
    timezone: "UTC",
    latitude: 49,
    longitude: -123,
    type: "reference",
    chart_datum: "LLWLT",
    source: {
      name: "Test",
      id: "test",
      url: "https://example.com",
      published_harmonics: true,
    },
    harmonic_constituents: [{ name: "M2", amplitude: 1, phase: 0 }],
    datums: { MSL: 2.1234, MHHW: 3.7, MHW: 3.5, MTL: 2.2, MLW: 0.8, MLLW: 0.6 },
    datums_source: "observed",
    datum_frame: "gauge",
    datum_epoch: { start: "2023-01-01", end: "2023-12-31" },
    datum_coverage: { months: 12, observed_hours: 8760, inferred_hours: 0 },
    disclaimers: OBSERVED_DATUM_NOTICE,
    license: { type: "cc-by-4.0", commercial_use: true, url: "" },
  };
  Object.assign(value, overrides);
  return value;
};

const computed = {
  MSL: 0,
  MHHW: 1.4,
  MHW: 1.2,
  MTL: 0.1,
  MLW: -1.1,
  MLLW: -1.3,
  LAT: -2.3456,
  HAT: 2.4567,
  MHWS: 1.5,
  MLWS: -1.5,
  LLWLT: -2.1,
  NLLW: -1.9,
  ALLW: -1.9,
  TLT: -2,
};

describe("stored harmonic datum ownership", () => {
  test("keeps observed TICON means and lifts only harmonic datums into the stored gauge frame", () => {
    const input = station();
    const original = structuredClone(input);
    expect(mergeHarmonicDatums("ticon", input, computed)).toEqual({
      MSL: 2.1234,
      MHHW: 3.7,
      MHW: 3.5,
      MTL: 2.2,
      MLW: 0.8,
      MLLW: 0.6,
      LAT: -0.222,
      HAT: 4.58,
      MHWS: 3.623,
      MLWS: 0.623,
      LLWLT: 0.023,
    });
    expect(input).toEqual(original);
  });

  test.each([
    ["gauge", 2.1234, OBSERVED_OFFSET_NOTICE, 3.323, 0.823],
    ["constituent", 0, CONSTITUENT_FRAME_NOTICE, 1.2, -1.3],
  ] as const)(
    "recomputes TICON fallback means in the %s frame",
    (frame, msl, notice, mhw, mllw) => {
      const input = station({
        datums_source: "harmonic",
        datum_frame: frame,
        datum_epoch: undefined,
        datum_coverage: undefined,
        datums: { MSL: msl, MHW: 99 },
        disclaimers: `${HARMONIC_DATUM_NOTICE} ${notice}`,
      });
      const result = mergeHarmonicDatums("ticon", input, computed);
      expect(result["MSL"]).toBe(msl);
      expect(result["MHW"]).toBe(mhw);
      expect(result["MLLW"]).toBe(mllw);
    },
  );

  test("preserves DMI provider LAT, MLWS and MSL and removes unsupported HAT", () => {
    const input = station({
      country: "Denmark",
      datums_source: "harmonic",
      datums: { MSL: 0, LAT: -0.279, MLWS: -0.152, HAT: 99 },
    });
    expect(mergeHarmonicDatums("dmi", input, computed)).toEqual({
      MSL: 0,
      MHHW: 1.4,
      MHW: 1.2,
      MTL: 0.1,
      MLW: -1.1,
      MLLW: -1.3,
      LAT: -0.279,
      MHWS: 1.5,
      MLWS: -0.152,
    });
    input.harmonic_constituents.push({
      name: "SSA",
      amplitude: 0.001,
      phase: 0,
    });
    expect(mergeHarmonicDatums("dmi", input, computed)["HAT"]).toBe(2.457);
  });

  test.each([
    ["linz", "New Zealand", "CD"],
    ["jhod", "Japan", "NLLW"],
  ] as const)(
    "keeps %s publisher zero and exact Z0 while shifting synthesized means",
    (source, country, zero) => {
      const input = station({ country, datums: { MSL: 1.2345, [zero]: 0 } });
      const result = mergeHarmonicDatums(source, input, computed);
      expect(result["MSL"]).toBe(1.2345);
      expect(result[zero]).toBe(0);
      expect(result["LAT"]).toBe(-1.111);
      expect(result["MHW"]).toBe(2.435);
      expect(result["LLWLT"]).toBeUndefined();
      expect(result["ALLW"]).toBeUndefined();
    },
  );

  test.each([0.848195, 1.342423])(
    "matches the LINZ importer with raw Z0 %s and stored millimetre MSL",
    (z0) => {
      const constituents = [
        { name: "M2", amplitude: 1, phase: 0 },
        { name: "SA", amplitude: 0.05, phase: 0 },
      ];
      const imported = buildStation({
        id: "043",
        name: "Picton",
        latitude: -41.28,
        longitude: 174.01,
        epoch: { start: "2005-05-01", end: "2025-12-31" },
        z0,
        constituents,
      });
      expect(
        mergeHarmonicDatums(
          "linz",
          imported,
          computeDatums(constituents, {}).datums,
        ),
      ).toEqual(imported.datums);
    },
  );

  test.each([
    { datums: {} },
    { datums: { MSL: NaN } },
    { datum_frame: undefined },
    { datums_source: undefined },
    { disclaimers: "legacy reduction" },
    { datum_coverage: undefined },
    { datums: { MSL: 1 } },
    {
      datums_source: "harmonic" as const,
      datum_frame: "constituent" as const,
      datums: { MSL: 1 },
      datum_epoch: undefined,
      datum_coverage: undefined,
      disclaimers: `${HARMONIC_DATUM_NOTICE} ${CONSTITUENT_FRAME_NOTICE}`,
    },
    { disclaimers: `${OBSERVED_DATUM_NOTICE} ${CONSTITUENT_FRAME_NOTICE}` },
  ])("refuses ambiguous or incomplete TICON metadata %j", (override) => {
    expect(() =>
      mergeHarmonicDatums("ticon", station(override), computed),
    ).toThrow();
  });
});

test("validates shard boundaries", () => {
  expect(parseShard(undefined)).toEqual([0, 1]);
  expect(parseShard("1/3")).toEqual([1, 3]);
  for (const invalid of [
    "",
    "-1/3",
    "3/3",
    "0/0",
    "1.5/3",
    "0/2extra",
    "0/9007199254740992",
  ])
    expect(() => parseShard(invalid)).toThrow();
});

test("regenerates selected sorted files only, preserving other fields and unchanged bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "harmonic-datums-"));
  try {
    for (const source of ["dmi", "jhod", "jma", "linz", "ticon"])
      await mkdir(join(root, source));
    const input = station({
      country: "New Zealand",
      datums: { MSL: 1.2345, CD: 0 },
    });
    const text = JSON.stringify(input, null, 2) + "\n";
    await writeFile(join(root, "linz", "b.json"), text);
    await writeFile(join(root, "linz", "a.json"), text);
    expect(await regenerateDirectory(root, [0, 2])).toBe(1);
    expect(await readFile(join(root, "linz", "b.json"), "utf8")).toBe(text);
    const afterText = await readFile(join(root, "linz", "a.json"), "utf8");
    const after = JSON.parse(afterText) as StationData;
    expect({ ...after, datums: input.datums }).toEqual(input);
    expect(after.datums["MSL"]).toBe(1.2345);
    expect(after.datums["CD"]).toBe(0);
    const beforeTime = (await stat(join(root, "linz", "a.json"))).mtimeMs;
    expect(await regenerateDirectory(root, [0, 2])).toBe(0);
    expect(await readFile(join(root, "linz", "a.json"), "utf8")).toBe(
      afterText,
    );
    expect((await stat(join(root, "linz", "a.json"))).mtimeMs).toBe(beforeTime);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("marks migrated TICON reductions once while leaving NOAA and observation provenance untouched", async () => {
  const root = await mkdtemp(join(tmpdir(), "harmonic-provenance-"));
  try {
    for (const source of ["dmi", "jhod", "jma", "linz", "ticon", "noaa"])
      await mkdir(join(root, source));
    const input = station({
      disclaimers: `Provider legal notice. ${OBSERVED_DATUM_NOTICE}`,
    });
    await writeFile(join(root, "ticon", "a.json"), JSON.stringify(input));
    await writeFile(
      join(root, "noaa", "a.json"),
      "NOAA must never be read or rewritten",
    );
    expect(await regenerateDirectory(root)).toBe(1);
    const result = JSON.parse(
      await readFile(join(root, "ticon", "a.json"), "utf8"),
    ) as StationData;
    expect(result.disclaimers).toBe(
      `Provider legal notice. ${OBSERVED_DATUM_NOTICE} ${HARMONIC_REDUCTION_NOTICE}`,
    );
    expect({
      ...result,
      datums: input.datums,
      disclaimers: input.disclaimers,
    }).toEqual(input);
    expect(result.datums["MSL"]).toBe(2.1234);
    expect(result.datums["MHW"]).toBe(3.5);
    expect(await regenerateDirectory(root)).toBe(0);
    expect(await readFile(join(root, "noaa", "a.json"), "utf8")).toBe(
      "NOAA must never be read or rewritten",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("regenerates JMA's derived NLLW and preserves MSL zero", async () => {
  const root = await mkdtemp(join(tmpdir(), "jma-datums-"));
  try {
    for (const source of ["dmi", "jhod", "jma", "linz", "ticon"])
      await mkdir(join(root, source));
    const input = station({
      country: "Japan",
      chart_datum: "CD",
      datums_source: "harmonic",
      datums: { MSL: 0, CD: -0.18, NLLW: 99 },
    });
    await writeFile(join(root, "jma", "test.json"), JSON.stringify(input));
    expect(await regenerateDirectory(root)).toBe(1);
    const output = JSON.parse(
      await readFile(join(root, "jma", "test.json"), "utf8"),
    );
    expect(output.datums.MSL).toBe(0);
    expect(output.datums.NLLW).toBe(-1);
    expect(output.chart_datum).toBe("CD");
    expect(output.datums.CD).toBe(-0.18);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("keeps a water-levels lake fit's observed means, as TICON's", async () => {
  const root = await mkdtemp(join(tmpdir(), "smhi-datums-"));
  try {
    for (const source of ["dmi", "jhod", "jma", "linz", "smhi", "ticon"])
      await mkdir(join(root, source));
    const input = station({
      disclaimers: `${OBSERVED_DATUM_NOTICE} ${HARMONIC_REDUCTION_NOTICE}`,
    });
    await writeFile(join(root, "smhi", "2130.json"), JSON.stringify(input));
    await regenerateDirectory(root);
    const result = JSON.parse(
      await readFile(join(root, "smhi", "2130.json"), "utf8"),
    ) as StationData;
    expect(result.datums["MSL"]).toBe(2.1234);
    expect(result.datums["MHW"]).toBe(3.5);
    expect(result.datums["HAT"]).toBeDefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
