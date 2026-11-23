import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { countryByName, countryByIso } from "../country.ts";

test.each([
  ["Western Samoa", "WS", "Samoa"],
  ["Samoa", "WS", "Samoa"],
  ["Cape Verde", "CV", "Cape Verde"],
  ["Cabo Verde", "CV", "Cape Verde"],
  ["American Samoa", "AS", "American Samoa"],
])("resolves %s to %s", (name, iso2, country) => {
  expect(countryByName(name)).toMatchObject({ iso2, country });
});

test("rejects unknown country names", () => {
  expect(countryByName("Unknown country")).toBeNull();
});

test("uses Wikidata display names and keeps ambiguous shorthand unresolved", () => {
  expect(countryByName("People's Republic of China")).toMatchObject({
    iso2: "CN",
    country: "People's Republic of China",
  });
  expect(countryByName("Congo")).toBeNull();
  expect(countryByName("Virgin Islands")).toBeNull();
});

test("the production country binary covers every geocoder ISO identity", () => {
  const places = JSON.parse(
    readFileSync(
      new URL("../../../metadata/places.json", import.meta.url),
      "utf8",
    ),
  );
  const codes = [
    ...new Set<string>(
      places.map((place: { countryCode: string }) => place.countryCode),
    ),
  ];
  expect(codes.filter((code) => countryByIso(code)?.iso2 !== code)).toEqual([]);
});
test("ISO namespaces accept alpha-2, alpha-3 and numeric codes without guessing names", () => {
  for (const code of ["US", "usa", "840"])
    expect(countryByIso(code)?.iso2).toBe("US");
  for (const code of ["CS", "AN", "ZZ", "United States", "123", " "])
    expect(countryByIso(code)).toBeNull();
});
