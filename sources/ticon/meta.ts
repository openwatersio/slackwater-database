import { distance, indexBy } from "@slackwater/stations";

export type TiconMetaRow = {
  "FILE NAME": string;
  "SITE NAME": string;
  LATITUDE: string;
  LONGITUDE: string;
};

export type Position = { lat: number; lon: number };

// A meta.csv row sits within metres of its gauge's data.csv position, and a
// misfiled one tens of kilometres away, so 1 km separates them with room to spare.
export const MAX_META_OFFSET_KM = 1;

function offsetKm(row: TiconMetaRow, { lat, lon }: Position): number {
  return distance(
    lat,
    lon,
    parseFloat(row.LATITUDE),
    parseFloat(row.LONGITUDE),
  );
}

/**
 * Pair each gauge in data.csv with its meta.csv row.
 *
 * meta.csv is keyed by FILE NAME, but a few rows carry another gauge's key
 * (#230: seven CCO gauges, each row's name, code and position all describing a
 * different gauge from its key). A row whose position disagrees with its key's
 * data.csv position is misfiled, and each such gauge takes the misfiled row
 * that does sit at its position. A correctly filed row at the same spot, such
 * as a CMEMS relay of the same gauge, is not a candidate. Throws unless exactly
 * one misfiled row fits, so a new mix-up stops the import instead of guessing.
 *
 * Rows whose coordinates don't parse (the naive CSV split shifts columns after
 * a quoted comma) can't be checked and keep their key.
 */
export function matchMetadata(
  rows: TiconMetaRow[],
  positions: Map<string, Position>,
): Record<string, TiconMetaRow> {
  const byKey = indexBy(rows, "FILE NAME");
  const matched: Record<string, TiconMetaRow> = {};
  const misfiled: string[] = [];
  const free: TiconMetaRow[] = [];

  for (const [id, position] of positions) {
    const row = byKey[id];
    if (!row) continue;
    const offset = offsetKm(row, position);
    if (Number.isNaN(offset) || offset <= MAX_META_OFFSET_KM) {
      matched[id] = row;
    } else {
      misfiled.push(id);
      free.push(row);
    }
  }

  const takenBy = new Map<TiconMetaRow, string>();
  for (const id of misfiled) {
    const position = positions.get(id)!;
    const fits = free.filter(
      (row) => offsetKm(row, position) <= MAX_META_OFFSET_KM,
    );
    const [row] = fits;
    if (fits.length !== 1 || !row) {
      throw new Error(
        `${id}: meta.csv row "${byKey[id]!["SITE NAME"]}" is ${offsetKm(byKey[id]!, position).toFixed(1)} km from the gauge, and ${fits.length} misfiled rows sit at its position`,
      );
    }
    const owner = takenBy.get(row);
    if (owner) {
      throw new Error(
        `${id}: the misfiled meta.csv row "${row["SITE NAME"]}" at its position is already taken by ${owner}`,
      );
    }
    takenBy.set(row, id);
    matched[id] = row;
  }

  return matched;
}

// GESLA-4, and so TICON-4, places these UHSLC research-quality records
// kilometres from their gauges. Each takes the position UHSLC publishes for the
// same series (uhslc-metadata.json), where a sea-level network's own station
// list also places the gauge. `published` is TICON's position, so a TICON
// release that moves or drops the record stops the import instead of being
// overwritten. See #371.
export const POSITION_CORRECTIONS: Record<
  string,
  { published: Position; corrected: Position }
> = {
  // IOC's sea level monitoring lists Tasiilaq Harbour (tasw) at 65.614, -37.626,
  // and DMI's Tasiilaq gauge (dmi/2992310) is 0.4 km away. TICON's position is
  // 29 km east.
  "ammassalik-297a-dnk-uhslc_rq": {
    published: { lat: 65.6, lon: -37 },
    corrected: { lat: 65.615, lon: -37.625 },
  },
  // PSMSL lists Pulau Langkawi (1676) at 6.4308, 99.7642, and TICON's
  // fast-delivery series of the same gauge is at 6.432, 99.765. TICON's
  // position is 49 km north, in Thailand's Satun Province.
  "langkawi-142a-mys-uhslc_rq": {
    published: { lat: 6.87, lon: 99.77 },
    corrected: { lat: 6.43049, lon: 99.76286 },
  },
  // GLOSS lists Porto de Macaé (352) at the same position, by Imbetiba
  // harbour. TICON's position is 35 km east-northeast, at sea.
  "macae-719a-bra-uhslc_rq": {
    published: { lat: -22.233, lon: -41.467 },
    corrected: { lat: -22.385, lon: -41.77 },
  },
  // PSMSL lists Alotau (1607) at -10.3167, 150.45, on the Milne Bay
  // waterfront. TICON's position is 17 km north.
  "alotau-069a-png-uhslc_rq": {
    published: { lat: -10.168, lon: 150.453 },
    corrected: { lat: -10.3167, lon: 150.4533 },
  },
};

// How far TICON's position may sit from the one a correction was written
// against: enough for a float rounding, far less than any real move.
const MAX_PUBLISHED_DRIFT_KM = 0.01;

/**
 * The gauge's position: TICON's, or its correction. Throws when TICON no
 * longer publishes the position a correction was written against.
 */
export function correctPosition(id: string, published: Position): Position {
  const correction = POSITION_CORRECTIONS[id];
  if (!correction) return published;
  const { lat, lon } = correction.published;
  if (distance(published.lat, published.lon, lat, lon) > MAX_PUBLISHED_DRIFT_KM)
    throw new Error(
      `${id}: TICON now places the gauge at ${published.lat}, ${published.lon}, not ${lat}, ${lon}; review its entry in POSITION_CORRECTIONS`,
    );
  return correction.corrected;
}

/**
 * Throws unless every correction names a gauge TICON still publishes, at the
 * position the correction was written against. Checking every gauge up front
 * stops a stale correction before any shard saves a station.
 */
export function checkCorrections(positions: Map<string, Position>): void {
  for (const id of Object.keys(POSITION_CORRECTIONS)) {
    const published = positions.get(id);
    if (!published)
      throw new Error(
        `${id}: TICON no longer publishes this gauge; review its entry in POSITION_CORRECTIONS`,
      );
    correctPosition(id, published);
  }
}
