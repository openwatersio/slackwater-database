import type { DatabaseRoutes, StationInput } from "@neaps/tide-database";
import type { Geocoder } from "./geocode.ts";
import {
  registryStations,
  resolveMetadata,
  validateMetadata,
  type Corrections,
  type Registry,
  type ResolvedStation,
} from "./metadata.ts";
import {
  buildRoutes,
  buildSlugTable,
  type RouteLock,
  type RouteMember,
  type SlugTable,
  type SlugTombstones,
} from "./routes.ts";

export interface CatalogueInputs {
  tides: StationInput[];
  currents: (StationInput & { routed?: boolean })[];
  corrections: Corrections;
  registry: Registry;
  slugTable: SlugTable;
  slugTombstones: SlugTombstones;
  routeLock: RouteLock;
  geocoder: Geocoder;
}

export function buildCatalogue(inputs: CatalogueInputs): {
  stations: ResolvedStation[];
  members: RouteMember[];
  routes: DatabaseRoutes;
  slugTable: SlugTable;
  slugTombstones: SlugTombstones;
  gone: string[];
} {
  const sourceStations = [...inputs.tides, ...inputs.currents];
  const errors = validateMetadata(
    inputs.corrections,
    inputs.registry,
    sourceStations,
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
        geocoder: inputs.geocoder,
      }),
    ),
    ...registryStations({
      registry: inputs.registry,
      geocoder: inputs.geocoder,
    }).filter(({ id }) => !providerIds.has(id)),
  ].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  validateStationReferences(stations);
  const routedStations = stations.filter(({ routed }) => routed !== false);
  const {
    table: slugs,
    tombstones: slugTombstones,
    gone,
  } = buildSlugTable(routedStations, inputs.slugTable, inputs.slugTombstones);
  const members: RouteMember[] = routedStations.map((station) => {
    const kind = station.kind ?? "tide";
    const slug = slugs[kind][station.id];
    if (!slug) throw new Error(`${station.id}: no ${kind} slug`);
    return {
      id: station.id,
      kind,
      slug,
      country_code: station.country_code,
      ...(station.region_code ? { region_code: station.region_code } : {}),
      ...(station.former_slugs ? { former_slugs: station.former_slugs } : {}),
    };
  });

  return {
    stations,
    members,
    routes: buildRoutes(members, {
      routeLock: inputs.routeLock,
      registryIds: new Set(inputs.registry.keys()),
    }),
    slugTable: slugs,
    slugTombstones,
    gone,
  };
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
