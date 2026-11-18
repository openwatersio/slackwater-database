import type { CountryRegistry, ConversionResult } from "@openwaters/c5y-n8r";

export function countryInfo(result: ConversionResult) {
  const source = result.source.preferred;
  const candidate = result.target.preferred;
  if (
    !source ||
    (source.applicability !== "active" &&
      !(source.applicability === "uncertain" && source.tentative)) ||
    !candidate ||
    (candidate.applicability !== "active" &&
      !(candidate.applicability === "uncertain" && candidate.tentative))
  )
    return null;
  return {
    iso2: candidate.value,
    country: candidate.name,
    continent: candidate.continent,
  };
}

export function createCountryLookup(
  registry: Pick<CountryRegistry, "convert">,
) {
  return {
    countryByName(name: string) {
      if (!name.trim()) return null;
      return countryInfo(
        registry.convert(name, { from: "name", to: "iso-alpha2" }),
      );
    },
    countryByIso(code: string) {
      if (!code.trim()) return null;
      const from = code.trim().length === 2 ? "iso-alpha2" : "iso-alpha3";
      return countryInfo(registry.convert(code, { from, to: "iso-alpha2" }));
    },
  };
}
