import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";

// A store with one gauge, src/g, whose hourly levels for 2019 to 2021 are four
// constituents and a small seiche.
const store = mkdtempSync(join(tmpdir(), "stillwell-"));
const cache = mkdtempSync(join(tmpdir(), "stillwell-cache-"));
process.env["STILLWELL_URL"] = "https://stillwell.test";
process.env["STILLWELL_CACHE"] = cache;
const { shortYears, vectorAverage, verifyFit } =
  await import("../verify-fit.ts");

beforeAll(async () => {
  const db = await (await DuckDBInstance.create()).connect();
  const q = (path: string) => `'${join(store, path)}'`;
  mkdirSync(join(store, "stations/years"), { recursive: true });
  await db.run(`COPY (SELECT 'src/g' AS id, 'src' AS source, 'g' AS source_id,
      'CD' AS datum, 'src/g' AS preferred,
      ['gesla/bergen-bgo-nor-nhs', 'gesla/altengamme-5930070-deu-wsv'] AS same_as,
      '2019-01-01 00:00:00+00'::TIMESTAMPTZ AS first,
      '2022-12-31 22:00:00+00'::TIMESTAMPTZ AS last,
      NULL::TIMESTAMPTZ AS source_qc_start,
      [{id: 1, since: NULL::TIMESTAMPTZ, until: NULL::TIMESTAMPTZ, to_current: 0.0, state: 'open'}] AS epochs)
    TO ${q("stations.parquet")}`);
  await db.run(`COPY (SELECT 'src/g' AS id, 1 AS epoch, y AS year, 'v' || y AS version, 0 AS preliminary
      FROM range(2019, 2023) r(y)) TO ${q("stations/years/src.parquet")}`);
  // 2022 has every other hour: half the year's values, but no hour the Godin
  // filter can score.
  for (const year of [2019, 2020, 2021, 2022]) {
    mkdirSync(join(store, "obs/src/g"), { recursive: true });
    await db.run(`COPY (
      SELECT time, (2 + 1.0 * cos(radians(28.9841042 * h + 40))
        + 0.3 * cos(radians(30 * h + 80)) + 0.2 * cos(radians(15.0410686 * h + 120))
        + 0.15 * cos(radians(13.9430356 * h + 200)) + 0.02 * sin(h * 0.7))::FLOAT AS level_m,
        0::UTINYINT AS flag, 'CD' AS datum
      FROM (SELECT time, epoch(time) / 3600 AS h FROM range(
        '${year}-01-01 00:00:00+00'::TIMESTAMPTZ, '${year + 1}-01-01 00:00:00+00'::TIMESTAMPTZ,
        INTERVAL ${year === 2022 ? 2 : 1} HOUR) r(time)))
      TO ${q(`obs/src/g/${year}.parquet`)}`);
  }
  writeFileSync(join(store, "errata.json"), "[]");
  writeFileSync(
    join(store, "sources.json"),
    JSON.stringify([{ id: "src", finalizes: true }]),
  );
  vi.stubGlobal("fetch", async (url: string) => {
    try {
      return new Response(
        new Uint8Array(
          readFileSync(join(store, url.replace("https://stillwell.test/", ""))),
        ),
      );
    } catch {
      return new Response(null, { status: 404 });
    }
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
  rmSync(store, { recursive: true, force: true });
  rmSync(cache, { recursive: true, force: true });
});

// Distinctive values, so any copy of them in the report can be found.
const AGENCY = [
  { name: "M2", amplitude: 0.987654321, phase: 41.23456789 },
  { name: "S2", amplitude: 0.312345678, phase: 79.87654321 },
  { name: "K1", amplitude: 0.198765432, phase: 121.3456789 },
  { name: "O1", amplitude: 0.151234567, phase: 198.7654321 },
];

describe("verifyFit", () => {
  let report: Awaited<ReturnType<typeof verifyFit>>;
  beforeAll(async () => {
    report = await verifyFit({
      series: "src/g",
      start: new Date("2019-01-01"),
      end: new Date("2021-01-01"),
      names: ["M2", "S2", "K1", "O1"],
      exact: true,
      heldOut: 2021,
      agency: {
        label: "agency/g",
        constants: AGENCY,
        epoch: { start: "2019-01-01", end: "2020-12-31" },
        rounding: { amplitude: 0.0005, phase: 0.05 },
      },
    });
  });

  test("fits the record with intervals, SNR and diagnostics", () => {
    expect(report.fit.hours).toBe(24 * 731);
    expect(report.fit.constituents.map((c) => c.name)).toEqual([
      "M2",
      "S2",
      "K1",
      "O1",
    ]);
    for (const c of report.fit.constituents) {
      expect(c.amplitudeInterval).toBeGreaterThan(0);
      expect(c.snr).toBeGreaterThan(100);
    }
    expect(report.fit.conditioning.conditionNumber).toBeLessThan(1.1);
    expect(report.fit.yearly.years).toBe(2);
  });

  test("scores the held-out year for the fit and the agency's constants", () => {
    expect(report.heldOut?.year).toBe(2021);
    expect(report.heldOut?.fit.hours).toBeGreaterThan(8000);
    expect(report.heldOut?.others["agency/g"]?.seen).toBe(false);
    expect(report.heldOut?.beatsTicon).toBe(true);
    expect(report.agency?.curve?.n).toBe(8760);
    // The agency's rounding widens every interval it is compared with.
    expect(report.agency!.constants).toHaveLength(4);
    for (const d of report.agency!.constants)
      expect(d.amplitudeInterval).toBeGreaterThanOrEqual(0.0005);
  });

  test("scores TICON's constants and this database's re-fits under their own labels", () => {
    expect(Object.keys(report.heldOut!.others).sort()).toEqual([
      "agency/g",
      "refit/altengamme-5930070-deu-wsv",
      "ticon/bergen-bgo-nor-nhs",
    ]);
    // Bergen's record runs to 2025, past the held-out year.
    expect(report.heldOut!.others["ticon/bergen-bgo-nor-nhs"]).toMatchObject({
      seen: true,
      verdict: "better",
    });
  });

  test("falls back from the source's year when it can't be scored", async () => {
    const fallback = await verifyFit({
      series: "src/g",
      start: new Date("2019-01-01"),
      end: new Date("2021-01-01"),
      names: ["M2", "S2", "K1", "O1"],
      exact: true,
    });
    expect(fallback.heldOut?.year).toBe(2021);
    expect(fallback.inputs.versions).toEqual({
      "1 2019": "v2019",
      "1 2020": "v2020",
      "1 2021": "v2021",
      "1 2022": "v2022",
    });
  });

  test("refuses a held-out year asked for that can't be scored", async () => {
    await expect(
      verifyFit({
        series: "src/g",
        start: new Date("2019-01-01"),
        end: new Date("2021-01-01"),
        names: ["M2"],
        exact: true,
        heldOut: 2022,
      }),
    ).rejects.toThrow("under half of 2022's hours");
  });

  test("refuses a held-out year before the fit's window", async () => {
    await expect(
      verifyFit({
        series: "src/g",
        start: new Date("2020-01-01"),
        end: new Date("2021-01-01"),
        names: ["M2"],
        heldOut: 2019,
      }),
    ).rejects.toThrow("before the fit's window");
  });

  test("refuses a held-out year inside the fit's window", async () => {
    await expect(
      verifyFit({
        series: "src/g",
        start: new Date("2019-01-01"),
        end: new Date("2021-01-01"),
        names: ["M2"],
        heldOut: 2020,
      }),
    ).rejects.toThrow("in the fit's window");
  });

  test("averages one-year fits, takes long-period lines from their own years, and holds none of those years out", async () => {
    const yearly = await verifyFit({
      series: "src/g",
      start: new Date("2019-01-01"),
      end: new Date("2021-01-01"),
      names: ["M2", "S2", "K1", "O1"],
      exact: true,
      yearly: true,
      longPeriod: [{ names: ["O1"], years: [2019, 2020, 2021, 2022] }],
    });
    expect(yearly.fit.years).toEqual([2019, 2020]);
    expect(yearly.fit.shortYears).toEqual([]);
    // 2022 has every other hour, under the two thirds a year needs.
    expect(yearly.fit.longPeriod).toEqual([
      { names: ["O1"], years: [2019, 2020, 2021, 2022], shortYears: [2022] },
    ]);
    const m2 = yearly.fit.constituents.find((c) => c.name === "M2")!;
    // The series has no nodal modulation, so the fit's f leaves it within 1%.
    expect(m2.amplitude).toBeCloseTo(1, 1);
    // 2021 and 2022 are in the long-period fit, so no year is left to hold out.
    expect(yearly.heldOut).toBeNull();
    await expect(
      verifyFit({
        series: "src/g",
        start: new Date("2019-01-01"),
        end: new Date("2021-01-01"),
        names: ["M2", "O1"],
        exact: true,
        yearly: true,
        longPeriod: [{ names: ["O1"], years: [2019, 2020, 2021] }],
        heldOut: 2021,
      }),
    ).rejects.toThrow("the held-out year 2021 is in the long-period fit");
  });

  test("lists a joint fit's short years, which it reads in part", async () => {
    const joint = await verifyFit({
      series: "src/g",
      start: new Date("2021-01-01"),
      end: new Date("2023-01-01"),
      names: ["M2", "S2", "K1", "O1"],
      exact: true,
    });
    expect(joint.fit.years).toBeUndefined();
    expect(joint.fit.shortYears).toEqual([2022]);
    expect(joint.fit.hours).toBe(8760 + 4380);
  });

  test("holds no agency curve, extreme or table", () => {
    const json = JSON.stringify(report);
    for (const c of AGENCY) {
      expect(json).not.toContain(String(c.amplitude));
      expect(json).not.toContain(String(c.phase));
    }
    // A curve or an event list would be an array longer than the constituents,
    // or objects with a time or a level.
    const walk = (value: unknown, path: string) => {
      if (Array.isArray(value)) {
        expect(value.length, path).toBeLessThanOrEqual(
          report.fit.constituents.length,
        );
        value.forEach((v, i) => walk(v, `${path}[${i}]`));
      } else if (value && typeof value === "object")
        for (const [key, v] of Object.entries(value)) {
          expect(["t", "time", "level", "high", "low"], path).not.toContain(
            key,
          );
          walk(v, `${path}.${key}`);
        }
    };
    walk(report, "report");
  });
});

describe("vectorAverage", () => {
  test("averages each constituent as a vector over the years that fit it", () => {
    const c = (name: string, amplitude: number, phase: number) => ({
      name,
      amplitude,
      phase,
      amplitudeInterval: 0.02,
      phaseInterval: 2,
    });
    const [m2, k1] = vectorAverage(
      [
        { constituents: [c("M2", 1, 350), c("K1", 0.5, 90)] },
        { constituents: [c("M2", 1, 10)] },
      ],
      ["M2", "K1"],
    );
    expect(m2!.amplitude).toBeCloseTo(Math.cos((10 * Math.PI) / 180), 12);
    expect(m2!.phase).toBeCloseTo(0, 9);
    // A mean of two independent years: the root sum of squares over two.
    expect(m2!.amplitudeInterval).toBeCloseTo(Math.SQRT2 * 0.01, 12);
    expect(k1).toMatchObject({ amplitude: 0.5, phase: 90, phaseInterval: 2 });
  });
});

describe("shortYears", () => {
  test("counts each hour once, however often it was read", () => {
    const hours = (year: number, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        t: Date.UTC(year, 0, 1) + i * 3_600_000,
        level: 0,
      }));
    const half = hours(2020, 4400);
    expect(shortYears([...half, ...half], [2020])).toEqual([2020]);
    expect(shortYears(hours(2021, 6000), [2021, 2022])).toEqual([2022]);
  });
});
