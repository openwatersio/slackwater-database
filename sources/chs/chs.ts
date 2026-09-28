/**
 * Identity for CHS tide stations: name, aliases and position, and never the
 * IWLS station code. A consumer resolves the code at runtime by position, which
 * keeps provider-minted ids out of this repository (metadata/PROVENANCE.md).
 *
 * Ids are Slackwater iOS's, which devices key fitted models by, so a record
 * keeps its id for as long as any IWLS station matches it.
 */

export interface ChsStation {
  id: string;
  name: string;
  aliases: string[];
  latitude: number;
  longitude: number;
}

/** The fields of an IWLS `/stations` row this reads. Never persisted. */
export interface IwlsStation {
  id: string;
  code: string;
  officialName: string;
  alternativeName?: string | null;
  latitude: number;
  longitude: number;
  timeSeries?: { code: string }[];
}

type Position = { latitude: number; longitude: number };

/**
 * Two gauges this close are one water. It catches the three IWLS duplicates of
 * registry ports (40-60 m away) and nothing else in the catalogue; the next
 * nearest distinct station is about 1 km from a port.
 */
export const SAME_WATER_KM = 0.2;

export function distanceKm(a: Position, b: Position): number {
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) *
      Math.cos(rad(b.latitude)) *
      Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** The app's id rule, so a station minted here reads like one minted there. */
export function chsId(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `chs-${slug || "station"}`;
}

/**
 * IWLS's one bilingual officialName. Both spellings are keyed: the feed served
 * a mis-decoded "ÃŽ" until CHS repaired it in 2026-08. The French half is a
 * real name someone might type, so it becomes an alias.
 */
const SABLE = { name: "Sable Island", aliases: ["sable, île de"] };
const NAME_FIXES: Record<string, { name: string; aliases: string[] }> = {
  "Sable Island/Sable, ÃŽle de": SABLE,
  "Sable Island/Sable, Île de": SABLE,
};

export function identity(station: IwlsStation): {
  name: string;
  aliases: string[];
} {
  const fix = NAME_FIXES[station.officialName];
  const name = (fix?.name ?? station.officialName).trim();
  // alternativeName is a comma-separated list of French, former and variant
  // names: what someone might search for.
  const alternatives = (station.alternativeName ?? "")
    .split(",")
    .map((alias) => alias.trim().toLowerCase())
    .filter((alias) => alias && alias !== name.toLowerCase());
  return {
    name,
    aliases: [...new Set([...(fix?.aliases ?? []), ...alternatives])],
  };
}

const byId = (a: ChsStation, b: ChsStation) =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/**
 * The next station list: every IWLS station that is not a registry port's
 * water, each under the id of the record it matches, or a new id.
 *
 * Matching is by position first, for every station, so a name match cannot
 * take a record another station sits on. `taken` must include every id that
 * ever held a slug, so a removed record's id is never handed to new water.
 */
export function reconcile(
  iwls: IwlsStation[],
  previous: ChsStation[],
  { ports, taken }: { ports: Position[]; taken: Iterable<string> },
): ChsStation[] {
  const candidates = iwls
    .filter(
      (station) =>
        !ports.some((port) => distanceKm(port, station) <= SAME_WATER_KM),
    )
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  const unclaimed = new Map(previous.map((station) => [station.id, station]));
  const matched = new Map<IwlsStation, string>();

  // Closest pairs first, so of two stations near one record the nearer wins.
  // ponytail: every station against every record, ~1.1 M distances on the real
  // data; fine for a hand-run import, index the records if it ever runs in CI.
  const pairs = candidates
    .flatMap((station) =>
      previous.map((record) => ({
        station,
        record,
        km: distanceKm(record, station),
      })),
    )
    .filter(({ km }) => km <= SAME_WATER_KM)
    .sort((a, b) => a.km - b.km);
  for (const { station, record } of pairs) {
    if (matched.has(station) || !unclaimed.has(record.id)) continue;
    matched.set(station, record.id);
    unclaimed.delete(record.id);
  }
  for (const station of candidates) {
    if (matched.has(station)) continue;
    const { name } = identity(station);
    const record = [...unclaimed.values()].find(
      (candidate) => candidate.name === name,
    );
    if (!record) continue;
    matched.set(station, record.id);
    unclaimed.delete(record.id);
  }

  const used = new Set([...taken, ...previous.map(({ id }) => id)]);
  return candidates
    .map((station) => {
      const { name, aliases } = identity(station);
      let id = matched.get(station);
      if (!id) {
        const base = chsId(name);
        id = base;
        for (let n = 2; used.has(id); n += 1) id = `${base}-${n}`;
        used.add(id);
      }
      return {
        id,
        name,
        aliases,
        latitude: station.latitude,
        longitude: station.longitude,
      };
    })
    .sort(byId);
}

/** The app's shipped stations whose ids the database reserves a slug for. */
export function seedStations(
  app: ChsStation[],
  reserved: Set<string>,
): ChsStation[] {
  return app
    .filter(({ id }) => reserved.has(id))
    .map(({ id, name, aliases, latitude, longitude }) => ({
      id,
      name,
      aliases,
      latitude,
      longitude,
    }))
    .sort(byId);
}
