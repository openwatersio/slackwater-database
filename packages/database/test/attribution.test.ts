import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { openDatabase } from "../src/database/reader.ts";
import {
  MODIFICATIONS_URL,
  PROJECT_CREDIT,
  attributionFor,
  isKnownSource,
} from "../src/attribution.ts";

const shipped = openDatabase(
  readFileSync(new URL("../src/generated/neaps.tcdb", import.meta.url)),
);

const ccBy = {
  type: "cc-by-4.0",
  url: "https://creativecommons.org/licenses/by/4.0/",
};
const ccByNc = {
  type: "cc-by-nc-4.0",
  url: "https://creativecommons.org/licenses/by-nc/4.0/",
};
const publicDomain = {
  type: "public domain",
  url: "https://tidesandcurrents.noaa.gov/disclaimers.html",
};

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

  // The builder bakes the notice into the file, so a reader in any language
  // gets it without a table of its own.
  test("every station in the shipped database carries its notice", () => {
    for (let i = 0; i < shipped.stationsLength(); i++) {
      const t = shipped.stations(i)!;
      const license = t.license();
      expect(t.attribution()).toBe(
        attributionFor(t.source()?.name()!, {
          type: license!.type()!,
          url: license!.url()!,
        }),
      );
    }
  });

  // What a CC BY redistributor has to pass on (section 3(a)(1)): who made it,
  // the licence and its URI, and that it was modified.
  test("a CC BY station gets a complete notice", () => {
    const notice = attributionFor("TICON-4", ccBy);
    expect(notice.startsWith(`${PROJECT_CREDIT}. `)).toBe(true);
    expect(notice).toContain("Hart-Davis");
    expect(notice).toContain("https://doi.org/10.17882/109129");
    expect(notice).toContain(
      "Licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)",
    );
    expect(notice).toContain(`Modified: see ${MODIFICATIONS_URL}`);
  });

  test("a CC BY-NC station names its own licence", () => {
    const notice = attributionFor("TICON-4", ccByNc);
    expect(notice).toContain(
      "Licensed CC BY-NC 4.0 (https://creativecommons.org/licenses/by-nc/4.0/)",
    );
    expect(notice).not.toContain("CC BY 4.0 (");
  });

  // Public domain imposes no notice, so nothing is put on the consumer.
  test("a source and licence requiring no notice give the project line alone", () => {
    expect(
      attributionFor(
        "US National Oceanic and Atmospheric Administration",
        publicDomain,
      ),
    ).toBe(PROJECT_CREDIT);
  });

  test("falls back to the project line for an unrecognized source", () => {
    expect(attributionFor("Some Future Source", undefined)).toBe(
      PROJECT_CREDIT,
    );
    expect(attributionFor(undefined, undefined)).toBe(PROJECT_CREDIT);
  });
});
