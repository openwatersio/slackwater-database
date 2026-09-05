import { describe, test, expect } from "vitest";
import { datums, stations, stationsById, allStations } from "../src/index.js";

describe("datums export", () => {
  test("is the set of datum keys present in the database", () => {
    expect(datums).toContain("MLLW");
    expect(datums).toContain("MSL");
    expect(datums.length).toBeGreaterThan(10);

    // Every datum key on a reference station is covered by the export.
    const ref = stations.find(
      (s) => s.type === "reference" && Object.keys(s.datums).length > 0,
    )!;
    for (const key of Object.keys(ref.datums)) expect(datums).toContain(key);
  });
});

describe("identity fields", () => {
  test("absent optional fields are undefined, not FlatBuffers null", () => {
    const nullish = allStations.filter(
      (s) =>
        s.disclaimers === null || s.region === null || s.chart_datum === null,
    );
    expect(nullish.map((s) => s.id)).toEqual([]);
  });
});

describe("lazily loaded station data", () => {
  test("reference stations resolve their own harmonics and datums", () => {
    const ref = stations.find(
      (s) => s.type === "reference" && s.harmonic_constituents.length > 0,
    )!;
    expect(ref.harmonic_constituents[0]).toHaveProperty("amplitude");
    expect(Object.keys(ref.datums).length).toBeGreaterThan(0);
  });

  test("subordinate stations inherit harmonics and datums from their reference", () => {
    const sub = allStations.find((s) => s.type === "subordinate" && s.offsets)!;
    const ref = stationsById.get(sub.offsets!.reference)!;
    expect(sub.harmonic_constituents).toEqual(ref.harmonic_constituents);
    expect(sub.datums).toEqual(ref.datums);
  });
});
