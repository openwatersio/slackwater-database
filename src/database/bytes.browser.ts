// Browser database source, selected via the "#database-bytes" subpath import.
// Browsers have no filesystem, so the same file the Node build reads from disk
// is fetched over the network; bundlers that understand
// `new URL(..., import.meta.url)` copy the asset and rewrite the URL.
//
// The fetch happens at module evaluation with top-level await so that this
// module alone is asynchronous: getDatabaseBytes() stays synchronous across
// all three sources, keeping the Node bundle's module graph synchronous and
// therefore require()-able.
const url = new URL("../generated/stations.neaps", import.meta.url);
const response = await fetch(url);
if (!response.ok) {
  throw new Error(`Failed to fetch tide database ${url}: ${response.status}`);
}
const bytes = new Uint8Array(await response.arrayBuffer());

export function getDatabaseBytes(): Uint8Array {
  return bytes;
}
