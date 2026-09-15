import MiniSearch, { type Options } from "minisearch";
import type { StationMeta } from "../types.js";

// Only metadata fields are indexed, so this operates on StationMeta and never
// touches the lazily-loaded harmonics/datums.
const textSearchIndexOptions: Options<StationMeta> = {
  fields: ["name", "region", "country", "continent", "source.id"],
  extractField: (station, fieldName) => {
    if (fieldName in station) {
      return (station as any)[fieldName];
    } else if (fieldName === "source.id") {
      return station.source.id;
    }
  },
  searchOptions: {
    boost: {
      name: 3,
    },
    fuzzy: 0.2,
    prefix: true,
  },
};

/**
 * Create a text search index for stations and return it as a JSON string, which can be
 * inlined at build time by using the `macro` import type:
 *
 *   import { createTextIndex } from "./text-search-index.js" with { type: "macro" };
 */
export async function createTextIndex() {
  const { loadStationMeta } = await import("../station-bundle.js");
  const stations = loadStationMeta();

  const index = new MiniSearch<StationMeta>(textSearchIndexOptions);
  index.addAll(stations);

  return JSON.stringify(index.toJSON());
}

export function loadTextIndex(data: string): MiniSearch<StationMeta> {
  return MiniSearch.loadJSON<StationMeta>(data, textSearchIndexOptions);
}
