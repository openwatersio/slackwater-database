import type * as flatbuffers from "flatbuffers";
import {
  ConstituentDefinition as DefinitionTable,
  ConstituentMember,
  NodeCorrections as FbsNodeCorrections,
} from "../generated/fbs/slackwater.ts";
import {
  checkCycles,
  checkDefinition,
  definitionIndex,
  stationDefinitions,
} from "../constituent-definitions.ts";
import type {
  ConstituentDefinition,
  DatabaseConstituents,
  NodeCorrections,
  StationInput,
} from "../types.js";

export const NODE_CORRECTIONS: Record<NodeCorrections, FbsNodeCorrections> = {
  iho: FbsNodeCorrections.IHO,
  schureman: FbsNodeCorrections.Schureman,
};

/** Every name the definitions mention, so the name table can index them. */
export function definitionNames(constituents: DatabaseConstituents): string[] {
  const sources = [...(constituents.sources?.values() ?? [])];
  return [
    constituents.definitions,
    ...sources.map((s) => s.constituent_definitions ?? []),
  ]
    .flat()
    .flatMap((d) => [
      d.name,
      ...(d.aliases ?? []),
      ...(d.members ?? []).map(([name]) => name),
    ]);
}

/**
 * Whether a source some station uses has its own definitions or Schureman's
 * formulas, which change its predictions. Sources no station uses don't count.
 */
export function sourcesChangePredictions(
  stations: StationInput[],
  constituents: DatabaseConstituents,
): boolean {
  const used = new Set(
    stations.flatMap((s) => (s.source ? [s.source.name] : [])),
  );
  return [...(constituents.sources ?? [])].some(
    ([name, s]) =>
      used.has(name) &&
      ((s.constituent_definitions?.length ?? 0) > 0 ||
        (s.node_corrections ?? "iho") !== "iho"),
  );
}

/**
 * Throws unless each definition is well formed, each name or alias appears
 * once in its set, no two of a source's definitions replace one shared
 * definition, and every name a station stores, and every member, resolves by
 * name or alias: in the station's source's definitions first, then the shared
 * ones. With no shared definitions and no source that changes predictions,
 * the file has no definitions, as one written before them, and names aren't
 * checked. Speeds aren't checked against coefficients.
 */
export function checkDefinitions(
  stations: StationInput[],
  constituents: DatabaseConstituents,
): void {
  const shared = byName(constituents.definitions, "shared definitions");
  const sources = new Map(
    [...(constituents.sources ?? [])].map(([name, s]) => {
      if (
        s.node_corrections &&
        !Object.hasOwn(NODE_CORRECTIONS, s.node_corrections)
      )
        throw new Error(
          `${name}: unknown node_corrections ${s.node_corrections}`,
        );
      return [name, byName(s.constituent_definitions ?? [], name)] as const;
    }),
  );
  const resolves = (name: string, own?: Map<string, unknown>) =>
    own?.has(name) || shared.has(name);
  const sets: [string, Map<string, ConstituentDefinition>, boolean][] = [
    ["shared definitions", shared, false],
    ...[...sources].map(
      ([n, d]) => [n, d, true] as [string, typeof d, boolean],
    ),
  ];
  checkCycles(new Map(), shared, "shared definitions");
  for (const [name, own] of sources) {
    checkCycles(own, shared, name);
    checkReplacements(own, shared, name);
  }
  for (const [label, set, own] of sets)
    for (const d of new Set(set.values()))
      for (const [member] of d.members ?? [])
        if (!resolves(member, own ? set : undefined))
          throw new Error(
            `${label}: ${d.name} names member ${member}, which nothing defines`,
          );
  const checkNames =
    shared.size > 0 || sourcesChangePredictions(stations, constituents);
  const ids = new Set(stations.map((s) => s.id));
  for (const s of stations) {
    // Readers take a subordinate's constituents from its reference when the
    // reference is in the file, so its own record is never read for them.
    if (s.type === "subordinate" && s.offsets && ids.has(s.offsets.reference))
      continue;
    const own = s.source ? sources.get(s.source.name) : undefined;
    const stored = [
      ...(s.harmonic_constituents ?? []),
      ...(s.current?.minor_constituents ?? []),
    ];
    for (const { name } of stored)
      if (checkNames && !resolves(name, own))
        throw new Error(`${s.id}: no definition for constituent ${name}`);
    checkCarriedDefinitions(
      s,
      stored.map((c) => c.name),
      constituents,
      own,
      shared,
    );
  }
}

/**
 * A station read from a database carries the definitions and formulas it was
 * read with; a subordinate whose reference is left out carries its
 * reference's. Refuse a rebuild that would resolve any name the station still
 * stores, or a member it leads to, to another definition, or that would change
 * its formulas. Names it gained are checked like any other station's.
 */
function checkCarriedDefinitions(
  s: StationInput,
  names: string[],
  constituents: DatabaseConstituents,
  own: Map<string, ConstituentDefinition> | undefined,
  shared: Map<string, ConstituentDefinition>,
): void {
  const carried = s as {
    constituent_definitions?: ConstituentDefinition[];
    node_corrections?: NodeCorrections;
  };
  const formulas =
    constituents.sources?.get(s.source?.name ?? "")?.node_corrections ?? "iho";
  let differs =
    carried.node_corrections !== undefined &&
    carried.node_corrections !== formulas;
  // Read once: a read station's getter decodes fresh copies on each access.
  const definitions = carried.constituent_definitions;
  if (!differs && definitions) {
    // First wins, as the readers dedupe; a hand-built set may repeat a name.
    const index = new Map<string, ConstituentDefinition>();
    for (const d of definitions)
      for (const spelling of [d.name, ...(d.aliases ?? [])])
        if (!index.has(spelling)) index.set(spelling, d);
    // Each name the station still stores, and each member it leads to, as the
    // readers resolved it: the carried definition of that spelling or of any
    // spelling of the shared definition.
    const pending = [...names];
    const seen = new Set<string>();
    for (let name; !differs && (name = pending.pop()) !== undefined;) {
      if (seen.has(name)) continue;
      seen.add(name);
      // Only the name's own definition: a gained compound's members don't count.
      const [first] = stationDefinitions([name], index, shared);
      const was = first && definitions.includes(first) ? first : undefined;
      if (!was) continue;
      differs = !sameDefinition(
        was,
        stationDefinitions([name], own ?? new Map(), shared)[0],
      );
      for (const [member] of was.members ?? []) pending.push(member);
    }
  }
  if (!differs) return;
  if (s.type === "subordinate" && s.offsets)
    throw new Error(
      `${s.id}: its reference ${s.offsets.reference} is left out, and its own source predicts its constituents differently; keep the reference in the file`,
    );
  throw new Error(
    `${s.id}: these constituents give it other definitions or nodal formulas than it was read with; rebuild with the database's constituents`,
  );
}

function sameDefinition(
  a: ConstituentDefinition,
  b: ConstituentDefinition | undefined,
): boolean {
  const list = (v: readonly unknown[] | null | undefined) =>
    JSON.stringify(v ?? []);
  // A read factor has been through a 32-bit float.
  const members = (d: ConstituentDefinition) =>
    list((d.members ?? []).map(([n, f]) => [n, Math.fround(f)]));
  return (
    !!b &&
    a.name === b.name &&
    a.speed === b.speed &&
    (a.coefficients === null) === (b.coefficients === null) &&
    list(a.coefficients) === list(b.coefficients) &&
    members(a) === members(b) &&
    list(a.aliases) === list(b.aliases)
  );
}

/**
 * Throws when two of a source's definitions replace one shared definition
 * under different spellings, or one replaces two: the engine would get two
 * lines for one catalog entry, or one line for two.
 */
function checkReplacements(
  own: Map<string, ConstituentDefinition>,
  shared: Map<string, ConstituentDefinition>,
  label: string,
): void {
  for (const common of new Set(shared.values())) {
    const replacing = new Set(
      [common.name, ...(common.aliases ?? [])].flatMap((spelling) => {
        const d = own.get(spelling);
        return d ? [d] : [];
      }),
    );
    if (replacing.size > 1)
      throw new Error(
        `${label}: ${[...replacing].map((d) => d.name).join(" and ")} both replace the shared ${common.name}`,
      );
  }
  for (const d of new Set(own.values())) {
    const replaced = new Set(
      [d.name, ...(d.aliases ?? [])].flatMap((spelling) => {
        const common = shared.get(spelling);
        return common ? [common] : [];
      }),
    );
    if (replaced.size > 1)
      throw new Error(
        `${label}: ${d.name} replaces both the shared ${[...replaced].map((c) => c.name).join(" and ")}`,
      );
  }
}

function byName(
  definitions: ConstituentDefinition[],
  label: string,
): Map<string, ConstituentDefinition> {
  for (const d of definitions) checkDefinition(d, label);
  return definitionIndex(definitions, label);
}

/** Each definition's table, in order, for a definitions vector. */
export function writeDefinitions(
  builder: flatbuffers.Builder,
  definitions: ConstituentDefinition[],
  names: ReadonlyMap<string, number>,
): number[] {
  return definitions.map(
    ({ name, speed, coefficients, members = [], aliases = [] }) => {
      const coefficientsVector = coefficients
        ? DefinitionTable.createCoefficientsVector(builder, coefficients)
        : 0;
      let membersVector = 0;
      if (members.length) {
        DefinitionTable.startMembersVector(builder, members.length);
        for (let i = members.length - 1; i >= 0; i--) {
          const [member, factor] = members[i]!;
          ConstituentMember.createConstituentMember(
            builder,
            names.get(member)!,
            factor,
          );
        }
        membersVector = builder.endVector();
      }
      const aliasesVector = aliases.length
        ? DefinitionTable.createAliasesVector(
            builder,
            aliases.map((a) => names.get(a)!),
          )
        : 0;
      return DefinitionTable.createConstituentDefinition(
        builder,
        names.get(name)!,
        speed,
        coefficientsVector,
        membersVector,
        aliasesVector,
      );
    },
  );
}
