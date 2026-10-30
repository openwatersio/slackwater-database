// Node byte loader: file I/O and fetch happen only when called.
import { readFile } from "node:fs/promises";
import { fetchDatabase } from "./fetch.js";

/** Node accepts paths, file URLs, and HTTP(S) URLs. No I/O until called. */
export default async function loadBytes(
  source?: string | URL,
): Promise<Uint8Array> {
  if (source === undefined) {
    return readFile(new URL("../generated/slackwater.tcdb", import.meta.url));
  }
  if (typeof source === "string" && !/^(?:https?|file):/i.test(source)) {
    return readFile(source);
  }
  const url = typeof source === "string" ? new URL(source) : source;
  if (url.protocol === "file:") return readFile(url);
  return fetchDatabase(url);
}
