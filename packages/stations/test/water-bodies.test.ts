import { beforeAll, describe, expect, test } from "vitest";
import {
  loadWaterBodies,
  waterBodies,
  waterBodyName,
  type WaterBodies,
} from "../water-bodies.ts";

const square = (lon: number, lat: number, size: number): [number, number][] => [
  [lon, lat],
  [lon + size, lat],
  [lon + size, lat + size],
  [lon, lat + size],
  [lon, lat],
];

describe("water body lookup", () => {
  const bodies = waterBodies([
    { name: "Outer Sound", rings: [square(0, 0, 1)] },
    { name: "Inner Bay", rings: [square(0.4, 0.4, 0.2)] },
    { name: "Next Door Bay", rings: [square(1.005, 0, 0.1)] },
  ]);

  test("lists containing water bodies smallest first", () => {
    expect(bodies.at(0.5, 0.5).map(({ name }) => name)).toEqual([
      "Inner Bay",
      "Outer Sound",
    ]);
  });

  test("lists water bodies just beyond the shore nearest first", () => {
    expect(bodies.at(0.05, 1.004)).toEqual([
      { name: "Next Door Bay", distance: expect.closeTo(0.11, 1) },
      { name: "Outer Sound", distance: expect.closeTo(0.44, 1) },
    ]);
  });

  test("ignores water bodies beyond the distance limit", () => {
    expect(bodies.at(0.5, 1.5)).toEqual([]);
  });
});

describe("water body names", () => {
  test("prefers the English name", () => {
    expect(
      waterBodyName({ name: "Golfe du Lion", "name:en": "Gulf of Lion" }),
    ).toBe("Gulf of Lion");
  });

  test("keeps a Latin-script local name", () => {
    expect(waterBodyName({ name: "Neustädter Bucht" })).toBe(
      "Neustädter Bucht",
    );
  });

  test("gives no name for an unnamed feature", () => {
    expect(waterBodyName({})).toBeUndefined();
  });

  test("skips a name in another script", () => {
    expect(waterBodyName({ name: "東京湾" })).toBeUndefined();
  });
});

describe("water body snapshot", () => {
  let snapshot: WaterBodies;

  beforeAll(async () => {
    snapshot = await loadWaterBodies();
  });

  test.each([
    ["Everett", "Port Gardner", 47.98, -122.223],
    ["Bangor Wharf", "Hood Canal", 47.7483, -122.7267],
    ["Cherry Point", "Strait of Georgia", 48.8633, -122.7583],
    ["Tacoma", "Commencement Bay", 47.2667, -122.4133],
    ["Turn Point", "Boundary Pass", 48.6912, -123.245],
  ])("places %s in %s", (_station, expected, lat, lon) => {
    expect(snapshot.at(lat, lon)[0]?.name).toBe(expected);
  });
});
