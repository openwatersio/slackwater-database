import loadBytes from "#slackwater.tcdb";
import { openDatabase } from "./database/reader.js";
import { createStationReader } from "./stations.js";
import { createRoutes } from "./routes.js";
import { createSearch } from "./search/index.js";
import { bundledSearchData, type SearchIndexData } from "./search/bundled.js";
import { Root } from "./generated/fbs/slackwater.ts";
import { ByteBuffer } from "flatbuffers";

/** A Node file path, file/HTTP(S) URL, or an already loaded database buffer. */
export type DatabaseSource = string | URL | Uint8Array;

/**
 * Load the bundled database, or a supplied source. Browsers and Workers accept
 * fetchable URLs and bytes; Node also accepts filesystem paths and file URLs.
 * Loading creates a reader, without materializing any station identities.
 * Every call for the bundled database shares one instance; each supplied source
 * gets its own instance and caches.
 */
export async function loadStations(
  source?: DatabaseSource,
): Promise<StationDatabase> {
  if (source === undefined) return (bundled ??= loadBundled());
  // Not instanceof: bytes can come from another realm, such as an iframe or vm.
  return createDatabase(
    ArrayBuffer.isView(source) ? source : await loadBytes(source),
  );
}

let bundled: Promise<StationDatabase> | undefined;

async function loadBundled(): Promise<StationDatabase> {
  try {
    return createDatabase(await loadBytes(), await bundledSearchData());
  } catch (error) {
    bundled = undefined; // A failed fetch can succeed on the next call.
    throw error;
  }
}

function createDatabase(bytes: Uint8Array, indexes?: SearchIndexData) {
  // This is a format check, not a full structural verifier for arbitrary bytes.
  if (bytes.length < 8 || !Root.bufferHasIdentifier(new ByteBuffer(bytes))) {
    throw new Error("Invalid station database: expected a TCDB FlatBuffer");
  }
  const root = openDatabase(bytes);
  const reader = createStationReader(root);
  return {
    byId: reader.byId,
    get all() {
      return reader.all;
    },
    get accepted() {
      return reader.accepted;
    },
    get qualityMap() {
      return reader.qualityMap;
    },
    get datums() {
      return reader.datums;
    },
    ...createRoutes(root, reader),
    ...createSearch(bytes, root, reader, indexes),
  };
}

export type StationDatabase = ReturnType<typeof createDatabase>;
