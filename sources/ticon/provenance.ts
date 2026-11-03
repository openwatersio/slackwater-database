/**
 * Which record a TICON relay was copied from, when the relay says so.
 *
 * Only declared provenance counts: a relay's own id naming a NOAA station or a
 * Kartverket gauge, or UHSLC metadata naming an originator this repo also
 * imports. An originator number has no namespace (UHSLC 071 is Wellington and
 * La Libertad), so each rule pairs a Data_Source pattern with the id shape
 * that provider uses.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pinned from "./uhslc-metadata.json" with { type: "json" };
import jhodOriginators from "../jhod/ticon-originators.json" with { type: "json" };

import jmaOriginators from "../jma/ticon-originators.json" with { type: "json" };

const jmaRecord = (code: string): string | undefined => {
  const id = (jmaOriginators as Record<string, string>)[code.toUpperCase()];
  return id ? `jma/${id}` : undefined;
};

const jhodRecord = (code: string): string | undefined => {
  const id = (jhodOriginators as Record<string, string>)[code.toUpperCase()];
  return id ? `jhod/${id}` : undefined;
};

/** The fields fetch-uhslc-metadata.ts pins from a UHSLC metadata file. */
export interface UhslcMetadata {
  station: string;
  latitude: number;
  longitude: number;
  /** The provider of Data_Source's current period (see currentProvider). */
  data_source: string;
  originator_number: string;
  last_updated: string;
}

/**
 * The provider of a UHSLC Data_Source's current period: the first line under
 * its last open-ended period heading ("For 1997-:", "and beginning 2006:");
 * else, where every period has a heading, the first line under the last; else
 * its first line, which then names the provider since UHSLC lists earlier
 * periods after it ("For the pre-1999 data:"). Those and the addresses and
 * people between them are not the gauge's operator.
 */
export function currentProvider(dataSource: string): string {
  const lines = dataSource
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const heading = (line = "") => /\d{4}.*:$/.test(line);
  const open = (line: string) =>
    heading(line) && /\d{4}\s*-\s*:$|beginning/i.test(line);
  const last = lines.findLastIndex(
    (line, i) => i < lines.length - 1 && open(line),
  );
  if (last >= 0) return lines[last + 1]!;
  if (!heading(lines[0])) return lines[0] ?? "";
  const latest = lines.findLastIndex(
    (line, i) => i < lines.length - 1 && heading(line),
  );
  return lines[latest + 1] ?? "";
}

/** The UHSLC research-quality code in a TICON id, such as "073A". */
export function uhslcCode(ticonId: string): string | undefined {
  const parts = ticonId.replace(/^ticon\//, "").split("-");
  if (parts.at(-1) !== "uhslc_rq") return undefined;
  return parts.at(-3)?.toUpperCase();
}

/** A place name folded for matching: "Vardø" and "Vardo" agree. Ø and Æ
 *  have no decomposition, so they are spelled out before accents are
 *  stripped. */
export function fold(name: string): string {
  return name
    .replace(/ø/gi, "o")
    .replace(/æ/gi, "ae")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

let kartverketByName: Map<string, string> | undefined;

/** The Kartverket record with this place name. UHSLC records the Norwegian
 *  Hydrographic Service as originator without a station number, and
 *  Kartverket names one gauge per place. */
function kartverketRecord(station: string): string | undefined {
  if (!kartverketByName) {
    const dir = join(import.meta.dirname, "..", "..", "data", "kartverket");
    kartverketByName = new Map();
    for (const file of readdirSync(dir).sort()) {
      if (!file.endsWith(".json")) continue;
      const name = fold(JSON.parse(readFileSync(join(dir, file), "utf8")).name);
      const id = `kartverket/${file.replace(/\.json$/, "")}`;
      const other = kartverketByName.get(name);
      if (other)
        throw new Error(`${id} and ${other} have the same name, ${name}`);
      kartverketByName.set(name, id);
    }
  }
  return kartverketByName.get(fold(station));
}

const UHSLC_RULES: {
  source: RegExp;
  number: RegExp;
  id: (n: string, meta: UhslcMetadata) => string | undefined;
  /** A number in this provider's own scheme names one gauge; LINZ's 071 is also La Libertad. */
  unambiguous: boolean;
}[] = [
  {
    source: /^National Ocean Service|^NOAA|National Oceanic and Atmospheric/i,
    number: /^\d{7}$/,
    id: (n) => `noaa/${n}`,
    unambiguous: true,
  },
  {
    source: /^Land Information New Zealand/i,
    number: /^\d{3}$/,
    id: (n) => `linz/${n}`,
    unambiguous: false,
  },
  {
    source: /^Norwegian Hydrographic Service/i,
    number: /^$/,
    id: (_, meta) => kartverketRecord(meta.station),
    unambiguous: false,
  },
  {
    source: /^Japan Oceanographic Data Center$|^Japan Meteorological Agency$/i,
    number: /^[A-Z0-9]{2}$/i,
    id: (n) =>
      Object.values(jmaOriginators).includes(n.toUpperCase())
        ? `jma/${n.toUpperCase()}`
        : undefined,
    unambiguous: true,
  },
  {
    source: /^Japan Oceanographic Data Center$/i,
    number: /^HD\d{2}$/i,
    id: (n) => jhodRecord(n),
    unambiguous: true,
  },
];

/** Whether UHSLC's metadata covers this TICON record. A record it covers
 *  speaks for itself, even where no rule matches what it names. */
export function hasUhslcMetadata(
  ticonId: string,
  metadata: Record<string, UhslcMetadata> = pinned,
): boolean {
  const code = uhslcCode(ticonId);
  return !!code && code in metadata;
}

/** The originator a TICON relay names in its own id, if any. */
export function originatorInId(ticonId: string): string | undefined {
  const parts = ticonId.replace(/^ticon\//, "").split("-");
  // TICON's NOAA relays carry the NOAA station number in their own id.
  if (parts.at(-1) === "noaa") return `noaa/${parts.at(-3)}`;
  // Its Norwegian Hydrographic Service relays carry Kartverket's gauge code.
  // CMEMS codes come from the place name, so they match one only by chance.
  if (parts.at(-1) === "nhs" && parts.at(-2) === "nor")
    return `kartverket/${parts.at(-3)!.toUpperCase()}`;
  if (parts.at(-1) === "jodc_jcg" && parts.at(-2) === "jpn")
    return jhodRecord(parts.at(-3)!);
  if (parts.at(-1) === "jodc_jma" && parts.at(-2) === "jpn")
    return jmaRecord(parts.at(-3)!);
  return undefined;
}

/** Explicit gauge identifiers establish identity without harmonic agreement; UHSLC's JODC HD and JMA gauge codes count alongside relay ids and NOAA numbers. */
export function declaration(
  ticonId: string,
  metadata: Record<string, UhslcMetadata> = pinned,
): { id: string; unambiguous: boolean } | undefined {
  const inId = originatorInId(ticonId);
  if (inId) return { id: inId, unambiguous: true };
  const code = uhslcCode(ticonId);
  const meta = code ? metadata[code] : undefined;
  if (!meta) return undefined;
  const rule = UHSLC_RULES.find(
    ({ source, number }) =>
      source.test(meta.data_source) && number.test(meta.originator_number),
  );
  const id = rule?.id(meta.originator_number, meta);
  if (!rule || !id) return undefined;
  return { id, unambiguous: rule.unambiguous };
}

/** The record id a TICON relay declares as its originator, if any. */
export function declaredOriginator(
  ticonId: string,
  metadata: Record<string, UhslcMetadata> = pinned,
): string | undefined {
  return declaration(ticonId, metadata)?.id;
}
