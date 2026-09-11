import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import type { GeocodeResult, Geocoder } from "../tools/geocode.ts";
import {
  loadCorrections,
  loadRegistry,
  registryStations,
  resolveMetadata,
  validateMetadata,
} from "../tools/metadata.ts";
import type { StationInput } from "../src/types.ts";

const everett: GeocodeResult = {
  place: {
    name: "Everett",
    admin1: "Washington",
    admin1Code: "WA",
    countryCode: "US",
    latitude: 47.979,
    longitude: -122.202,
    population: 110629,
  },
  distance: 2,
  country: "United States",
  continent: "North America",
  region: "WA",
};

const geocoder: Geocoder = {
  nearest: () => everett,
  near: () => [everett],
};

const baseStation: StationInput = {
  id: "noaa/9447659",
  name: "EVERETT",
  latitude: 47.978,
  longitude: -122.223,
  timezone: "America/Los_Angeles",
  country: "United States",
  country_code: "US",
};

describe("metadata resolution", () => {
  test("keeps location components independent", () => {
    const result = resolveMetadata(baseStation, {
      correction: {
        name: "Everett",
        context: "Port Gardner",
        cities: ["Marysville"],
      },
      geocoder,
    });

    expect(result).toMatchObject({
      name: "Everett",
      locality: "Everett",
      region: "Washington",
      region_code: "US-WA",
      country: "United States",
      country_code: "US",
      context: "Port Gardner",
      cities: ["Marysville"],
    });
  });

  test("does not borrow locality or region across a border", () => {
    const result = resolveMetadata(
      { ...baseStation, id: "chs-test", country: "Canada", country_code: "CA" },
      { geocoder },
    );

    expect(result.country_code).toBe("CA");
    expect(result).not.toHaveProperty("locality");
    expect(result).not.toHaveProperty("region");
    expect(result).not.toHaveProperty("region_code");
  });

  test("preserves a provider name qualifier as context", () => {
    const result = resolveMetadata(
      { ...baseStation, name: "Friday Harbor, San Juan Island" },
      { geocoder: { nearest: () => null, near: () => [] } },
    );

    expect(result.name).toBe("Friday Harbor");
    expect(result.context).toBe("San Juan Island");
    expect(result.context_derived).toBe(false);
  });

  test("a code-only country correction outranks provider country", () => {
    const canada = {
      ...everett,
      country: "Canada",
      place: {
        ...everett.place,
        name: "Victoria",
        admin1: "British Columbia",
        admin1Code: "02",
        countryCode: "CA",
      },
    };
    const result = resolveMetadata(baseStation, {
      correction: { location: { countryCode: "CA" } },
      geocoder: { nearest: () => canada, near: () => [canada] },
    });

    expect(result.country).toBe("Canada");
    expect(result.country_code).toBe("CA");
    expect(result.region).toBe("British Columbia");
    expect(result.region_code).toBe("CA-BC");
  });

  test("replaces opaque provider subdivision ids with the display region", () => {
    const canada = {
      ...everett,
      country: "Canada",
      region: "British Columbia",
      place: {
        ...everett.place,
        name: "Sooke",
        admin1: "British Columbia",
        admin1Code: "02",
        countryCode: "CA",
      },
    };
    const result = resolveMetadata(
      { ...baseStation, country: "Canada", country_code: "CA", region: "02" },
      { geocoder: { nearest: () => canada, near: () => [canada] } },
    );

    expect(result.region).toBe("British Columbia");
    expect(result.region_code).toBe("CA-BC");
    expect(result.context).toBe("Sooke, British Columbia");
  });

  test("a curated context is not marked as derived", () => {
    const result = resolveMetadata(
      { ...baseStation, context: "Automated place", context_derived: true },
      { correction: { context: "Port Gardner" }, geocoder },
    );

    expect(result.context).toBe("Port Gardner");
    expect(result.context_derived).toBe(false);
  });
});

describe("metadata validation", () => {
  test("accepts the migrated metadata sources", () => {
    const corrections = loadCorrections(
      readFileSync(
        new URL("../metadata/corrections.yaml", import.meta.url),
        "utf8",
      ),
    );
    const registry = loadRegistry(
      readFileSync(
        new URL("../metadata/registry.yaml", import.meta.url),
        "utf8",
      ),
    );
    expect(validateMetadata(corrections, registry)).toEqual([]);
  });

  test("accepts recognized country codes beyond the initial US and Canada data", () => {
    const corrections = loadCorrections(`
test/1:
  location:
    country: United Kingdom
    countryCode: GB
    region: England
    regionCode: GB-ENG
`);
    expect(validateMetadata(corrections, new Map())).toEqual([]);
  });

  test("rejects an empty override instead of blanking derived data", () => {
    const corrections = loadCorrections(`
test/1:
  location:
    countryCode: ""
`);
    expect(validateMetadata(corrections, new Map())).toContain(
      "test/1: location.countryCode must not be empty",
    );
  });

  test("accepts a tide port, ordinary gate, and tide-derived gate", () => {
    const registry = loadRegistry(`
chs-port:
  name: Point Atkinson
  position: [49.337, -123.254]
  provider: chs
  kind: tide
chs-gate:
  name: First Narrows
  position: [49.316, -123.1401]
  provider: chs
  kind: current
  tideReference: chs-port
chs-derived:
  name: Malibu Rapids
  position: [50.1626, -123.8515]
  provider: chs
  kind: current
  magnitudeNote: 9 kn flood and ebb
  derived:
    reference: chs-port
    hwLagMinutes: 25
    lwLagMinutes: 35
`);

    expect(validateMetadata(new Map(), registry)).toEqual([]);
    expect(registryStations({ registry, geocoder })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "chs-port", kind: "tide" }),
        expect.objectContaining({
          id: "chs-gate",
          kind: "current",
          current: expect.objectContaining({ tide_reference: "chs-port" }),
        }),
        expect.objectContaining({
          id: "chs-derived",
          current: expect.objectContaining({
            magnitude_note: "9 kn flood and ebb",
            derived: {
              reference: "chs-port",
              high_water_lag_minutes: 25,
              low_water_lag_minutes: 35,
            },
          }),
        }),
      ]),
    );
  });

  test.each([
    [
      "tideReference",
      "tideReference: missing-port",
      "chs-gate",
      "missing-port",
    ],
    [
      "derived reference",
      "derived: { reference: missing-port, hwLagMinutes: 1, lwLagMinutes: 2 }",
      "chs-gate",
      "missing-port",
    ],
  ])("reports a dangling %s with both ids", (_label, field, owner, target) => {
    const registry = loadRegistry(`
${owner}:
  name: Gate
  position: [49, -123]
  provider: chs
  kind: current
  ${field}
`);
    expect(validateMetadata(new Map(), registry).join("\n")).toMatch(owner);
    expect(validateMetadata(new Map(), registry).join("\n")).toMatch(target);
  });

  test("rejects an id declared in both metadata files", () => {
    const corrections = loadCorrections("same-id:\n  name: Corrected\n");
    const registry = loadRegistry(`
same-id:
  name: Owned
  position: [49, -123]
  provider: chs
`);
    expect(validateMetadata(corrections, registry).join("\n")).toMatch(
      /same-id.*both/,
    );
  });

  test("rejects an implausibly distant position correction", () => {
    const corrections = loadCorrections(`
test/1:
  position: [50, -125]
  reason: source typo
`);
    expect(
      validateMetadata(corrections, new Map(), [
        { ...baseStation, id: "test/1", latitude: 49, longitude: -123 },
      ]).join("\n"),
    ).toMatch(/test\/1.*corrected position/);
  });

  test("rejects a curated name attached to a different published station", () => {
    const corrections = loadCorrections("test/1:\n  name: Anacortes\n");
    expect(
      validateMetadata(corrections, new Map(), [
        { ...baseStation, id: "test/1", name: "Swinomish Channel Entrance" },
      ]).join("\n"),
    ).toMatch(/test\/1.*Anacortes.*Swinomish Channel Entrance/);
  });
});
