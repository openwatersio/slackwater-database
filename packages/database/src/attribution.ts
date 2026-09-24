/**
 * The project half of every notice. A station's full notice opens with this,
 * then adds whatever its source and licence require.
 */
export const PROJECT_CREDIT =
  "Slackwater database (https://github.com/openwatersio/slackwater-database)";

/** Where a redistributor is pointed to find what this project changed. */
export const MODIFICATIONS_URL =
  "https://github.com/openwatersio/slackwater-database#modifications-to-source-data";

/**
 * Keyed by `source.name`; `null` means the source requires no credit of its
 * own. Sources that add nothing are listed anyway so that a new source is a
 * decision rather than an omission — test/attribution.test.ts fails on one
 * that is missing. These strings are the README's Attribution section, and the
 * two must not drift.
 */
const SOURCE_CREDITS: Record<string, string | null> = {
  "Kartverket / Norwegian Mapping Authority, Hydrographic Service":
    "Source: Kartverket / Norwegian Mapping Authority, Hydrographic Service",
  "TICON-4":
    "Source: Hart-Davis, M., Dettmering, D., Seitz, F. (2025), TICON-4: TIdal CONstants based on GESLA-4 sea-level records, SEANOE, https://doi.org/10.17882/109129",
  // Public domain: credit is welcome, so not imposed on consumers.
  "US National Oceanic and Atmospheric Administration": null,
  // Names the operating agency of a record authored here under MIT, not a
  // licensor of redistributed data. See metadata/PROVENANCE.md.
  "Canadian Hydrographic Service": null,
};

/**
 * Display names for the licences that oblige a redistributor to pass the
 * licence on. A licence absent here (public domain, this project's own MIT
 * records) imposes no notice, so it adds nothing to the station's credit.
 */
const LICENSE_NAMES: Record<string, string> = {
  "cc-by-4.0": "CC BY 4.0",
  "cc-by-nc-4.0": "CC BY-NC 4.0",
};

/** Whether a source name has a credit decision recorded. */
export function isKnownSource(sourceName: string): boolean {
  return sourceName in SOURCE_CREDITS;
}

/**
 * Assemble a station's complete notice, so displaying it is the whole of a
 * consumer's obligation. Under a Creative Commons licence that means the
 * creator credit, the licence and its URI, and an indication that the material
 * was modified — the three things CC BY 4.0 section 3(a)(1) requires be passed
 * on. Licence is taken per station rather than per source because it varies
 * within one source: TICON stations relayed from CMEMS are CC BY-NC while the
 * rest are CC BY.
 */
export function attributionFor(
  sourceName: string | undefined,
  license: { type: string; url: string } | undefined,
): string {
  const parts = [PROJECT_CREDIT];

  const credit = sourceName ? SOURCE_CREDITS[sourceName] : null;
  if (credit) parts.push(credit);

  const licenseName = license && LICENSE_NAMES[license.type];
  if (licenseName) {
    parts.push(`Licensed ${licenseName} (${license!.url})`);
    parts.push(`Modified: see ${MODIFICATIONS_URL}`);
  }

  return parts.join(". ");
}
