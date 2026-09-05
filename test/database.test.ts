import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import * as flatbuffers from "flatbuffers";
import { buildDatabase } from "../src/database/builder.ts";
import { Root } from "../src/generated/fbs/neaps/root.ts";
import { Kind } from "../src/generated/fbs/neaps/kind.ts";
import type { StationInput } from "../src/types.ts";

function open(bytes: Uint8Array): Root {
  return Root.getRootAsRoot(new flatbuffers.ByteBuffer(bytes));
}

const shipped = open(
  readFileSync(new URL("../src/generated/stations.neaps", import.meta.url)),
);

describe("the shipped database file", () => {
  test("carries the NEAP file identifier", () => {
    const bytes = readFileSync(
      new URL("../src/generated/stations.neaps", import.meta.url),
    );
    expect(Root.bufferHasIdentifier(new flatbuffers.ByteBuffer(bytes))).toBe(
      true,
    );
    expect(shipped.version()).toBeTruthy();
  });

  test("stations are sorted by id, the vector key", () => {
    let previous = "";
    for (let i = 0; i < shipped.stationsLength(); i++) {
      const id = shipped.stations(i)!.id()!;
      expect(id > previous).toBe(true);
      previous = id;
    }
  });

  // The layout the builder exists to produce: every station's prediction data
  // (constituents and datums vectors) lands together at the tail of the file,
  // every station table together at the head, so an identity scan over a
  // memory-mapped file touches only the head pages. A naive build loop
  // interleaves them, and nothing else fails when that regresses.
  test("prediction data sits after all station tables", () => {
    let highestTable = 0;
    let lowestPrediction = Infinity;
    for (let i = 0; i < shipped.stationsLength(); i++) {
      const station = shipped.stations(i)!;
      highestTable = Math.max(highestTable, station.bb_pos);
      if (station.constituentsLength() > 0)
        lowestPrediction = Math.min(
          lowestPrediction,
          station.constituents(0)!.bb_pos,
        );
      if (station.datumsLength() > 0)
        lowestPrediction = Math.min(
          lowestPrediction,
          station.datums(0)!.bb_pos,
        );
    }
    expect(lowestPrediction).toBeGreaterThan(highestTable);
  });
});

describe("buildDatabase", () => {
  const inputs: StationInput[] = [
    {
      id: "test/2",
      name: "Reference",
      latitude: 47.6,
      longitude: -122.3,
      timezone: "America/Los_Angeles",
      country: "United States",
      continent: "Americas",
      type: "reference",
      chart_datum: "MLLW",
      datums_source: "observed",
      epoch: { start: "2007-01-01", end: "2026-01-01" },
      aliases: ["Elliott Bay", "seattle"],
      harmonic_constituents: [
        { name: "M2", amplitude: 1.063, phase: 10.8 },
        { name: "S2", amplitude: 0.268, phase: 25.2 },
      ],
      datums: { MLLW: 2.419, MSL: 4.443 },
    },
    {
      id: "test/1",
      name: "Subordinate",
      type: "subordinate",
      offsets: {
        reference: "test/2",
        time: { high: 12, low: -6 },
        height: { high: 1.1, low: 0.9, type: "ratio" },
      },
    },
    {
      id: "test/3",
      name: "A current",
      kind: "current",
      current: {
        flood_direction: 90,
        ebb_direction: 270,
        mean_flow: 0.4,
        tide_reference: "test/2",
        offsets: {
          reference: "test/2",
          slack_before_flood: -30,
          flood_speed_ratio: 0.8,
        },
      },
    },
  ];
  const db = open(buildDatabase(inputs, { version: "1.2.3" }));

  test("round-trips stations sorted by id", () => {
    expect(db.version()).toBe("1.2.3");
    expect(db.stationsLength()).toBe(3);
    expect(db.stations(0)!.id()).toBe("test/1");
    expect(db.stations(1)!.id()).toBe("test/2");
    expect(db.stations(2)!.id()).toBe("test/3");
  });

  test("round-trips prediction data through the name tables", () => {
    const station = db.stations(1)!;
    expect(station.constituentsLength()).toBe(2);
    const m2 = station.constituents(0)!;
    expect(db.constituentNames(m2.name())).toBe("M2");
    expect(m2.amplitude()).toBeCloseTo(1.063, 6);
    expect(m2.phase()).toBeCloseTo(10.8, 5);

    const mllw = station.datums(0)!;
    expect(db.datumNames(mllw.name())).toBe("MLLW");
    expect(mllw.value()).toBeCloseTo(2.419, 6);
    expect(station.chartDatum()).toBe("MLLW");

    const epoch = station.epoch()!;
    expect(epoch.start()).toBe("2007-01-01");
    expect(epoch.end()).toBe("2026-01-01");
    // Aliases are lower-cased per the schema contract.
    expect(station.aliases(0)).toBe("elliott bay");
    expect(station.aliases(1)).toBe("seattle");
  });

  test("round-trips subordinate offsets", () => {
    const offsets = db.stations(0)!.offsets()!;
    expect(offsets.reference()).toBe("test/2");
    expect(offsets.timeHigh()).toBe(12);
    expect(offsets.timeLow()).toBe(-6);
    expect(offsets.heightHigh()).toBeCloseTo(1.1, 6);
  });

  test("round-trips current stations", () => {
    const station = db.stations(2)!;
    expect(station.kind()).toBe(Kind.Current);
    const current = station.current()!;
    expect(current.floodDirection()).toBe(90);
    expect(current.ebbDirection()).toBe(270);
    expect(current.meanFlow()).toBeCloseTo(0.4, 6);
    expect(current.tideReference()).toBe("test/2");
    const offsets = current.offsets()!;
    expect(offsets.reference()).toBe("test/2");
    expect(offsets.slackBeforeFlood()).toBe(-30);
    expect(offsets.floodSpeedRatio()).toBeCloseTo(0.8, 6);
  });
});
