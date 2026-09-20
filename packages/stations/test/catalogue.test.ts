import { describe, expect, test } from "vitest";
import { buildCatalogue, type CatalogueInputs } from "../catalogue.ts";

const geocoder = { nearest: () => null, near: () => [] };

function fixtures(): CatalogueInputs {
  return {
    tides: [
      {
        id: "noaa/9447130",
        name: "SEATTLE",
        latitude: 47.6026,
        longitude: -122.3393,
        timezone: "America/Los_Angeles",
        country: "United States",
        country_code: "US",
        type: "reference",
        harmonic_constituents: [],
      },
    ],
    currents: [
      {
        id: "noaa/PUG1701",
        kind: "current",
        name: "Deception Pass",
        latitude: 48.4,
        longitude: -122.65,
        timezone: "America/Los_Angeles",
        country: "United States",
        country_code: "US",
        type: "reference",
        harmonic_constituents: [],
        current: {
          flood_direction: 90,
          ebb_direction: 270,
          mean_flow: 0,
        },
      },
    ],
    corrections: new Map(),
    registry: new Map([
      [
        "chs-point-atkinson",
        {
          name: "Point Atkinson",
          provider: "chs",
          kind: "tide",
          position: [49.337, -123.254],
          location: {
            region: "British Columbia",
            regionCode: "CA-BC",
            country: "Canada",
            countryCode: "CA",
          },
        },
      ],
      [
        "chs-malibu-rapids",
        {
          name: "Malibu Rapids",
          provider: "chs",
          kind: "current",
          position: [50.1626, -123.8515],
          location: {
            region: "British Columbia",
            regionCode: "CA-BC",
            country: "Canada",
            countryCode: "CA",
          },
          derived: {
            reference: "chs-point-atkinson",
            hwLagMinutes: 25,
            lwLagMinutes: 35,
          },
        },
      ],
    ]),
    slugTable: {
      catalogue: {},
      tide: {
        "noaa/9447130": "seattle",
        "chs-point-atkinson": "point-atkinson",
      },
      current: {
        "noaa/PUG1701": "deception-pass",
        "chs-malibu-rapids": "malibu-rapids",
      },
    },
    slugTombstones: { tide: {}, current: {} },
    routeLock: { tide: {}, current: {} },
    geocoder,
  };
}

describe("buildCatalogue", () => {
  test("combines provider and registry stations with stable routes", () => {
    const catalogue = buildCatalogue(fixtures());

    expect(catalogue.stations.map((station) => station.id)).toEqual([
      "chs-malibu-rapids",
      "chs-point-atkinson",
      "noaa/9447130",
      "noaa/PUG1701",
    ]);
    expect(
      catalogue.routes.tide.find(({ slug }) => slug === "seattle"),
    ).toMatchObject({ station_ids: ["noaa/9447130"] });
    expect(
      catalogue.routes.current.find(({ slug }) => slug === "malibu-rapids"),
    ).toMatchObject({ station_ids: ["chs-malibu-rapids"] });
    expect(
      catalogue.stations.find(({ id }) => id === "chs-malibu-rapids")?.current
        ?.derived,
    ).toEqual({
      reference: "chs-point-atkinson",
      high_water_lag_minutes: 25,
      low_water_lag_minutes: 35,
    });
    expect(
      catalogue.stations.every(
        ({ country, country_code }) => country && country_code,
      ),
    ).toBe(true);
    expect(
      catalogue.stations.find(({ id }) => id === "chs-point-atkinson")?.source,
    ).toMatchObject({
      name: "Canadian Hydrographic Service",
      id: "chs-point-atkinson",
      published_harmonics: false,
    });
    expect(catalogue.slugTable.tide["noaa/9447130"]).toBe("seattle");
    expect(catalogue.slugTombstones).toEqual({ tide: {}, current: {} });
  });

  test("rejects a missing station reference with both ids", () => {
    const input = fixtures();
    input.currents[0]!.current!.offsets = { reference: "noaa/missing" };

    expect(() => buildCatalogue(input)).toThrow(/noaa\/PUG1701.*noaa\/missing/);
  });

  test("keeps rejected station URLs but omits explicit support records", () => {
    const input = fixtures();
    input.tides[0]!.quality = {
      id: "noaa/9447130",
      accepted: false,
      score: 0,
    };
    input.currents[0]!.routed = false;

    const catalogue = buildCatalogue(input);
    expect(catalogue.routes.tide.map(({ slug }) => slug)).toContain("seattle");
    expect(catalogue.routes.current).toEqual([
      expect.objectContaining({ slug: "malibu-rapids" }),
    ]);
  });
});
