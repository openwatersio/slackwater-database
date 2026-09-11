import { Root, StationType } from "../generated/fbs/neaps.ts";
import * as flatbuffers from "flatbuffers";
import type { StationMeta } from "../types.js";

/**
 * Open a database buffer. The only place a consumer should touch the
 * FlatBuffers root; everything else in src/database/ speaks this format so the
 * rest of the package doesn't have to.
 */
export function openDatabase(bytes: Uint8Array): Root {
  return Root.getRootAsRoot(new flatbuffers.ByteBuffer(bytes));
}

/**
 * Station identity in database order, as plain objects. What the build-time
 * search-index generators consume: coordinates for the geo index; id, name,
 * place fields, and source.id for the text index.
 */
export function readStationMeta(bytes: Uint8Array): StationMeta[] {
  const db = openDatabase(bytes);

  return Array.from({ length: db.stationsLength() }, (_, i) => {
    const t = db.stations(i)!;
    const meta = {
      id: t.id()!,
      name: t.name()!,
      latitude: t.latitude(),
      longitude: t.longitude(),
      country: t.country()!,
      country_code: t.countryCode()!,
      continent: t.continent()!,
      timezone: t.timezone()!,
      type: t.type() === StationType.Subordinate ? "subordinate" : "reference",
    } as StationMeta;
    const region = t.region();
    if (region !== null) meta.region = region;
    const locality = t.locality();
    if (locality !== null) meta.locality = locality;
    const regionCode = t.regionCode();
    if (regionCode !== null) meta.region_code = regionCode;
    const context = t.context();
    if (context !== null) {
      meta.context = context;
      meta.context_derived = t.contextDerived();
    }
    if (t.citiesLength() > 0) {
      meta.cities = Array.from({ length: t.citiesLength() }, (_, index) =>
        t.cities(index),
      );
    }
    if (t.aliasesLength() > 0) {
      meta.aliases = Array.from({ length: t.aliasesLength() }, (_, index) =>
        t.aliases(index),
      );
    }
    const source = t.source();
    if (source) {
      meta.source = {
        name: source.name()!,
        id: source.id()!,
        published_harmonics: source.publishedHarmonics(),
        url: source.url()!,
      };
    }
    return meta;
  });
}
