import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import type {
  ConstituentDefinition,
  NodeCorrections,
} from "@slackwater/database";
// From source: the database's own build runs this before its dist exists.
import { checkDefinition } from "../database/src/constituent-definitions.ts";

/** What `sources/<name>/metadata.yaml` declares about a provider. */
export interface SourceMetadata {
  /** Equal to `source.name` on every record the provider writes. */
  name: string;
  /** A national hydrographic office whose records win duplicates against relays. */
  authoritative: boolean;
  /** The provider's own credit line, or null when it requires none. */
  credit: string | null;
  /** The countries, as records write `country`, whose gauges an authoritative
   *  provider operates. Absent means everywhere it publishes. */
  jurisdiction?: string[];
  /** The nodal correction formulas the provider's constants were analyzed with. Absent means IHO. */
  node_corrections?: NodeCorrections;
  /**
   * Lines the provider means by a name that differ from `@slackwater/engine`'s
   * catalog, or names the catalog lacks, for its own stations only.
   */
  constituent_definitions?: ConstituentDefinition[];
}

const SOURCES_DIR = join(import.meta.dirname, "..", "..", "sources");

/**
 * Every provider's metadata, keyed by `source.name`. A record whose source has
 * no entry fails the catalogue load, so adding a source is a decision rather
 * than an omission.
 */
export function loadSources(dir = SOURCES_DIR): Map<string, SourceMetadata> {
  const sources = new Map<string, SourceMetadata>();
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry, "metadata.yaml");
    if (!existsSync(path)) continue;
    const source = parse(readFileSync(path, "utf8")) as SourceMetadata;
    if (typeof source?.name !== "string" || !source.name)
      throw new Error(`${path}: name must be a non-empty string`);
    if (typeof source.authoritative !== "boolean")
      throw new Error(`${path}: authoritative must be true or false`);
    if (source.credit !== null && typeof source.credit !== "string")
      throw new Error(`${path}: credit must be a string or null`);
    if (
      source.jurisdiction !== undefined &&
      !(
        Array.isArray(source.jurisdiction) &&
        source.jurisdiction.every((c) => typeof c === "string" && c)
      )
    )
      throw new Error(`${path}: jurisdiction must be a list of countries`);
    if (
      source.node_corrections !== undefined &&
      source.node_corrections !== "iho" &&
      source.node_corrections !== "schureman"
    )
      throw new Error(`${path}: node_corrections must be iho or schureman`);
    if (
      source.constituent_definitions !== undefined &&
      !Array.isArray(source.constituent_definitions)
    )
      throw new Error(`${path}: constituent_definitions must be a list`);
    for (const definition of source.constituent_definitions ?? [])
      checkDefinition(definition, `${path}: constituent_definitions`);
    if (sources.has(source.name))
      throw new Error(`${path}: ${source.name} is declared twice`);
    sources.set(source.name, source);
  }
  return sources;
}

let cached: Map<string, SourceMetadata> | undefined;

/** The metadata for a record's source, which must exist. */
export function sourceMetadata(name: string | undefined): SourceMetadata {
  cached ??= loadSources();
  const source = name === undefined ? undefined : cached.get(name);
  if (!source)
    throw new Error(
      `no sources/*/metadata.yaml declares source ${JSON.stringify(name)}`,
    );
  return source;
}
