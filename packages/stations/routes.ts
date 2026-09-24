import type { DatabaseRoutes } from "@neaps/tide-database";
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

/**
 * Every slug an id has ever resolved to and no longer does, by kind.
 *
 * Append-only, and the reason a slug can never change hands: the allocator
 * treats every entry here as taken, so a station that moves keeps its old
 * address as a redirect and nothing else can be minted at it — even after the
 * allocation table itself has been reset. `metadata:lock` writes it, so a
 * migration records its own history rather than relying on a curated
 * `formerSlugs` that only a registry record can carry.
 */
export interface FormerSlugs {
  tide: Record<string, string[]>;
  current: Record<string, string[]>;
}

export const emptyFormerSlugs = (): FormerSlugs => ({ tide: {}, current: {} });

export interface SlugTableOptions {
  /**
   * Ids to send back through the ladder even though they hold a slug. This is
   * how a deliberate migration happens: the old slug is recorded as former
   * rather than the table being reset and the history lost with it.
   */
  reallocate?: Set<string>;
  /**
   * Curated identity records. Two ids may share a curated slug only when
   * exactly one of them is here — a provider row joining the registry record
   * for the same water. Two provider rows on one slug is a collision.
   */
  registryIds?: Set<string>;
}

export function buildSlugTable(
  stations: ResolvedStation[],
  previous: SlugTable,
  tombstones: SlugTombstones = { tide: {}, current: {} },
  formerSlugs: FormerSlugs = emptyFormerSlugs(),
  { reallocate = new Set(), registryIds = new Set() }: SlugTableOptions = {},
): {
  table: SlugTable;
  tombstones: SlugTombstones;
  formerSlugs: FormerSlugs;
  gone: string[];
} {
  const table: SlugTable = {
    catalogue: { ...previous.catalogue },
    tide: {},
    current: {},
  };
  const nextTombstones: SlugTombstones = {
    tide: { ...tombstones.tide },
    current: { ...tombstones.current },
  };
  const nextFormer: FormerSlugs = {
    tide: Object.fromEntries(
      Object.entries(formerSlugs.tide).map(([id, slugs]) => [id, [...slugs]]),
    ),
    current: Object.fromEntries(
      Object.entries(formerSlugs.current).map(([id, slugs]) => [
        id,
        [...slugs],
      ]),
    ),
  };
  const gone: string[] = [];

  for (const kind of ["tide", "current"] as const) {
    const candidates = stations.filter(
      (station) =>
        station.routed !== false && (station.kind ?? "tide") === kind,
    );
    const localNames = new Map<string, number>();
    const localContexts = new Map<string, number>();
    for (const station of candidates) {
      const key = `${station.region_code || station.country_code}\0${(station.name || station.id).toLowerCase()}`;
      const context = toSlug(station.context ?? "");
      localNames.set(key, (localNames.get(key) ?? 0) + 1);
      if (context)
        localContexts.set(
          `${key}\0${context}`,
          (localContexts.get(`${key}\0${context}`) ?? 0) + 1,
        );
    }
    const ids = new Set(candidates.map((station) => station.id));
    const allocated = new Map(Object.entries(previous[kind] ?? {}));
    // The slug each id arrived with, so a move can be recorded whichever pass
    // caused it — the ladder or a curated slug.
    const arrived = new Map(allocated);
    const retire = (id: string, slug: string | undefined) => {
      if (slug === undefined || allocated.get(id) === slug) return;
      const history = (nextFormer[kind][id] ??= []);
      if (!history.includes(slug)) history.push(slug);
    };

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
    for (const id of reallocate) if (ids.has(id)) allocated.delete(id);

    // A curated `slug` outranks any earlier allocation. It may land on a slug
    // another id holds only to merge a provider row with the registry record
    // for the same water; between two provider rows, or two registry records,
    // it is a collision.
    for (const station of candidates) {
      if (!station.slug) continue;
      const owner = [...allocated].find(
        ([id, slug]) => slug === station.slug && id !== station.id,
      );
      if (owner) {
        const curatedOwners =
          Number(registryIds.has(owner[0])) +
          Number(registryIds.has(station.id));
        if (curatedOwners === 0)
          throw new Error(
            `${station.id}: slug ${JSON.stringify(station.slug)} is allocated to ${owner[0]}`,
          );
        if (curatedOwners === 2)
          throw new Error(
            `${station.id}: slug ${JSON.stringify(station.slug)} would have two registry owners, ${owner[0]} and ${station.id}`,
          );
      }
      const buried = Object.entries(nextTombstones[kind]).find(
        ([, slug]) => slug === station.slug,
      );
      if (buried)
        throw new Error(
          `${station.id}: slug ${JSON.stringify(station.slug)} is tombstoned for ${buried[0]}`,
        );
      const historical = Object.entries(nextFormer[kind]).find(
        ([id, slugs]) => id !== station.id && slugs.includes(station.slug!),
      );
      if (historical)
        throw new Error(
          `${station.id}: slug ${JSON.stringify(station.slug)} was published for ${historical[0]} and cannot change hands`,
        );
      allocated.set(station.id, station.slug);
    }

    // Every slug that arrived is reserved for the whole pass, so an id that
    // moves cannot vacate a slug into a later id's ladder — only its own.
    const used = new Set([
      ...allocated.values(),
      ...arrived.values(),
      ...Object.values(nextTombstones[kind]),
      ...Object.values(nextFormer[kind]).flat(),
      ...candidates.flatMap((station) => station.former_slugs ?? []),
    ]);
    for (const station of candidates
      .filter((candidate) => !allocated.has(candidate.id))
      .sort((a, b) => compare(a.id, b.id))) {
      const base = toSlug(station.name ?? "") || toSlug(station.id);
      const localKey = `${station.region_code || station.country_code}\0${(station.name || station.id).toLowerCase()}`;
      const context = toSlug(station.context ?? "");
      const region = toSlug(station.region ?? "");
      const localCollision = (localNames.get(localKey) ?? 0) > 1;
      const contextRung =
        context && localContexts.get(`${localKey}\0${context}`) === 1
          ? [`${base}-${context}`]
          : [];
      // A collision withholds the bare slug so an ambiguous name is not handed
      // to an arbitrary one of its stations. A station that already published
      // it is not arbitrary — that is the address people have — so it moves
      // only to a slug that says more than the bare one did. A unique context
      // does; the id rung does not, and a published `kahului` is worth more
      // than `kahului-noaa-1615680` with a redirect.
      const keepsBase =
        arrived.get(station.id) === base && contextRung.length === 0;
      const ladder = localCollision
        ? [
            ...(keepsBase ? [base] : []),
            ...contextRung,
            `${base}-${toSlug(station.id)}`,
          ]
        : [
            base,
            ...(context ? [`${base}-${context}`] : []),
            ...(region ? [`${base}-${region}`] : []),
            `${base}-${toSlug(station.id)}`,
          ];
      const own = arrived.get(station.id);
      const slug = ladder.find(
        (candidate) => candidate === own || !used.has(candidate),
      );
      if (!slug)
        throw new Error(
          `${station.id}: slug ladder exhausted (${ladder.join(", ")})`,
        );
      allocated.set(station.id, slug);
      used.add(slug);
    }
    for (const [id, was] of arrived) retire(id, was);

    // A tombstone is an id that left holding its slug. The same slug live
    // under another id means it changed hands, which is the one thing a
    // tombstone exists to forbid — and the shape a stale entry takes when a
    // merged record's retirement was recorded as a departure.
    for (const [buriedId, slug] of Object.entries(nextTombstones[kind])) {
      const holder = [...allocated].find(([, live]) => live === slug);
      if (holder && holder[0] !== buriedId)
        throw new Error(
          `${kind}/${slug}: tombstoned for ${buriedId} but allocated to ${holder[0]}`,
        );
    }

    const holders = new Map<string, string[]>();
    for (const [id, slug] of allocated)
      holders.set(slug, [...(holders.get(slug) ?? []), id]);
    for (const [slug, owners] of holders) {
      if (owners.length < 2) continue;
      const curated = owners.filter((id) => registryIds.has(id));
      if (curated.length !== 1)
        throw new Error(
          `${kind}/${slug}: shared by ${owners.join(", ")} with ${curated.length === 0 ? "no" : "two"} registry owners; a shared slug is one curated record plus the provider rows for the same water`,
        );
    }

    table[kind] = Object.fromEntries(
      [...allocated].sort(([a], [b]) => compare(a, b)),
    );
    nextFormer[kind] = Object.fromEntries(
      Object.entries(nextFormer[kind])
        .filter(([, slugs]) => slugs.length)
        .sort(([a], [b]) => compare(a, b)),
    );
  }

  return {
    table,
    tombstones: nextTombstones,
    formerSlugs: nextFormer,
    gone: gone.sort(compare),
  };
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

  const formerSlugOwners = new Map<string, string>();
  for (const member of members) {
    const owner = `${member.kind}\0${member.slug}`;
    for (const formerSlug of member.former_slugs ?? []) {
      if (!/^[a-z0-9-]+$/.test(formerSlug))
        throw new Error(
          `${member.id}: invalid former slug ${JSON.stringify(formerSlug)}`,
        );
      const formerKey = `${member.kind}\0${formerSlug}`;
      if (groups.has(formerKey) && formerKey !== owner)
        throw new Error(
          `${member.kind}/${member.slug}: former slug ${formerSlug} is another route's current slug`,
        );
      const previousOwner = formerSlugOwners.get(formerKey);
      if (previousOwner && previousOwner !== owner)
        throw new Error(
          `${member.kind}/${member.slug}: former slug ${formerSlug} is already used by ${previousOwner.split("\0").join("/")}`,
        );
      formerSlugOwners.set(formerKey, owner);
    }
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
    const formerSlugs = new Set(
      group.flatMap((member) => member.former_slugs ?? []),
    );
    const previousEntries = [
      routeLock[first.kind][first.slug],
      ...[...formerSlugs].map((slug) => routeLock[first.kind][slug]),
    ].filter((entry): entry is RouteLockEntry => entry !== undefined);
    const formerPaths = new Set(
      previousEntries.flatMap((entry) => entry.former_paths),
    );
    for (const entry of previousEntries) {
      if (entry.path !== path) formerPaths.add(entry.path);
    }
    for (const member of group) {
      for (const slug of member.former_slugs ?? [])
        formerPaths.add(routePath(first.kind, { ...member, slug }));
    }
    formerPaths.delete(path);
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

export function routeHistoryProblems(
  previous: RouteLock,
  current: RouteLock,
  previousSlugs: SlugTable,
  gone: Iterable<string>,
): string[] {
  const problems: string[] = [];
  const departedIds = new Set(gone);
  for (const kind of ["tide", "current"] as const) {
    const redirects = new Set(
      Object.values(current[kind]).flatMap(({ former_paths }) => former_paths),
    );
    for (const [slug, route] of Object.entries(previous[kind])) {
      if (current[kind][slug]) continue;
      const previousOwners = Object.entries(previousSlugs[kind])
        .filter(([, allocated]) => allocated === slug)
        .map(([id]) => id);
      const departed =
        previousOwners.length > 0 &&
        previousOwners.every((id) => departedIds.has(id));
      if (departed) continue;
      for (const path of [route.path, ...route.former_paths]) {
        if (!redirects.has(path))
          problems.push(
            `${kind}/${slug}: published path ${path} disappeared without a tombstone or redirect`,
          );
      }
    }
  }
  return problems;
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
