import { fetchDatabase } from "./fetch.js";

// Bundlers copy this asset and rewrite its URL. Resolve it only when loading.
export default async function loadBytes(
  source?: string | URL,
): Promise<Uint8Array> {
  return fetchDatabase(
    source ?? new URL("../generated/slackwater.tcdb", import.meta.url),
  );
}
