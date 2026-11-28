import { computeDatums } from "@slackwater/datums";
import { mergeHarmonicDatums } from "../../packages/stations/regenerate-harmonic-datums.ts";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import {
  readArchives,
  writeStations,
  buildStation,
  cachedDownload,
  downloadPinned,
  verifyInventory,
} from "./import.ts";
import { parseInventory, type DmiStation } from "./dmi.ts";
import snapshot from "./validation.json" with { type: "json" };

const station: DmiStation = {
  id: "2988270",
  name: "Tórshavn",
  country: "FRO",
  latitude: 62.008,
  longitude: -6.769,
  lat: -0.279,
  mlws: -0.152,
};
const root = () => mkdtemp(join(tmpdir(), "dmi-test-"));
const sha256 = (bytes: string) =>
  createHash("sha256").update(bytes).digest("hex");

test("streams daily ZIP features across the UTC year boundary and refuses duplicates", async () => {
  const dir = await root();
  try {
    const start = Date.parse("2026-12-31T23:50Z"),
      end = start + 1200000;
    for (let i = 0; i < 2; i++) {
      const feature = {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [station.longitude, station.latitude],
        },
        properties: {
          stationId: station.id,
          predictionType: "10minutes",
          predictionTime: new Date(start + i * 600000).toISOString(),
          value: i === 0 ? 0 : -15.2,
        },
      };
      const name = i === 0 ? "2026-12-31.txt" : "2027-01-01.txt";
      await writeFile(join(dir, name), JSON.stringify(feature) + "\n");
      execFileSync("zip", ["-q", join(dir, `${i}.zip`), name], { cwd: dir });
    }
    const values = await readArchives(
      [join(dir, "0.zip"), join(dir, "1.zip")],
      [station],
      start,
      end,
    );
    expect([...values.get(station.id)!]).toEqual([0, -0.152]);
    await expect(
      readArchives(
        [join(dir, "0.zip"), join(dir, "0.zip")],
        [station],
        start,
        end,
      ),
    ).rejects.toThrow(/duplicate/i);
    await writeFile(join(dir, "broken.zip"), "not a ZIP");
    await expect(
      readArchives([join(dir, "broken.zip")], [station], start, end),
    ).rejects.toThrow(/zip/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("keeps existing records when a refresh is empty or would drop a station", async () => {
  const dir = await root(),
    out = join(dir, "data", "dmi");
  try {
    await mkdir(out, { recursive: true });
    await writeFile(join(out, "old.json"), "original\n");
    await expect(writeStations([], out)).rejects.toThrow(/empty/i);
    const data = buildStation(
      station,
      [{ name: "M2", amplitude: 0.1, phase: 15 }],
      0,
      { note: "NOTE: dry out at low waters" },
    );
    await expect(writeStations([data], out)).rejects.toThrow(/drop/i);
    expect(await readFile(join(out, "old.json"), "utf8")).toBe("original\n");
    expect(await readdir(out)).toEqual(["old.json"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writes derived harmonics with source credit, source LAT and a representable fitted offset", async () => {
  const data = buildStation(
    station,
    [{ name: "M2", amplitude: 0.1, phase: 15 }],
    -0.002,
    { note: "NOTE: dry out at low waters" },
  );
  expect(data).toMatchObject({
    country: "Faroe Islands",
    timezone: "Atlantic/Faroe",
    chart_datum: "LAT",
    source: {
      name: "Danish Meteorological Institute",
      id: "2988270",
      published_harmonics: false,
    },
    license: { type: "cc-by-4.0", commercial_use: true },
    datums: { LAT: -0.279, MLWS: -0.152, MSL: 0 },
    datums_source: "harmonic",
  });
  const unshifted = buildStation(
    station,
    [{ name: "M2", amplitude: 0.1, phase: 15 }],
    0,
    { note: "" },
  );
  expect(data.datums["MHW"]! - unshifted.datums["MHW"]!).toBeCloseTo(-0.002, 6);
  expect(
    mergeHarmonicDatums(
      "dmi",
      data,
      computeDatums(data.harmonic_constituents).datums,
    ),
  ).toEqual(data.datums);
  expect(data.epoch).toBeUndefined();
  expect(data.harmonic_constituents).toContainEqual({
    name: "Zo",
    amplitude: 0.002,
    phase: 180,
  });
  expect(data.disclaimers).toContain("dry out");
  expect(data.disclaimers).toContain("2027-01-05 through 2027-12-30 UTC");
  const dir = await root();
  try {
    const out = join(dir, "data", "dmi");
    await writeStations([data], out);
    expect((await stat(out)).mode & 0o777).toBe(0o755);
    expect(
      JSON.parse(await readFile(join(out, "2988270.json"), "utf8")),
    ).toEqual(data);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a crash lock outside data refuses a second import without becoming a source", async () => {
  const dir = await root(),
    out = join(dir, "data", "dmi"),
    lock = join(dir, ".dmi-import.lock");
  const data = buildStation(
    station,
    [{ name: "M2", amplitude: 0.1, phase: 15 }],
    0,
    { note: "" },
  );
  try {
    await mkdir(out, { recursive: true });
    await writeFile(join(out, "2988270.json"), "original\n");
    await mkdir(lock);
    await expect(writeStations([data], out)).rejects.toThrow(/EEXIST/);
    expect(await readdir(join(dir, "data"))).toEqual(["dmi"]);
    expect(await readFile(join(out, "2988270.json"), "utf8")).toBe(
      "original\n",
    );
    expect((await stat(lock)).isDirectory()).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("publishes a synthesized HAT only when the fit contains an annual constituent", () => {
  const make = (amplitude: number) =>
    buildStation(
      station,
      [
        { name: "M2", amplitude: 0.1, phase: 15 },
        { name: "Sa", amplitude, phase: 0 },
      ],
      0,
      { note: "" },
    );
  expect(make(0).datums["HAT"]).toBeUndefined();
  expect(make(0).datums["LAT"]).toBe(station.lat);
  const seasonal = make(0.001);
  expect(seasonal.datums["HAT"]).toBe(
    computeDatums(seasonal.harmonic_constituents).datums["HAT"],
  );
});

test("rejects corrupt cached downloads instead of silently using them", async () => {
  const dir = await root(),
    path = join(dir, "year.zip");
  try {
    await writeFile(path, "corrupt");
    await writeFile(
      `${path}.json`,
      JSON.stringify({
        url: "https://example.test/year.zip",
        sha256: "invalid",
      }),
    );
    await expect(
      cachedDownload("https://example.test/year.zip", path, sha256("original")),
    ).rejects.toThrow(/checksum/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rejects a coherent cache from a different snapshot", async () => {
  const dir = await root(),
    path = join(dir, "year.zip"),
    url = "https://example.test/year.zip";
  try {
    await writeFile(path, "revised upstream data");
    await writeFile(
      `${path}.json`,
      JSON.stringify({ url, sha256: sha256("revised upstream data") }),
    );
    await expect(cachedDownload(url, path, sha256("original"))).rejects.toThrow(
      /pinned.*checksum/i,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("checks fresh downloads against the committed hash before caching them", async () => {
  const dir = await root(),
    path = join(dir, "year.zip"),
    url = "https://example.test/year.zip",
    fetch = vi.spyOn(globalThis, "fetch");
  try {
    fetch.mockResolvedValueOnce(new Response("revised upstream data"));
    await expect(cachedDownload(url, path, sha256("original"))).rejects.toThrow(
      /pinned.*checksum/i,
    );
    expect(await readdir(dir)).toEqual([]);
    fetch.mockResolvedValueOnce(new Response("original"));
    await expect(cachedDownload(url, path, sha256("original"))).resolves.toBe(
      path,
    );
    expect(await readFile(path, "utf8")).toBe("original");
    expect(JSON.parse(await readFile(`${path}.json`, "utf8"))).toEqual({
      url,
      sha256: sha256("original"),
    });
    await expect(cachedDownload(url, path, sha256("original"))).resolves.toBe(
      path,
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally {
    fetch.mockRestore();
    await rm(dir, { recursive: true, force: true });
  }
});

test("the importer enforces every committed archive identity and refuses unrecorded URLs", async () => {
  const dir = await root(),
    fetch = vi.spyOn(globalThis, "fetch");
  try {
    for (const input of snapshot.inputs) {
      fetch.mockResolvedValueOnce(new Response("different snapshot"));
      await expect(
        downloadPinned(input.url, join(dir, "input")),
      ).rejects.toThrow(/pinned.*checksum/i);
    }
    expect(await readdir(dir)).toEqual([]);
    expect(() =>
      downloadPinned(
        "https://example.test/unrecorded-page",
        join(dir, "input"),
      ),
    ).toThrow(/unpinned.*URL/i);
    expect(fetch).toHaveBeenCalledTimes(snapshot.inputs.length);
  } finally {
    fetch.mockRestore();
    await rm(dir, { recursive: true, force: true });
  }
});

test("pins every imported inventory field without depending on object property order", () => {
  const expected =
    "88bab0c77fb9a2e6e43bf1a91f11673129dd595168d225b5b9385cbad73f8ece";
  expect(verifyInventory([station], expected)).toBe(expected);
  const { mlws, ...rest } = station;
  expect(verifyInventory([{ mlws, ...rest }], expected)).toBe(expected);
  for (const changed of [
    { ...station, id: "2988271" },
    { ...station, name: "Revised name" },
    { ...station, country: "GRL" as const },
    { ...station, latitude: 62.009 },
    { ...station, longitude: -6.77 },
    { ...station, lat: -0.28 },
    { ...station, mlws: -0.153 },
  ]) {
    expect(() => verifyInventory([changed], expected)).toThrow(
      /pinned.*inventory.*checksum/i,
    );
  }
  expect(() => verifyInventory([], expected)).toThrow(/checksum/i);
  expect(() => verifyInventory([station, station], expected)).toThrow(
    /checksum/i,
  );
});

test("inventory request timestamps do not change its pinned station content", () => {
  const page = {
    type: "FeatureCollection",
    numberReturned: 1,
    features: [
      {
        geometry: {
          type: "Point",
          coordinates: [station.longitude, station.latitude],
        },
        properties: {
          stationId: station.id,
          name: station.name,
          country: station.country,
          lowAstronomicalTide: -27.9,
          meanLowWaterSpring: -15.2,
        },
      },
    ],
  };
  const expected =
    "88bab0c77fb9a2e6e43bf1a91f11673129dd595168d225b5b9385cbad73f8ece";
  for (const timeStamp of ["2026-10-20T05:21:58Z", "2026-10-20T13:48:00Z"])
    expect(
      verifyInventory(parseInventory({ ...page, timeStamp }), expected),
    ).toBe(expected);
});
