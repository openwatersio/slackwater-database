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

function countryInfo(result: ConversionResult) {
  const usable = (candidate: typeof result.source.preferred) =>
    candidate &&
    (candidate.applicability === "active" ||
      (candidate.applicability === "uncertain" && candidate.tentative));
  const target = result.target.preferred;
  if (!usable(result.source.preferred) || !usable(target) || !target)
    return null;
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
export function countryByIso(input: string) {
  const code = input.trim();
  if (/^[a-z]{2}$/i.test(code)) return lookup(code, "iso-alpha2");
  if (/^[a-z]{3}$/i.test(code)) return lookup(code, "iso-alpha3");
  if (/^\d{1,3}$/.test(code))
    return lookup(code.padStart(3, "0"), "iso-numeric");
  return null;
}

export function countryMatchesCode(name: string, code: string): boolean {
  if (!countryByIso(code)) return false;
  if (countryByName(name)?.iso2 === code) return true;
  // Stored labels identify these territories only when paired with their explicit ISO identity.
  return (
    (code === "VI" && name === "Virgin Islands") ||
    (code === "SH" && name === "Saint Helena")
  );
}
