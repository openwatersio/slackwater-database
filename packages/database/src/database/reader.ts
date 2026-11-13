import { Root, StationType } from "../generated/fbs/slackwater.ts";
import * as flatbuffers from "flatbuffers";
import type { StationMeta } from "../types.js";
import { FORMAT_VERSION, UnsupportedStationDatabaseError } from "./format.ts";

/**
 * Open a database buffer. The only place a consumer should touch the
 * FlatBuffers root; everything else in src/database/ speaks this format so the
 * rest of the package doesn't have to.
 */
export function openDatabase(bytes: Uint8Array): Root {
  if (!rootInBounds(bytes)) {
    throw new Error(
      "Invalid station database: the root table lies past the end",
    );
  }
  const root = Root.getRootAsRoot(new flatbuffers.ByteBuffer(bytes));
  if (root.formatVersion() > FORMAT_VERSION) {
    throw new UnsupportedStationDatabaseError(root.formatVersion());
  }
  return root;
}

/**
 * Whether the root table and its vtable lie inside `bytes`, so reading the
 * format version can't run past the end. FlatBuffers' JavaScript reads past
 * the end without throwing.
 */
function rootInBounds(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const root = view.getUint32(0, true);
  if (root + 4 > bytes.length) return false;
  const vtable = root - view.getInt32(root, true);
  if (vtable < 0 || vtable + 4 > bytes.length) return false;
  // The vtable's first two entries are its own size and the table's.
  const vtableSize = view.getUint16(vtable, true);
  if (vtable + vtableSize > bytes.length) return false;
  if (root + view.getUint16(vtable + 2, true) > bytes.length) return false;
  // Root.format_version's entry, when the vtable has one.
  const field = vtableSize >= 18 ? view.getUint16(vtable + 16, true) : 0;
  return field === 0 || root + field + 2 <= bytes.length;
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
    const id = t.id()!;
    // The text index keys on source.id, so a station without a source table
    // can't be indexed. Name the station rather than failing on a null deref
    // deeper in the build.
    const source = t.source();
    if (!source) throw new Error(`Station ${id} has no source`);
    const meta: StationMeta = {
      id,
      name: t.name()!,
      latitude: t.latitude(),
      longitude: t.longitude(),
      country: t.country()!,
      country_code: t.countryCode()!,
      continent: t.continent()!,
      timezone: t.timezone()!,
      type: t.type() === StationType.Subordinate ? "subordinate" : "reference",
      source: {
        name: source.name()!,
        id: source.id()!,
        published_harmonics: source.publishedHarmonics(),
        url: source.url()!,
      },
    };
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
    return meta;
  });
}
