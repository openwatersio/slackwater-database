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
  test("a reviewed same-gauge link shares a route and redirects the relay's old URL", () => {
    const input = fixtures();
    input.tides[0]!.harmonic_constituents = [
      { name: "M2", amplitude: 1, phase: 10 },
    ];
    input.tides.push({
      ...input.tides[0]!,
      id: "ticon/seattle",
      harmonic_constituents: [{ name: "M2", amplitude: 2, phase: 20 }],
    });
    input.slugTable.tide["ticon/seattle"] = "seattle-relay";
    input.routeLock.tide["seattle-relay"] = {
      path: "/tides/us/seattle-relay/",
      former_paths: ["/tides/us/old-seattle-relay/"],
    };
    input.corrections.set("ticon/seattle", { sameGauge: "noaa/9447130" });

    const catalogue = buildCatalogue(input);
    expect(catalogue.routes.tide.find((r) => r.slug === "seattle")).toEqual({
      slug: "seattle",
      station_ids: ["noaa/9447130", "ticon/seattle"],
      former_paths: [
        "/tides/us/old-seattle-relay/",
        "/tides/us/seattle-relay/",
      ],
    });
    expect(catalogue.routes.tide.some((r) => r.slug === "seattle-relay")).toBe(
      false,
    );
    expect(catalogue.stations.map((s) => s.id)).toContain("ticon/seattle");
    expect(catalogue.stations.map((s) => s.id)).toContain("noaa/9447130");
    for (const station of input.tides)
      expect(
        catalogue.stations.find((s) => s.id === station.id)
          ?.harmonic_constituents,
      ).toEqual(station.harmonic_constituents);
    expect(catalogue.formerSlugs.tide["ticon/seattle"]).toEqual([
      "seattle-relay",
    ]);

    const rebuilt = buildCatalogue({
      ...input,
      slugTable: catalogue.slugTable,
      formerSlugs: catalogue.formerSlugs,
    });
    expect(rebuilt.routes).toEqual(catalogue.routes);
  });

  test.each([
    ["missing", "noaa/missing"],
    ["wrong kind", "noaa/PUG1701"],
    ["self", "ticon/seattle"],
  ])("rejects a %s same-gauge target", (_label, sameGauge) => {
    const input = fixtures();
    input.tides.push({ ...input.tides[0]!, id: "ticon/seattle" });
    input.corrections.set("ticon/seattle", { sameGauge });
    expect(() => buildCatalogue(input)).toThrow(/sameGauge/);
  });

  test("same-gauge links point directly to the owner, not through another relay", () => {
    const input = fixtures();
    input.tides.push(
      { ...input.tides[0]!, id: "ticon/relay" },
      { ...input.tides[0]!, id: "ticon/seattle" },
    );
    input.corrections.set("ticon/relay", { sameGauge: "noaa/9447130" });
    input.corrections.set("ticon/seattle", { sameGauge: "ticon/relay" });
    expect(() => buildCatalogue(input)).toThrow(/sameGauge/);
  });

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

  test("an identity-only CHS tide station revives the slug tombstoned for its id", () => {
    const inputs = fixtures();
    inputs.slugTombstones = {
      tide: { "chs-abbotts-harbour": "abbotts-harbour" },
      current: {},
    };
    inputs.tides.push({
      id: "chs-abbotts-harbour",
      kind: "tide",
      name: "Abbotts Harbour",
      latitude: 43.663818,
      longitude: -65.824022,
      timezone: "America/Halifax",
      country: "Canada",
      country_code: "CA",
      type: "reference",
      harmonic_constituents: [],
    });

    const catalogue = buildCatalogue(inputs);
    expect(catalogue.slugTable.tide["chs-abbotts-harbour"]).toBe(
      "abbotts-harbour",
    );
    expect(catalogue.slugTombstones.tide).toEqual({});
    expect(catalogue.formerSlugs.tide["chs-abbotts-harbour"]).toBeUndefined();
  });
});
