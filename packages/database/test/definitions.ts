import type { DatabaseConstituents, StationInput } from "../src/types.ts";

/** A placeholder definition for every name the stations store, for builder tests that aren't about definitions. */
export function definedNames(stations: StationInput[]): DatabaseConstituents {
  const names = new Set(
    stations.flatMap((s) =>
      [
        ...(s.harmonic_constituents ?? []),
        ...(s.current?.minor_constituents ?? []),
      ].map((c) => c.name),
    ),
  );
  return {
    definitions: [...names].map((name) => ({
      name,
      speed: 0,
      coefficients: [0, 0, 0, 0, 0, 0, 0],
    })),
  };
}
