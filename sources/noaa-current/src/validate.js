// Structural checks on a bundle. Cheap, and they catch the failures that actually
// happen: a truncated/partial extraction, or a subordinate pointing at a reference
// that isn't there (which silently yields no prediction at that station).

// Broad sanity bounds, not borders: include US territories and Alaska across 180°.
export function plausiblePosition(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  return [
    [15, -180, 75, -50],
    [45, 170, 75, 180],
    [10, 130, 25, 155],
    [-20, -180, -10, -160],
  ].some(
    ([south, west, north, east]) =>
      latitude >= south &&
      latitude <= north &&
      longitude >= west &&
      longitude <= east,
  );
}

/** @returns {{ok: boolean, counts: object, crossFlow: object|null, errors: string[]}} */
export function validateBundle(bundle) {
  const errors = [];
  const stations = bundle?.stations;
  if (!Array.isArray(stations))
    return {
      ok: false,
      counts: {},
      crossFlow: null,
      errors: ["no stations array"],
    };

  const harmonic = stations.filter((s) => s.type === "harmonic");
  const subordinate = stations.filter((s) => s.type === "subordinate");
  const ids = new Set(harmonic.map((s) => s.id));

  const orphans = subordinate.filter((s) => !ids.has(s.reference));
  if (orphans.length) {
    errors.push(
      `${orphans.length} subordinate(s) reference a missing station: ` +
        orphans
          .slice(0, 5)
          .map((s) => `${s.id}→${s.reference}`)
          .join(", "),
    );
  }

  const dupes = stations.length - new Set(stations.map((s) => s.id)).size;
  if (dupes) errors.push(`${dupes} duplicate station id(s)`);

  const noCons = harmonic.filter((s) => !s.constituents?.length);
  if (noCons.length)
    errors.push(`${noCons.length} harmonic station(s) with no constituents`);

  // Z0 absent is a silent, systematic slack-timing error — the exact bug this project
  // was started to fix. A bundle without it anywhere is a broken extraction.
  const withZ0 = harmonic.filter((s) => typeof s.offset === "number").length;
  if (harmonic.length && withZ0 === 0)
    errors.push("no harmonic station carries a Z0 offset");

  for (const s of harmonic) {
    for (const field of ["minorMeanFlow", "azimuth"]) {
      if (s[field] !== undefined && !Number.isFinite(s[field]))
        errors.push(`${s.id}: ${field} must be finite when present`);
    }
    if (
      s.minorConstituents !== undefined &&
      (!Array.isArray(s.minorConstituents) ||
        s.minorConstituents.some(
          (c) =>
            !c ||
            typeof c.name !== "string" ||
            !c.name ||
            !Number.isFinite(c.amplitude) ||
            !Number.isFinite(c.phase),
        ))
    )
      errors.push(`${s.id}: invalid minor constituents`);
  }

  const unknownType = stations.filter(
    (s) => s.type !== "harmonic" && s.type !== "subordinate",
  );
  if (unknownType.length)
    errors.push(`${unknownType.length} station(s) of unknown type`);

  const badPosition = stations.filter(
    (s) => !Number.isFinite(s.latitude) || !Number.isFinite(s.longitude),
  );
  if (badPosition.length) {
    errors.push(
      `${badPosition.length} station(s) missing a finite latitude/longitude: ` +
        badPosition
          .slice(0, 5)
          .map((s) => s.id)
          .join(", "),
    );
  }

  for (const s of stations) {
    if (
      Number.isFinite(s.latitude) &&
      Number.isFinite(s.longitude) &&
      !plausiblePosition(s.latitude, s.longitude)
    )
      errors.push(
        `${s.id}: position ${s.latitude}, ${s.longitude} outside NOAA's US coastal regions`,
      );
  }

  const cf = bundle.crossFlow ?? null;

  return {
    ok: errors.length === 0,
    counts: {
      harmonic: harmonic.length,
      subordinate: subordinate.length,
      total: stations.length,
    },
    crossFlow: cf,
    errors,
  };
}
