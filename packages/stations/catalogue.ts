import type { DatabaseRoutes, StationInput } from "@slackwater/database";
import type { Geocoder } from "./geocode.ts";
import type { MaritimeZones } from "./maritime-zones.ts";
import type { WaterBodies } from "./water-bodies.ts";
import {
  registryStations,
  resolveMetadata,
  validateMetadata,
  type Corrections,
  type Registry,
  type ResolvedStation,
} from "./metadata.ts";
import {
  assignSlugs,
  buildRoutes,
  type RouteLock,
  type RouteMember,
} from "./routes.ts";
import { filePath, type StationFile } from "./station-files.ts";
import { cleanName } from "./name-cleanup.ts";
import { isAuthoritative } from "./filtering.ts";

export interface CatalogueInputs {
  tides: StationInput[];
  currents: (StationInput & { routed?: boolean })[];
  corrections: Corrections;
  registry: Registry;
  /** Published stations; a record no file lists gets a new slug. */
  stationFiles: StationFile[];
  geocoder: Geocoder;
  waterBodies?: WaterBodies;
  maritimeZones?: MaritimeZones;
}

export function buildCatalogue(inputs: CatalogueInputs): {
  stations: ResolvedStation[];
  members: RouteMember[];
  routes: DatabaseRoutes;
  redundantNames: string[];
} {
  const sourceStations = [...inputs.tides, ...inputs.currents];
  const siblings = new Map(
    inputs.stationFiles.flatMap(({ sources }) =>
      sources.map((id) => [id, sources] as const),
    ),
  );
  const places = {
    geocoder: inputs.geocoder,
    ...(inputs.waterBodies ? { waterBodies: inputs.waterBodies } : {}),
    ...(inputs.maritimeZones ? { maritimeZones: inputs.maritimeZones } : {}),
  };
  const namedStations = sourceStations.map((station) => {
    if (
      !station.id.startsWith("ticon/") ||
      !cleanName(station.name ?? "", station.country ?? "").isOpaque
    )
      return station;
    const { name, ...correction } = inputs.corrections.get(station.id) ?? {};
    return {
      ...station,
      name: resolveMetadata(station, { ...places, correction }).name!,
    };
  });
  const errors = validateMetadata(
    inputs.corrections,
    inputs.registry,
    namedStations,
    siblings,
  );
  if (errors.length) throw new Error(errors.join("\n"));

  const providerIds = new Set(sourceStations.map(({ id }) => id));
  const stations = [
    ...sourceStations.map((station) =>
      resolveMetadata(station, {
        ...(inputs.corrections.get(station.id)
          ? { correction: inputs.corrections.get(station.id)! }
          : {}),
        ...(inputs.registry.get(station.id)
          ? { registry: inputs.registry.get(station.id)! }
          : {}),
        ...places,
      }),
    ),
    ...registryStations({ registry: inputs.registry, ...places }).filter(
      ({ id }) => !providerIds.has(id),
    ),
  ].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // A station's curated name the cleanup already produces for every one of its
  // records is one to prune, or a pin waiting for a regeneration to need it.
  // Reported, not refused.
  const byId = new Map(sourceStations.map((station) => [station.id, station]));
  const producesName = (id: string) => {
    const station = byId.get(id);
    const correction = inputs.corrections.get(id);
    if (!station || !correction?.name || inputs.registry.has(id)) return false;
    const { name, ...rest } = correction;
    return (
      resolveMetadata(station, { correction: rest, ...places }).name === name
    );
  };
  const redundantNames = inputs.stationFiles.flatMap(
    ({ file, name, sources }) =>
      name && sources.length && sources.every(producesName)
        ? [`${file}: ${name}`]
        : [],
  );

  validateStationReferences(stations);
  const routedStations = stations.filter(({ routed }) => routed !== false);
  const held = {
    tide: new Map<string, string>(),
    current: new Map<string, string>(),
  };
  const reserved = { tide: new Set<string>(), current: new Set<string>() };
  const routeLock: RouteLock = { tide: {}, current: {} };
  for (const file of inputs.stationFiles) {
    // A retired record the provider publishes again returns to its station.
    for (const id of [...file.sources, ...(file.retired_sources ?? [])])
      held[file.kind].set(id, file.slug);
    reserved[file.kind].add(file.slug);
    for (const path of file.redirect_from ?? [])
      reserved[file.kind].add(path.split("/").filter(Boolean).at(-1)!);
    routeLock[file.kind][file.slug] = {
      path: filePath(file),
      former_paths: file.redirect_from ?? [],
    };
  }
  const slugs = assignSlugs(routedStations, held, reserved);
  const members: RouteMember[] = routedStations.map((station) => {
    const kind = station.kind ?? "tide";
    const slug = slugs[kind].get(station.id);
    if (!slug) throw new Error(`${station.id}: no ${kind} slug`);
    return {
      id: station.id,
      kind,
      slug,
      country_code: station.country_code,
      ...(station.region_code ? { region_code: station.region_code } : {}),
      ...(station.quality?.accepted === false ? { rejected: true } : {}),
      ...(isAuthoritative(station) ? { authoritative: true } : {}),
      ...(station.quality?.score !== undefined
        ? { score: station.quality.score }
        : {}),
    };
  });

  const routes = buildRoutes(members, {
    routeLock,
    registryIds: new Set(inputs.registry.keys()),
  });
  followTideReferences(stations, routes);
  return { stations, members, routes, redundantNames };
}

/**
 * A tide pairing names a gauge, so it publishes as the record its station
 * shows first. A pairing curated against a relay that quality later rejects
 * for its operator's record of the same gauge keeps pointing at that gauge.
 */
function followTideReferences(
  stations: ResolvedStation[],
  routes: DatabaseRoutes,
): void {
  const shown = new Map(
    routes.tide.flatMap(({ station_ids }) =>
      station_ids.map((id) => [id, station_ids[0]!] as const),
    ),
  );
  for (const station of stations) {
    const reference = station.current?.tide_reference;
    const first = reference && shown.get(reference);
    if (first && first !== reference)
      station.current = { ...station.current, tide_reference: first };
  }
}

function validateStationReferences(stations: ResolvedStation[]): void {
  const byId = new Map(stations.map((station) => [station.id, station]));
  const requireKind = (
    owner: ResolvedStation,
    reference: string | undefined,
    kind: "tide" | "current",
  ) => {
    if (!reference) return;
    const target = byId.get(reference);
    if (!target)
      throw new Error(`${owner.id} references missing station ${reference}`);
    if ((target.kind ?? "tide") !== kind)
      throw new Error(
        `${owner.id} references ${reference}, which is not ${kind}`,
      );
  };

  for (const station of stations) {
    requireKind(station, station.offsets?.reference, "tide");
    requireKind(station, station.current?.offsets?.reference, "current");
    requireKind(station, station.current?.tide_reference, "tide");
    requireKind(station, station.current?.derived?.reference, "tide");
  }
}
