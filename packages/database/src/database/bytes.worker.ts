// Cloudflare Workers source for the "#slackwater.tcdb" subpath import, selected by
// aliasing it in the worker build (see tsdown.config.ts). Workers can't
// construct file URLs from import.meta.url and disallow fetch during module
// evaluation, so the database ships inside the bundle as a base64 literal —
// the same bundle-the-data approach the JSON-string browser build used —
// decoded here at module evaluation (compute in global scope is allowed; only
// I/O is not).
import { createDatabaseBase64 } from "./inline.js" with { type: "macro" };

let encoded: string | undefined = createDatabaseBase64();
const binary = atob(encoded!);
encoded = undefined; // let the ~8 MB base64 string go to GC
const bytes = new Uint8Array(binary.length);
for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

export default bytes;
