import { describe, expect, test } from "vitest";
import type { GeocodeResult, Geocoder } from "../geocode.ts";
import {
  loadCorrections,
  loadRegistry,
  registryStations,
  resolveMetadata,
  validateMetadata,
} from "../metadata.ts";
import type { StationInput } from "@slackwater/database";

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
  test("keeps the geocoder's region spelling for a raw TICON name", () => {
    const result = resolveMetadata(
      { ...baseStation, id: "ticon/everett", name: "Everett" },
      { geocoder },
    );
    expect(result.region).toBe("WA");
  });

  test("keeps a NOAA site's Roman numeral when it conflicts with the nearby state", () => {
    const result = resolveMetadata(
      {
        ...baseStation,
        id: "noaa/kb0501",
        kind: "current",
        name: "Kings Bay, Site VI",
      },
      { geocoder },
    );
    expect(result).toMatchObject({
      name: "Kings Bay, Site VI",
      region_code: "US-WA",
    });
  });

  test.each(["Bayou_Liberty_Near_SlidellLa", "Bayou Liberty near Slidell LA"])(
    "takes the region from the raw name before a nearby state's: %s",
    (name) => {
      const result = resolveMetadata(
        { ...baseStation, id: "ticon/bayou", name },
        { geocoder },
      );
      expect(result).toMatchObject({
        name: "Bayou Liberty near Slidell",
        region: "LA",
        region_code: "US-LA",
      });
    },
  );

  test("a raw Canadian province beats a nearby province", () => {
    const canada: GeocodeResult = {
      ...everett,
      country: "Canada",
      region: "Alberta",
      place: {
        ...everett.place,
        countryCode: "CA",
        admin1: "Alberta",
        admin1Code: "01",
      },
    };
    const result = resolveMetadata(
      {
        ...baseStation,
        name: "WadhamsBC",
        id: "ticon/wadhams",
        country: "Canada",
        country_code: "CA",
      },
      { geocoder: { nearest: () => canada, near: () => [canada] } },
    );
    expect(result).toMatchObject({
      name: "Wadhams",
      region: "British Columbia",
      region_code: "CA-BC",
    });
  });

  test("a province published by another provider beats a nearby province", () => {
    const canada = {
      ...everett,
      country: "Canada",
      place: {
        ...everett.place,
        countryCode: "CA",
        admin1: "Alberta",
        admin1Code: "01",
      },
    };
    const result = resolveMetadata(
      {
        ...baseStation,
        name: "Gauge",
        country: "Canada",
        country_code: "CA",
        region: "British Columbia",
      },
      { geocoder: { nearest: () => canada, near: () => [canada] } },
    );
    expect(result).toMatchObject({
      region: "British Columbia",
      region_code: "CA-BC",
    });
  });

  test("an unambiguous code from another provider beats a nearby state", () => {
    const result = resolveMetadata(
      { ...baseStation, name: "Gauge_LA" },
      { geocoder },
    );
    expect(result.region_code).toBe("US-LA");
  });

  test("resolves an opaque raw name to the nearest place", () => {
    const result = resolveMetadata(
      { ...baseStation, id: "ticon/s197", name: "S197_T" },
      { geocoder },
    );
    expect(result.name).toBe("Everett");
  });

  test("keeps a NOAA pier name that resembles an opaque TICON code", () => {
    const result = resolveMetadata(
      { ...baseStation, id: "noaa/SFB1206", kind: "current", name: "Pier 23" },
      { geocoder },
    );
    expect(result.name).toBe("Pier 23");
  });

  test.each([
    [50, "Everett"],
    [51, "S197"],
  ])("resolves an opaque name at %s km to %s", (distance, name) => {
    const distant = { ...everett, distance };
    const result = resolveMetadata(
      { ...baseStation, id: "ticon/s197", name: "S197_T" },
      { geocoder: { nearest: () => distant, near: () => [distant] } },
    );
    expect(result.name).toBe(name);
  });

  test("a curated name outranks the opaque-name fallback", () => {
    const result = resolveMetadata(
      { ...baseStation, id: "ticon/s197", name: "S197_T" },
      { geocoder, correction: { name: "Gauge at the Pier" } },
    );
    expect(result.name).toBe("Gauge at the Pier");
  });

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

  test("codes a US state from the provider when the nearest place is foreign", () => {
    const stewart: GeocodeResult = {
      ...everett,
      place: {
        ...everett.place,
        name: "Stewart",
        admin1: "British Columbia",
        admin1Code: "02",
        countryCode: "CA",
      },
      country: "Canada",
      region: "British Columbia",
    };
    const result = resolveMetadata(
      {
        ...baseStation,
        id: "noaa/9450831",
        name: "Hyder, Portland Canal",
        region: "AK",
      },
      { geocoder: { nearest: () => stewart, near: () => [stewart] } },
    );

    expect(result).toMatchObject({
      country_code: "US",
      region: "AK",
      region_code: "US-AK",
    });
    expect(result).not.toHaveProperty("locality");
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

  test.each([
    "N.J.",
    "Md.",
    "Va.",
    "Pa.",
    "N.Y.",
    "B.C.",
    "Del.",
    "Wash.",
    "Oreg.",
    "Alaska",
    "D.C.",
    "S.C.",
    "NL",
    "PEI",
    "Lab",
    "R.I.",
    "V.I.",
  ])("a provider's region qualifier is not its water: %s", (qualifier) => {
    const result = resolveMetadata(
      { ...baseStation, name: `Alpine, ${qualifier}` },
      {
        geocoder,
        waterBodies: { at: () => [{ name: "Hudson River", distance: 0 }] },
      },
    );
    expect(result.name).toBe("Alpine");
    expect(result.context).toBe("Hudson River");
    expect(result.context_derived).toBe(true);
  });

  test("keeps a water qualifier beside a state abbreviation", () => {
    const result = resolveMetadata(
      { ...baseStation, name: "Mills Point, Wicomico River, Md." },
      { geocoder },
    );
    expect(result.name).toBe("Mills Point");
    expect(result.context).toBe("Wicomico River");
    expect(result.context_derived).toBe(false);
  });

  test("leaves context absent when a region qualifier has no water or town", () => {
    const result = resolveMetadata(
      { ...baseStation, name: "Alpine, N.J." },
      { geocoder: { nearest: () => null, near: () => [] } },
    );
    expect(result).not.toHaveProperty("context");
    expect(result).not.toHaveProperty("context_derived");
  });

  test.each(["N.J.", "NJ", "B.C.", "NL"])(
    "a discarded region qualifier falls back only to water: %s",
    (qualifier) => {
      const result = resolveMetadata(
        { ...baseStation, name: `Alpine, ${qualifier}` },
        { geocoder, waterBodies: { at: () => [] } },
      );
      expect(result).not.toHaveProperty("context");
      expect(result).not.toHaveProperty("context_derived");
    },
  );

  test.each([
    "Columbia_Slough_At_Portland_Or",
    "Abercorn_Creek_Near_SavannahGa",
    "USCG Station NY",
  ])("an extracted region suffix falls back only to water: %s", (name) => {
    const station = { ...baseStation, id: "ticon/region-suffix", name };
    const absent = resolveMetadata(station, {
      geocoder,
      waterBodies: { at: () => [] },
    });
    expect(absent).not.toHaveProperty("context");
    expect(absent).not.toHaveProperty("context_derived");
    const withWater = resolveMetadata(station, {
      geocoder,
      waterBodies: { at: () => [{ name: "Test River", distance: 0 }] },
    });
    expect(withWater.context).toBe("Test River");
    expect(withWater.context_derived).toBe(true);
  });

  test("does not use the state alone when the nearest town repeats the name", () => {
    const result = resolveMetadata(baseStation, {
      geocoder,
      waterBodies: { at: () => [] },
    });
    expect(result).not.toHaveProperty("context");
    expect(result).not.toHaveProperty("context_derived");
  });

  test("a remote CHS station without water has no invented coast or province context", () => {
    const result = resolveMetadata(
      {
        ...baseStation,
        country: "Canada",
        country_code: "CA",
        region: "British Columbia",
        source: {
          name: "Canadian Hydrographic Service",
          id: "chs-everett",
          published_harmonics: false,
          url: "https://example.com/chs",
        },
      },
      { geocoder: { nearest: () => null, near: () => [] } },
    );
    expect(result.region_code).toBe("CA-BC");
    expect(result).not.toHaveProperty("context");
    expect(result).not.toHaveProperty("context_derived");
  });

  test.each([
    "Deer Island, 0.7 nm ESE of",
    "Cape Cod Canal, east end",
    "Goose Cove, south of Chops Passage, Kennebec River",
  ])("keeps the NOAA current qualifier in its name: %s", (name) => {
    const result = resolveMetadata(
      { ...baseStation, id: "noaa/BOS1110", kind: "current", name },
      { geocoder: { nearest: () => null, near: () => [] } },
    );

    expect(result.name).toBe(name);
    expect(result).not.toHaveProperty("context");
    expect(result).not.toHaveProperty("context_derived");
  });

  test("a NOAA current's context comes from its water, not its bearing", () => {
    const result = resolveMetadata(
      {
        ...baseStation,
        id: "noaa/BOS1110",
        kind: "current",
        name: "Deer Island, 0.7 nm ESE of",
      },
      {
        geocoder,
        waterBodies: { at: () => [{ name: "Boston Harbor", distance: 0 }] },
      },
    );

    expect(result.context).toBe("Boston Harbor");
    expect(result.context_derived).toBe(true);
  });

  test("a NOAA current skips a water its own name already gives", () => {
    const result = resolveMetadata(
      {
        ...baseStation,
        id: "noaa/PUG1513",
        kind: "current",
        name: "Rich Passage, East End",
      },
      {
        geocoder,
        waterBodies: {
          at: () => [
            { name: "Rich Passage", distance: 0 },
            { name: "Puget Sound", distance: 0 },
          ],
        },
      },
    );

    expect(result.name).toBe("Rich Passage, East End");
    expect(result.context).toBe("Puget Sound");
  });

  test("a NOAA current keeps its curated name and water", () => {
    const result = resolveMetadata(
      {
        ...baseStation,
        id: "noaa/BOS1110",
        kind: "current",
        name: "Deer Island, 0.7 nm ESE of",
      },
      {
        geocoder,
        correction: { name: "Deer Island", context: "Boston Harbor" },
      },
    );

    expect(result.name).toBe("Deer Island");
    expect(result.context).toBe("Boston Harbor");
    expect(result.context_derived).toBe(false);
  });

  test("other current providers still split their water qualifier", () => {
    const result = resolveMetadata(
      {
        ...baseStation,
        id: "other/1",
        kind: "current",
        name: "Friday Harbor, San Juan Channel",
      },
      { geocoder },
    );

    expect(result.name).toBe("Friday Harbor");
    expect(result.context).toBe("San Juan Channel");
    expect(result.context_derived).toBe(false);
  });

  test("a code-only country correction outranks zone and provider country", () => {
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
      maritimeZones: { country: () => "US" },
    });

    expect(result.country).toBe("Canada");
    expect(result.country_code).toBe("CA");
    expect(result.region).toBe("British Columbia");
    expect(result.region_code).toBe("CA-BC");
  });

  test("keeps Hanbury Point in Washington despite the maritime boundary", () => {
    const result = resolveMetadata(
      {
        ...baseStation,
        id: "noaa/9449828",
        name: "Hanbury Point",
        latitude: 48.5817,
        longitude: -123.17,
      },
      {
        // As its station file pins it.
        correction: { location: { countryCode: "US", regionCode: "US-WA" } },
        geocoder,
        maritimeZones: { country: () => "CA" },
      },
    );

    expect(result.country_code).toBe("US");
    expect(result.region_code).toBe("US-WA");
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
      {
        ...baseStation,
        name: "Alert Bay BC",
        country: "Canada",
        country_code: "CA",
        region: "02",
      },
      { geocoder: { nearest: () => canada, near: () => [canada] } },
    );

    expect(result.name).toBe("Alert Bay");
    expect(result.region).toBe("British Columbia");
    expect(result.region_code).toBe("CA-BC");
    expect(result).not.toHaveProperty("context");
    expect(result).not.toHaveProperty("context_derived");
  });

  test("prefers the GeoNames display region over a name-derived code", () => {
    const newYork: GeocodeResult = {
      ...everett,
      region: "NY",
      place: {
        ...everett.place,
        name: "Niagara Falls",
        admin1: "New York",
        admin1Code: "NY",
      },
    };
    const result = resolveMetadata(
      {
        ...baseStation,
        name: "Ashland Ave NY",
        region: "08",
      },
      { geocoder: { nearest: () => newYork, near: () => [newYork] } },
    );

    expect(result.region).toBe("New York");
    expect(result.region_code).toBe("US-NY");
  });

  test("omits numeric GeoNames subdivision sentinels", () => {
    const apia: GeocodeResult = {
      ...everett,
      country: "Western Samoa",
      continent: "Oceania",
      region: undefined,
      place: {
        ...everett.place,
        name: "Vaiala",
        admin1: "00",
        admin1Code: "00",
        countryCode: "WS",
      },
    };
    const result = resolveMetadata(
      {
        ...baseStation,
        id: "ticon/apia-401-wsm-uhslc_fd",
        name: "Apia",
        country: "Western Samoa",
        country_code: "WS",
        region: "00",
      },
      { geocoder: { nearest: () => apia, near: () => [apia] } },
    );

    expect(result).not.toHaveProperty("region");
    expect(result.context).toBe("Vaiala");
    expect(result.country).toBe("Samoa");
    expect(result.country_code).toBe("WS");
  });

  test("lifts a trailing territory code when geocoding has no US region", () => {
    const result = resolveMetadata(
      {
        ...baseStation,
        name: "San Juan PR",
        region: "San Juan",
      },
      { geocoder: { nearest: () => null, near: () => [] } },
    );

    expect(result.name).toBe("San Juan");
    expect(result.region_code).toBe("US-PR");
  });

  test("lifts a Canadian province when the provider region is opaque", () => {
    const result = resolveMetadata(
      {
        ...baseStation,
        name: "Alert Bay BC",
        country: "Canada",
        country_code: "CA",
        region: "02",
      },
      { geocoder: { nearest: () => null, near: () => [] } },
    );

    expect(result.name).toBe("Alert Bay");
    expect(result.region).toBe("British Columbia");
    expect(result.region_code).toBe("CA-BC");
  });

  test("takes a Canadian province from the provider region when no place is in reach", () => {
    const result = resolveMetadata(
      {
        ...baseStation,
        name: "Carpenter Bay",
        country: "Canada",
        country_code: "CA",
        region: "British Columbia",
      },
      { geocoder: { nearest: () => null, near: () => [] } },
    );

    expect(result.region).toBe("British Columbia");
    expect(result.region_code).toBe("CA-BC");
  });

  test("names the water body the station sits in", () => {
    const result = resolveMetadata(baseStation, {
      geocoder,
      waterBodies: { at: () => [{ name: "Port Gardner", distance: 0 }] },
    });

    expect(result.context).toBe("Port Gardner");
    expect(result.context_derived).toBe(true);
  });

  test("skips a water body that repeats the name", () => {
    const result = resolveMetadata(
      { ...baseStation, name: "NEAH-BAY" },
      {
        geocoder,
        waterBodies: {
          at: () => [
            { name: "Neah Bay", distance: 0 },
            { name: "Strait of Juan de Fuca", distance: 0 },
          ],
        },
      },
    );

    expect(result.context).toBe("Strait of Juan de Fuca");
  });

  test("falls back to the nearest place outside any water body", () => {
    const result = resolveMetadata(
      { ...baseStation, name: "Priest Point" },
      { geocoder, waterBodies: { at: () => [] } },
    );

    expect(result.context).toBe("Everett, WA");
    expect(result.context_derived).toBe(true);
  });

  describe("a derived context names the place a reader knows", () => {
    const at = (name: string, distance: number, population: number) => ({
      ...everett,
      place: { ...everett.place, name, population },
      distance,
    });
    const resolveNear = (places: GeocodeResult[]) =>
      resolveMetadata(
        { ...baseStation, name: "Priest Point" },
        {
          geocoder: { nearest: () => places[0] ?? null, near: () => places },
          waterBodies: { at: () => [] },
        },
      );

    test("a city beats a neighbourhood a kilometre nearer", () => {
      const result = resolveNear([
        at("Riverside", 1, 0),
        at("Everett", 2, 110629),
      ]);
      expect(result.context).toBe("Everett, WA");
      expect(result.context_derived).toBe(true);
    });

    test("a genuinely nearest town keeps its label", () => {
      const result = resolveNear([
        at("Mukilteo", 1, 21000),
        at("Seattle", 30, 750000),
      ]);
      expect(result.context).toBe("Mukilteo, WA");
    });

    test("a section of a city places the station but never labels it", () => {
      const southBoston = {
        ...at("South Boston", 1, 571281),
        place: { ...at("South Boston", 1, 571281).place, section: true },
      };
      const result = resolveNear([southBoston, at("Everett", 6, 110629)]);
      expect(result.context).toBe("Everett, WA");
      expect(result.locality).toBe("South Boston");
    });

    test("locality stays the nearest place", () => {
      const result = resolveNear([
        at("Riverside", 1, 0),
        at("Everett", 2, 110629),
      ]);
      expect(result.locality).toBe("Riverside");
    });

    test("a place past the derived range is never the label", () => {
      const result = resolveNear([
        at("Riverside", 1, 0),
        at("Seattle", 45, 750000),
      ]);
      expect(result.context).toBe("Riverside, WA");
    });

    test("a place that restates the name with accents is still a restatement", () => {
      const mayaguez: GeocodeResult = {
        place: {
          name: "Mayagüez",
          admin1: "Mayagüez",
          admin1Code: "97",
          countryCode: "PR",
          latitude: 18.2,
          longitude: -67.14,
          population: 70000,
        },
        distance: 1,
        country: "Puerto Rico",
        continent: "North America",
        region: "Mayagüez",
      };
      const result = resolveMetadata(
        {
          ...baseStation,
          id: "noaa/9759394",
          name: "Mayaguez",
          latitude: 18.22,
          longitude: -67.16,
          country: "Puerto Rico",
          country_code: "PR",
        },
        {
          geocoder: { nearest: () => mayaguez, near: () => [mayaguez] },
          waterBodies: { at: () => [] },
        },
      );
      expect(result).not.toHaveProperty("context");
      expect(result).not.toHaveProperty("context_derived");
    });

    test("a US territory is named like a state, not by its municipality", () => {
      const carolina: GeocodeResult = {
        place: {
          name: "Carolina",
          admin1: "Carolina",
          admin1Code: "31",
          countryCode: "PR",
          latitude: 18.38,
          longitude: -65.96,
          population: 170000,
        },
        distance: 3,
        country: "Puerto Rico",
        continent: "North America",
        region: "Carolina",
      };
      const result = resolveMetadata(
        {
          ...baseStation,
          id: "noaa/9754986",
          name: "Punta Cangrejos",
          latitude: 18.46,
          longitude: -65.99,
          country: "Puerto Rico",
          country_code: "PR",
        },
        {
          geocoder: { nearest: () => carolina, near: () => [carolina] },
          waterBodies: { at: () => [] },
        },
      );
      expect(result.context).toBe("Carolina, PR");
    });
  });

  test("a provider qualifier outranks the water body", () => {
    const result = resolveMetadata(
      { ...baseStation, name: "Friday Harbor, San Juan Island" },
      {
        geocoder,
        waterBodies: { at: () => [{ name: "San Juan Channel", distance: 0 }] },
      },
    );

    expect(result.context).toBe("San Juan Island");
    expect(result.context_derived).toBe(false);
  });

  describe("across a strait from the nearest places", () => {
    const sidney: GeocodeResult = {
      ...everett,
      country: "Canada",
      region: "British Columbia",
      place: {
        ...everett.place,
        name: "Sidney",
        admin1: "British Columbia",
        admin1Code: "02",
        countryCode: "CA",
      },
    };
    const fridayHarbor: GeocodeResult = {
      ...everett,
      distance: 24,
      place: { ...everett.place, name: "Friday Harbor" },
    };
    const resolve = (zone: string) =>
      resolveMetadata(
        { ...baseStation, id: "noaa/PUG1717", name: "Turn Point" },
        {
          geocoder: {
            nearest: () => sidney,
            near: (_lat, _lon, maxResults = 5) =>
              maxResults > 10 ? [sidney, fridayHarbor] : [sidney],
          },
          maritimeZones: { country: () => zone },
        },
      );

    test("finds a region when the maritime zone confirms the country", () => {
      const result = resolve("US");

      expect(result.country_code).toBe("US");
      expect(result.region).toBe("Washington");
      expect(result.region_code).toBe("US-WA");
      expect(result.locality).toBe("Friday Harbor");
    });

    test("takes country and region from the maritime zone when the provider disagrees", () => {
      const result = resolve("CA");

      expect(result.country_code).toBe("CA");
      expect(result.region).toBe("British Columbia");
      expect(result.region_code).toBe("CA-BC");
      expect(result.locality).toBe("Sidney");
    });
  });

  test("takes a registry station's country from its maritime zone", () => {
    const registry = loadRegistry(`
chs-port-renfrew:
  name: Port Renfrew
  position: [48.555, -124.421]
  provider: chs
`);
    const [result] = registryStations({
      registry,
      geocoder,
      maritimeZones: { country: () => "CA" },
    });

    expect(result!.country).toBe("Canada");
    expect(result!.country_code).toBe("CA");
    expect(result).not.toHaveProperty("region");
  });

  test("a station pinned to no region takes none, even one its provider names", () => {
    const result = resolveMetadata(
      { ...baseStation, region_code: "US-WA" },
      {
        correction: { location: { countryCode: "US", regionCode: null } },
        geocoder,
      },
    );
    expect(result.region_code).toBeUndefined();
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
chs-fitted:
  name: Seymour Narrows
  position: [50.1, -125.35]
  provider: chs
  kind: current
  chsFit:
    tier: online
    miss:
      clause: slack_median
      value: null
    evidence: fit-2026-10-22-8f85912-r2
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
          id: "chs-fitted",
          current: expect.objectContaining({
            chs_fit: {
              tier: "online",
              miss: { clause: "slack_median", value: null },
              evidence: "fit-2026-10-22-8f85912-r2",
            },
          }),
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

  test("a curated position must fit every record of its station", () => {
    const corrections = loadCorrections("test/1:\n  position: [49, -123]\n");
    expect(
      validateMetadata(
        corrections,
        new Map(),
        [
          { ...baseStation, id: "test/1", latitude: 49, longitude: -123 },
          { ...baseStation, id: "test/2", latitude: 50, longitude: -123 },
        ],
        new Map([["test/1", ["test/1", "test/2"]]]),
      ).join("\n"),
    ).toMatch(/corrected position is 111\.\d km/);
  });

  test("rejects an implausibly distant position correction", () => {
    const corrections = loadCorrections(`
test/1:
  position: [50, -125]
`);
    expect(
      validateMetadata(corrections, new Map(), [
        { ...baseStation, id: "test/1", latitude: 49, longitude: -123 },
      ]).join("\n"),
    ).toMatch(/test\/1.*corrected position/);
  });

  test("accepts a curated name that splits a squashed published name", () => {
    const corrections = loadCorrections("test/1:\n  name: Marsden Point\n");
    expect(
      validateMetadata(corrections, new Map(), [
        { ...baseStation, id: "test/1", name: "Marsdenpt" },
      ]),
    ).toEqual([]);
  });

  test("rejects a curated name attached to a different published station", () => {
    const corrections = loadCorrections("test/1:\n  name: Anacortes\n");
    expect(
      validateMetadata(corrections, new Map(), [
        { ...baseStation, id: "test/1", name: "Swinomish Channel Entrance" },
      ]).join("\n"),
    ).toMatch(/test\/1.*Anacortes.*Swinomish Channel Entrance/);
  });

  test.each([
    ["Büsum", "Bsum"],
    ["Bu\u0308sum", "Bsum"],
    ["Buttelerhörne", "Buttelerhrne"],
    ["Emshörn", "Emshrn"],
    ["Hörnum", "Hrnum"],
    ["Lübeck-Bauhof", "Lbeckbauhof"],
    ["Reithörne", "Reithrne"],
    ["Scharhörn", "Scharhrn"],
    ["Schleimünde SP", "Schleimndesp"],
    ["Travemünde", "Travemnde"],
    ["Ueckermünde", "Ueckermnde"],
    ["Warnemünde", "Warnemnde"],
    ["Wittower Fähre", "Wittowerfhre"],
  ])(
    "accepts %s when the source deleted non-ASCII letters",
    (name, published) => {
      const corrections = loadCorrections(`test/1:\n  name: ${name}\n`);
      expect(
        validateMetadata(corrections, new Map(), [
          { ...baseStation, id: "test/1", name: published },
        ]),
      ).toEqual([]);
    },
  );

  test.each([
    ["Büsum", "Bsumhaven"],
    ["Büsum", "Busam"],
    ["Äöx", "X"],
  ])("rejects %s as a correction for %s", (name, published) => {
    const corrections = loadCorrections(`test/1:\n  name: ${name}\n`);
    expect(
      validateMetadata(corrections, new Map(), [
        { ...baseStation, id: "test/1", name: published },
      ]),
    ).toEqual([
      `test/1: curated name ${JSON.stringify(name)} shares no meaningful word with published name ${JSON.stringify(published)}`,
    ]);
  });

  test("accepts a curated name that restores the accents a source dropped", () => {
    const corrections = loadCorrections(
      "test/1:\n  name: E4-bron Södertälje\n",
    );
    expect(
      validateMetadata(corrections, new Map(), [
        { ...baseStation, id: "test/1", name: "E4Bron Sodertalje" },
      ]),
    ).toEqual([]);
  });
});
