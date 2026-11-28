import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

export function countryBytesBase64(): string {
  return readFileSync(
    createRequire(import.meta.url).resolve("@openwaters/c5y-n8r/data"),
  ).toString("base64");
}
