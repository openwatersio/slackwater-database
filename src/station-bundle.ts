import type { StationData, StationMeta, StationMetaKey } from "./types.js";

// Build-time only. This module reads the raw station JSON and exposes the light
// metadata the search-index macros (src/search/geo.ts and text.ts) consume. It
// is never included in the runtime bundle: only the macros' string results are
// inlined. The runtime reads the same fields from the FlatBuffers database
// (see stations.ts).

const META_KEYS: StationMetaKey[] = [
  "name",
  "latitude",
  "longitude",
  "region",
  "country",
  "continent",
  "timezone",
  "type",
  "disclaimers",
  "chart_datum",
  "datums_source",
  "source",
  "license",
  "offsets",
];

function readAll(): { id: string; data: StationData }[] {
  // data/ also holds non-station GeoJSON (e.g. baltic-sea.geo.json); only plain
  // .json files are stations. Must stay in sync with the walk in
  // scripts/generate-database.ts so the search indexes share the database's
  // station order.
  const modules = import.meta.glob<StationData>(
    ["./**/*.json", "!./**/*.geo.json"],
    {
      eager: true,
      import: "default",
      base: "../data",
    },
  );
  // Sorted by id so the geo/text indexes share the database file's station
  // order (buildDatabase sorts the stations vector by id, its FlatBuffers key).
  return Object.entries(modules)
    .map(([path, data]) => ({
      id: path.replace(/^\.\//, "").replace(/\.json$/, ""),
      data,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Light metadata for every station, in database order. Used at build time. */
export function loadStationMeta(): StationMeta[] {
  return readAll().map(({ id, data }) => {
    const meta = { id } as StationMeta;
    for (const key of META_KEYS) {
      const value = data[key];
      if (value !== undefined) (meta as Record<string, unknown>)[key] = value;
    }
    return meta;
  });
}
