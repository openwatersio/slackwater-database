import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import currentBundle from "./noaa-current/currents.json" with { type: "json" };
import countryLookup from "country-code-lookup";
import type { StationInput, StationQuality } from "@neaps/tide-database";
import { buildCatalogue } from "./catalogue.ts";
import { currentInputs } from "./current-input.ts";
import { loadGeocoder } from "./geocode.ts";
import { loadMaritimeZones } from "./maritime-zones.ts";
import { loadCorrections, loadRegistry } from "./metadata.ts";
import type { RouteLock, SlugTable, SlugTombstones } from "./routes.ts";
import { loadWaterBodies } from "./water-bodies.ts";

export async function loadProductionCatalogue(root: string) {
  const quality = new Map<string, StationQuality>(
    JSON.parse(readFileSync(join(root, "quality.json"), "utf8")).map(
      (entry: StationQuality) => [entry.id, entry],
    ),
  );
  const dataDir = join(root, "data");
  const tides: StationInput[] = walk(dataDir).map((file) => {
    const id = file.slice(dataDir.length + 1).replace(/\.json$/, "");
    const source = JSON.parse(readFileSync(file, "utf8"));
    const stationQuality = quality.get(id);
    if (!stationQuality) throw new Error(`${id}: no quality record`);
    const countryCode = countryLookup.byCountry(source.country)?.iso2;
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
  const metadataDir = join(root, "metadata");
  const slugTable = JSON.parse(
    readFileSync(join(metadataDir, "slugs.json"), "utf8"),
  ) as SlugTable;
  const slugTombstones = JSON.parse(
    readFileSync(join(metadataDir, "slug-tombstones.json"), "utf8"),
  ) as SlugTombstones;
  const routeLock = JSON.parse(
    readFileSync(join(metadataDir, "routes.lock.json"), "utf8"),
  ) as RouteLock;
  return {
    ...buildCatalogue({
      tides,
      currents,
      corrections: loadCorrections(
        readFileSync(join(metadataDir, "corrections.yaml"), "utf8"),
      ),
      registry: loadRegistry(
        readFileSync(join(metadataDir, "registry.yaml"), "utf8"),
      ),
      slugTable,
      slugTombstones,
      routeLock,
      geocoder: await loadGeocoder(),
      waterBodies: await loadWaterBodies(),
      maritimeZones: await loadMaritimeZones(),
    }),
    providerTideIds: new Set(tides.map(({ id }) => id)),
    providerCurrentIds: new Set(currents.map(({ id }) => id)),
    previousSlugTable: slugTable,
    previousSlugTombstones: slugTombstones,
    previousRouteLock: routeLock,
  };
}

/** Every published station position, before metadata resolution. */
export function stationPositions(root: string): [number, number][] {
  const dataDir = join(root, "data");
  const metadataDir = join(root, "metadata");
  const records = [
    ...loadRegistry(
      readFileSync(join(metadataDir, "registry.yaml"), "utf8"),
    ).values(),
    ...loadCorrections(
      readFileSync(join(metadataDir, "corrections.yaml"), "utf8"),
    ).values(),
  ];
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
    ...records.flatMap(({ position }) => (position ? [position] : [])),
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
