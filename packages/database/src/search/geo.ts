import KDBush from "kdbush";

/**
 * Create a search index for stations and return it as a base64 string, which can be
 * inlinted at build time by using the `macro` import type:
 *
 *   import { createGeoIndex } from "./search-index.js" with { type: "macro" };
 */
export async function createGeoIndex() {
  const { loadStationMeta } = await import("../station-bundle.js");
  const stations = loadStationMeta();

  const index = new KDBush(stations.length);

  for (const { longitude, latitude } of stations) {
    index.add(longitude, latitude);
  }
  index.finish();

  // @ts-ignore: Buffer is available at build time
  return Buffer.from(index.data).toString("base64");
}

export function loadGeoIndex(data: string): KDBush {
  return KDBush.from(base64ToArrayBuffer(data));
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
