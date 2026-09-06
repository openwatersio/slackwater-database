// Cloudflare Workers database source, selected by aliasing "#database-bytes"
// in the worker build (see tsdown.config.ts). Workers can't construct file
// URLs from import.meta.url and disallow fetch during module evaluation, so
// the database ships inside the bundle as a base64 literal — the same
// bundle-the-data approach the JSON-string browser build used — decoded once
// on first use.
import { createDatabaseBase64 } from "./inline.js" with { type: "macro" };

let encoded: string | undefined = createDatabaseBase64();
let bytes: Uint8Array | undefined;

export function getDatabaseBytes(): Uint8Array {
  if (!bytes) {
    const bin = atob(encoded!);
    encoded = undefined; // let the ~8 MB base64 string go to GC
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}
