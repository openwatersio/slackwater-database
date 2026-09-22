// Detect drift in NOAA's current-station list.
//
// NOAA revises the list — stations get added, retired, or reclassified. That is not an
// error, but it must never be silent: a station appearing means the bundle is stale, and
// one disappearing means something downstream may reference a station that no longer
// exists. We went 855 → 856 harmonic between two extractions and only noticed by
// diffing bundles.
//
// This is deliberately cheap — ONE request for the station list, no per-station harcon
// fetches — so it can run on a schedule. It detects list-level drift (which stations
// exist, and their type). It does NOT detect a station's constituents being revised in
// place; that needs a full re-extraction and a bundle diff.

import { fetchStationList } from "./noaa.js";

/** Reduce a live station list to the shape we pin. */
export function summarize(stations) {
  const counts = { H: 0, S: 0, W: 0 };
  for (const s of stations) counts[s.type] = (counts[s.type] ?? 0) + 1;
  return {
    counts: { ...counts, total: stations.length },
    ids: stations.map((s) => `${s.id}:${s.type}`).sort(),
  };
}

/**
 * Compare a live summary against a pinned lock.
 * @returns {{drifted: boolean, added: string[], removed: string[], retyped: string[],
 *            counts: object, expected: object}}
 */
export function diffAgainstLock(live, lock) {
  const parse = (list) => new Map(list.map((e) => e.split(":")));
  const now = parse(live.ids);
  const then = parse(lock.ids);

  const added = [...now.keys()]
    .filter((id) => !then.has(id))
    .map((id) => `${id} (${now.get(id)})`);
  const removed = [...then.keys()]
    .filter((id) => !now.has(id))
    .map((id) => `${id} (${then.get(id)})`);
  // A reclassification changes how a station is predicted — it matters as much as an
  // addition, and a plain count check can miss it entirely (H→S keeps the total equal).
  const retyped = [...now.keys()]
    .filter((id) => then.has(id) && then.get(id) !== now.get(id))
    .map((id) => `${id} (${then.get(id)} → ${now.get(id)})`);

  return {
    drifted: added.length > 0 || removed.length > 0 || retyped.length > 0,
    added,
    removed,
    retyped,
    counts: live.counts,
    expected: lock.counts,
  };
}

export async function checkDrift(lock, opts = {}) {
  const live = summarize(await fetchStationList({ paceMs: 0, ...opts }));
  return diffAgainstLock(live, lock);
}

export function buildLock(stations) {
  return {
    note:
      "Pinned NOAA current-station list. `noaa-current-stations check` fails when NOAA's " +
      "live list no longer matches this. Regenerate with `noaa-current-stations lock`, and " +
      "re-extract the bundle when it changes.",
    generated: new Date().toISOString(),
    ...summarize(stations),
  };
}
