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
 * Display names for the licences that oblige a redistributor to pass the
 * licence on. A licence absent here (public domain, this project's own MIT
 * records) imposes no notice, so it adds nothing to the station's credit.
 */
export const LICENSE_NAMES: Record<string, string> = {
  "cc-by-4.0": "CC BY 4.0",
  "cc-by-nc-4.0": "CC BY-NC 4.0",
  "Government Standard Terms of Use 2.0":
    "Government Standard Terms of Use 2.0",
};

/**
 * Assemble a station's notice for its source, so displaying it meets what the
 * source's licence asks. Under a Creative Commons licence that means the
 * creator credit, the licence and its URI, and an indication that the material
 * was modified — the three things CC BY 4.0 section 3(a)(1) requires be passed
 * on. The geocoded location fields and `context` draw on GeoNames,
 * OpenStreetMap and Marine Regions, whose credits are in NOTICE and are passed
 * on separately. Licence is taken per station rather than per source because
 * it varies within one source: TICON stations from the GESLA sources that
 * restrict commercial use (`NON_COMMERCIAL_SOURCES`) are CC BY-NC while the
 * rest are CC BY. `credit` is the source's own line from its
 * `sources/<name>/metadata.yaml`, or null when it requires none.
 */
export function attributionWithCredit(
  credit: string | null | undefined,
  license: { type: string; url: string } | undefined,
): string {
  const parts = [PROJECT_CREDIT];

  if (credit) parts.push(credit);

  const licenseName = license && LICENSE_NAMES[license.type];
  if (licenseName) {
    parts.push(`Licensed ${licenseName} (${license!.url})`);
    parts.push(`Modified: see ${MODIFICATIONS_URL}`);
  }

  return parts.join(". ");
}
