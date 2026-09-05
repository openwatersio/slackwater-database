// Browser database source, selected via the "#database-bytes" subpath import.
// Browsers have no filesystem, so the same file the Node build reads from disk
// is fetched over the network; bundlers that understand
// `new URL(..., import.meta.url)` copy the asset and rewrite the URL.
export async function getDatabaseBytes(): Promise<Uint8Array> {
  const url = new URL("../generated/stations.neaps", import.meta.url);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch tide database ${url}: ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}
