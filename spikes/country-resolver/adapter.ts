import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { CountryRegistry } from "@openwaters/c5y-n8r";
import { createCountryLookup } from "./lookup.ts";

const bytes = readFileSync(
  new URL(import.meta.resolve("@openwaters/c5y-n8r/data")),
);
export const countryBinarySha256 = createHash("sha256")
  .update(bytes)
  .digest("hex");
export const countryRegistry = CountryRegistry.open(bytes);
export const { countryByName, countryByIso } =
  createCountryLookup(countryRegistry);
