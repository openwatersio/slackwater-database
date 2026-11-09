import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";

// A lake with one station whose datum moved on 2020-06-01: epoch 1's levels
// are 0.5 m below the current datum.
const lake = mkdtempSync(join(tmpdir(), "lake-"));
const cache = mkdtempSync(join(tmpdir(), "lake-cache-"));
process.env["WATER_LEVELS_URL"] = "https://lake.test";
process.env["WATER_LEVELS_CACHE"] = cache;
const { cachedLakeFile, readLakeSamples, lakeStation, MEASURED_FLAGS } =
  await import("../lake.ts");
const fetched: string[] = [];

const at = (iso: string) => Date.parse(iso);

beforeAll(async () => {
  const db = await (await DuckDBInstance.create()).connect();
  const q = (path: string) => `'${join(lake, path)}'`;
  await db.run(`COPY (SELECT 'src/a b' AS id, 'src' AS source, 'a b' AS source_id,
      'NAP' AS datum, 'src/a b' AS preferred, ['gesla/x'] AS same_as,
      '2019-01-01 00:00:00+00'::TIMESTAMPTZ AS first,
      '2021-12-31 23:00:00+00'::TIMESTAMPTZ AS last,
      [{id: 1, since: NULL::TIMESTAMPTZ, until: '2020-06-01 00:00:00+00'::TIMESTAMPTZ, to_current: 0.5, state: 'closed'},
       {id: 2, since: '2020-06-01 00:00:00+00'::TIMESTAMPTZ, until: NULL::TIMESTAMPTZ, to_current: 0.0, state: 'open'}] AS epochs)
    TO ${q("stations.parquet")}`);
  const year = async (path: string, rows: string) => {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(lake, path, ".."), { recursive: true });
    await db.run(`COPY (SELECT time::TIMESTAMPTZ AS time, level_m::FLOAT AS level_m,
        flag::UTINYINT AS flag, 'NAP' AS datum FROM (VALUES ${rows}) v(time, level_m, flag))
      TO ${q(path)}`);
  };
  // Epoch 1 also holds rows past its `until`, which aren't part of the series.
  await year(
    "obs/src/a%20b/2020.parquet",
    `('2020-05-31 23:00:00+00', 1.0, 0), ('2020-06-01 00:00:00+00', 9.0, 0),
     ('2020-03-01 00:00:00+00', 1.5, 1), ('2020-03-01 01:00:00+00', 1.5, 3),
     ('2020-03-01 02:00:00+00', 1.25, 2)`,
  );
  await year(
    "obs/src/a%20b/2/2020.parquet",
    `('2020-06-01 00:00:00+00', 2.0, 0), ('2020-06-01 01:00:00+00', 2.1, 4)`,
  );
  // 2019 and 2021 have no files: a gap, not an error.
  // Answers as R2 does: an ETag that is the body's MD5, and 304 when it matches.
  vi.stubGlobal(
    "fetch",
    async (url: string, init: { headers: Record<string, string> }) => {
      let body: Buffer;
      try {
        body = readFileSync(join(lake, url.replace("https://lake.test/", "")));
      } catch {
        return new Response(null, { status: 404 });
      }
      const etag = `"${createHash("md5").update(body).digest("hex")}"`;
      const match = init.headers["If-None-Match"] === etag;
      fetched.push(`${url} ${match ? 304 : 200}`);
      return match
        ? new Response(null, { status: 304 })
        : new Response(new Uint8Array(body), { headers: { etag } });
    },
  );
});

afterAll(() => {
  vi.unstubAllGlobals();
  rmSync(lake, { recursive: true, force: true });
  rmSync(cache, { recursive: true, force: true });
});

describe("readLakeSamples", () => {
  test("reads the station list", async () => {
    const station = await lakeStation("src/a b");
    expect(station?.epochs.map((e) => [e.id, e.to_current])).toEqual([
      [1, 0.5],
      [2, 0],
    ]);
    expect(station?.last).toEqual(new Date("2021-12-31T23:00:00Z"));
  });

  test("puts every epoch in the current datum and keeps verified values only", async () => {
    const samples = await readLakeSamples("src/a b", {
      start: new Date("2019-01-01"),
      end: new Date("2022-01-01"),
    });
    expect(samples).toEqual([
      { t: at("2020-05-31T23:00:00Z"), level: 1.5 },
      { t: at("2020-06-01T00:00:00Z"), level: 2 },
    ]);
  });

  test("reads preliminary values when asked for every measured value", async () => {
    const samples = await readLakeSamples(
      "src/a b",
      { start: new Date("2020-03-01"), end: new Date("2020-03-02") },
      MEASURED_FLAGS,
    );
    expect(samples).toEqual([{ t: at("2020-03-01T02:00:00Z"), level: 1.75 }]);
  });

  test("keeps to the period asked for", async () => {
    const samples = await readLakeSamples("src/a b", {
      start: new Date("2020-05-31T23:00:00Z"),
      end: new Date("2020-06-01T00:00:00Z"),
    });
    expect(samples).toEqual([{ t: at("2020-05-31T23:00:00Z"), level: 1.5 }]);
  });

  test("refuses a series the public lake doesn't list", async () => {
    await expect(
      readLakeSamples("src/missing", {
        start: new Date("2020-01-01"),
        end: new Date("2021-01-01"),
      }),
    ).rejects.toThrow("not in the public water-levels lake");
  });
});

describe("cachedLakeFile", () => {
  test("revalidates a cached file and fetches it again once it changes", async () => {
    writeFileSync(join(lake, "note.txt"), "one");
    fetched.length = 0;
    const local = await cachedLakeFile("note.txt");
    expect(await cachedLakeFile("note.txt")).toBe(local);
    expect(readFileSync(local!, "utf8")).toBe("one");
    writeFileSync(join(lake, "note.txt"), "two");
    await cachedLakeFile("note.txt");
    expect(readFileSync(local!, "utf8")).toBe("two");
    expect(fetched).toEqual([
      "https://lake.test/note.txt 200",
      "https://lake.test/note.txt 304",
      "https://lake.test/note.txt 200",
    ]);
  });

  test("drops a cached file the lake no longer has", async () => {
    writeFileSync(join(lake, "gone.txt"), "x");
    const local = await cachedLakeFile("gone.txt");
    rmSync(join(lake, "gone.txt"));
    expect(await cachedLakeFile("gone.txt")).toBeUndefined();
    expect(() => readFileSync(local!)).toThrow();
  });
});
