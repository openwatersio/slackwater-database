import type { DatabaseRoutes, StationRouteInput } from "../src/types.ts";
import type { ResolvedStation } from "./metadata.ts";

export type StationKind = "tide" | "current";

export interface SlugTable {
  catalogue: Record<string, unknown>;
  tide: Record<string, string>;
  current: Record<string, string>;
}

export interface SlugTombstones {
  tide: Record<string, string>;
  current: Record<string, string>;
}

export interface RouteMember {
  id: string;
  kind: StationKind;
  slug: string;
  country_code: string;
  region_code?: string;
  former_slugs?: string[];
}

export interface RouteLockEntry {
  path: string;
  former_paths: string[];
}

export interface RouteLock {
  tide: Record<string, RouteLockEntry>;
  current: Record<string, RouteLockEntry>;
}

export const DEPARTURE_LIMIT = 10;

export function buildSlugTable(
  stations: ResolvedStation[],
  previous: SlugTable,
  tombstones: SlugTombstones = { tide: {}, current: {} },
): { table: SlugTable; tombstones: SlugTombstones; gone: string[] } {
  const table: SlugTable = {
    catalogue: { ...previous.catalogue },
    tide: {},
    current: {},
  };
  const nextTombstones: SlugTombstones = {
    tide: { ...tombstones.tide },
    current: { ...tombstones.current },
  };
  const gone: string[] = [];

  for (const kind of ["tide", "current"] as const) {
    const candidates = stations.filter(
      (station) =>
        station.routed !== false && (station.kind ?? "tide") === kind,
    );
    const ids = new Set(candidates.map((station) => station.id));
    const allocated = new Map(Object.entries(previous[kind] ?? {}));

    for (const [id, slug] of [...allocated]) {
      if (ids.has(id)) continue;
      nextTombstones[kind][id] = slug;
      allocated.delete(id);
      gone.push(id);
    }
    for (const station of candidates) {
      const slug = nextTombstones[kind][station.id];
      if (allocated.has(station.id) || slug === undefined) continue;
      allocated.set(station.id, slug);
      delete nextTombstones[kind][station.id];
    }

    const used = new Set([
      ...allocated.values(),
      ...Object.values(nextTombstones[kind]),
      ...candidates.flatMap((station) => station.former_slugs ?? []),
    ]);
    for (const station of candidates
      .filter((candidate) => !allocated.has(candidate.id))
      .sort((a, b) => compare(a.id, b.id))) {
      const base = toSlug(station.name ?? "") || toSlug(station.id);
      const region = toSlug(station.region ?? "");
      const ladder = [
        base,
        ...(region ? [`${base}-${region}`] : []),
        `${base}-${toSlug(station.id)}`,
      ];
      const slug = ladder.find((candidate) => !used.has(candidate));
      if (!slug)
        throw new Error(
          `${station.id}: slug ladder exhausted (${ladder.join(", ")})`,
        );
      allocated.set(station.id, slug);
      used.add(slug);
    }
    table[kind] = Object.fromEntries(
      [...allocated].sort(([a], [b]) => compare(a, b)),
    );
  }

  return { table, tombstones: nextTombstones, gone: gone.sort(compare) };
}

export function checkSlugTable(
  previous: SlugTable,
  current: SlugTable,
  tombstones: SlugTombstones,
  formerSlugs: Partial<Record<StationKind, Iterable<string>>> = {},
): string[] {
  const problems: string[] = [];
  for (const kind of ["tide", "current"] as const) {
    const redirects = new Set(formerSlugs[kind] ?? []);
    for (const [id, was] of Object.entries(previous[kind] ?? {})) {
      const now = current[kind]?.[id];
      if (now === undefined) {
        const buried = tombstones[kind]?.[id];
        if (buried === was) continue;
        problems.push(
          buried === undefined
            ? `${kind}/${id}: slug ${JSON.stringify(was)} disappeared without being tombstoned`
            : `${kind}/${id}: tombstoned as ${JSON.stringify(buried)} but was published as ${JSON.stringify(was)}`,
        );
      } else if (now !== was && !redirects.has(was)) {
        problems.push(
          `${kind}/${id}: slug moved from ${JSON.stringify(was)} to ${JSON.stringify(now)} without ${JSON.stringify(was)} in formerSlugs`,
        );
      }
    }
  }
  return problems;
}

export function departures(
  previousIds: Iterable<string>,
  catalogueIds: Iterable<string>,
): string[] {
  const present = new Set(catalogueIds);
  return [...previousIds].filter((id) => !present.has(id)).sort(compare);
}

export function toSlug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function routePath(kind: StationKind, station: RouteMember): string {
  const prefix = kind === "tide" ? "tides" : "currents";
  const country = station.country_code.toLowerCase();
  const subdivision = station.region_code?.startsWith(
    `${station.country_code}-`,
  )
    ? station.region_code.slice(3).toLowerCase()
    : undefined;
  return `/${[prefix, country, subdivision, station.slug].filter(Boolean).join("/")}/`;
}

export function buildRoutes(
  members: RouteMember[],
  {
    routeLock,
    registryIds,
  }: { routeLock: RouteLock; registryIds: Set<string> },
): DatabaseRoutes {
  const groups = new Map<string, RouteMember[]>();
  for (const member of members) {
    if (!/^[a-z0-9-]+$/.test(member.slug))
      throw new Error(
        `${member.id}: invalid route slug ${JSON.stringify(member.slug)}`,
      );
    if (!/^[A-Z]{2}$/.test(member.country_code))
      throw new Error(
        `${member.id}: invalid country code ${member.country_code}`,
      );
    if (
      member.region_code &&
      !member.region_code.startsWith(`${member.country_code}-`)
    )
      throw new Error(
        `${member.id}: region ${member.region_code} does not match country ${member.country_code}`,
      );
    const key = `${member.kind}\0${member.slug}`;
    groups.set(key, [...(groups.get(key) ?? []), member]);
  }

  const routes: DatabaseRoutes = { tide: [], current: [] };
  const canonicalPaths = new Map<string, string>();
  const formerPathOwners = new Map<string, string>();
  for (const group of groups.values()) {
    const first = group[0]!;
    if (
      group.some(
        (member) =>
          member.country_code !== first.country_code ||
          member.region_code !== first.region_code,
      )
    )
      throw new Error(
        `${first.slug}: shared route members disagree on country or region`,
      );
    const path = routePath(first.kind, first);
    canonicalPaths.set(path, `${first.kind}/${first.slug}`);
    const previous = routeLock[first.kind][first.slug];
    const formerPaths = new Set(previous?.former_paths ?? []);
    if (previous?.path && previous.path !== path)
      formerPaths.add(previous.path);
    for (const member of group) {
      for (const slug of member.former_slugs ?? [])
        formerPaths.add(routePath(first.kind, { ...member, slug }));
    }
    const stationIds = group
      .map((member) => member.id)
      .sort(
        (a, b) =>
          Number(registryIds.has(b)) - Number(registryIds.has(a)) ||
          compare(a, b),
      );
    routes[first.kind].push({
      slug: first.slug,
      station_ids: stationIds,
      former_paths: [...formerPaths].sort(compare),
    });
  }

  for (const kind of ["tide", "current"] as const)
    routes[kind].sort((a, b) => compare(a.slug, b.slug));
  for (const kind of ["tide", "current"] as const) {
    for (const route of routes[kind]) {
      const owner = `${kind}/${route.slug}`;
      for (const path of route.former_paths ?? []) {
        if (canonicalPaths.has(path) && canonicalPaths.get(path) !== owner)
          throw new Error(
            `${owner}: former path ${path} is another route's canonical path`,
          );
        const previousOwner = formerPathOwners.get(path);
        if (previousOwner && previousOwner !== owner)
          throw new Error(
            `${owner}: former path ${path} is already used by ${previousOwner}`,
          );
        formerPathOwners.set(path, owner);
      }
    }
  }
  return routes;
}

export function buildRouteLock(
  members: RouteMember[],
  previous: RouteLock,
): RouteLock {
  const routes = buildRoutes(members, {
    routeLock: previous,
    registryIds: new Set(),
  });
  const byId = new Map(members.map((member) => [member.id, member]));
  const lock: RouteLock = { tide: {}, current: {} };
  for (const kind of ["tide", "current"] as const) {
    for (const route of routes[kind]) {
      const member = byId.get(route.station_ids[0]!);
      if (!member) throw new Error(`${kind}/${route.slug}: no route member`);
      lock[kind][route.slug] = {
        path: routePath(kind, member),
        former_paths: route.former_paths ?? [],
      };
    }
  }
  return lock;
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
