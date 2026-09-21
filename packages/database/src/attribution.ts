/**
 * The project half of every credit. A station's full credit opens with this,
 * then appends whatever further credit its own source requires.
 */
export const PROJECT_CREDIT =
  "Neaps tide database (https://github.com/openwatersio/tide-database)";

/**
 * Keyed by `source.name`; `null` means the source requires no credit of its
 * own. Sources that add nothing are listed anyway so that a new source is a
 * decision rather than an omission — test/attribution.test.ts fails on one
 * that is missing. These strings are the README's Attribution section, and the
 * two must not drift.
 *
 * A credit names the creator, never the licence: licence varies per station
 * within one source (TICON stations relayed from CMEMS are CC BY-NC while the
 * rest are CC BY), so it belongs on `station.license` where it is exact.
 */
const SOURCE_CREDITS: Record<string, string | null> = {
  "TICON-4":
    "Source: Hart-Davis, M., Dettmering, D., Seitz, F. (2025), TICON-4: TIdal CONstants based on GESLA-4 sea-level records, SEANOE, https://doi.org/10.17882/109129",
  // Public domain: credit is welcome, so not imposed on consumers.
  "US National Oceanic and Atmospheric Administration": null,
  // Names the operating agency of a record authored here under MIT, not a
  // licensor of redistributed data. See metadata/PROVENANCE.md.
  "Canadian Hydrographic Service": null,
};

/** Whether a source name has a credit decision recorded. */
export function isKnownSource(sourceName: string): boolean {
  return sourceName in SOURCE_CREDITS;
}

/**
 * Build a source's credit line. An unrecognized source falls back to the
 * project credit rather than throwing, so a consumer pinned to an older
 * library still renders a newer database; the test keeps the table complete.
 */
export function attributionFor(sourceName: string | undefined): string {
  const credit = sourceName ? SOURCE_CREDITS[sourceName] : null;
  return credit ? `${PROJECT_CREDIT}. ${credit}` : PROJECT_CREDIT;
}
