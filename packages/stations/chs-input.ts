import { find as findTimezone } from "geo-tz/all";
import type { StationInput } from "@slackwater/database";

/** One row of sources/chs/stations.json. */
export interface ChsStationRecord {
  id: string;
  name: string;
  aliases: string[];
  latitude: number;
  longitude: number;
}

/**
 * CHS tide stations as identity-only tides: DFO's terms allow no redistributed
 * prediction, so each carries no constituents. Country, region and context come
 * from the same resolution every station goes through.
 */
export function chsInputs(records: ChsStationRecord[]): StationInput[] {
  return records.map(({ id, name, aliases, latitude, longitude }) => {
    const timezone = findTimezone(latitude, longitude)[0];
    if (!timezone) throw new Error(`${id}: no timezone at position`);
    return {
      id,
      kind: "tide",
      name,
      latitude,
      longitude,
      timezone,
      // Every IWLS station is Canadian, and an Arctic cove can sit beyond both
      // a maritime zone and any place within 100 km. A zone still wins.
      country: "Canada",
      type: "reference",
      harmonic_constituents: [],
      ...(aliases.length ? { aliases } : {}),
      source: {
        name: "Canadian Hydrographic Service",
        id,
        published_harmonics: false,
        url: "https://github.com/openwatersio/slackwater-database/blob/main/sources/chs/README.md",
      },
      license: {
        type: "MIT",
        commercial_use: true,
        url: "https://github.com/openwatersio/slackwater-database/blob/main/LICENSE",
      },
    };
  });
}
