import {
  CountryRegistry,
  type ConversionResult,
  type Namespace,
} from "@openwaters/c5y-n8r";
import { countryBytesBase64 } from "./country-bytes.ts" with { type: "macro" };

let registry: CountryRegistry | undefined;
function countries(): CountryRegistry {
  if (!registry) {
    const binary = atob(countryBytesBase64());
    registry = CountryRegistry.open(
      Uint8Array.from(binary, (character) => character.charCodeAt(0)),
    );
  }
  return registry;
}

function currentCountry(result: ConversionResult) {
  const usable = (candidate: typeof result.source.preferred) =>
    candidate &&
    (candidate.applicability === "active" ||
      (candidate.applicability === "uncertain" && candidate.tentative));
  const target = result.target.preferred;
  return usable(result.source.preferred) && usable(target) ? target : undefined;
}

function countryInfo(result: ConversionResult) {
  const target = currentCountry(result);
  if (!target) return null;
  return {
    iso2: target.value,
    country: target.name,
    continent: target.continent,
  };
}

function lookup(value: string, from: Namespace) {
  if (!value.trim() || value.length > 1024) return null;
  return countryInfo(countries().convert(value, { from, to: "iso-alpha2" }));
}

export function countryByName(name: string) {
  return lookup(name, "name");
}
function resolveIso(input: string) {
  const code = input.trim();
  if (/^[a-z]{2}$/i.test(code))
    return countries().convert(code, { from: "iso-alpha2", to: "iso-alpha2" });
  if (/^[a-z]{3}$/i.test(code))
    return countries().convert(code, { from: "iso-alpha3", to: "iso-alpha2" });
  if (/^\d{1,3}$/.test(code))
    return countries().convert(code.padStart(3, "0"), {
      from: "iso-numeric",
      to: "iso-alpha2",
    });
  return undefined;
}

export function countryByIso(input: string) {
  const result = resolveIso(input);
  return result ? countryInfo(result) : null;
}

/** Current names other than the display name, for searching by ISO country identity. */
export function countryAliases(input: string): readonly string[] {
  const result = resolveIso(input);
  const country = result && currentCountry(result);
  if (!country) return [];
  const names = countries().assignments(country.id, { namespace: "name" });
  return [
    ...new Set(
      names.candidates
        .filter(
          (name) =>
            name.applicability === "active" && name.value !== country.name,
        )
        .map((name) => name.value),
    ),
  ];
}

// Exact display labels from country-code-lookup 0.2.1 retain only their original ISO identity.
const legacyLabels: Readonly<Record<string, string>> = {
  FK: "Falkland Islands (Islas Malvinas)",
  RE: "Reunion",
  MF: "Saint Martin",
  AX: "Åland Islands",
  BQ: "Bonaire",
  VI: "Virgin Islands",
  SH: "Saint Helena",
};

export function countryMatchesCode(name: string, code: string): boolean {
  if (!countryByIso(code)) return false;
  if (countryByName(name)?.iso2 === code) return true;
  return legacyLabels[code] === name;
}
