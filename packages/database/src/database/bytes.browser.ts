// Browser source for the "#neaps.tcdb" subpath import. Browsers have no
// filesystem, so the same file the Node build reads from disk is fetched over
// the network; bundlers that understand `new URL(..., import.meta.url)` copy
// the asset and rewrite the URL.
//
// The fetch resolves with top-level await, so this module alone is
// asynchronous — importers just see the bytes, and the Node bundle's module
// graph stays synchronous and therefore require()-able.
const url = new URL("../generated/neaps.tcdb", import.meta.url);
const response = await fetch(url);
if (!response.ok) {
  throw new Error(`Failed to fetch tide database ${url}: ${response.status}`);
}

export default new Uint8Array(await response.arrayBuffer());
