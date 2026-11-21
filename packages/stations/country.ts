import countryLookup from "country-code-lookup";

export function countryByName(name: string) {
  if (name === "Western Samoa") return countryLookup.byIso("WS");
  if (name === "Cape Verde") return countryLookup.byIso("CV");
  return countryLookup.byCountry(name);
}

export function countryByNameOrCode(input: string) {
  return (
    countryByName(input) ||
    (input.length === 2 || input.length === 3 || /^\d+$/.test(input)
      ? countryLookup.byIso(input)
      : null)
  );
}

export function countryForRecord(record: {
  country?: string;
  country_code?: string;
}) {
  if (record.country_code !== undefined) {
    const code = record.country_code;
    if (!/^[A-Z]{2}$/.test(code))
      throw new Error(`Invalid country code: ${JSON.stringify(code)}`);
    const country = countryLookup.byIso(code);
    if (!country) throw new Error(`Unrecognized country code: ${code}`);
    return country;
  }
  return record.country ? countryByNameOrCode(record.country) : null;
}
