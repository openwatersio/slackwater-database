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
