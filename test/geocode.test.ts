import { describe, test, expect, beforeAll } from "vitest";
import { loadGeocoder, type Geocoder } from "../tools/geocode.js";

describe("geocoder", () => {
  let geocoder: Geocoder;

  beforeAll(async () => {
    geocoder = await loadGeocoder();
  }, 120_000); // allow time for download on first run

  test("finds San Francisco near Golden Gate", () => {
    // Golden Gate coordinates
    const result = geocoder.nearest(37.8, -122.47);
    expect(result).not.toBeNull();
    expect(result!.place.name).toBe("San Francisco");
    expect(result!.place.countryCode).toBe("US");
    expect(result!.place.admin1Code).toBe("CA");
    expect(result!.distance).toBeLessThan(15);
  });

  test("finds Brest from offshore point", () => {
    // Point in the Bay of Brest, ~5km offshore
    const result = geocoder.nearest(48.35, -4.55);
    expect(result).not.toBeNull();
    expect(result!.place.countryCode).toBe("FR");
    expect(result!.distance).toBeLessThan(20);
  });

  test("finds place near CRMS station in Louisiana", () => {
    // CRMS0572 coordinates: ~30.10, -89.79
    const result = geocoder.nearest(30.1, -89.79);
    expect(result).not.toBeNull();
    expect(result!.place.countryCode).toBe("US");
    expect(result!.place.admin1Code).toBe("LA");
  });

  test("returns null for very remote ocean point with small maxDistance", () => {
    // Middle of Pacific Ocean
    const result = geocoder.nearest(0, -160, 10);
    expect(result).toBeNull();
  });

  test("near returns multiple results sorted by distance", () => {
    const results = geocoder.near(37.8, -122.47, 3);
    expect(results.length).toBeGreaterThanOrEqual(2);
    // Should be sorted by distance
    for (let i = 1; i < results.length; i++) {
      expect(results[i]!.distance).toBeGreaterThanOrEqual(
        results[i - 1]!.distance,
      );
    }
  });

  test("admin1 resolves to human-readable name", () => {
    const result = geocoder.nearest(37.8, -122.47);
    expect(result).not.toBeNull();
    expect(result!.place.admin1).toBe("California");
  });

  test("uses a display name for Canadian subdivisions", () => {
    const result = geocoder.nearest(48.37, -123.73);
    expect(result?.place.countryCode).toBe("CA");
    expect(result?.region).toBe("British Columbia");
  });
});
