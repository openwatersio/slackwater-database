import { afterEach, describe, expect, test, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import { loadStations } from "../src/load-stations.js";
import { qualityFilter } from "../src/stations.js";
import { buildDatabase } from "../src/database/builder.js";
import { Station as StationTable } from "../src/generated/fbs/slackwater.ts";
import type { StationInput } from "../src/types.js";

const credits = new Map([["Test", null]]);
function station(id: string, name = id): StationInput {
  return {
    id,
    name,
    latitude: 0,
    longitude: 0,
    country: "Canada",
    country_code: "CA",
    region_code: "CA-BC",
    timezone: "Etc/UTC",
    continent: "Americas",
    type: "reference",
    source: {
      name: "Test",
      id,
      published_harmonics: true,
      url: "https://example.com",
    },
    license: {
      type: "public domain",
      commercial_use: true,
      url: "https://example.com",
    },
    harmonic_constituents: [{ name: "M2", amplitude: 1, phase: 20 }],
    chart_datum: "MLLW",
    datums: { MLLW: 0, MSL: 1, LAT: -1, HAT: 3 },
  };
}
const build = (records: StationInput[]) => buildDatabase(records, { credits });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("station loading", () => {
  test("loading reads no identities or predictions; an ID lookup decodes only its station", async () => {
    const bytes = build(
      Array.from({ length: 256 }, (_, i) =>
        station(`test/${String(i).padStart(3, "0")}`),
      ),
    );
    const name = vi.spyOn(StationTable.prototype, "name");
    const constituents = vi.spyOn(StationTable.prototype, "constituents");
    const datums = vi.spyOn(StationTable.prototype, "datums");
    const id = vi.spyOn(StationTable.prototype, "id");
    const db = await loadStations(bytes);
    expect(name).not.toHaveBeenCalled();
    expect(id).not.toHaveBeenCalled();

    const selected = db.byId("test/000")!;
    expect(selected.id).toBe("test/000");
    expect(name).toHaveBeenCalledTimes(1);
    expect(id.mock.calls.length).toBeLessThanOrEqual(10);
    expect(constituents).not.toHaveBeenCalled();
    expect(datums).not.toHaveBeenCalled();
    id.mockClear();
    expect(db.byId(selected.id)).toBe(selected);
    expect(id).not.toHaveBeenCalled();
    expect(name).toHaveBeenCalledTimes(1);
    for (const missing of ["", "test/000a", "test/999"])
      expect(db.byId(missing)).toBeUndefined();
  });

  test("collections reuse identities and are memoized; predictions remain uncached", async () => {
    const db = await loadStations(
      build([
        station("test/a"),
        {
          ...station("test/b"),
          quality: {
            id: "test/b",
            accepted: false,
            score: 0,
            reason: "duplicate",
          },
        },
      ]),
    );
    const first = db.byId("test/a")!;
    const name = vi.spyOn(StationTable.prototype, "name");
    expect(db.accepted).toEqual([first]);
    expect(name).not.toHaveBeenCalled();
    const all = db.all;
    expect(all).toHaveLength(2);
    expect(name).toHaveBeenCalledTimes(1);
    expect(all[0]).toBe(first);
    expect(db.byId("test/b")).toBe(all[1]);
    expect(db.all).toBe(all);
    expect(db.accepted).toBe(db.accepted);
    expect(db.qualityMap).toBe(db.qualityMap);
    expect(db.qualityMap.get("test/b")).toBe(all[1]!.quality);
    expect(qualityFilter(all[1]!)).toBe(false);
    expect(db.datums).toContain("MLLW");
    expect(first.harmonic_constituents).toEqual(first.harmonic_constituents);
    expect(first.harmonic_constituents).not.toBe(first.harmonic_constituents);
  });

  test("a subordinate resolves prediction data without decoding its reference identity", async () => {
    const db = await loadStations(
      build([
        {
          ...station("test/a"),
          type: "subordinate",
          harmonic_constituents: [],
          datums: {},
          offsets: {
            reference: "test/z",
            time: { high: 0, low: 0 },
            height: { type: "ratio", high: 2, low: 2 },
          },
        },
        station("test/z"),
      ]),
    );
    const name = vi.spyOn(StationTable.prototype, "name");
    const sub = db.byId("test/a")!;
    expect(sub.harmonic_constituents[0]!.name).toBe("M2");
    expect(sub.datums["MSL"]).toBe(1);
    expect(sub.astronomical_bounds).toEqual({ lat: -2, hat: 6 });
    expect(name).toHaveBeenCalledTimes(1);
  });

  test("a subordinate whose reference was filtered out reads its stored data", async () => {
    const reference = await loadStations(
      build([
        {
          ...station("test/a"),
          type: "subordinate",
          chart_datum: "MLLW",
          harmonic_constituents: [],
          datums: {},
          offsets: {
            reference: "test/z",
            time: { high: 0, low: 0 },
            height: { type: "ratio", high: 2, low: 2 },
          },
        },
        station("test/z"),
      ]),
    );
    const sub = reference.byId("test/a")!;
    const rebuilt = (await loadStations(build([sub]))).byId("test/a")!;
    expect(rebuilt.harmonic_constituents).toEqual(sub.harmonic_constituents);
    expect(rebuilt.datums).toEqual(sub.datums);
    expect(rebuilt.astronomical_bounds).toEqual({ lat: -2, hat: 6 });
  });

  test("a subordinate with no reference and no stored data throws", async () => {
    const db = await loadStations(
      build([
        {
          ...station("test/a"),
          type: "subordinate",
          harmonic_constituents: [],
          datums: {},
          offsets: {
            reference: "test/z",
            time: { high: 0, low: 0 },
            height: { type: "ratio", high: 1, low: 1 },
          },
        },
      ]),
    );
    expect(() => db.byId("test/a")!.datums).toThrow(/test\/z/);
  });

  test("every bundled load shares one instance", async () => {
    const [first, second] = await Promise.all([loadStations(), loadStations()]);
    expect(first).toBe(second);
    expect(await loadStations()).toBe(first);
  });

  test("each database owns its identity cache", async () => {
    const first = await loadStations(build([station("test/a", "First")]));
    const second = await loadStations(build([station("test/a", "Second")]));
    expect(first.byId("test/a")!.name).toBe("First");
    expect(second.byId("test/a")!.name).toBe("Second");
    expect(first.byId("test/a")).not.toBe(second.byId("test/a"));
  });

  test("loads a Node path, file URL object, and file URL string", async () => {
    const dir = await mkdtemp(join(tmpdir(), "slackwater-loader-"));
    try {
      const file = join(dir, "stations.tcdb");
      await writeFile(file, build([station("test/local")]));
      for (const source of [
        file,
        pathToFileURL(file),
        pathToFileURL(file).href,
      ]) {
        expect((await loadStations(source)).byId("test/local")!.name).toBe(
          "test/local",
        );
      }
      await expect(loadStations(join(dir, "missing.tcdb"))).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a relative path with a colon is a path, not a URL", async () => {
    await expect(loadStations("backups:2026/stations.tcdb")).rejects.toThrow(
      /ENOENT/,
    );
  });

  test("accepts bytes from another realm", async () => {
    const bytes = build([station("test/realm")]);
    const foreign: Uint8Array = runInNewContext("new Uint8Array(length)", {
      length: bytes.length,
    });
    foreign.set(bytes);
    expect((await loadStations(foreign)).byId("test/realm")).toBeDefined();
  });

  test("loads remote bytes and propagates HTTP and network errors", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(new Uint8Array(build([station("test/remote")]))),
      );
    vi.stubGlobal("fetch", fetch);
    const url = new URL("https://example.com/stations.tcdb");
    expect((await loadStations(url)).byId("test/remote")).toBeDefined();
    expect(fetch).toHaveBeenCalledWith(url);
    fetch.mockResolvedValue(new Response(null, { status: 404 }));
    await expect(loadStations(url.href)).rejects.toThrow(/404/);
    fetch.mockRejectedValue(new Error("offline"));
    await expect(loadStations(url)).rejects.toThrow("offline");
  });

  test("rejects responses without the database format identifier", async () => {
    await expect(loadStations(new Uint8Array())).rejects.toThrow(/TCDB/);
    await expect(
      loadStations(new TextEncoder().encode("<html>Not a database</html>")),
    ).rejects.toThrow(/TCDB/);
  });
});

describe("supplied database search and routes", () => {
  test("search follows each buffer's ordering, coordinates, names and quality", async () => {
    const first = await loadStations(
      build([
        { ...station("test/a", "Old Harbour"), longitude: 10 },
        { ...station("test/c", "Sydney"), longitude: 150 },
      ]),
    );
    const second = await loadStations(
      build([
        { ...station("test/a", "New Harbour"), longitude: 20 },
        { ...station("test/b", "Mumbai"), longitude: 70 },
        { ...station("test/c", "Sydney"), longitude: 150 },
        {
          ...station("test/d", "Sydney Rejected"),
          longitude: 151,
          quality: { id: "test/d", accepted: false, score: 0 },
        },
      ]),
    );
    const name = vi.spyOn(StationTable.prototype, "name");
    expect(second.nearest({ lat: 0, lon: 150 })![0]).toBe(
      second.byId("test/c"),
    );
    expect(name).toHaveBeenCalledTimes(1);
    expect(first.nearest({ lat: 0, lon: 150 })![0].id).toBe("test/c");
    expect(second.bbox([149, -1, 152, 1]).map((s) => s.id)).toEqual(["test/c"]);
    expect(second.bbox([149, -1, 152, 1], { includeAll: true })).toHaveLength(
      2,
    );
    expect(first.search("Old Harbour")[0]!.name).toBe("Old Harbour");
    expect(second.search("New Harbour")[0]!.name).toBe("New Harbour");
    expect(second.search("Mumbai")[0]).toBe(second.byId("test/b"));
    expect(first.search("Mumbai")).toEqual([]);
    expect(second.search("Sydney")).toHaveLength(1);
    expect(second.search("Sydney", { includeAll: true })).toHaveLength(2);
    expect(
      second.search("Sydney", {
        includeAll: true,
        filter: (s) => s.id === "test/d",
      })[0]!.id,
    ).toBe("test/d");
  });

  test("routes are lazy, cached, and resolve geography from the supplied database", async () => {
    const bytes = buildDatabase([station("test/a"), station("test/b")], {
      credits,
      routes: {
        tide: [
          { slug: "harbour", station_ids: ["test/a"], former_paths: ["/old/"] },
        ],
        current: [],
      },
    });
    const db = await loadStations(bytes);
    const name = vi.spyOn(StationTable.prototype, "name");
    expect(name).not.toHaveBeenCalled();
    const route = db.stationRouteBySlug("tide", "harbour");
    expect(route).toEqual({
      slug: "harbour",
      path: "/tides/ca/bc/harbour/",
      stationIds: ["test/a"],
      formerPaths: ["/old/"],
    });
    expect(name).toHaveBeenCalledTimes(1);
    expect(db.stationRouteBySlug("tide", "harbour")).toBe(route);
    expect(db.stationRoutes("tide")[0]).toBe(route);
    expect(db.stationRoutes("tide")).toBe(db.stationRoutes("tide"));
    expect(db.stationRouteBySlug("current", "harbour")).toBeUndefined();
  });

  test("empty databases have empty collections, routes, and search results", async () => {
    const db = await loadStations(build([]));
    expect(db.byId("missing")).toBeUndefined();
    expect(db.all).toEqual([]);
    expect(db.accepted).toEqual([]);
    expect(db.qualityMap.size).toBe(0);
    expect(db.stationRoutes("tide")).toEqual([]);
    expect(db.nearest({ lat: 0, lon: 0 })).toBeNull();
    expect(db.bbox([-1, -1, 1, 1])).toEqual([]);
    expect(db.search("harbour")).toEqual([]);
  });
});
