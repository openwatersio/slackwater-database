import crosswalk from "../ticon-originators.json" with { type: "json" };
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  parseInventory,
  parseHarmonics,
  parsePredictions,
  buildStation,
} from "../jma.ts";
const page = (name: string) =>
  readFileSync(new URL(`../fixtures/${name}.html`, import.meta.url), "utf8");
describe("JMA published harmonics", () => {
  it("imports only the 70 stations with constant tables", () => {
    const gauges = parseInventory(page("index"));
    expect(gauges).toHaveLength(70);
    expect(gauges[0]).toMatchObject({
      id: "WN",
      name: "稚内",
      latitude: 45.4,
      z0: 0.18,
    });
  });
  it("uses the constants longitude for the local-meridian conversion", () => {
    const h = parseHarmonics(
      page("WN-constants"),
      parseInventory(page("index"))[0]!,
    );
    expect(h.longitude).toBeCloseTo(141 + 41 / 60 + 7 / 3600, 10);
    expect(h.constituents).toHaveLength(60);
    expect(h.constituents.find((c) => c.name === "M2")).toMatchObject({
      amplitude: 0.0218,
    });
    expect(h.constituents.find((c) => c.name === "M2")!.phase).toBeCloseTo(
      (109.78 - 2 * h.longitude + 360) % 360,
      9,
    );
    expect(h.constituents.find((c) => c.name === "Sa")!.phase).toBe(161.28);
    expect(h.epoch).toEqual({ start: "2011-01-01", end: "2020-12-31" });
  });
  it("rejects an absent or ambiguous phase reference and wrong station", () => {
    const gauge = parseInventory(page("index"))[0]!;
    expect(() =>
      parseHarmonics(page("WN-constants").replace("現地子午線", "不明"), gauge),
    ).toThrow();
    expect(() =>
      parseHarmonics(page("WN-constants"), { ...gauge, name: "東京" }),
    ).toThrow();
  });
  it("rejects missing rows, unknown speeds and malformed amplitudes", () => {
    const gauge = parseInventory(page("index"))[0]!;
    for (const html of [
      page("WN-constants").replace("28.9841042", "28.1"),
      page("WN-constants").replace("  2.18", " --"),
    ]) {
      expect(() => parseHarmonics(html, gauge)).toThrow();
    }
  });
});

it("retains spans for analysis periods with omitted years", () => {
  const gauge = parseInventory(page("index")).find((g) => g.id === "TN")!;
  expect(parseHarmonics(page("TN-constants"), gauge).epoch).toEqual({
    start: "2011-01-01",
    end: "2020-12-31",
  });
});

it("preserves measured zero amplitudes", () => {
  const g = parseInventory(page("index"))[0]!;
  const h = parseHarmonics(page("WN-constants").replace("  2.18", "  0.00"), g);
  expect(h.constituents.find((c) => c.name === "M2")!.amplitude).toBe(0);
});
it("requires consecutive valid prediction dates", () => {
  const html = page("WN-01-predictions");
  expect(parsePredictions(html)).toHaveLength(168);
  expect(() =>
    parsePredictions(html.replaceAll("2026/01/02", "2026/01/01")),
  ).toThrow();
});

it("preserves published tide-table zero separately from derived NLLW", () => {
  const h = parseHarmonics(
    page("WN-constants"),
    parseInventory(page("index"))[0]!,
  );
  const station = buildStation(h);
  expect(station.chart_datum).toBe("CD");
  expect(station.datums["MSL"]).toBe(0);
  expect(station.datums["CD"]).toBe(-0.18);
  expect(station.datums["NLLW"]).toBe(-0.167);
});

it("expands abbreviated analysis years across a century", () => {
  const gauge = parseInventory(page("index"))[0]!;
  const h = parseHarmonics(
    page("WN-constants").replaceAll("2011-20", "1998-02"),
    gauge,
  );
  expect(h.epoch).toEqual({ start: "1998-01-01", end: "2002-12-31" });
});

it("covers the pinned inventory with exactly one reviewed MA-code identity per gauge", () => {
  expect(Object.values(crosswalk).sort()).toEqual(
    parseInventory(page("index"))
      .map((g) => g.id)
      .sort(),
  );
});
