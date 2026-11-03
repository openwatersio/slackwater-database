/**
 * Which tide routes publish the same physical gauge, and so should become one
 * station with one URL.
 *
 * Four kinds of evidence join routes. A TICON relay that declares its
 * originator (see sources/ticon/provenance.ts) joins the originator's route
 * when the two sit within MAX_PROVENANCE_KM and their M2 does not contradict
 * it; an unambiguous declaration skips the M2 check within MAX_GAUGE_CODE_KM.
 * A relay quality marks as superseded by its operator's record passed the same
 * tests, so its link counts as provenance. A CMEMS record joins the one
 * station of its name within MAX_COPY_KM whose M2, amplitude and phase,
 * agrees. A CHS record, which carries a name and a position and no harmonics,
 * joins the one provider station of its name within MAX_TWIN_KM, or within
 * MAX_MEDS_TWIN_KM when that station is MEDS's, unless SEPARATE_TWINS lists
 * the pair. Otherwise
 * quality's `redundant` link
 * joins a duplicate to the record it duplicates: on a shared TICON gauge code,
 * or on proximity alone. Proximity pairs records to hide the weaker one, not
 * to say they are one gauge, so a confident plan leaves it, a gauge code
 * shared across more than MAX_GAUGE_CODE_KM, and a gauge code whose records'
 * M2 disagree, to a person, as it does a CHS record with two provider
 * stations of its name, or one up to MAX_TWIN_REVIEW_KM away. No link joins
 * two authoritative records: two station numbers a provider publishes stay two
 * stations. No link joins two CHS records either. Joined routes
 * collapse onto the published slug that names the primary record, so a clean
 * URL such as `bergen` survives even when an authoritative record took a
 * suffixed one, except that a station holding a CHS record keeps that
 * record's slug.
 */
import type { DatabaseRoutes, StationQuality } from "@slackwater/database";
import { declaration } from "../../sources/ticon/provenance.ts";
import { tideConflict } from "./evaluate-quality.ts";
import {
  distance,
  gaugeKey,
  isAuthoritative,
  m2Contradicts,
  MAX_PROVENANCE_KM,
} from "./filtering.ts";
import { toSlug } from "./routes.ts";
import type { ResolvedStation } from "./metadata.ts";

/** The farthest a relay may sit from the originator it declares. */
export { MAX_PROVENANCE_KM };
/**
 * The farthest apart two records sharing a gauge code merge without review.
 * UHSLC's letter suffixes mark a gauge that moved, usually within its harbor;
 * farther apart, one record's position is likely wrong (Port Stanley's sit
 * 105.7 km apart).
 */
export const MAX_GAUGE_CODE_KM = 2;
/**
 * The farthest a CMEMS record may sit from the record it copies. CMEMS
 * relays European agencies' gauges under a code cut from the place name, so
 * it declares no originator; the same name at the same position is the
 * evidence instead.
 */
export const MAX_COPY_KM = 0.05;

/**
 * The farthest a CHS record's provider twin may sit from it and merge without
 * review. A CHS record's position is IWLS's; MEDS rounds its gauges to the
 * minute, about 1.85 km of latitude, so a twin can sit farther off. Of the
 * 159 MEDS records named as their CHS station within 1 km, every one carries
 * that station's IWLS number. This project's definition.
 */
export const MAX_TWIN_KM = 1;
/** The farthest a provider record of a CHS record's name is put to a person. */
export const MAX_TWIN_REVIEW_KM = 5;
/**
 * The farthest a MEDS record may sit from the CHS record of its name and merge
 * without review. MEDS numbers each gauge with its DFO station number, the
 * code IWLS publishes the CHS station under, and its positions can be several
 * kilometres off: Sand Heads 07594 sits 8.1 km from IWLS's position, Forteau
 * Bay 02590 5.5 km. Of the 194 MEDS records named as a CHS station within
 * 25 km, checked against IWLS's station list on 2026-10-16, 193 carry that
 * station's code; the other, La Grande Rivière's 64680 for CHS's 04680, sits
 * at the same position. This repo holds no IWLS code (stations/README.md
 * #provenance), so the number is checked by hand against IWLS, and the name
 * stands for it here. The cap stops a namesake, or a mis-keyed number, from
 * joining. This project's definition.
 */
export const MAX_MEDS_TWIN_KM = 25;

/** A MEDS record: TICON's relay of a DFO gauge, under its station number. */
const isMeds = (station: { id: string }) =>
  /^ticon\/.+-\d+-can-meds$/.test(station.id);

/** How far a provider record of a CHS record's name merges without review. */
const twinKm = (other: { id: string }) =>
  isMeds(other) ? MAX_MEDS_TWIN_KM : MAX_TWIN_KM;
/** How far a provider record of a CHS record's name is a twin at all. */
const reviewKm = (other: { id: string }) =>
  isMeds(other) ? MAX_MEDS_TWIN_KM : MAX_TWIN_REVIEW_KM;

/**
 * CHS records and provider records of their name that publish apart on
 * purpose, keyed "<chs id> <provider id>", with the reason. No plan joins
 * them, and `npm run validate` accepts them on separate routes.
 */
export const SEPARATE_TWINS: ReadonlyMap<string, string> = new Map([
  [
    "chs-bamfield ticon/bamfield-541-can-uhslc_fd",
    "UHSLC's Bamfield sits in Grappler Inlet, 900 m from the MEDS gauge the CHS station holds, and declares no originator; M2 agrees, which two gauges in one inlet would too",
  ],
  [
    "chs-kumeon-bay noaa/8218361",
    "NOAA 8218361 is a 1954 occupation predicted from Ketchikan with fixed offsets, its position read off a paper chart, and NOAA says CHS 09414, a temporary 1954 station referenced to Prince Rupert, may be another station. For 20-21 Oct 2026 NOAA's turns run 45-55 minutes after CHS's and its range is about 15% larger, so one route would jump every turn by about 50 minutes",
  ],
]);

const CHS = "Canadian Hydrographic Service";

/**
 * A CHS record: identity only, a name and a position this repo publishes,
 * with its predictions fetched from CHS at runtime. A station holding one is
 * a curated station.
 */
export const isCurated = (station: { source?: { name: string } }) =>
  station.source?.name === CHS;

export type Evidence =
  "provenance" | "copy" | "gauge" | "curated" | "proximity";

export interface MergeMember {
  id: string;
  /** The slug this record's route published. */
  slug: string;
  name: string;
  /** Kilometres from the survivor's primary record. */
  km: number;
  /** How this record joined; absent for the survivor's own records. */
  evidence?: Evidence;
  /** The record the evidence points at. */
  target?: string;
}

export interface MergeGroup {
  /** The slug every other slug in the group redirects to: a published slug,
   *  or one a member already holds as a redirect, such as `cape-may`. */
  survivor: string;
  /** The record quality would choose to publish under it. */
  primary: string;
  /** Whether the primary comes from an authoritative source, whose geography the station takes. */
  authoritative: boolean;
  /** The CHS record the station is named for, whose slug, curated fields and
   *  geography it keeps. */
  curated?: string;
  /** Every published slug in the group; the first's station file survives. */
  slugs: string[];
  members: MergeMember[];
}

export interface RefusedLink {
  id: string;
  target: string;
  reason: string;
}

export interface MergePlan {
  groups: MergeGroup[];
  /** Links that failed the position or M2 check, or would join two authoritative records. */
  refused: RefusedLink[];
}

const km = (a: ResolvedStation, b: ResolvedStation) =>
  distance(a.latitude, a.longitude, b.latitude, b.longitude);

/** A TICON record's gauge code; other sources have none. */
const gaugeCode = (station: ResolvedStation) =>
  station.id.startsWith("ticon/")
    ? gaugeKey(station.source?.id ?? station.id)
    : undefined;

type Tide = Parameters<typeof tideConflict>[0];

/** Whether two records' M2 disagrees in amplitude or phase by more than one
 *  gauge analyzed twice does, so a rule that joins on a code or a name
 *  refuses what the copy rule refuses. */
const m2Differs = (a: ResolvedStation, b: ResolvedStation) =>
  m2Contradicts(a, b) || !!tideConflict(a as Tide, b as Tide);

/**
 * A place name's spellings for matching: CMEMS writes Bodø as Bodoe and
 * Göteborg as Goteborg, so ø, ö, æ, ä, ü and å match either their bare letter
 * or their two-letter form. Digits stay, so "Galway Port 2" is not "Galway Port".
 */
function nameKeys(name: string): string[] {
  const key = (n: string) =>
    n
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/[^a-z0-9]/g, "");
  const lower = name.toLowerCase();
  const keys = new Set([
    key(lower.replace(/ø/g, "o").replace(/æ/g, "ae")),
    key(
      lower
        .replace(/[øö]/g, "oe")
        .replace(/[æä]/g, "ae")
        .replace(/ü/g, "ue")
        .replace(/å/g, "aa"),
    ),
  ]);
  keys.delete("");
  return [...keys];
}

/**
 * A name's keys for matching a CHS record to its provider twin. MEDS appends
 * the province to some names ("La Grande Riviere Pq", "Wadhams BC"), which
 * says nothing about which gauge it is.
 */
export const twinKeys = (name: string) =>
  nameKeys(
    name.replace(
      /[\s,]+(bc|b\.c\.|pq|qc|nb|ns|nl|nf|pe|pei|nu|nt|yt|on|mb)\.?$/i,
      "",
    ),
  );

const byCodepoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const shortestSlug = (a: string, b: string) =>
  a.length - b.length || byCodepoint(a, b);

/**
 * With `confident`, only provenance, CMEMS copies, gauge codes shared within
 * MAX_GAUGE_CODE_KM and sure CHS twins join routes: the merges `npm run merge`
 * makes. No plan joins a CHS twin `separate` lists.
 */
export function planMerges(
  stations: ResolvedStation[],
  routes: DatabaseRoutes,
  quality: Map<string, StationQuality>,
  {
    confident = false,
    separate = SEPARATE_TWINS,
  }: { confident?: boolean; separate?: ReadonlyMap<string, string> } = {},
): MergePlan {
  const byId = new Map(stations.map((station) => [station.id, station]));
  const slugOf = new Map<string, string>();
  for (const { slug, station_ids } of routes.tide)
    for (const id of station_ids) slugOf.set(id, slug);

  const parent = new Map<string, string>();
  const find = (slug: string): string => {
    const up = parent.get(slug) ?? slug;
    if (up === slug) return slug;
    const root = find(up);
    parent.set(slug, root);
    return root;
  };
  // The authoritative records under each root, so no link joins two.
  const authorities = new Map<string, string[]>();
  for (const { slug, station_ids } of routes.tide)
    authorities.set(
      slug,
      station_ids.filter((id) => {
        const station = byId.get(id);
        return station && isAuthoritative(station);
      }),
    );
  // And the CHS records, so no link joins two curated stations.
  const curatedIds = new Map<string, string[]>();
  for (const { slug, station_ids } of routes.tide)
    curatedIds.set(
      slug,
      station_ids.filter((id) => {
        const station = byId.get(id);
        return station && isCurated(station);
      }),
    );
  const evidence = new Map<string, { evidence: Evidence; target: string }>();
  const refused: RefusedLink[] = [];
  const join = (id: string, target: string, kind: Evidence) => {
    const [a, b] = [slugOf.get(id), slugOf.get(target)];
    if (!a || !b) return;
    if (separate.has(`${id} ${target}`) || separate.has(`${target} ${id}`))
      return;
    const [ra, rb] = [find(a), find(b)];
    if (ra !== rb) {
      const [ia, ib] = [authorities.get(ra)!, authorities.get(rb)!];
      const [ca, cb] = [curatedIds.get(ra)!, curatedIds.get(rb)!];
      const both =
        ia.length && ib.length
          ? [...ia, ...ib]
          : ca.length && cb.length
            ? [...ca, ...cb]
            : undefined;
      if (both) {
        // The gauge pass and quality's link can both try one pair.
        if (!refused.some((r) => r.id === id && r.target === target))
          refused.push({
            id,
            target,
            reason: `would join ${both.sort().join(" and ")}`,
          });
        return;
      }
      parent.set(ra, rb);
      authorities.set(rb, [...ia, ...ib]);
      curatedIds.set(rb, [...ca, ...cb]);
    }
    if (!evidence.has(id)) evidence.set(id, { evidence: kind, target });
  };

  for (const station of stations) {
    if (!station.id.startsWith("ticon/")) continue;
    const declared = declaration(station.id);
    const target = declared?.id;
    const origin = target ? byId.get(target) : undefined;
    if (!declared || !target || !origin) continue;
    const apart = km(station, origin);
    if (apart > MAX_PROVENANCE_KM)
      refused.push({
        id: station.id,
        target,
        reason: `${apart.toFixed(1)} km apart`,
      });
    // A provider-qualified gauge code (including NOAA numbers, JODC HD
    // codes and JMA gauge codes) names one gauge. Unqualified originator numbers and more distant
    // relays still need M2 confirmation.
    else if (
      !(declared.unambiguous && apart <= MAX_GAUGE_CODE_KM) &&
      m2Contradicts(station, origin)
    )
      refused.push({ id: station.id, target, reason: "M2 amplitudes differ" });
    else join(station.id, target, "provenance");
  }

  // A declared originator outranks an inferred duplicate: UHSLC 259B names
  // Ferry Reach even though quality pairs it with St George's 0.75 km away.
  // Quality supersedes a relay only under the tests above, so its link is
  // provenance too. Provenance links go first, then CMEMS copies, then gauge
  // links, then proximity ones, so a weaker link never takes the place of a
  // stronger one.
  const links = [...quality].flatMap(([id, result]) => {
    if (!result.redundant) return [];
    if (result.reason !== "duplicate" && result.reason !== "superseded")
      return [];
    if (evidence.get(id)?.evidence === "provenance") return [];
    const [station, target] = [byId.get(id), byId.get(result.redundant)];
    if (!station || !target) return [];
    // Quality points a superseded relay at the operator's record, unless
    // that record later lost a duplicate; the relay then follows the winner,
    // which only proximity may tie to it (Dauphin Island's relays point at
    // its Hydro gauge).
    const operator = result.issues
      ?.join(" ")
      .match(/Superseded by (\S+), its operator's own record/)?.[1];
    const code = gaugeCode(station);
    const kind: Evidence =
      result.reason === "superseded" && operator === result.redundant
        ? "provenance"
        : code && code === gaugeCode(target)
          ? "gauge"
          : "proximity";
    if (confident && kind === "proximity") return [];
    if (
      confident &&
      kind === "gauge" &&
      (km(station, target) > MAX_GAUGE_CODE_KM || m2Differs(station, target))
    )
      return [];
    return [{ id, target: result.redundant, kind }];
  });
  const joinAll = (kind: Evidence) => {
    for (const link of links)
      if (link.kind === kind) join(link.id, link.target, link.kind);
  };
  joinAll("provenance");

  // A CMEMS record joins the one station of its name it sits on, unless their
  // M2 says otherwise. Two such stations leave the choice to a person.
  // ponytail: every CMEMS record against every record; a spatial index if
  // this grows past seconds.
  const isCopy = (station: ResolvedStation) => station.id.endsWith("-cmems");
  for (const copy of stations.filter(isCopy)) {
    const names = nameKeys(copy.name ?? "");
    if (!names.length) continue;
    const named = stations.filter(
      (other) =>
        !isCopy(other) &&
        slugOf.has(other.id) &&
        km(copy, other) <= MAX_COPY_KM &&
        nameKeys(other.name ?? "").some((key) => names.includes(key)),
    );
    // Records already one station are one choice.
    const roots = new Set(named.map(({ id }) => find(slugOf.get(id) ?? id)));
    if (roots.size !== 1) continue;
    const other = named[0]!;
    // Records one route already holds are one station whatever M2 says.
    const rootOf = (id: string) => find(slugOf.get(id) ?? id);
    if (rootOf(copy.id) === rootOf(other.id)) continue;
    // Every record it would join must have an M2 that agrees with the copy's.
    const m2 = (station: ResolvedStation) =>
      station.harmonic_constituents?.some(({ name }) => name === "M2");
    if (!m2(copy) || !named.every(m2))
      refused.push({
        id: copy.id,
        target: other.id,
        reason: "no M2 to compare",
      });
    else if (named.some((n) => tideConflict(copy as Tide, n as Tide)))
      refused.push({ id: copy.id, target: other.id, reason: "M2 differs" });
    else join(copy.id, other.id, "copy");
  }
  // Records sharing a gauge code are segments of one gauge, whichever record
  // quality links each to, unless their M2 says otherwise (Fanning's 012a and
  // 012b sit together with M2 a factor of two apart).
  // ponytail: pairwise within a gauge code; codes hold a handful of records.
  const byGauge = new Map<string, ResolvedStation[]>();
  for (const station of stations) {
    const code = gaugeCode(station);
    if (!code) continue;
    const segments = byGauge.get(code) ?? [];
    for (const other of segments)
      if (km(station, other) <= MAX_GAUGE_CODE_KM && !m2Differs(station, other))
        join(station.id, other.id, "gauge");
    byGauge.set(code, [...segments, station]);
  }

  joinAll("gauge");

  // A CHS record joins the provider station of its name it sits beside. Its
  // position is the one IWLS publishes for the gauge, and MEDS, which relays
  // CHS's gauges into TICON, names and numbers the gauge as CHS does, so a
  // MEDS record joins within MAX_MEDS_TWIN_KM. Two provider stations of its
  // name, or one farther than MAX_TWIN_KM that is not MEDS, wait for a
  // person, as does a provider station two CHS records claim.
  // ponytail: every CHS record against every record; a spatial index if this
  // grows past seconds.
  const rootOf = (id: string) => find(slugOf.get(id)!);
  const twins = stations.filter(isCurated).flatMap((record) => {
    if (!slugOf.has(record.id)) return [];
    const names = twinKeys(record.name ?? "");
    const near = stations.filter(
      (other) =>
        !isCurated(other) &&
        slugOf.has(other.id) &&
        !separate.has(`${record.id} ${other.id}`) &&
        rootOf(other.id) !== rootOf(record.id) &&
        km(record, other) <= reviewKm(other) &&
        twinKeys(other.name ?? "").some((key) => names.includes(key)),
    );
    return near.length ? [{ record, near }] : [];
  });
  const claims = new Map<string, number>();
  for (const { near } of twins)
    for (const root of new Set(near.map(({ id }) => rootOf(id))))
      claims.set(root, (claims.get(root) ?? 0) + 1);
  for (const { record, near } of twins) {
    const roots = new Set(near.map(({ id }) => rootOf(id)));
    const sure =
      roots.size === 1 &&
      claims.get([...roots][0]!) === 1 &&
      near.every((other) => km(record, other) <= twinKm(other));
    if (confident && !sure) continue;
    for (const other of near) join(other.id, record.id, "curated");
  }

  joinAll("proximity");

  const slugsByRoot = new Map<string, string[]>();
  for (const { slug } of routes.tide) {
    const root = find(slug);
    slugsByRoot.set(root, [...(slugsByRoot.get(root) ?? []), slug]);
  }
  const idsBySlug = new Map(
    routes.tide.map(({ slug, station_ids }) => [slug, station_ids]),
  );
  const formerBySlug = new Map(
    routes.tide.map(({ slug, former_paths }) => [slug, former_paths ?? []]),
  );

  const groups: MergeGroup[] = [];
  for (const slugs of slugsByRoot.values()) {
    if (slugs.length < 2) continue;
    slugs.sort(shortestSlug);
    const ids = slugs.flatMap((slug) => idsBySlug.get(slug)!);
    const records = ids.flatMap((id) => byId.get(id) ?? []);
    const accepted = records.filter(({ id }) => quality.get(id)?.accepted);
    const primary =
      accepted.find(isAuthoritative) ??
      [...accepted].sort(
        (a, b) =>
          quality.get(b.id)!.score - quality.get(a.id)!.score ||
          byCodepoint(a.id, b.id),
      )[0] ??
      records[0]!;
    // The URL should name what the station shows, its primary record: the
    // shortest slug that is its name or a word-prefix of it (`annapolis` for
    // Annapolis US Naval Academy), else the primary's own slug, else the
    // shortest that is its name with a suffix. A slug a member holds as a
    // redirect counts, so Cape May takes back `cape-may`. A slug ending in a
    // record id is the ladder's last resort and loses to any other.
    const own = toSlug(primary.name ?? "");
    const primarySlug = slugOf.get(primary.id);
    const held = slugs.flatMap((slug) =>
      (formerBySlug.get(slug) ?? []).map((path) =>
        path.split("/").filter(Boolean).at(-1)!,
      ),
    );
    const rank = (slug: string) => [
      ids.some((id) => slug.endsWith(`-${toSlug(id)}`)) ? 1 : 0,
      slug === own || own.startsWith(`${slug}-`)
        ? 0
        : slug === primarySlug
          ? 1
          : slug.startsWith(`${own}-`)
            ? 2
            : 3,
      slug.length,
    ];
    const best = (candidates: string[]) =>
      [...candidates].sort((a, b) => {
        const [ra, rb] = [rank(a), rank(b)];
        const i = ra.findIndex((value, index) => value !== rb[index]);
        return i >= 0 ? ra[i]! - rb[i]! : byCodepoint(a, b);
      })[0]!;
    // A curated station keeps its CHS record's slug: the name a person
    // chose for it, which a provider's suffixed slug only approximates.
    const curated = records.find(isCurated);
    const survivor = curated
      ? slugOf.get(curated.id)!
      : best([...slugs, ...held]);
    // The station file of the published slug the survivor is, or ranks best,
    // carries the merged station.
    const carrier = slugs.includes(survivor) ? survivor : best(slugs);
    slugs.splice(slugs.indexOf(carrier), 1);
    slugs.unshift(carrier);
    const members = records.map((record): MergeMember => {
      const joined = evidence.get(record.id);
      return {
        id: record.id,
        slug: slugOf.get(record.id)!,
        name: record.name ?? "",
        km: Number(km(record, primary).toFixed(3)),
        ...(joined ?? {}),
      };
    });
    groups.push({
      survivor,
      primary: primary.id,
      authoritative: isAuthoritative(primary),
      ...(curated ? { curated: curated.id } : {}),
      slugs,
      members,
    });
  }
  groups.sort((a, b) => byCodepoint(a.survivor, b.survivor));
  return { groups, refused };
}

/**
 * The merges `npm run merge` makes: every confident group, and each review
 * group whose surviving slug is named, which replaces the confident groups
 * within it. Throws before anything is written when a name matches no review
 * group or a station would be in two merges, since the plans can split a
 * gauge differently.
 */
export function selectMerges(
  confident: MergeGroup[],
  review: MergeGroup[],
  named: string[],
): MergeGroup[] {
  const picked = [...new Set(named)].map((slug) => {
    const group = review.find(({ survivor }) => survivor === slug);
    if (!group) throw new Error(`${slug}: no review group survives as it`);
    return group;
  });
  const within = (group: MergeGroup) =>
    picked.some(({ slugs }) =>
      group.slugs.every((slug) => slugs.includes(slug)),
    );
  const groups = [...confident.filter((group) => !within(group)), ...picked];
  const claimed = new Map<string, string>();
  for (const group of groups)
    for (const slug of group.slugs) {
      const other = claimed.get(slug);
      if (other)
        throw new Error(
          `${slug} is in the merges into ${other} and ${group.survivor}; merge one at a time`,
        );
      claimed.set(slug, group.survivor);
    }
  return groups;
}

export interface SeparatedTwin {
  curated: string;
  twin: string;
  km: number;
  kind: "tide" | "current";
}

/**
 * Every CHS record with a provider record of the same kind and name on
 * another route, within MAX_TWIN_KM or, for a MEDS record, MAX_MEDS_TWIN_KM:
 * one place published as two stations, which `npm run validate` refuses.
 */
export function separatedTwins(
  stations: ResolvedStation[],
  routes: DatabaseRoutes,
): SeparatedTwin[] {
  const found: SeparatedTwin[] = [];
  for (const kind of ["tide", "current"] as const) {
    const slugOf = new Map<string, string>();
    for (const { slug, station_ids } of routes[kind])
      for (const id of station_ids) slugOf.set(id, slug);
    const routed = stations.filter(
      (station) => (station.kind ?? "tide") === kind && slugOf.has(station.id),
    );
    for (const record of routed.filter(isCurated)) {
      const names = twinKeys(record.name ?? "");
      for (const other of routed) {
        if (isCurated(other) || slugOf.get(other.id) === slugOf.get(record.id))
          continue;
        const apart = km(record, other);
        if (
          apart <= twinKm(other) &&
          twinKeys(other.name ?? "").some((key) => names.includes(key))
        )
          found.push({
            curated: record.id,
            twin: other.id,
            km: Number(apart.toFixed(3)),
            kind,
          });
      }
    }
  }
  return found;
}

/**
 * The pairs `separate` lists that no longer publish apart: on one route, or
 * with a record no route holds.
 */
export function staleSeparations(
  routes: DatabaseRoutes,
  separate: ReadonlyMap<string, string> = SEPARATE_TWINS,
): string[] {
  const slugOf = new Map<string, string>();
  for (const { slug, station_ids } of [...routes.tide, ...routes.current])
    for (const id of station_ids) slugOf.set(id, slug);
  return [...separate.keys()].filter((pair) => {
    const [a, b] = pair.split(" ").map((id) => slugOf.get(id));
    return !a || !b || a === b;
  });
}
