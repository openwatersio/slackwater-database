import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";

// A lake with one station whose datum moved on 2020-06-01: epoch 1's levels
// are 0.5 m below the current datum. The others: one whose listed year has no
// file, one the year list marks as being written, one whose year list is ahead
// of the station list, one with observations but no listed years, and one from
// a source with no year list.
const lake = mkdtempSync(join(tmpdir(), "lake-"));
const cache = mkdtempSync(join(tmpdir(), "lake-cache-"));
process.env["WATER_LEVELS_URL"] = "https://lake.test";
process.env["WATER_LEVELS_CACHE"] = cache;
const {
  cachedLakeFile,
  readLakeSamples,
  lakeStation,
  MEASURED_FLAGS,
  FINAL_FLAGS,
} = await import("../lake.ts");
const fetched: string[] = [];
// Runs before the fake lake answers a request, as a lake run writing meanwhile would.
let beforeFetch: ((url: string) => unknown) | undefined;

const at = (iso: string) => Date.parse(iso);

beforeAll(async () => {
  const db = await (await DuckDBInstance.create()).connect();
  const q = (path: string) => `'${join(lake, path)}'`;
  await db.run(`COPY (SELECT 'src/a b' AS id, 'src' AS source, 'a b' AS source_id,
      'NAP' AS datum, 'src/a b' AS preferred, ['gesla/x'] AS same_as,
      '2019-01-01 00:00:00+00'::TIMESTAMPTZ AS first,
      '2021-12-31 23:00:00+00'::TIMESTAMPTZ AS last,
      '2020-03-01 02:30:00+00'::TIMESTAMPTZ AS source_qc_start,
      [{id: 1, since: NULL::TIMESTAMPTZ, until: '2020-06-01 00:00:00+00'::TIMESTAMPTZ, to_current: 0.5, state: 'closed'},
       {id: 2, since: '2020-06-01 00:00:00+00'::TIMESTAMPTZ, until: NULL::TIMESTAMPTZ, to_current: 0.0, state: 'open'}] AS epochs
    UNION ALL BY NAME
    SELECT id, split_part(id, '/', 1) AS source, split_part(id, '/', 2) AS source_id,
      'NAP' AS datum, id AS preferred
    FROM (VALUES ('src/lost'), ('src/busy'), ('src/moved'), ('unlisted/x')) v(id)
    UNION ALL BY NAME
    SELECT 'src/new' AS id, 'src' AS source, 'new' AS source_id, 'NAP' AS datum,
      'src/new' AS preferred, '2024-01-01 00:00:00+00'::TIMESTAMPTZ AS first)
    TO ${q("stations.parquet")}`);
  const { mkdirSync } = await import("node:fs");
  mkdirSync(join(lake, "stations/years"), { recursive: true });
  await db.run(`COPY (SELECT * FROM (VALUES
      ('src/a b', 1, 2020, 'v1'), ('src/a b', 2, 2020, 'v2'),
      ('src/lost', 1, 2020, 'v3'), ('src/busy', NULL, NULL, NULL),
      ('src/moved', 2, 2020, 'v4'))
      v(id, epoch, year, version))
    TO ${q("stations/years/src.parquet")}`);
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
  // 2019 and 2021 have no files and aren't listed: a gap, not an error.
  // Answers as R2 does: an ETag that is the body's MD5, and 304 when it matches.
  vi.stubGlobal(
    "fetch",
    async (url: string, init: { headers: Record<string, string> }) => {
      await beforeFetch?.(url);
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

  test("reads preliminary values only from before the QC start when asked for final ones", async () => {
    const period = {
      start: new Date("2020-03-01"),
      end: new Date("2020-06-02"),
    };
    expect(await readLakeSamples("src/a b", period, FINAL_FLAGS)).toEqual([
      { t: at("2020-03-01T02:00:00Z"), level: 1.75 },
      { t: at("2020-05-31T23:00:00Z"), level: 1.5 },
      { t: at("2020-06-01T00:00:00Z"), level: 2 },
    ]);
  });

  test("keeps to the period asked for", async () => {
    const samples = await readLakeSamples("src/a b", {
      start: new Date("2020-05-31T23:00:00Z"),
      end: new Date("2020-06-01T00:00:00Z"),
    });
    expect(samples).toEqual([{ t: at("2020-05-31T23:00:00Z"), level: 1.5 }]);
  });

  test("reads a listed year from the cache while its version is unchanged", async () => {
    const period = {
      start: new Date("2020-01-01"),
      end: new Date("2021-01-01"),
    };
    await readLakeSamples("src/a b", period);
    fetched.length = 0;
    await readLakeSamples("src/a b", period);
    expect(fetched.filter((f) => f.includes("/obs/"))).toEqual([]);
  });

  test("fails when the lake writes a year file while it is read", async () => {
    const manifest = join(lake, "stations/years/src.parquet");
    const before = readFileSync(manifest);
    let requests = 0;
    beforeFetch = async (url) => {
      // The second request for the list is the check after the read.
      if (url.endsWith("years/src.parquet") && ++requests === 2) {
        const db = await (await DuckDBInstance.create()).connect();
        await db.run(`COPY (SELECT id, epoch, year,
            CASE WHEN version = 'v2' THEN 'v2b' ELSE version END AS version
          FROM read_parquet('${manifest}')) TO '${manifest}.new' (FORMAT parquet)`);
        renameSync(`${manifest}.new`, manifest);
      }
    };
    try {
      await expect(
        readLakeSamples("src/a b", {
          start: new Date("2020-01-01"),
          end: new Date("2021-01-01"),
        }),
      ).rejects.toThrow("changed its year files while they were read");
    } finally {
      beforeFetch = undefined;
      writeFileSync(manifest, before);
    }
  });

  test("refuses a year list with an epoch the station list doesn't have yet", async () => {
    await expect(
      readLakeSamples("src/moved", {
        start: new Date("2020-01-01"),
        end: new Date("2021-01-01"),
      }),
    ).rejects.toThrow("has epoch 2, which stations.parquet doesn't");
  });

  test("refuses a station with observations but no listed years", async () => {
    await expect(
      readLakeSamples("src/new", {
        start: new Date("2024-01-01"),
        end: new Date("2025-01-01"),
      }),
    ).rejects.toThrow("has observations but no years");
  });

  test("fails on a year the lake lists but can't serve", async () => {
    await expect(
      readLakeSamples("src/lost", {
        start: new Date("2020-01-01"),
        end: new Date("2021-01-01"),
      }),
    ).rejects.toThrow("src/lost/2020.parquet is listed but missing");
  });

  test("refuses a station the year list marks as being written", async () => {
    await expect(
      readLakeSamples("src/busy", {
        start: new Date("2020-01-01"),
        end: new Date("2021-01-01"),
      }),
    ).rejects.toThrow("writing its year files");
  });

  test("refuses a source without a year list", async () => {
    await expect(
      readLakeSamples("unlisted/x", {
        start: new Date("2020-01-01"),
        end: new Date("2021-01-01"),
      }),
    ).rejects.toThrow("hasn't listed unlisted's years yet");
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

  test("asks the lake again only when the version changes", async () => {
    writeFileSync(join(lake, "year.txt"), "one");
    fetched.length = 0;
    const local = await cachedLakeFile("year.txt", "a");
    expect(await cachedLakeFile("year.txt", "a")).toBe(local);
    writeFileSync(join(lake, "year.txt"), "two");
    await cachedLakeFile("year.txt", "b");
    expect(readFileSync(local!, "utf8")).toBe("two");
    expect(fetched).toEqual([
      "https://lake.test/year.txt 200",
      "https://lake.test/year.txt 200",
    ]);
  });

  test("fetches again a cached file another process replaced", async () => {
    writeFileSync(join(lake, "raced.txt"), "new");
    const local = await cachedLakeFile("raced.txt", "a");
    writeFileSync(local!, "old");
    fetched.length = 0;
    await cachedLakeFile("raced.txt", "a");
    expect(readFileSync(local!, "utf8")).toBe("new");
    expect(fetched).toEqual(["https://lake.test/raced.txt 200"]);
  });

  test("drops a cached file the lake no longer has", async () => {
    writeFileSync(join(lake, "gone.txt"), "x");
    const local = await cachedLakeFile("gone.txt");
    rmSync(join(lake, "gone.txt"));
    expect(await cachedLakeFile("gone.txt")).toBeUndefined();
    expect(() => readFileSync(local!)).toThrow();
  });
});
