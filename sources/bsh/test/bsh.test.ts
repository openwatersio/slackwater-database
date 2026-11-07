import { describe, expect, it } from "vitest";
import { compare, parsePlace, placeUrl, regressions } from "../bsh.ts";
import { check, type Baseline } from "../validate.ts";

const place = {
  years: [
    {
      "2026": {
        hwnw_prediction: {
          data: [
            { timestamp: "2026-01-01 04:50:00+01:00", height: 380, type: "NW" },
            { timestamp: "2026-01-01 10:34:00+01:00", height: 667, type: "HW" },
            {
              timestamp: "2026-01-01 17:10:00+01:00",
              height: null,
              type: "NW",
            },
          ],
        },
      },
    },
  ],
};

describe("parsePlace", () => {
  it("reads events with heights in UTC and metres", () => {
    expect(parsePlace(place, 2026)).toEqual([
      { time: new Date("2026-01-01T03:50:00Z"), high: false, level: 3.8 },
      { time: new Date("2026-01-01T09:34:00Z"), high: true, level: 6.67 },
    ]);
  });

  it("returns nothing for a year BSH does not publish", () => {
    expect(parsePlace(place, 2027)).toEqual([]);
  });

  it("rejects a timestamp without an offset", () => {
    const local = structuredClone(place);
    local.years[0]!["2026"].hwnw_prediction.data[0]!.timestamp =
      "2026-01-01 04:50:00";
    expect(() => parsePlace(local, 2026)).toThrow(/Unexpected BSH event/);
  });
});

it("builds place URLs from gauge numbers", () => {
  expect(placeUrl("506P")).toBe(
    "https://gezeiten.bsh.de/data/DE__506P_tides.json",
  );
  expect(placeUrl("3015P")).toBe(
    "https://gezeiten.bsh.de/data/DE_3015P_tides.json",
  );
});

describe("compare", () => {
  const at = (iso: string, high: boolean, level: number) => ({
    time: new Date(iso),
    high,
    level,
  });
  const reference = [
    at("2026-01-01T04:00:00Z", false, 3),
    at("2026-01-01T10:00:00Z", true, 6),
  ];

  it("pairs events of the same type and signs early as negative", () => {
    const metrics = compare(reference, [
      at("2026-01-01T03:50:00Z", false, 0),
      at("2026-01-01T09:58:00Z", true, 3),
    ]);
    expect(metrics).toMatchObject({
      events: 2,
      predicted: 2,
      matched: 2,
      timeMean: -6,
      highMean: -2,
      lowMean: -10,
      timeSd: 4,
      timeP95: 10,
      heightSd: 0,
    });
  });

  it("leaves events more than three hours away unmatched", () => {
    const metrics = compare(reference, [
      at("2026-01-01T07:01:00Z", false, 0),
      at("2026-01-01T10:00:00Z", true, 3),
    ]);
    expect(metrics.matched).toBe(1);
  });

  it("counts partners more than half an hour outside BSH's span", () => {
    const metrics = compare(reference, [
      at("2026-01-01T02:00:00Z", false, 0),
      at("2026-01-01T11:30:00Z", true, 3),
    ]);
    expect(metrics).toMatchObject({ predicted: 2, matched: 2 });
  });

  it("counts extra events of ours that every BSH event ignores", () => {
    const metrics = compare(reference, [
      at("2026-01-01T03:50:00Z", false, 0),
      at("2026-01-01T04:40:00Z", false, 0),
      at("2026-01-01T07:00:00Z", true, 3),
      at("2026-01-01T09:58:00Z", true, 3),
      at("2026-01-02T12:00:00Z", true, 3),
    ]);
    expect(metrics).toMatchObject({ events: 2, predicted: 4, matched: 2 });
  });
});

const metrics = {
  events: 1410,
  predicted: 1410,
  matched: 1410,
  timeMean: -10,
  timeSd: 12,
  highMean: -5,
  lowMean: -15,
  timeP95: 30,
  heightSd: 0.1,
};

describe("regressions", () => {
  it("accepts drift within tolerance and any improvement", () => {
    expect(regressions(metrics, { ...metrics, timeMean: -11.5 })).toEqual([]);
    expect(
      regressions(metrics, { ...metrics, timeMean: 0, timeSd: 5 }),
    ).toEqual([]);
  });

  it("reports a larger bias in either direction", () => {
    expect(regressions(metrics, { ...metrics, timeMean: 12.5 })).toHaveLength(
      1,
    );
  });

  it("reports a worse bias at high or low water alone", () => {
    expect(
      regressions(metrics, { ...metrics, highMean: -2, lowMean: -18 }),
    ).toEqual(["lowMean -15 → -18"]);
  });

  it("reports missing BSH events and extra events of ours", () => {
    expect(
      regressions(metrics, { ...metrics, events: 2, predicted: 2, matched: 2 }),
    ).toEqual(["events 1410 → 2"]);
    expect(regressions(metrics, { ...metrics, predicted: 1440 })).toEqual([
      "predicted 1410 → 1440",
    ]);
  });

  it("reports wider scatter and lost matches", () => {
    expect(
      regressions(metrics, {
        ...metrics,
        timeSd: 15,
        heightSd: 0.13,
        matched: 1380,
      }),
    ).toHaveLength(3);
  });
});

it("fails gauges that changed station or disappeared", () => {
  const gauge = {
    bshnr: "506P",
    name: "Cuxhaven",
    station: "a",
    km: 0,
    ...metrics,
  };
  const baseline: Baseline = {
    year: 2026,
    gauges: [gauge, { ...gauge, bshnr: "509A" }],
  };
  expect(check(baseline, [{ ...gauge, station: "b" }])).toEqual([
    "506P Cuxhaven: station a → b",
    "509A Cuxhaven: no longer matched",
  ]);
});
