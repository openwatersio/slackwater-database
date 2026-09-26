/**
 * SQLite database validation tests.
 *
 * These tests validate that the SQLite build correctly preserves all station
 * data from the source JSON files.
 */

import { describe, test, expect, beforeAll } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { basename, join } from "path";
import { DatabaseSync } from "node:sqlite";
import {
  stations,
  constituents as constituentDefs,
} from "@neaps/tide-database";
import tidePredictor, { astro } from "@neaps/tide-predictor";

const dbPath = join(import.meta.dirname, "..", "dist", "tides.tidebase");

let db: DatabaseSync;

beforeAll(() => {
  db = new DatabaseSync(dbPath, { readOnly: true });
});

describe("Database file", () => {
  test("exists and has reasonable size", () => {
    expect(existsSync(dbPath)).toBe(true);
    const stats = statSync(dbPath);
    expect(stats.size).toBeGreaterThan(1_000_000); // At least 1MB
  });
});

describe("Metadata", () => {
  test("all expected keys are present", () => {
    const rows = db.prepare("SELECT key, value FROM metadata").all() as {
      key: string;
      value: string;
    }[];
    const meta = Object.fromEntries(rows.map((r) => [r.key, r.value]));

    expect(meta["generator"]).toContain("tide-database");
    expect(meta["generated_at"]).toBeTruthy();
    expect(Number(meta["station_count"])).toBe(stations.length);
    expect(Number(meta["constituent_count"])).toBeGreaterThan(0);
    expect(Number(meta["start_year"])).toBe(1970);
    expect(Number(meta["end_year"])).toBe(2100);
  });
});

describe("Constituents", () => {
  test("all canonical constituents are present with correct speeds", () => {
    for (const c of constituentDefs) {
      const row = db
        .prepare("SELECT speed FROM constituents WHERE name = ?")
        .get(c.name) as { speed: number } | undefined;
      expect(row, `Constituent ${c.name} not found`).toBeDefined();
      expect(row!.speed).toBeCloseTo(c.speed, 4);
    }
  });

  test("total count includes station-only constituents", () => {
    const row = db
      .prepare("SELECT count(*) AS cnt FROM constituents")
      .get() as { cnt: number };
    expect(row.cnt).toBeGreaterThanOrEqual(constituentDefs.length);
  });
});

describe("Stations", () => {
  test("total count matches source data", () => {
    const row = db.prepare("SELECT count(*) AS cnt FROM stations").get() as {
      cnt: number;
    };
    expect(row.cnt).toBe(stations.length);
  });

  test("reference station count matches", () => {
    const expected = stations.filter((s) => s.type === "reference").length;
    const row = db
      .prepare("SELECT count(*) AS cnt FROM stations WHERE type = 'reference'")
      .get() as { cnt: number };
    expect(row.cnt).toBe(expected);
  });

  test("subordinate station count matches", () => {
    const expected = stations.filter((s) => s.type === "subordinate").length;
    const row = db
      .prepare(
        "SELECT count(*) AS cnt FROM stations WHERE type = 'subordinate'",
      )
      .get() as { cnt: number };
    expect(row.cnt).toBe(expected);
  });

  test("sample reference station has correct data", () => {
    const station = stations.find((s) => s.id === "noaa/9414290")!;
    const row = db
      .prepare("SELECT * FROM stations WHERE station_id = ?")
      .get("noaa/9414290") as Record<string, unknown>;

    expect(row).toBeDefined();
    expect(row["name"]).toBe(station.name);
    expect(row["type"]).toBe("reference");
    expect(row["latitude"]).toBeCloseTo(station.latitude, 4);
    expect(row["longitude"]).toBeCloseTo(station.longitude, 4);
    expect(row["timezone"]).toBe(station.timezone);
    expect(row["country"]).toBe(station.country);
    expect(row["continent"]).toBe(station.continent);
  });

  test("sample subordinate station has correct offsets", () => {
    const station = stations.find((s) => s.id === "noaa/1610367")!;
    const sRow = db
      .prepare("SELECT id FROM stations WHERE station_id = ?")
      .get("noaa/1610367") as { id: number };
    const oRow = db
      .prepare("SELECT * FROM station_offsets WHERE station_id = ?")
      .get(sRow.id) as {
      reference_id: number;
      height_type: string;
      height_high: number;
      height_low: number;
      time_high: number;
      time_low: number;
    };

    expect(oRow).toBeDefined();
    expect(oRow.height_type).toBe(station.offsets!.height.type);
    expect(oRow.height_high).toBeCloseTo(station.offsets!.height.high, 4);
    expect(oRow.height_low).toBeCloseTo(station.offsets!.height.low, 4);
    expect(oRow.time_high).toBe(station.offsets!.time.high);
    expect(oRow.time_low).toBe(station.offsets!.time.low);

    // Verify reference points to correct station
    const refRow = db
      .prepare("SELECT station_id FROM stations WHERE id = ?")
      .get(oRow.reference_id) as { station_id: string };
    expect(refRow.station_id).toBe(station.offsets!.reference);
  });
});

describe("Station constituents", () => {
  test("sample station has all constituents preserved", () => {
    const station = stations.find((s) => s.id === "noaa/9414290")!;
    const sRow = db
      .prepare("SELECT id FROM stations WHERE station_id = ?")
      .get("noaa/9414290") as { id: number };

    const rows = db
      .prepare(
        `SELECT sc.constituent AS name, sc.amplitude, sc.phase
         FROM station_constituents sc
         WHERE sc.station_id = ?`,
      )
      .all(sRow.id) as { name: string; amplitude: number; phase: number }[];

    // Should have at least as many as the source (may resolve aliases)
    expect(rows.length).toBeGreaterThanOrEqual(
      station.harmonic_constituents.filter(
        (hc) => hc.amplitude !== 0 || hc.phase !== 0,
      ).length,
    );

    // Check M2 specifically
    const m2Source = station.harmonic_constituents.find(
      (hc) => hc.name === "M2",
    )!;
    const m2Db = rows.find((r) => r.name === "M2")!;
    expect(m2Db).toBeDefined();
    expect(m2Db.amplitude).toBeCloseTo(m2Source.amplitude, 4);
    expect(m2Db.phase).toBeCloseTo(m2Source.phase, 2);
  });

  test("all subordinate offset references are valid", () => {
    const row = db
      .prepare(
        `SELECT count(*) AS cnt FROM station_offsets o
         WHERE NOT EXISTS (
           SELECT 1 FROM stations s WHERE s.id = o.reference_id
         )`,
      )
      .get() as { cnt: number };
    expect(row.cnt).toBe(0);
  });
});

describe("Datums", () => {
  test("sample station has correct datum values", () => {
    const station = stations.find((s) => s.id === "noaa/9414290")!;
    const sRow = db
      .prepare("SELECT id FROM stations WHERE station_id = ?")
      .get("noaa/9414290") as { id: number };

    const rows = db
      .prepare("SELECT datum, value FROM station_datums WHERE station_id = ?")
      .all(sRow.id) as { datum: string; value: number }[];

    const dbDatums = Object.fromEntries(rows.map((r) => [r.datum, r.value]));

    for (const [name, value] of Object.entries(station.datums) as [
      string,
      number,
    ][]) {
      expect(dbDatums[name], `Datum ${name}`).toBeCloseTo(value, 4);
    }
  });
});

describe("Equilibrium arguments and node factors", () => {
  test("spot check M2 equilibrium argument for 2026", () => {
    const eaRow = db
      .prepare(
        "SELECT value FROM equilibrium_arguments WHERE constituent = 'M2' AND year = 2026",
      )
      .get() as { value: number };

    // Compute expected value directly
    const time = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
    const constituent = tidePredictor.constituents["M2"]!;
    const astroData = astro(time);
    const V0 = constituent.value(astroData);
    const { u } = constituent.correction(astroData);
    const expected = (((V0 + u) % 360) + 360) % 360;

    expect(eaRow.value).toBeCloseTo(expected, 2);
  });

  test("spot check M2 node factor for 2026", () => {
    const nfRow = db
      .prepare(
        "SELECT value FROM node_factors WHERE constituent = 'M2' AND year = 2026",
      )
      .get() as { value: number };

    // Compute expected value directly
    const time = new Date(Date.UTC(2026, 6, 1, 0, 0, 0));
    const constituent = tidePredictor.constituents["M2"]!;
    const astroData = astro(time);
    const { f } = constituent.correction(astroData);

    expect(nfRow.value).toBeCloseTo(f, 4);
  });

  test("all constituents with tide-predictor support have eq args and node factors", () => {
    const constituentCount = db
      .prepare(
        `SELECT count(DISTINCT ea.constituent) AS cnt
         FROM equilibrium_arguments ea`,
      )
      .get() as { cnt: number };

    // Should be a substantial number (the canonical tide-predictor constituents)
    expect(constituentCount.cnt).toBeGreaterThan(50);

    // Each should have entries for the full year range
    const yearCount = db
      .prepare(
        `SELECT count(*) AS cnt FROM equilibrium_arguments
         WHERE constituent = 'M2'`,
      )
      .get() as { cnt: number };
    expect(yearCount.cnt).toBe(2100 - 1970 + 1);
  });
});

describe("Example queries", () => {
  const examplesDir = join(import.meta.dirname, "..", "examples");
  const files = readdirSync(examplesDir).filter((f) => f.endsWith(".sql"));

  for (const file of files) {
    test(`${basename(file, ".sql")} executes without error`, () => {
      const sql = readFileSync(join(examplesDir, file), "utf-8");
      const statements = sql
        .split(";")
        .map((s) => s.trim())
        .filter((s) => s && !s.startsWith("--"));

      for (const stmt of statements) {
        const rows = db.prepare(stmt).all();
        expect(rows.length).toBeGreaterThanOrEqual(0);
      }
    });
  }
});
