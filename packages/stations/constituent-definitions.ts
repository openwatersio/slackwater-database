import {
  constituents as catalog,
  defineConstituents,
} from "@slackwater/engine";
import type {
  Coefficients,
  ConstituentDefinition,
  DatabaseConstituents,
  SourceConstituents,
  StationInput,
} from "@slackwater/database";
// From source: the database's own build runs this before its dist exists.
import {
  definitionIndex,
  stationDefinitions,
} from "../database/src/constituent-definitions.ts";
import { sourceMetadata, type SourceMetadata } from "./sources.ts";

/**
 * The definitions `buildDatabase` stores: each source's own definitions and
 * nodal formulas, and the engine's catalog line for every name a station
 * stores that its source doesn't define, and every member these name. A
 * catalog line is stored once, under the catalog's name, with every alias the
 * catalog gives it, so a source's own definition of any spelling replaces it
 * whichever other stations the file holds. Throws on a name nothing defines, and
 * on a station whose definitions the engine would refuse.
 */
export function databaseConstituents(
  stations: StationInput[],
  metadata: (name: string) => SourceMetadata = sourceMetadata,
): DatabaseConstituents {
  const sources = new Map<string, SourceConstituents>();
  const own = new Map<string, Map<string, ConstituentDefinition>>();
  for (const { source } of stations) {
    if (!source || sources.has(source.name)) continue;
    const { node_corrections, constituent_definitions = [] } = metadata(
      source.name,
    );
    sources.set(source.name, {
      ...(node_corrections ? { node_corrections } : {}),
      ...(constituent_definitions.length ? { constituent_definitions } : {}),
    });
    own.set(source.name, definitionIndex(constituent_definitions, source.name));
  }

  // By catalog name; each entry collects the spellings the file uses.
  const shared = new Map<string, ConstituentDefinition>();
  const needShared = (name: string, from: string) => {
    const line = Object.hasOwn(catalog, name) ? catalog[name] : undefined;
    if (!line)
      throw new Error(
        `${from}: no definition for constituent ${name}; neither its source nor @slackwater/engine's catalog defines it`,
      );
    let definition = shared.get(line.name);
    if (!definition) {
      const members = line.members.map((m): [string, number] => [
        m.constituent.name,
        m.factor,
      ]);
      definition = {
        name: line.name,
        speed: line.speed,
        coefficients: line.coefficients
          ? ([...line.coefficients] as Coefficients)
          : null,
        ...(members.length ? { members } : {}),
        ...(line.aliases.length ? { aliases: [...line.aliases] } : {}),
      };
      shared.set(line.name, definition);
      for (const [member] of members) needShared(member, line.name);
    }
  };

  const stored = (station: StationInput) =>
    [
      ...(station.harmonic_constituents ?? []),
      ...(station.current?.minor_constituents ?? []),
    ].map((c) => c.name);
  for (const station of stations) {
    const mine = station.source ? own.get(station.source.name)! : new Map();
    for (const name of stored(station))
      if (!mine.has(name)) needShared(name, station.id);
    for (const d of new Set(mine.values()))
      for (const [member] of d.members ?? [])
        if (!mine.has(member)) needShared(member, d.name);
  }

  // What each station's reader hands the engine, merged onto its catalog as
  // the predictor does. One check per distinct set.
  const sharedIndex = definitionIndex(
    [...shared.values()],
    "shared definitions",
  );
  const checked = new Set<string>();
  for (const station of stations) {
    const names = [...new Set(stored(station))].sort();
    const key = `${station.source?.name}\0${names.join("\0")}`;
    if (checked.has(key)) continue;
    checked.add(key);
    const mine = station.source ? own.get(station.source.name)! : new Map();
    try {
      defineConstituents(stationDefinitions(names, mine, sharedIndex), catalog);
    } catch (error) {
      throw new Error(
        `${station.id}: the engine refuses its constituent definitions`,
        {
          cause: error,
        },
      );
    }
  }
  return { definitions: [...shared.values()], sources };
}
