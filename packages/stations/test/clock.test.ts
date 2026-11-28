import { describe, expect, test } from "vitest";
import { constituents } from "@slackwater/engine";
import { clockErrors, standardOffset, timeShift } from "../clock.ts";
import {
  CLOCK_CONSTITUENTS,
  CLOCK_ERROR_SOURCES,
  CLOCK_MAX_RESIDUAL,
  CLOCK_NEIGHBOR_KM,
  OBSERVATION_ERROR_SOURCES,
  RECORD_CLOCK_SHIFT,
  SOURCE_CLOCK_SHIFT,
  ZONE_CLOCK_WINDOW,
} from "../filtering.ts";

type Station = Parameters<typeof clockErrors>[0][number];

const AMPLITUDES: Record<string, number> = {
  M2: 0.5,
  S2: 0.2,
  N2: 0.1,
  K1: 0.15,
  O1: 0.1,
};
const PHASES: Record<string, number> = {
  M2: 120,
  S2: 150,
  N2: 100,
  K1: 200,
  O1: 180,
};

/** The phases of a tide running `minutes` late against PHASES. */
function phases(minutes: number) {
  return new Map(
    CLOCK_CONSTITUENTS.map((name) => [
      name,
      {
        amplitude: AMPLITUDES[name]!,
        phase:
          (PHASES[name]! + (constituents[name]!.speed * minutes) / 60) % 360,
      },
    ]),
  );
}

/** A record at `km` east of the equator's prime meridian, running `minutes`
 *  late: a NOAA record when `id` starts with noaa/, else a TICON one. */
function record(
  id: string,
  minutes: number,
  km = 0,
  timezone = "America/New_York",
): Station {
  const noaa = id.startsWith("noaa/");
  return {
    id,
    type: "reference",
    latitude: 25,
    longitude: -80 + km / 101,
    timezone,
    source: noaa
      ? {
          name: "US National Oceanic and Atmospheric Administration",
          id: id.slice(5),
        }
      : { name: "TICON-4", id: id.slice(6) },
    harmonic_constituents: [...phases(minutes)].map(([name, c]) => ({
      name,
      ...c,
    })),
  } as unknown as Station;
}

/** A record whose S2 runs half a cycle off the shift its other lines share,
 *  so no single shift explains it. */
function incoherent(record: Station): Station {
  for (const c of record.harmonic_constituents) {
    if (c.name === "S2") {
      c.amplitude = 0.01;
      c.phase = (c.phase + 180) % 360;
    } else c.amplitude = 0.5;
  }
  return record;
}

describe("timeShift", () => {
  test.each([0, 44, -95, -300])("measures a tide %i minutes late", (min) => {
    expect(timeShift(phases(min), phases(0))).toEqual({
      minutes: min,
      residual: expect.closeTo(0, 1),
    });
  });

  test("tells a half-day error from none by the diurnal tide", () => {
    expect(timeShift(phases(12 * 60), phases(0)).minutes).toBe(12 * 60);
  });
});

describe("standardOffset", () => {
  test.each([
    ["America/New_York", -300],
    ["America/Puerto_Rico", -240],
    ["Pacific/Auckland", 720],
    ["Asia/Kolkata", 330],
    ["UTC", 0],
  ])("%s is %i minutes from UTC in standard time", (zone, minutes) => {
    expect(standardOffset(zone)).toBe(minutes);
  });
});

describe("clockErrors", () => {
  const far = CLOCK_NEIGHBOR_KM * 10;
  const late = SOURCE_CLOCK_SHIFT + 10;

  test("rejects every record of a source whose timed gauges run off", () => {
    const errors = clockErrors([
      record("noaa/1", 0),
      record("ticon/a-1-usa-xx", late),
      record("ticon/b-2-usa-xx", late + 5),
      record("ticon/c-3-usa-xx", 0),
      record("ticon/d-4-usa-xx", late),
      record("ticon/e-5-usa-xx", 0, far),
      record("ticon/f-6-usa-yy", 0),
    ]);
    expect([...errors.keys()].sort()).toEqual([
      "ticon/a-1-usa-xx",
      "ticon/b-2-usa-xx",
      "ticon/c-3-usa-xx",
      "ticon/d-4-usa-xx",
      "ticon/e-5-usa-xx",
    ]);
    expect(errors.get("ticon/e-5-usa-xx")).toBe(
      `Clock error in source xx: 3 of its 4 gauges timed against ` +
        `authoritative gauges within ${CLOCK_NEIGHBOR_KM} km run ` +
        `${SOURCE_CLOCK_SHIFT} min or more late, a median ${late} min late`,
    );
  });

  test.each([
    ["2 of 3, the share itself", ["late", "late", "fine"], true],
    ["3 of 5, short of it", ["late", "late", "late", "fine", "fine"], false],
  ])("judges a source with %s", (_, gauges, rejected) => {
    const errors = clockErrors([
      record("noaa/1", 0),
      ...gauges.map((g, i) =>
        record(`ticon/g${i}-${i}-usa-xx`, g === "late" ? late : 0),
      ),
    ]);
    expect(errors.size > 0).toBe(rejected);
  });

  test("counts the records of one gauge once", () => {
    // By record, 4 of 6 run late; by gauge, 1 of 3.
    const errors = clockErrors([
      record("noaa/1", 0),
      ...["123", "123a", "123b", "123c"].map((code) =>
        record(`ticon/harbor-${code}-usa-xx`, late),
      ),
      record("ticon/inlet-456-usa-xx", 0),
      record("ticon/bay-789-usa-xx", 0),
    ]);
    expect(errors.size).toBe(0);
  });

  test("judges no source on fewer than three gauges", () => {
    const errors = clockErrors([
      record("noaa/1", 0),
      record("ticon/a-1-usa-xx", late),
      record("ticon/b-2-usa-xx", late),
      record("ticon/c-3-usa-xx", 0, far),
    ]);
    expect(errors.size).toBe(0);
  });

  test("keeps a source whose records run off in both directions", () => {
    const errors = clockErrors([
      record("noaa/1", 0),
      record("ticon/a-1-usa-xx", late),
      record("ticon/b-2-usa-xx", -late),
      record("ticon/c-3-usa-xx", late),
      record("ticon/d-4-usa-xx", -late),
    ]);
    expect(errors.size).toBe(0);
  });

  test("rejects a listed source's records with no gauge to time them", () => {
    const [source, measurement] = Object.entries(CLOCK_ERROR_SOURCES)[0]!;
    const errors = clockErrors([record(`ticon/a-1-usa-${source}`, 0, far)]);
    expect(errors.get(`ticon/a-1-usa-${source}`)).toBe(
      `Clock error in source ${source}: ${measurement}`,
    );
  });

  test("times nothing by a pair no single shift explains", () => {
    const anchor = incoherent(record("noaa/1", 0));
    const records = ["a-1", "b-2", "c-3"].map((id) =>
      record(`ticon/${id}-usa-xx`, -300),
    );
    for (const r of records)
      for (const c of r.harmonic_constituents)
        if (c.name !== "S2") c.amplitude = 0.5;
        else c.amplitude = 0.01;
    const shift = timeShift(
      new Map(records[0]!.harmonic_constituents.map((c) => [c.name, c])),
      new Map(anchor.harmonic_constituents.map((c) => [c.name, c])),
    );
    expect(shift.residual).toBeGreaterThan(CLOCK_MAX_RESIDUAL);
    expect(clockErrors([anchor, ...records]).size).toBe(0);
  });

  test("doesn't judge a source whose constants miss their own gauges", () => {
    const source = Object.keys(OBSERVATION_ERROR_SOURCES)[0]!;
    const errors = clockErrors([
      record("noaa/1", 0),
      ...["a-1", "b-2", "c-3"].map((id) =>
        record(`ticon/${id}-usa-${source}`, late),
      ),
    ]);
    expect(errors.size).toBe(0);
  });

  test("keeps TICON's contributors apart from sources imported directly", () => {
    const direct = {
      ...record("ticon/x-9-usa-dmi", 0, far),
      id: "dmi/9",
      source: { name: "Danish Meteorological Institute", id: "9" },
    } as Station;
    const errors = clockErrors([
      record("noaa/1", 0),
      ...["a-1", "b-2", "c-3"].map((id) => record(`ticon/${id}-dnk-dmi`, late)),
      direct,
    ]);
    expect(errors.size).toBe(3);
    expect(errors.has("dmi/9")).toBe(false);
  });

  test("times nothing against a gauge its own checks reject", () => {
    const errors = clockErrors(
      [
        record("noaa/1", 0),
        ...["a-1", "b-2", "c-3"].map((id) =>
          record(`ticon/${id}-usa-xx`, late),
        ),
      ],
      (s) => s.id !== "noaa/1",
    );
    expect(errors.size).toBe(0);
  });

  test("never rejects an authoritative record", () => {
    const errors = clockErrors([
      record("noaa/1", 0),
      record("noaa/2", -300),
      record("noaa/3", late),
    ]);
    expect(errors.size).toBe(0);
  });

  test("rejects a single record on local time labeled UTC", () => {
    const errors = clockErrors([
      record("noaa/1", 0),
      record("ticon/pr-1-usa-zz", -235, 0, "America/Puerto_Rico"),
      record("ticon/pr-2-usa-zz", 0, 0, "America/Puerto_Rico"),
      record("ticon/pr-3-usa-zz", 0, 0, "America/Puerto_Rico"),
    ]);
    expect(errors.get("ticon/pr-1-usa-zz")).toBe(
      `Clock error: runs 235 min early against 1 authoritative gauge within ` +
        `${CLOCK_NEIGHBOR_KM} km, near its standard time (UTC−4): local time ` +
        `labeled UTC`,
    );
    expect(errors.size).toBe(1);
  });

  test("rejects a record at exactly the shift and zone limits", () => {
    const errors = clockErrors([
      record("noaa/1", 0),
      record("ticon/a-1-usa-zz", -RECORD_CLOCK_SHIFT, 0, "America/Noronha"),
      record("ticon/b-2-usa-zz", 0),
      record("ticon/c-3-usa-zz", 0),
    ]);
    expect([...errors.keys()]).toEqual(["ticon/a-1-usa-zz"]);
  });

  test.each([
    [ZONE_CLOCK_WINDOW, true],
    [ZONE_CLOCK_WINDOW + 1, false],
  ])("judges a record %i min from its standard time", (gap, rejected) => {
    const errors = clockErrors([
      record("noaa/1", 0),
      record("ticon/a-1-usa-zz", -120 - gap, 0, "America/Noronha"),
      record("ticon/b-2-usa-zz", 0),
      record("ticon/c-3-usa-zz", 0),
    ]);
    expect(errors.has("ticon/a-1-usa-zz")).toBe(rejected);
  });

  test.each([
    ["away from its standard time", -235, "Europe/London"],
    ["too small to be a clock", -(RECORD_CLOCK_SHIFT - 5), "UTC"],
  ])("keeps a record running off %s", (_, minutes, zone) => {
    const errors = clockErrors([
      record("noaa/1", 0),
      record("ticon/a-1-usa-zz", minutes, 0, zone),
      record("ticon/b-2-usa-zz", 0),
      record("ticon/c-3-usa-zz", 0),
    ]);
    expect(errors.size).toBe(0);
  });

  test("times nothing against a gauge with a different tide", () => {
    const anchor = record("noaa/1", 0);
    for (const c of anchor.harmonic_constituents) c.amplitude /= 2;
    const errors = clockErrors([
      anchor,
      record("ticon/a-1-usa-xx", 300),
      record("ticon/b-2-usa-xx", 300),
      record("ticon/c-3-usa-xx", 300),
    ]);
    expect(errors.size).toBe(0);
  });
});
