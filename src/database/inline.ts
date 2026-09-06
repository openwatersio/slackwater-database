// Build-time only (imported with `with { type: "macro" }`): reads the
// generated database and returns it base64-encoded, inlined as a string
// literal into the worker bundle. Never part of a runtime bundle.
import { readFileSync } from "node:fs";

export function createDatabaseBase64(): string {
  return readFileSync(
    new URL("../generated/stations.neaps", import.meta.url),
  ).toString("base64");
}
