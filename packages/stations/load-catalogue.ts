import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import currentBundle from "../../sources/noaa-current/currents.json" with { type: "json" };
import chsStations from "../../sources/chs/stations.json" with { type: "json" };
import { countryByName } from "./country.ts";
import type { StationInput, StationQuality } from "@slackwater/database";
import { buildCatalogue } from "./catalogue.ts";
import { databaseConstituents } from "./constituent-definitions.ts";
import { chsInputs } from "./chs-input.ts";
import { currentInputs } from "./current-input.ts";
import { loadGeocoder } from "./geocode.ts";
import { loadMaritimeZones } from "./maritime-zones.ts";
import { sourceMetadata } from "./sources.ts";
import {
  curatedRecords,
  readStationFiles,
  storedQuality,
  type StationFile,
} from "./station-files.ts";
import { loadWaterBodies } from "./water-bodies.ts";

export async function loadProductionCatalogue(
  root: string,
  stationFiles: StationFile[] = readStationFiles(join(root, "stations")),
  /** Each record's quality; by default what the station files record. */
  quality: Map<string, StationQuality> = storedQuality(stationFiles),
) {
  const dataDir = join(root, "data");
  const tides: StationInput[] = walk(dataDir).map((file) => {
    const id = file.slice(dataDir.length + 1).replace(/\.json$/, "");
    const source = JSON.parse(readFileSync(file, "utf8"));
    const stationQuality = quality.get(id);
    if (!stationQuality)
      throw new Error(`${id}: no quality evaluation; run npm run stations`);
    const countryCode = countryByName(source.country)?.iso2;
    if (!countryCode)
      throw new Error(`${id}: no ISO country code for ${source.country}`);
    return {
      id,
      ...source,
      country_code: countryCode,
      quality: stationQuality,
    };
  });
  const currents = currentInputs(currentBundle);
  const chs = chsInputs(chsStations);
  const { corrections, registry } = curatedRecords(
    stationFiles,
    new Set([...tides, ...chs, ...currents].map(({ id }) => id)),
  );
  const catalogue = buildCatalogue({
    // CHS stations stay out of providerTideIds below: they are identity-only.
    tides: [...tides, ...chs],
    currents,
    corrections,
    registry,
    stationFiles,
    geocoder: await loadGeocoder(),
    waterBodies: await loadWaterBodies(),
    maritimeZones: await loadMaritimeZones(),
  });
  // Every station's source must have a metadata.yaml, so its credit is a
  // decision rather than an omission.
  const credits = new Map(
    catalogue.stations.flatMap(({ source }) =>
      source
        ? [[source.name, sourceMetadata(source.name).credit] as const]
        : [],
    ),
  );
  let constituents: ReturnType<typeof databaseConstituents> | undefined;
  return {
    ...catalogue,
    credits,
    // Only the database build needs these; scripts that don't read them
    // don't stop on a constituent name problem.
    get constituents() {
      return (constituents ??= databaseConstituents(catalogue.stations));
    },
    stationFiles,
    providerTideIds: new Set(tides.map(({ id }) => id)),
    providerCurrentIds: new Set(currents.map(({ id }) => id)),
  };
}

/** Every published station position, before metadata resolution. */
export function stationPositions(root: string): [number, number][] {
  const dataDir = join(root, "data");
  const curated = readStationFiles(join(root, "stations")).flatMap(
    ({ position }) => (position ? [position] : []),
  );
  const positions: [number, number][] = [
    ...walk(dataDir).map((file): [number, number] => {
      const { latitude, longitude } = JSON.parse(readFileSync(file, "utf8"));
      return [latitude, longitude];
    }),
    ...currentInputs(currentBundle).flatMap(
      ({ latitude, longitude }): [number, number][] =>
        latitude === undefined || longitude === undefined
          ? []
          : [[latitude, longitude]],
    ),
    ...curated,
    ...chsStations.map(({ latitude, longitude }): [number, number] => [
      latitude,
      longitude,
    ]),
  ];
  const unique = new Map(
    positions.map(([lat, lon]) => {
      const rounded: [number, number] = [
        Number(lat.toFixed(5)),
        Number(lon.toFixed(5)),
      ];
      return [rounded.join(","), rounded];
    }),
  );
  return [...unique.values()];
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return path.endsWith(".json") && !path.endsWith(".geo.json") ? [path] : [];
  });
}
