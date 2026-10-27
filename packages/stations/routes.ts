import type { DatabaseRoutes } from "@slackwater/database";
// From source, not the package entry: the entry ships the database that
// @slackwater/database generates by loading this package.
import { routePath } from "../database/src/route-path.ts";
import type { ResolvedStation } from "./metadata.ts";

export type StationKind = "tide" | "current";

export interface RouteMember {
  id: string;
  kind: StationKind;
  slug: string;
  country_code: string;
  region_code?: string;
  /** Quality rejected the record, so it sorts after the ones a route shows. */
  rejected?: boolean;
  /** The record's source is authoritative, so it leads the records quality scored. */
  authoritative?: boolean;
  /** Quality's score, which orders the rest. */
  score?: number;
}

export interface RouteLockEntry {
  path: string;
  former_paths: string[];
}

/** Each published route's path and redirects, by kind and slug. */
export interface RouteLock {
  tide: Record<string, RouteLockEntry>;
  current: Record<string, RouteLockEntry>;
}

/**
 * Every routed station's slug. A station a station file already lists keeps
 * that file's slug; any other climbs the ladder, avoiding every slug and
 * redirect already published for its kind, so an address never changes hands.
 */
export function assignSlugs(
  stations: ResolvedStation[],
  held: Record<StationKind, Map<string, string>>,
  reserved: Record<StationKind, Set<string>>,
): Record<StationKind, Map<string, string>> {
  const result = { tide: new Map(), current: new Map() } as Record<
    StationKind,
    Map<string, string>
  >;
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
    const used = new Set([...held[kind].values(), ...reserved[kind]]);
    for (const station of candidates) {
      const slug = held[kind].get(station.id);
      if (slug) result[kind].set(station.id, slug);
    }
    for (const station of candidates
      .filter((candidate) => !held[kind].has(candidate.id))
      .sort((a, b) => compare(a.id, b.id))) {
      const base = toSlug(station.name ?? "") || toSlug(station.id);
      const localKey = `${station.region_code || station.country_code}\0${(station.name || station.id).toLowerCase()}`;
      const context = toSlug(station.context ?? "");
      const region = toSlug(station.region ?? "");
      // A collision withholds the bare slug so an ambiguous name is not handed
      // to an arbitrary one of its stations.
      const ladder =
        (localNames.get(localKey) ?? 0) > 1
          ? [
              ...(context && localContexts.get(`${localKey}\0${context}`) === 1
                ? [`${base}-${context}`]
                : []),
              `${base}-${toSlug(station.id)}`,
            ]
          : [
              base,
              ...(context ? [`${base}-${context}`] : []),
              ...(region ? [`${base}-${region}`] : []),
              `${base}-${toSlug(station.id)}`,
            ];
      const slug = ladder.find((candidate) => !used.has(candidate));
      if (!slug)
        throw new Error(
          `${station.id}: slug ladder exhausted (${ladder.join(", ")})`,
        );
      result[kind].set(station.id, slug);
      used.add(slug);
    }
  }
  return result;
}

// Letters that NFD leaves whole, so stripping marks would delete them.
const TRANSLITERATE: Record<string, string> = {
  æ: "ae",
  đ: "d",
  ð: "d",
  ł: "l",
  œ: "oe",
  ø: "o",
  ß: "ss",
  þ: "th",
};

export function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[æđðłœøßþ]/g, (letter) => TRANSLITERATE[letter]!)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
    // Consumers read a two-letter first path segment as a country code.
    if (member.slug.length <= 2)
      throw new Error(
        `${member.id}: route slug ${JSON.stringify(member.slug)} is 2 characters or fewer`,
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
    // The station's published path, when its geography has moved since, and
    // its redirects.
    const previous = routeLock[first.kind][first.slug];
    const formerPaths = new Set(previous?.former_paths ?? []);
    if (previous) formerPaths.add(previous.path);
    formerPaths.delete(path);
    // Consumers show a route's first station: the curated record, else one
    // quality does not score (a CHS identity), else the accepted record a
    // merge names primary (merges.ts), an authoritative one or else the best
    // scored, so a station never shows a weaker record on the order of its
    // ids. Rejected records keep id order.
    const scored = (m: RouteMember) => !m.rejected && m.score !== undefined;
    const stationIds = group
      .sort(
        (a, b) =>
          Number(registryIds.has(b.id)) - Number(registryIds.has(a.id)) ||
          Number(a.rejected ?? false) - Number(b.rejected ?? false) ||
          Number(scored(a)) - Number(scored(b)) ||
          (scored(a) && scored(b)
            ? Number(b.authoritative ?? false) -
                Number(a.authoritative ?? false) || b.score! - a.score!
            : 0) ||
          compare(a.id, b.id),
      )
      .map((member) => member.id);
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

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
