import type { StationData, StationMeta, StationMetaKey } from "./types.js";

// Build-time only. This module reads the raw station JSON and splits it into
// light metadata (bundled eagerly) and heavy fields (bundled as unparsed JSON
// strings, parsed one station at a time at runtime). It is never included in
// the runtime bundle: stations.ts imports the create*Json functions as macros
// (only their string results are inlined), and the search index macros call
// loadStationMeta() at build time.

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
  // Stations live at data/<source>/<id>.json; one level deep excludes
  // top-level files like baltic-sea.geo.json.
  const modules = import.meta.glob<StationData>("./*/*.json", {
    eager: true,
    import: "default",
    base: "../data",
  });
  // Sort explicitly so the metadata array and the geo/text indexes share one
  // deterministic station order regardless of the bundler's glob implementation.
  return Object.entries(modules)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, data]) => ({
      id: path.replace(/^\.\//, "").replace(/\.json$/, ""),
      data,
    }));
}

/**
 * The set of datum keys present across all stations, computed at build time and
 * inlined as a small array literal. Lets consumers (e.g. the API's OpenAPI spec)
 * get the datum enum without a runtime scan that would parse every station.
 */
export function createDatumEnum(): string[] {
  const datums = new Set<string>();
  for (const { data } of readAll()) {
    if (data.datums)
      for (const key of Object.keys(data.datums)) datums.add(key);
  }
  // Sorted for deterministic builds (downstream may embed this, e.g. OpenAPI enums).
  return [...datums].sort();
}

/** Light metadata for every station, in bundle order. Used at build time. */
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

/**
 * Metadata array, inlined into the runtime bundle via a macro as an array of
 * object literals (the live objects — no retained JSON string, no parse).
 */
export function createStationMeta(): StationMeta[] {
  return loadStationMeta();
}

/**
 * Prediction data (harmonic_constituents, datums, epoch) keyed by station id,
 * each a JSON string. Used by the browser build, which inlines this as an object
 * of string literals and parses one record on demand. (The Node build reads the
 * same records from an off-heap pack file instead — see station-data.ts.)
 */
export function createStationDataById(): Record<string, string> {
  const data: Record<string, string> = {};
  for (const { id, data: station } of readAll()) {
    data[id] = JSON.stringify({
      harmonic_constituents: station.harmonic_constituents ?? [],
      datums: station.datums ?? {},
      epoch: station.epoch,
    });
  }
  return data;
}
