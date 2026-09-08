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
      continent: t.continent()!,
      timezone: t.timezone()!,
      type: t.type() === StationType.Subordinate ? "subordinate" : "reference",
    } as StationMeta;
    const region = t.region();
    if (region !== null) meta.region = region;
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
