import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { openDatabase } from "../src/database/reader.ts";
import {
  PROJECT_CREDIT,
  attributionFor,
  isKnownSource,
} from "../src/attribution.ts";

const shipped = openDatabase(
  readFileSync(new URL("../src/generated/neaps.tcdb", import.meta.url)),
);

describe("attribution", () => {
  // The guard that keeps the credit table honest: a source added to the
  // database without a credit decision fails here rather than shipping
  // stations that quietly credit no one.
  test("every source in the shipped database has a credit decision", () => {
    const unknown = new Set<string>();
    for (let i = 0; i < shipped.stationsLength(); i++) {
      const name = shipped.stations(i)?.source()?.name();
      if (name && !isKnownSource(name)) unknown.add(name);
    }
    expect([...unknown]).toEqual([]);
  });

  test("appends the credit a CC BY source requires", () => {
    const credit = attributionFor("TICON-4");
    expect(credit.startsWith(`${PROJECT_CREDIT}. `)).toBe(true);
    expect(credit).toContain("Hart-Davis");
    expect(credit).toContain("https://doi.org/10.17882/109129");
  });

  test("gives a source that requires no credit the project line alone", () => {
    expect(
      attributionFor("US National Oceanic and Atmospheric Administration"),
    ).toBe(PROJECT_CREDIT);
    expect(attributionFor("Canadian Hydrographic Service")).toBe(
      PROJECT_CREDIT,
    );
  });

  test("falls back to the project line for an unrecognized source", () => {
    expect(attributionFor("Some Future Source")).toBe(PROJECT_CREDIT);
    expect(attributionFor(undefined)).toBe(PROJECT_CREDIT);
  });
});
