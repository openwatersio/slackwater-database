// No imports: packages/stations loads this file from source to mint the paths
// it records in metadata/routes.lock.json, so both sides share one copy.

/**
 * A route's canonical web path, e.g. `/tides/ca/bc/victoria/`: the kind, the
 * lowercase ISO 3166-1 country code, the ISO 3166-2 subdivision when
 * `region_code` belongs to that country, and the slug.
 */
export function routePath(
  kind: "tide" | "current",
  station: {
    slug: string;
    country_code: string;
    region_code?: string | undefined;
  },
): string {
  const prefix = kind === "tide" ? "tides" : "currents";
  const country = station.country_code.toLowerCase();
  const subdivision = station.region_code?.startsWith(
    `${station.country_code}-`,
  )
    ? station.region_code.slice(3).toLowerCase()
    : undefined;
  return `/${[prefix, country, subdivision, station.slug].filter(Boolean).join("/")}/`;
}
