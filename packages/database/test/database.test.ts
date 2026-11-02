import { describe, test, expect, expectTypeOf, vi } from "vitest";
import { readFileSync } from "node:fs";
import * as flatbuffers from "flatbuffers";
import { buildDatabase } from "../src/database/builder.ts";
import { loadStations } from "../src/load-stations.ts";
import { openDatabase } from "../src/database/reader.ts";
import { Root, Kind, DatumFrame } from "../src/generated/fbs/slackwater.ts";
import type { ChsFitData, Station, StationInput } from "../src/types.ts";

// The fixtures' sources carry no credit of their own.
const build = (
  stations: Parameters<typeof buildDatabase>[0],
  options: Omit<Parameters<typeof buildDatabase>[1], "credits"> = {},
) =>
  buildDatabase(stations, {
    credits: new Map(
      stations.flatMap(({ source }) => (source ? [[source.name, null]] : [])),
    ),
    ...options,
  });

expectTypeOf<Station["chart_datum"]>().toEqualTypeOf<string | undefined>();

const shipped = openDatabase(
  readFileSync(new URL("../src/generated/slackwater.tcdb", import.meta.url)),
);

describe("the shipped database file", () => {
  test("carries the TCDB file identifier", () => {
    const bytes = readFileSync(
      new URL("../src/generated/slackwater.tcdb", import.meta.url),
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
      const quality = station.quality();
      if (quality)
        lowestPrediction = Math.min(lowestPrediction, quality.bb_pos);
    }
    expect(lowestPrediction).toBeGreaterThan(highestTable);
  });
});

describe("buildDatabase", () => {
  const identity = {
    latitude: 0,
    longitude: 0,
    timezone: "Etc/UTC",
    continent: "Americas",
    source: {
      name: "Test",
      id: "test",
      published_harmonics: true,
      url: "https://example.com",
    },
    license: {
      type: "public domain",
      commercial_use: true,
      url: "https://example.com/license",
    },
  };
  const inputs: StationInput[] = [
    {
      ...identity,
      id: "test/2",
      name: "Reference",
      latitude: 47.6,
      longitude: -122.3,
      timezone: "America/Los_Angeles",
      locality: "Victoria",
      region: "British Columbia",
      region_code: "CA-BC",
      country: "Canada",
      country_code: "CA",
      continent: "Americas",
      context: "Inner Harbour",
      context_derived: false,
      cities: ["Victoria", "Esquimalt"],
      type: "reference",
      chart_datum: "MLLW",
      datums_source: "observed",
      datum_frame: "gauge",
      datum_coverage: { months: 24, observed_hours: 17520, inferred_hours: 24 },
      epoch: { start: "2007-01-01", end: "2026-01-01" },
      datum_epoch: { start: "2020-01-01", end: "2021-12-31" },
      aliases: ["Elliott Bay", "seattle"],
      harmonic_constituents: [
        { name: "M2", amplitude: 1.063, phase: 10.8 },
        { name: "S2", amplitude: 0.268, phase: 25.2 },
      ],
      datums: { MLLW: 2.419, MSL: 4.443 },
      quality: {
        id: "test/2",
        accepted: true,
        score: 87,
        factors: {
          epoch: 1,
          recency: 0.75,
          source: 1,
          quality: 1,
          amplitude: 0.5,
          coverage: 1,
        },
        issues: ["MLW (3.827) < LAT (3.831)"],
      },
    },
    {
      ...identity,
      id: "test/1",
      name: "Subordinate",
      country: "Canada",
      country_code: "CA",
      type: "subordinate",
      quality: {
        id: "test/1",
        accepted: false,
        score: 0,
        reason: "duplicate",
        redundant: "test/2",
      },
      offsets: {
        reference: "test/2",
        time: { high: 12, low: -6 },
        height: { high: 1.1, low: 0.9, type: "ratio" },
      },
    },
    {
      ...identity,
      id: "test/3",
      name: "A current",
      country: "United States",
      country_code: "US",
      // No explicit kind: the builder derives Kind.Current from `current`.
      current: {
        flood_direction: 90,
        ebb_direction: 270,
        mean_flow: 0.4,
        tide_reference: "test/2",
        magnitude_note: "9 kn flood and ebb",
        derived: {
          reference: "test/2",
          high_water_lag_minutes: 25,
          low_water_lag_minutes: 35,
        },
        offsets: {
          reference: "test/2",
          slack_before_flood: -30,
          flood_speed_ratio: 0.8,
        },
      },
    },
  ];
  const db = openDatabase(build(inputs, { version: "1.2.3" }));

  const routeInputs = [
    ...inputs,
    {
      ...inputs[0]!,
      id: "test/4",
      name: "Second Victoria provider record",
    },
  ];
  const routes = {
    tide: [
      {
        slug: "victoria",
        station_ids: ["test/2", "test/4", "test/2"],
        former_paths: ["/tides/victoria-harbour/", "/tides/victoria-harbour/"],
      },
      { slug: "alpha", station_ids: ["test/1"] },
    ],
    current: [],
  };

  test("round-trips stations sorted by id", () => {
    expect(db.version()).toBe("1.2.3");
    expect(db.stationsLength()).toBe(3);
    expect(db.stations(0)!.id()).toBe("test/1");
    expect(db.stations(1)!.id()).toBe("test/2");
    expect(db.stations(2)!.id()).toBe("test/3");
  });

  test("round-trips sorted, deduplicated route indexes", () => {
    const root = openDatabase(build(routeInputs, { version: "1.2.3", routes }));
    expect(root.tideRoutesLength()).toBe(2);
    expect(root.tideRoutes(0)!.slug()).toBe("alpha");
    const victoria = root.tideRoutes(1)!;
    expect(victoria.slug()).toBe("victoria");
    expect(victoria.stationIdsLength()).toBe(2);
    expect(victoria.stationIds(1)).toBe("test/4");
    expect(victoria.formerPathsLength()).toBe(1);
    expect(victoria.formerPaths(0)).toBe("/tides/victoria-harbour/");
  });

  test("rejects routes that point at the other station kind", () => {
    expect(() =>
      build(inputs, {
        routes: {
          tide: [{ slug: "wrong", station_ids: ["test/3"] }],
          current: [],
        },
      }),
    ).toThrow(/tide\/wrong.*current.*test\/3/);
  });

  // A source missing from the map would ship every notice without its credit.
  test("rejects a station whose source has no credit decision", () => {
    expect(() =>
      buildDatabase(inputs, { version: "1.2.3", credits: new Map() }),
    ).toThrow(/no credit decision for source/);
    expect(() => (buildDatabase as Function)(inputs)).toThrow(/needs credits/);
  });

  test("rejects contradictory station kinds", () => {
    expect(() => build([{ ...inputs[2]!, kind: "tide" }])).toThrow(
      /test\/3.*tide.*current/,
    );
  });

  test("rejects empty and duplicate station ids", () => {
    expect(() => build([{ ...inputs[0]!, id: "" }])).toThrow(/no id/);
    expect(() => build([inputs[0]!, { ...inputs[0]! }])).toThrow(
      /duplicate station id test\/2/,
    );
  });

  test("rejects malformed route indexes", () => {
    expect(() =>
      build(inputs, {
        routes: {
          tide: [
            { slug: "same", station_ids: ["test/1"] },
            { slug: "same", station_ids: ["test/2"] },
          ],
          current: [],
        },
      }),
    ).toThrow(/tide.*duplicate.*same/);
    expect(() =>
      build(inputs, {
        routes: {
          tide: [{ slug: "empty", station_ids: [] }],
          current: [],
        },
      }),
    ).toThrow(/tide\/empty.*no station ids/);
    expect(() =>
      build(inputs, {
        routes: {
          tide: [{ slug: "missing", station_ids: ["test/404"] }],
          current: [],
        },
      }),
    ).toThrow(/tide\/missing.*test\/404/);
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
    expect(station.datumEpoch()!.start()).toBe("2020-01-01");
    expect(station.datumEpoch()!.end()).toBe("2021-12-31");
    expect(station.datumFrame()).toBe(DatumFrame.Gauge);
    expect(station.datumCoverage()!.observedHours()).toBe(17520);
    expect(station.datumCoverage()!.inferredHours()).toBe(24);
    // Aliases are lower-cased per the schema contract.
    expect(station.aliases(0)).toBe("elliott bay");
    expect(station.aliases(1)).toBe("seattle");
  });

  test("distinguishes constituent-frame datums from an unspecified frame", () => {
    for (const datum_frame of ["constituent", undefined] as const) {
      const { datum_frame: _, ...base } = inputs[0]!;
      const record = { ...base, ...(datum_frame ? { datum_frame } : {}) };
      const table = openDatabase(build([record])).stations(0)!;
      expect(table.datumFrame()).toBe(
        datum_frame ? DatumFrame.Constituent : DatumFrame.Unknown,
      );
    }
  });

  test("round-trips structured station identity", () => {
    const station = db.stations(1)!;
    expect(station.locality()).toBe("Victoria");
    expect(station.region()).toBe("British Columbia");
    expect(station.regionCode()).toBe("CA-BC");
    expect(station.country()).toBe("Canada");
    expect(station.countryCode()).toBe("CA");
    expect(station.context()).toBe("Inner Harbour");
    expect(station.contextDerived()).toBe(false);
    expect(
      Array.from({ length: station.citiesLength() }, (_, i) =>
        station.cities(i),
      ),
    ).toEqual(["Victoria", "Esquimalt"]);
  });

  test("round-trips quality, gate inline and detail in the table", () => {
    const accepted = db.stations(1)!;
    expect(accepted.accepted()).toBe(true);
    expect(accepted.score()).toBe(87);
    const detail = accepted.quality()!;
    const factors = detail.factors()!;
    expect(factors.recency()).toBeCloseTo(0.75, 6);
    expect(factors.amplitude()).toBeCloseTo(0.5, 6);
    expect(detail.issuesLength()).toBe(1);
    expect(detail.issues(0)).toBe("MLW (3.827) < LAT (3.831)");
    expect(detail.reason()).toBeNull();

    const rejected = db.stations(0)!;
    expect(rejected.accepted()).toBe(false);
    expect(rejected.score()).toBe(0);
    // Factors were not provided, so they read back absent — not six zeros.
    expect(rejected.quality()!.factors()).toBeNull();
    expect(rejected.quality()!.reason()).toBe("duplicate");
    expect(rejected.quality()!.redundant()).toBe("test/2");
  });

  test("round-trips subordinate offsets", () => {
    const offsets = db.stations(0)!.offsets()!;
    expect(offsets.reference()).toBe("test/2");
    expect(offsets.timeHigh()).toBe(12);
    expect(offsets.timeLow()).toBe(-6);
    expect(offsets.heightHigh()).toBeCloseTo(1.1, 6);
  });

  test("rejects a station without a name, by id", () => {
    expect(() =>
      build([
        {
          id: "test/nameless",
          country: "United States",
          country_code: "US",
        },
      ]),
    ).toThrow(/test\/nameless has no name/);
  });

  test("rejects missing, unknown, and mismatched country codes by station id", () => {
    const missing = { ...inputs[0]!, id: "test/missing" };
    delete missing.country_code;
    expect(() => build([missing])).toThrow(/test\/missing.*country_code/);
    expect(() =>
      build([{ ...inputs[0]!, id: "test/bad", country_code: "CAN" }]),
    ).toThrow(/test\/bad.*country_code/);
    expect(() =>
      build([{ ...inputs[0]!, id: "test/unknown", country_code: "ZZ" }]),
    ).toThrow(/test\/unknown.*ZZ/);
    expect(() =>
      build([
        {
          ...inputs[0]!,
          id: "test/mismatch",
          country: "Canada",
          country_code: "US",
        },
      ]),
    ).toThrow(/test\/mismatch.*Canada.*US/);
    expect(() =>
      build([
        {
          ...inputs[0]!,
          id: "test/region",
          region_code: "US-WA",
        },
      ]),
    ).toThrow(/test\/region.*US-WA.*CA/);
  });

  test("rejects incomplete public station identity", () => {
    expect(() =>
      build([{ ...inputs[0]!, id: "test/incomplete", timezone: "" }]),
    ).toThrow(/test\/incomplete.*timezone/);
  });

  test("round-trips current stations", () => {
    const station = db.stations(2)!;
    expect(station.kind()).toBe(Kind.Current);
    const current = station.current()!;
    expect(current.floodDirection()).toBe(90);
    expect(current.ebbDirection()).toBe(270);
    expect(current.meanFlow()).toBeCloseTo(0.4, 6);
    expect(current.tideReference()).toBe("test/2");
    expect(current.magnitudeNote()).toBe("9 kn flood and ebb");
    const derived = current.derived()!;
    expect(derived.reference()).toBe("test/2");
    expect(derived.highWaterLagMinutes()).toBe(25);
    expect(derived.lowWaterLagMinutes()).toBe(35);
    const offsets = current.offsets()!;
    expect(offsets.reference()).toBe("test/2");
    expect(offsets.slackBeforeFlood()).toBe(-30);
    expect(offsets.floodSpeedRatio()).toBeCloseTo(0.8, 6);
  });

  test("round-trips chs_fit", async () => {
    const evidence = "fit-2026-10-22-8f85912-r2";
    const fits: ChsFitData[] = [
      { tier: "bounded", days: 210, slack_bound_minutes: 45, evidence },
      { tier: "final", days: 210, provisional_slack_minutes: 35, evidence },
      {
        tier: "online",
        miss: { clause: "slack_worst", value: 47.4 },
        miss_context: "rapids",
        evidence,
      },
      {
        tier: "online",
        miss: { clause: "peak_speed", value: 0.55, near_bar: true },
        evidence,
      },
      {
        tier: "online",
        miss: { clause: "slack_median", value: null },
        evidence,
      },
    ];
    const fitted = fits.map((chs_fit, i) => ({
      ...inputs[2]!,
      id: `test/fit-${i}`,
      current: { flood_direction: 90, chs_fit },
    }));
    const bytes = build([...inputs, ...fitted]);
    const { byId } = await loadStations(bytes);
    fits.forEach((fit, i) => {
      const read = byId(`test/fit-${i}`)!.current!.chs_fit;
      expect(read).toEqual(fit);
      expect(read).toStrictEqual(fit);
    });
    const nullMiss = byId("test/fit-4")!.current!.chs_fit!;
    expect(nullMiss.miss!.value).toBeNull();
  });

  test("rejects chs_fit numbers its ushort fields cannot hold", () => {
    const fit = (chs_fit: ChsFitData) => [
      { ...inputs[2]!, id: "test/fit-range", current: { chs_fit } },
    ];
    const evidence = "fit-2026-10-22-8f85912-r2";
    expect(() =>
      build(fit({ tier: "final", days: 70000 as 60, evidence })),
    ).toThrow(/test\/fit-range.*chs_fit\.days 70000/);
    expect(() =>
      build(
        fit({ tier: "bounded", days: 60, slack_bound_minutes: 0, evidence }),
      ),
    ).toThrow(/chs_fit\.slack_bound_minutes 0/);
    expect(() =>
      build(
        fit({
          tier: "final",
          days: 210,
          provisional_slack_minutes: 37.5,
          evidence,
        }),
      ),
    ).toThrow(/chs_fit\.provisional_slack_minutes 37\.5/);
  });

  test("an unknown chs_fit tier reads as online", async () => {
    const bytes = build([
      ...inputs,
      {
        ...inputs[2]!,
        id: "test/fit-unknown",
        current: {
          flood_direction: 90,
          chs_fit: {
            tier: "final",
            days: 210,
            evidence: "fit-2026-10-22-8f85912-r2",
          },
        },
      },
    ]);
    const root = openDatabase(bytes);
    const station = Array.from({ length: root.stationsLength() }, (_, i) =>
      root.stations(i)!,
    ).find((t) => t.id() === "test/fit-unknown")!;
    const fit = station.current()!.chsFit()!;
    // Raw value 3 is past the last tier this reader knows.
    const tierOffset = fit.bb!.__offset(fit.bb_pos, 4);
    expect(tierOffset).not.toBe(0);
    bytes[fit.bb_pos + tierOffset] = 3;
    expect(fit.tier() as number).toBe(3);
    const { byId } = await loadStations(bytes);
    const read = byId("test/fit-unknown")!.current!.chs_fit!;
    expect(read.tier).toBe("online");
    expect(read.days).toBeUndefined();
    expect(read.evidence).toBe("fit-2026-10-22-8f85912-r2");
  });

  test("a current without chs_fit reads none", async () => {
    const bytes = build(inputs);
    const { byId } = await loadStations(bytes);
    expect(byId("test/3")!.current!.chs_fit).toBeUndefined();
  });

  test("exposes kind eagerly and current data lazily", async () => {
    const bytes = build(inputs, { version: "1.2.3" });
    const { Station: FlatBufferStation } =
      await import("../src/generated/fbs/slackwater.ts");
    const currentAccessor = vi.spyOn(FlatBufferStation.prototype, "current");

    try {
      const { byId } = await loadStations(bytes);
      const station = byId("test/3")!;
      expect(station.kind).toBe("current");
      expect(currentAccessor).not.toHaveBeenCalled();
      const current = station.current!;
      expect(current).toMatchObject({
        flood_direction: 90,
        ebb_direction: 270,
        tide_reference: "test/2",
        magnitude_note: "9 kn flood and ebb",
        derived: {
          reference: "test/2",
          high_water_lag_minutes: 25,
          low_water_lag_minutes: 35,
        },
        offsets: {
          reference: "test/2",
          slack_before_flood: -30,
        },
      });
      expect(current.mean_flow).toBeCloseTo(0.4, 6);
      expect(current.offsets?.flood_speed_ratio).toBeCloseTo(0.8, 6);
      expect(currentAccessor).toHaveBeenCalledTimes(1);
    } finally {
      currentAccessor.mockRestore();
    }
  });

  test("inherits datum frame and reduction method with the reference's values", async () => {
    const bytes = build(inputs);
    const { byId } = await loadStations(bytes);
    const reference = byId("test/2")!;
    const subordinate = byId("test/1")!;
    expect(reference.datum_frame).toBe("gauge");
    expect(subordinate.datum_frame).toBe(reference.datum_frame);
    expect(reference.datum_coverage).toEqual({
      months: 24,
      observed_hours: 17520,
      inferred_hours: 24,
    });
    expect(subordinate.datum_coverage).toEqual(reference.datum_coverage);
    expect(subordinate.datums_source).toBe("observed");
    expect(subordinate.datums).toEqual(reference.datums);
    expect(byId("test/3")!.datum_frame).toBeUndefined();
    expect(byId("test/3")!.datum_coverage).toBeUndefined();
  });

  test("preserves absent current measurements without confusing them with zero", async () => {
    const sparse = structuredClone(inputs);
    sparse[2]!.current = {
      ebb_direction: 0,
      offsets: { reference: "test/2", flood_time: 0 },
    };
    const bytes = build(sparse);

    const { byId } = await loadStations(bytes);
    expect(byId("test/3")!.current).toEqual({
      ebb_direction: 0,
      offsets: { reference: "test/2", flood_time: 0 },
    });
  });
});
