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

// A store with one station whose datum moved on 2020-06-01: epoch 1's levels
// are 0.5 m below the current datum. The others: one whose listed year has no
// file, one the year list marks as being written, one whose year list is ahead
// of the station list, one with observations but no listed years, and one from
// a source with no year list.
const store = mkdtempSync(join(tmpdir(), "stillwell-"));
const cache = mkdtempSync(join(tmpdir(), "stillwell-cache-"));
process.env["STILLWELL_URL"] = "https://stillwell.test";
process.env["STILLWELL_CACHE"] = cache;
const {
  cachedStillwellFile,
  readStillwellSamples,
  sourceFinalYear,
  stillwellErrata,
  stillwellStation,
  MEASURED_FLAGS,
  FINAL_FLAGS,
} = await import("../stillwell.ts");
const fetched: string[] = [];
// Runs before the fake store answers a request, as an ingest run writing meanwhile would.
let beforeFetch: ((url: string) => unknown) | undefined;

const at = (iso: string) => Date.parse(iso);

beforeAll(async () => {
  const db = await (await DuckDBInstance.create()).connect();
  const q = (path: string) => `'${join(store, path)}'`;
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
  mkdirSync(join(store, "stations/years"), { recursive: true });
  await db.run(`COPY (SELECT * FROM (VALUES
      ('src/a b', 1, 2020, 'v1'), ('src/a b', 2, 2020, 'v2'), ('src/a b', 2, 2022, 'v5'),
      ('src/lost', 1, 2020, 'v3'), ('src/busy', NULL, NULL, NULL),
      ('src/moved', 2, 2020, 'v4'))
      v(id, epoch, year, version))
    TO ${q("stations/years/src.parquet")}`);
  const year = async (path: string, rows: string) => {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(store, path, ".."), { recursive: true });
    await db.run(`COPY (SELECT time::TIMESTAMPTZ AS time, level_m::FLOAT AS level_m,
        flag::UTINYINT AS flag, 'NAP' AS datum FROM (VALUES ${rows}) v(time, level_m, flag))
      TO ${q(path)}`);
  };
  // Epoch 1 also holds rows past its `until`, which aren't part of the series.
  await year(
    "obs/src/a%20b/2020.parquet",
    `('2020-05-31 23:00:00+00', 1.0, 0), ('2020-06-01 00:00:00+00', 9.0, 0),
     ('2020-03-01 00:00:00+00', 1.5, 1), ('2020-03-01 01:00:00+00', 1.5, 3),
     ('2020-03-01 02:00:00+00', 1.25, 2), ('2020-03-01 00:30:00+00', 1.0, 1)`,
  );
  await year(
    "obs/src/a%20b/2/2020.parquet",
    `('2020-06-01 00:00:00+00', 2.0, 0), ('2020-06-01 01:00:00+00', 2.1, 4)`,
  );
  // A year backfilled after stations.parquet's `last` was written.
  await year(
    "obs/src/a%20b/2/2022.parquet",
    `('2022-01-01 00:00:00+00', 3.0, 0)`,
  );
  // 2019 and 2021 have no files and aren't listed: a gap, not an error.
  writeFileSync(
    join(store, "sources.json"),
    JSON.stringify([
      { id: "src", finalizes: true },
      { id: "fin", finalizes: true },
      { id: "nf", finalizes: false },
    ]),
  );
  // fin/a has two epochs in 2025 with no preliminary values, fin/b has some,
  // and fin/m, whose files are being written, would tip 2025 the other way.
  await db.run(`COPY (SELECT * FROM (VALUES
      ('fin/a', 1, 2024, 'x', 0), ('fin/a', 1, 2025, 'x', 0), ('fin/a', 2, 2025, 'x', 0),
      ('fin/b', 1, 2024, 'x', 0), ('fin/b', 1, 2025, 'x', 7),
      ('fin/m', 1, 2025, 'x', 0), ('fin/m', NULL, NULL, NULL, NULL))
      v(id, epoch, year, version, preliminary))
    TO ${q("stations/years/fin.parquet")}`);
  // Stillwell keeps the 2022 value as served; another source's erratum and a
  // flagged one touch nothing a read decides.
  writeFileSync(
    join(store, "errata.json"),
    JSON.stringify([
      {
        id: "src-2022",
        source: "src",
        stations: ["src/a b"],
        since: "2022-01-01",
        until: "2022-01-02",
        handling: "kept",
        error: "late",
      },
      {
        id: "src-flagged",
        source: "src",
        stations: null,
        since: null,
        until: null,
        handling: "flagged",
        error: "spikes",
      },
      {
        id: "other",
        source: "other",
        stations: null,
        since: null,
        until: null,
        handling: "kept",
        error: "gaps",
      },
    ]),
  );
  // Answers as R2 does: an ETag that is the body's MD5, and 304 when it matches.
  vi.stubGlobal(
    "fetch",
    async (url: string, init: { headers: Record<string, string> }) => {
      await beforeFetch?.(url);
      let body: Buffer;
      try {
        body = readFileSync(
          join(store, url.replace("https://stillwell.test/", "")),
        );
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
  rmSync(store, { recursive: true, force: true });
  rmSync(cache, { recursive: true, force: true });
});

describe("readStillwellSamples", () => {
  test("reads the station list", async () => {
    const station = await stillwellStation("src/a b");
    expect(station?.epochs.map((e) => [e.id, e.to_current])).toEqual([
      [1, 0.5],
      [2, 0],
    ]);
    expect(station?.last).toEqual(new Date("2021-12-31T23:00:00Z"));
  });

  test("puts every epoch in the current datum and keeps verified values only", async () => {
    const samples = await readStillwellSamples("src/a b", {
      start: new Date("2019-01-01"),
      end: new Date("2022-01-01"),
    });
    expect(samples).toEqual([
      { t: at("2020-05-31T23:00:00Z"), level: 1.5 },
      { t: at("2020-06-01T00:00:00Z"), level: 2 },
    ]);
  });

  test("reads preliminary values when asked for every measured value", async () => {
    const samples = await readStillwellSamples(
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
    expect(await readStillwellSamples("src/a b", period, FINAL_FLAGS)).toEqual([
      { t: at("2020-03-01T02:00:00Z"), level: 1.75 },
      { t: at("2020-05-31T23:00:00Z"), level: 1.5 },
      { t: at("2020-06-01T00:00:00Z"), level: 2 },
    ]);
  });

  test("keeps to the period asked for", async () => {
    const samples = await readStillwellSamples("src/a b", {
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
    await readStillwellSamples("src/a b", period);
    fetched.length = 0;
    await readStillwellSamples("src/a b", period);
    expect(fetched.filter((f) => f.includes("/obs/"))).toEqual([]);
  });

  test("reads a listed year past the station list's last observation", async () => {
    expect(
      await readStillwellSamples(
        "src/a b",
        { start: new Date("2022-01-01"), end: new Date("2023-01-01") },
        undefined,
        { errata: { "src-2022": "keep" } },
      ),
    ).toEqual([{ t: at("2022-01-01T00:00:00Z"), level: 3 }]);
  });

  test("records the year versions and errata a read used", async () => {
    const inputs = { versions: {}, errata: {} };
    await readStillwellSamples(
      "src/a b",
      { start: new Date("2020-01-01"), end: new Date("2023-01-01") },
      undefined,
      { errata: { "src-2022": "keep" }, inputs },
    );
    expect(inputs).toMatchObject({
      versions: { "1 2020": "v1", "2 2020": "v2", "2 2022": "v5" },
      epochs: [
        { id: 1, to_current: 0.5 },
        { id: 2, to_current: 0 },
      ],
      source_qc_start: new Date("2020-03-01T02:30:00Z"),
      errata: {
        "src-2022": {
          handling: "kept",
          since: "2022-01-01",
          until: "2022-01-02",
        },
        "src-flagged": { handling: "flagged", since: null, until: null },
      },
    });
  });

  test("reads only values on the hour when asked", async () => {
    const samples = await readStillwellSamples(
      "src/a b",
      { start: new Date("2020-03-01"), end: new Date("2020-03-02") },
      [1, 2],
      { hourly: true },
    );
    expect(samples.map((s) => s.t % 3_600_000)).toEqual([0, 0]);
  });

  test("refuses a kept erratum's span until the caller decides it", async () => {
    const period = {
      start: new Date("2022-01-01"),
      end: new Date("2023-01-01"),
    };
    await expect(readStillwellSamples("src/a b", period)).rejects.toThrow(
      "keeps erratum src-2022",
    );
    expect(
      await readStillwellSamples("src/a b", period, undefined, {
        errata: { "src-2022": "drop" },
      }),
    ).toEqual([]);
  });

  test("picks up a change to the station list between reads", async () => {
    const list = join(store, "stations.parquet");
    const before = readFileSync(list);
    const db = await (await DuckDBInstance.create()).connect();
    await db.run(`COPY (SELECT * REPLACE (CASE WHEN id = 'src/a b' THEN
        [{id: 1, since: NULL::TIMESTAMPTZ, until: '2020-06-01 00:00:00+00'::TIMESTAMPTZ, to_current: 0.75, state: 'closed'},
         {id: 2, since: '2020-06-01 00:00:00+00'::TIMESTAMPTZ, until: NULL::TIMESTAMPTZ, to_current: 0.0, state: 'open'}]
        ELSE epochs END AS epochs) FROM read_parquet('${list}'))
      TO '${list}.new' (FORMAT parquet)`);
    renameSync(`${list}.new`, list);
    try {
      expect(
        await readStillwellSamples("src/a b", {
          start: new Date("2020-05-31T23:00:00Z"),
          end: new Date("2020-06-01T00:00:00Z"),
        }),
      ).toEqual([{ t: at("2020-05-31T23:00:00Z"), level: 1.75 }]);
    } finally {
      writeFileSync(list, before);
    }
  });

  test("fails when Stillwell writes a year file while it is read", async () => {
    const manifest = join(store, "stations/years/src.parquet");
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
        readStillwellSamples("src/a b", {
          start: new Date("2020-01-01"),
          end: new Date("2021-01-01"),
        }),
      ).rejects.toThrow("changed its year files while they were read");
    } finally {
      beforeFetch = undefined;
      writeFileSync(manifest, before);
    }
  });

  test("reads on when Stillwell writes a year outside the read", async () => {
    const manifest = join(store, "stations/years/src.parquet");
    const before = readFileSync(manifest);
    let requests = 0;
    beforeFetch = async (url) => {
      if (url.endsWith("years/src.parquet") && ++requests === 2) {
        const db = await (await DuckDBInstance.create()).connect();
        await db.run(`COPY (SELECT id, epoch, year,
            CASE WHEN version = 'v5' THEN 'v5b' ELSE version END AS version
          FROM read_parquet('${manifest}')) TO '${manifest}.new' (FORMAT parquet)`);
        renameSync(`${manifest}.new`, manifest);
      }
    };
    try {
      expect(
        await readStillwellSamples("src/a b", {
          start: new Date("2020-01-01"),
          end: new Date("2021-01-01"),
        }),
      ).toHaveLength(2);
    } finally {
      beforeFetch = undefined;
      writeFileSync(manifest, before);
    }
  });

  test("refuses a year list with an epoch the station list doesn't have yet", async () => {
    await expect(
      readStillwellSamples("src/moved", {
        start: new Date("2020-01-01"),
        end: new Date("2021-01-01"),
      }),
    ).rejects.toThrow("has epoch 2, which stations.parquet doesn't");
  });

  test("refuses a station with observations but no listed years", async () => {
    await expect(
      readStillwellSamples("src/new", {
        start: new Date("2024-01-01"),
        end: new Date("2025-01-01"),
      }),
    ).rejects.toThrow("has observations but no years");
  });

  test("fails on a year Stillwell lists but can't serve", async () => {
    await expect(
      readStillwellSamples("src/lost", {
        start: new Date("2020-01-01"),
        end: new Date("2021-01-01"),
      }),
    ).rejects.toThrow("src/lost/2020.parquet is listed but missing");
  });

  test("refuses a station the year list marks as being written", async () => {
    await expect(
      readStillwellSamples("src/busy", {
        start: new Date("2020-01-01"),
        end: new Date("2021-01-01"),
      }),
    ).rejects.toThrow("writing its year files");
  });

  test("refuses a source without a year list", async () => {
    await expect(
      readStillwellSamples("unlisted/x", {
        start: new Date("2020-01-01"),
        end: new Date("2021-01-01"),
      }),
    ).rejects.toThrow("hasn't listed unlisted's years yet");
  });

  test("refuses a series Stillwell's public store doesn't list", async () => {
    await expect(
      readStillwellSamples("src/missing", {
        start: new Date("2020-01-01"),
        end: new Date("2021-01-01"),
      }),
    ).rejects.toThrow("not in Stillwell's public store");
  });
});

describe("stillwellErrata", () => {
  test("refuses an erratum whose date isn't one", async () => {
    const path = join(store, "errata.json");
    const before = readFileSync(path);
    writeFileSync(
      path,
      JSON.stringify([
        {
          id: "bad",
          source: "src",
          stations: null,
          since: "2023-02-30",
          until: null,
          handling: "kept",
          error: "",
        },
      ]),
    );
    try {
      await expect(stillwellErrata()).rejects.toThrow("isn't one: 2023-02-30");
    } finally {
      writeFileSync(path, before);
    }
  });
});

describe("sourceFinalYear", () => {
  test("is the latest year most stations have no preliminary values in", async () => {
    expect(await sourceFinalYear("fin")).toBe(2024);
  });

  test("refuses a source that doesn't finalize its values", async () => {
    await expect(sourceFinalYear("nf")).rejects.toThrow("doesn't finalize");
  });
});

describe("cachedStillwellFile", () => {
  test("revalidates a cached file and fetches it again once it changes", async () => {
    writeFileSync(join(store, "note.txt"), "one");
    fetched.length = 0;
    const local = await cachedStillwellFile("note.txt");
    expect(await cachedStillwellFile("note.txt")).toBe(local);
    expect(readFileSync(local!, "utf8")).toBe("one");
    writeFileSync(join(store, "note.txt"), "two");
    await cachedStillwellFile("note.txt");
    expect(readFileSync(local!, "utf8")).toBe("two");
    expect(fetched).toEqual([
      "https://stillwell.test/note.txt 200",
      "https://stillwell.test/note.txt 304",
      "https://stillwell.test/note.txt 200",
    ]);
  });

  test("asks Stillwell again only when the version changes", async () => {
    writeFileSync(join(store, "year.txt"), "one");
    fetched.length = 0;
    const local = await cachedStillwellFile("year.txt", "a");
    expect(await cachedStillwellFile("year.txt", "a")).toBe(local);
    writeFileSync(join(store, "year.txt"), "two");
    await cachedStillwellFile("year.txt", "b");
    expect(readFileSync(local!, "utf8")).toBe("two");
    expect(fetched).toEqual([
      "https://stillwell.test/year.txt 200",
      "https://stillwell.test/year.txt 200",
    ]);
  });

  test("fetches again a cached file another process replaced", async () => {
    writeFileSync(join(store, "raced.txt"), "new");
    const local = await cachedStillwellFile("raced.txt", "a");
    writeFileSync(local!, "old");
    fetched.length = 0;
    await cachedStillwellFile("raced.txt", "a");
    expect(readFileSync(local!, "utf8")).toBe("new");
    expect(fetched).toEqual(["https://stillwell.test/raced.txt 200"]);
  });

  test("drops a cached file Stillwell no longer has", async () => {
    writeFileSync(join(store, "gone.txt"), "x");
    const local = await cachedStillwellFile("gone.txt");
    rmSync(join(store, "gone.txt"));
    expect(await cachedStillwellFile("gone.txt")).toBeUndefined();
    expect(() => readFileSync(local!)).toThrow();
  });
});
