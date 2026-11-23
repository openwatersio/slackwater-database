import {
  countryByName as lookupName,
  countryByIso,
} from "../database/src/country.ts";
export { countryByIso };
export function countryByName(name: string) {
  return name === "Western Samoa" ? countryByIso("WS") : lookupName(name);
}

export function countryByNameOrCode(input: string) {
  return (
    countryByName(input) ||
    (input.length === 2 || input.length === 3 || /^\d+$/.test(input)
      ? countryByIso(input)
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
    const country = countryByIso(code);
    if (!country) throw new Error(`Unrecognized country code: ${code}`);
    return country;
  }
  return record.country ? countryByNameOrCode(record.country) : null;
}
