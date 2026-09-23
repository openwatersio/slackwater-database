import type { DatabaseRoutes, StationInput } from "@neaps/tide-database";
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
  buildRoutes,
  buildSlugTable,
  emptyFormerSlugs,
  type FormerSlugs,
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
  formerSlugs?: FormerSlugs;
  /** Ids to re-ladder, recording the slug each leaves behind. */
  reallocate?: Set<string>;
  routeLock: RouteLock;
  geocoder: Geocoder;
  waterBodies?: WaterBodies;
  maritimeZones?: MaritimeZones;
}

export function buildCatalogue(inputs: CatalogueInputs): {
  stations: ResolvedStation[];
  members: RouteMember[];
  routes: DatabaseRoutes;
  slugTable: SlugTable;
  slugTombstones: SlugTombstones;
  formerSlugs: FormerSlugs;
  gone: string[];
} {
  const sourceStations = [...inputs.tides, ...inputs.currents];
  const errors = validateMetadata(
    inputs.corrections,
    inputs.registry,
    sourceStations,
  );
  if (errors.length) throw new Error(errors.join("\n"));

  const places = {
    geocoder: inputs.geocoder,
    ...(inputs.waterBodies ? { waterBodies: inputs.waterBodies } : {}),
    ...(inputs.maritimeZones ? { maritimeZones: inputs.maritimeZones } : {}),
  };
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

  validateStationReferences(stations);
  const routedStations = stations.filter(({ routed }) => routed !== false);
  const {
    table: slugs,
    tombstones: slugTombstones,
    formerSlugs,
    gone,
  } = buildSlugTable(
    routedStations,
    inputs.slugTable,
    inputs.slugTombstones,
    inputs.formerSlugs ?? emptyFormerSlugs(),
    {
      ...(inputs.reallocate ? { reallocate: inputs.reallocate } : {}),
      registryIds: new Set(inputs.registry.keys()),
    },
  );
  const members: RouteMember[] = routedStations.map((station) => {
    const kind = station.kind ?? "tide";
    const slug = slugs[kind][station.id];
    if (!slug) throw new Error(`${station.id}: no ${kind} slug`);
    // A curated former slug and a recorded one are the same fact from two
    // sources; the route redirects both.
    const former = [
      ...new Set([
        ...(station.former_slugs ?? []),
        ...(formerSlugs[kind][station.id] ?? []),
      ]),
    ].filter((old) => old !== slug);
    return {
      id: station.id,
      kind,
      slug,
      country_code: station.country_code,
      ...(station.region_code ? { region_code: station.region_code } : {}),
      ...(former.length ? { former_slugs: former } : {}),
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
    formerSlugs,
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
