import { beforeAll, describe, expect, test } from "vitest";
import {
  loadMaritimeZones,
  maritimeZones,
  type MaritimeZones,
} from "../maritime-zones.ts";

describe("maritime zone lookup", () => {
  const zones = maritimeZones(
    [[0, 0, 2, 1]],
    [
      {
        country: "AA",
        polygons: [
          [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 1],
              [0, 0],
            ],
          ],
        ],
      },
    ],
  );

  test("answers inside a zone", () => {
    expect(zones.country(0.5, 0.5)).toBe("AA");
  });

  test("answers from the nearest zone up a harbor", () => {
    expect(zones.country(0.5, 1.05)).toBe("AA");
  });

  test("gives no answer far from every zone", () => {
    expect(zones.country(0.5, 1.5)).toBeUndefined();
  });

  test("gives no answer outside the coverage", () => {
    expect(zones.country(0.5, 3)).toBeUndefined();
  });
});

describe("maritime zone snapshot", () => {
  let snapshot: MaritimeZones;

  beforeAll(async () => {
    snapshot = await loadMaritimeZones();
  });

  test.each([
    ["Port Renfrew", "CA", 48.555, -124.421],
    ["Juan de Fuca - East", "CA", 48.2317, -123.53],
    ["Boundary Pass", "US", 48.6912, -123.245],
  ])("places %s in %s waters", (_station, expected, lat, lon) => {
    expect(snapshot.country(lat, lon)).toBe(expected);
  });
});
