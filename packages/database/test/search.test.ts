import { describe, test, expect } from "vitest";
import { near, nearest, search, bbox } from "../src/index.js";

describe("near", () => {
  [
    { lat: 44, lon: -67 },
    { lat: 44, lng: -67 },
    { latitude: 44, longitude: -67 },
  ].forEach((coords) => {
    test(Object.keys(coords).join("/"), () => {
      const stations = near(coords);
      expect(stations.length).toBeGreaterThan(0);

      const [station, distance] = stations[0]!;
      expect(station.source.id).toBe("8411801");
      expect(distance).toBeCloseTo(70, 0);
    });
  });

  test("defaults to maxResults=10, maxDistance=Infinity", () => {
    expect(near({ lat: 0, lon: 0 }).length).toBe(10);
  });

  test("can set maxResults", () => {
    const stations = near({ lon: -67, lat: 44, maxResults: 5 });
    expect(stations.length).toBe(5);
  });

  test("can set maxDistance", () => {
    const stations = near({ lon: -67.5, lat: 44.5, maxDistance: 10 });
    expect(stations.length).toBe(1);
  });

  test("can filter results", () => {
    const stations = near({
      lon: -67,
      lat: 44,
      filter: (station) => station.type === "reference",
    });
    expect(stations.length).toBe(10);
    stations.forEach(([station]) => {
      expect(station.type).toBe("reference");
    });
  });
});

describe("nearest", () => {
  test("returns the single nearest station", () => {
    const [station, distance] = nearest({ lon: -75, lat: 23 }) || [];
    expect(station).toBeDefined();
    expect(station!.source.id).toBe("TEC4633");
    expect(distance).toBeCloseTo(11, 0);
  });

  test("returns nearest with filter", () => {
    const [station] =
      nearest({
        lon: -75,
        lat: 23,
        filter: (s) => s.type === "reference" && s.id.startsWith("noaa"),
      }) || [];
    expect(station).toBeDefined();
    expect(station!.source.id).toBe("9710441");
  });

  test("returns null if no stations found", () => {
    expect(nearest({ lon: 0, lat: 0, maxDistance: 1 })).toBe(null);
  });
});

describe("bbox", () => {
  test("returns stations within bounding box", () => {
    // Boston area: roughly -71.5 to -70.5 lon, 42 to 42.8 lat
    const results = bbox([-71.5, 42, -70.5, 42.8]);
    expect(results.length).toBeGreaterThan(0);
    results.forEach((station) => {
      expect(station.longitude).toBeGreaterThanOrEqual(-71.5);
      expect(station.longitude).toBeLessThanOrEqual(-70.5);
      expect(station.latitude).toBeGreaterThanOrEqual(42);
      expect(station.latitude).toBeLessThanOrEqual(42.8);
    });
  });

  test("returns empty array for bbox with no stations", () => {
    // Middle of the Pacific
    const results = bbox([-170, -50, -169, -49]);
    expect(results).toEqual([]);
  });

  test("can filter results", () => {
    const results = bbox([-72, 41, -70, 43], {
      filter: (station) => station.type === "reference",
    });
    expect(results.length).toBeGreaterThan(0);
    results.forEach((station) => {
      expect(station.type).toBe("reference");
    });
  });
});

describe("search", () => {
  test("searches by name", () => {
    const results = search("Boston");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.name.toUpperCase()).toContain("BOSTON");
  });

  test("searches by source id", () => {
    const results = search("9414290");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.source.id).toBe("9414290");
  });

  test("searches by region", () => {
    const results = search("HI");
    expect(results.length).toBeGreaterThan(0);
    const hasHawaiiStation = results.some((s) => s.region === "HI");
    expect(hasHawaiiStation).toBe(true);
  });

  test("searches by country", () => {
    const results = search("Canada");
    expect(results.length).toBeGreaterThan(0);
    const hasCanadianStation = results.some((s) => s.country === "Canada");
    expect(hasCanadianStation).toBe(true);
  });

  test("searches by continent", () => {
    const results = search("Europe");
    expect(results.length).toBeGreaterThan(0);
    results.forEach((station) => {
      expect(station.continent).toBe("Europe");
    });
  });

  test("supports fuzzy matching", () => {
    const results = search("Bosten"); // Misspelled Boston
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.name.toUpperCase()).toContain("BOSTON");
  });

  test("supports prefix search", () => {
    const results = search("San");
    expect(results.length).toBeGreaterThan(0);
    const hasSanFrancisco = results.some((s) => s.name.includes("San"));
    expect(hasSanFrancisco).toBe(true);
  });

  test("combines query with filters", () => {
    const results = search("Harbor", {
      filter: (station) =>
        station.type === "reference" &&
        station.country === "United States" &&
        station.continent === "Americas",
    });
    expect(results.length).toBeGreaterThan(0);
    results.forEach((station) => {
      expect(station.type).toBe("reference");
      expect(station.country).toBe("United States");
      expect(station.continent).toBe("Americas");
    });
  });

  test("respects maxResults", () => {
    const results = search("Harbor", { maxResults: 5 });
    expect(results.length).toBeLessThanOrEqual(5);
  });

  test("defaults maxResults to 20", () => {
    const results = search("Bay");
    expect(results.length).toBeLessThanOrEqual(20);
  });
});
