// The build embeds the database as base64. Decode only when loading the
// bundled source; supplied URLs are fetched when the loader is called.
import { createDatabaseBase64 } from "./inline.ts" with { type: "macro" };
import { fetchDatabase } from "./fetch.js";

export default async function loadBytes(
  source?: string | URL,
): Promise<Uint8Array> {
  if (source !== undefined) return fetchDatabase(source);
  const binary = atob(createDatabaseBase64());
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
