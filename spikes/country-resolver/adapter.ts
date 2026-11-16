import { readFileSync } from "node:fs";
import { CountryRegistry, type Candidate } from "@openwaters/c5y-n8r";

export const countryRegistry = CountryRegistry.open(
  readFileSync(new URL(import.meta.resolve("@openwaters/c5y-n8r/data"))),
);

// shortcut: the spike API lacks entity-to-code lookup; replace this scan when that API exists.
const alpha2 = new Map<string, Set<string>>();
for (let a = 65; a <= 90; a++)
  for (let b = 65; b <= 90; b++) {
    const code = String.fromCharCode(a, b);
    const candidate = countryRegistry.resolve(code, {
      namespace: "iso-alpha2",
    }).preferred;
    if (
      candidate &&
      candidate.applicability !== "retired" &&
      candidate.applicability !== "outside-date" &&
      candidate.applicability !== "deprecated"
    ) {
      const codes = alpha2.get(candidate.id) ?? new Set<string>();
      codes.add(code);
      alpha2.set(candidate.id, codes);
    }
  }
function info(candidate: Candidate | undefined) {
  if (!candidate) return null;
  const codes = alpha2.get(candidate.id);
  const iso2 = codes?.size === 1 ? [...codes][0] : undefined;
  return iso2
    ? { iso2, country: candidate.name, continent: candidate.continent }
    : null;
}
export function countryByName(name: string) {
  return info(countryRegistry.resolve(name, { namespace: "name" }).preferred);
}
export function countryByIso(code: string) {
  const namespace = code.trim().length === 2 ? "iso-alpha2" : "iso-alpha3";
  return info(countryRegistry.resolve(code, { namespace }).preferred);
}
