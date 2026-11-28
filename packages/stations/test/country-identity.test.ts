import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProductionCatalogue } from "../load-catalogue.ts";
import { readFileSync } from "node:fs";
import { expect, test, vi } from "vitest";
import * as currentInput from "../current-input.ts";
import * as chsInput from "../chs-input.ts";
import * as geocode from "../geocode.ts";
import * as maritimeZones from "../maritime-zones.ts";
import * as waterBodies from "../water-bodies.ts";
import { normalize } from "../station.ts";
import { mergeHarmonicDatums } from "../regenerate-harmonic-datums.ts";
import { winsOnAuthority } from "../filtering.ts";
import {
  loadCorrections,
  validateMetadata,
  resolveMetadata,
} from "../metadata.ts";

const dalian = JSON.parse(
  readFileSync(
    new URL(
      "../../../data/ticon/dalian-630a-chn-uhslc_rq.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

test("normalization preserves the identity of an uncoded legacy China record before its display name changes", () => {
  const { country_code: _code, ...legacy } = dalian;
  const stored = normalize(legacy);
  expect(stored.country_code).toBe("CN");
  expect(stored.chart_datum).toBe("TLT");
  expect(stored.datums["TLT"]).toBe(legacy.datums.TLT);
  const renamed = normalize({
    ...stored,
    country: "People's Republic of China",
  });
  expect(renamed.country_code).toBe("CN");
  expect(renamed.chart_datum).toBe("TLT");
  expect(renamed.datums["TLT"]).toBe(legacy.datums.TLT);
});

test("normalization resolves an uncoded alpha-3 identity supplied by an importer", () => {
  const { country_code: _code, ...uncoded } = dalian;
  expect(normalize({ ...uncoded, country: "CHN" }).country_code).toBe("CN");
});

test.each(["ZZ", "cn", "CHN", ""])(
  "an invalid explicit country code cannot fall back to the label: %s",
  (country_code) => {
    expect(() =>
      normalize({ ...dalian, country: "China", country_code }),
    ).toThrow(/country code/i);
  },
);

test("metadata's provider fallback uses the stored ISO identity instead of its display name", () => {
  const resolved = resolveMetadata(
    {
      ...dalian,
      id: "ticon/dalian",
      country: "People's Republic of China",
      country_code: "CN",
    },
    { geocoder: { near: () => [], nearest: () => null } },
  );
  expect(resolved.country_code).toBe("CN");
});

test("NOAA jurisdiction survives a renamed territory when its ISO code is stored", () => {
  const source = { name: "US National Oceanic and Atmospheric Administration" };
  expect(
    winsOnAuthority({
      id: "noaa/9751540",
      type: "subordinate",
      source,
      country: "United States Virgin Islands",
      country_code: "VI",
    }),
  ).toBe(true);
  expect(
    winsOnAuthority({
      id: "noaa/unresearched",
      type: "subordinate",
      source,
      country: "Unknown territory",
    }),
  ).toBe(false);
  expect(
    winsOnAuthority({
      id: "other/9751540",
      type: "subordinate",
      source: { name: "TICON-4" },
      country: "United States Virgin Islands",
      country_code: "VI",
    }),
  ).toBe(false);
});

test("regeneration refuses an unresolved country before silently pruning TLT", () => {
  const { country_code: _code, ...uncoded } = dalian;
  expect(() =>
    mergeHarmonicDatums(
      "ticon",
      { ...uncoded, country: "ZZ" },
      { MSL: 0, LAT: -1, TLT: -1 },
    ),
  ).toThrow(/country/i);
});

test("catalogue loading retains a coded source's identity when its display label differs", async () => {
  const root = await mkdtemp(join(tmpdir(), "country-catalogue-"));
  // This fixture checks source identity; worldwide currents and geography
  // are covered by the production catalogue build and their own suites.
  const mocks = [
    vi.spyOn(currentInput, "currentInputs").mockReturnValue([]),
    vi.spyOn(chsInput, "chsInputs").mockReturnValue([]),
    vi.spyOn(geocode, "loadGeocoder").mockResolvedValue({
      nearest: () => null,
      near: () => [],
    }),
    vi.spyOn(maritimeZones, "loadMaritimeZones").mockResolvedValue({
      country: () => undefined,
    }),
    vi
      .spyOn(waterBodies, "loadWaterBodies")
      .mockResolvedValue({ at: () => [] }),
  ];
  try {
    await mkdir(join(root, "data", "ticon"), { recursive: true });
    const id = "ticon/test-china";
    await writeFile(
      join(root, "data", "ticon", "test-china.json"),
      JSON.stringify({
        ...dalian,
        country: "People's Republic of China",
        country_code: "CN",
        source: { ...dalian.source, id: "test-china" },
      }),
    );
    const catalogue = await loadProductionCatalogue(
      root,
      [],
      new Map([[id, { id, accepted: true, score: 100 }]]),
    );
    expect(catalogue.stations).toHaveLength(1);
    expect(
      catalogue.stations.find((station) => station.id === id),
    ).toMatchObject({
      country_code: "CN",
      chart_datum: "TLT",
      datums: { TLT: dalian.datums.TLT },
    });
  } finally {
    for (const mock of mocks) mock.mockRestore();
    await rm(root, { recursive: true, force: true });
  }
});

test("an unknown source label cannot inherit a nearby country's identity", () => {
  const { country_code: _code, ...uncoded } = dalian;
  const place = {
    name: "Nearby",
    admin1: "",
    admin1Code: "",
    countryCode: "US",
    latitude: 0,
    longitude: 0,
    population: 0,
  };
  const nearby = { place, distance: 1, country: "United States" };
  expect(() =>
    resolveMetadata(
      { ...uncoded, id: "ticon/unknown", country: "Unknown country" },
      { geocoder: { near: () => [nearby], nearest: () => nearby } },
    ),
  ).toThrow(/no ISO country code/);
});
test("an unknown maritime-zone code retains the source fallback", () => {
  expect(
    resolveMetadata(
      { ...dalian, id: "ticon/dalian" },
      {
        geocoder: { near: () => [], nearest: () => null },
        maritimeZones: { country: () => "ZZ" },
      },
    ).country_code,
  ).toBe("CN");
});
test("a curated country typo is rejected even with a valid code", () => {
  const corrections = loadCorrections(
    "test/1:\n  location:\n    country: Canda\n    countryCode: CA\n",
  );
  expect(validateMetadata(corrections, new Map()).join("\n")).toMatch(
    /recognized country name/,
  );
});

test("direct metadata resolution rejects an invalid curated country", () => {
  expect(() =>
    resolveMetadata(
      { ...dalian, id: "ticon/dalian" },
      {
        geocoder: { near: () => [], nearest: () => null },
        correction: { location: { country: "Canda" } },
      },
    ),
  ).toThrow(/no ISO country code for Canda/);
});

test("metadata rejects an empty explicit country code instead of geocoding it", () => {
  expect(() =>
    resolveMetadata(
      {
        id: "test/empty",
        name: "Gauge",
        latitude: 0,
        longitude: 0,
        timezone: "UTC",
        country_code: "",
      },
      { geocoder: { near: () => [], nearest: () => null } },
    ),
  ).toThrow(/Invalid country code/);
});
