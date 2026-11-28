import countryLookup from "country-code-lookup";

export function baselineCountryByName(name: string) {
  if (name === "Western Samoa") return countryLookup.byIso("WS");
  if (name === "Cape Verde") return countryLookup.byIso("CV");
  return countryLookup.byCountry(name);
}
