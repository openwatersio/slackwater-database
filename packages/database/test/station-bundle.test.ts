import { describe, test, expect } from "vitest";
import {
  datums,
  stations,
  stationsById,
  allStations,
  qualityMap,
} from "../src/index.js";

describe("station metadata", () => {
  test("every station has an id and finite coordinates", () => {
    for (const s of allStations) {
      // Provider ids are source-prefixed; registry-only stations use their
      // registry key. Anything else means a non-station file slipped in.
      expect(s.id, `station ${s.id}`).toMatch(/^([^/]+\/.+|[a-z0-9-]+)$/);
      expect(Number.isFinite(s.latitude), `latitude of ${s.id}`).toBe(true);
      expect(Number.isFinite(s.longitude), `longitude of ${s.id}`).toBe(true);
    }
  });
});

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

describe("qualityMap", () => {
  test("records keep their station id, like the quality.json originals", () => {
    const station = stations.find(({ quality }) => quality)!;
    expect(qualityMap.get(station.id)?.id).toBe(station.id);
    expect(station.quality?.id).toBe(station.id);
  });
});

describe("identity fields", () => {
  test("absent optional fields are undefined, not FlatBuffers null", () => {
    const nullish = allStations.filter(
      (s) =>
        s.disclaimers === null ||
        s.locality === null ||
        s.region === null ||
        s.region_code === null ||
        s.context === null ||
        s.cities === null ||
        s.chart_datum === null,
    );
    expect(nullish.map((s) => s.id)).toEqual([]);
  });

  test("every station has structured country identity", () => {
    expect(
      allStations.filter(
        (station) =>
          !station.country || !/^[A-Z]{2}$/.test(station.country_code),
      ),
    ).toEqual([]);
  });

  test("every station retains source and license provenance", () => {
    expect(
      allStations.filter((station) => !station.source || !station.license),
    ).toEqual([]);
  });

  test("the shipped catalogue exposes both station kinds eagerly", () => {
    expect(allStations.some((station) => station.kind === "tide")).toBe(true);
    expect(allStations.some((station) => station.kind === "current")).toBe(
      true,
    );
    expect(
      allStations.find((station) => station.kind === "current")?.current,
    ).toBeDefined();
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

  test("subordinate stations inherit harmonics, datums, and epoch from their reference", () => {
    const sub = allStations.find(
      (s) =>
        s.type === "subordinate" &&
        s.offsets &&
        stationsById.get(s.offsets.reference)?.epoch,
    )!;
    const ref = stationsById.get(sub.offsets!.reference)!;
    expect(sub.harmonic_constituents).toEqual(ref.harmonic_constituents);
    expect(sub.datums).toEqual(ref.datums);
    expect(sub.epoch).toBeDefined();
    expect(sub.epoch).toEqual(ref.epoch);
  });
});
