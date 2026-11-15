import type { ConstituentDefinition } from "./types.ts";

/** A set of definitions by every name and alias, throwing when two share one. */
export function definitionIndex(
  definitions: readonly ConstituentDefinition[],
  label: string,
): Map<string, ConstituentDefinition> {
  const index = new Map<string, ConstituentDefinition>();
  for (const d of definitions)
    for (const spelling of [d.name, ...(d.aliases ?? [])]) {
      if (index.has(spelling))
        throw new Error(`${label}: ${spelling} is defined twice`);
      index.set(spelling, d);
    }
  return index;
}

/**
 * The definitions to hand the engine for a station's constituent names: each
 * name and every member it leads to, once each. A source's own definition
 * wins when it defines the name or any spelling of the shared definition's.
 * Names nothing defines are left out.
 */
export function stationDefinitions(
  names: Iterable<string>,
  own: ReadonlyMap<string, ConstituentDefinition>,
  shared: ReadonlyMap<string, ConstituentDefinition>,
): ConstituentDefinition[] {
  const pick = (name: string) => {
    const mine = own.get(name);
    if (mine) return mine;
    const common = shared.get(name);
    if (!common) return undefined;
    for (const spelling of [common.name, ...(common.aliases ?? [])]) {
      const replaced = own.get(spelling);
      if (replaced) return replaced;
    }
    return common;
  };
  const result = new Set<ConstituentDefinition>();
  const pending = [...names];
  for (let name; (name = pending.pop()) !== undefined;) {
    const definition = pick(name);
    if (!definition || result.has(definition)) continue;
    result.add(definition);
    for (const [member] of definition.members ?? []) pending.push(member);
  }
  return [...result];
}

/**
 * Throws unless `definition` is one a reader can hand the engine: a name, a
 * speed, seven integer coefficients or null for a compound with members, and
 * members whose factors survive storage as 32-bit floats.
 */
export function checkDefinition(definition: unknown, label: string): void {
  const d = definition as Partial<ConstituentDefinition> | null;
  const name = typeof d?.name === "string" && d.name ? d.name : undefined;
  if (!d || typeof d !== "object" || !name)
    throw new Error(`${label}: a definition has no name`);
  const known = ["name", "speed", "coefficients", "members", "aliases"];
  const unknown = Object.keys(d).find((key) => !known.includes(key));
  if (unknown)
    throw new Error(`${label}: ${name} has an unknown key ${unknown}`);
  const { speed, coefficients, members = [], aliases = [] } = d;
  if (typeof speed !== "number" || !Number.isFinite(speed) || speed < 0)
    throw new Error(`${label}: ${name} has a bad speed`);
  if (
    coefficients !== null &&
    !(
      Array.isArray(coefficients) &&
      coefficients.length === 7 &&
      coefficients.every((c) => Number.isInteger(c) && c >= -128 && c <= 127)
    )
  )
    throw new Error(`${label}: ${name} needs 7 integer coefficients or null`);
  if (
    !Array.isArray(members) ||
    !members.every(
      (m) =>
        Array.isArray(m) &&
        m.length === 2 &&
        typeof m[0] === "string" &&
        typeof m[1] === "number" &&
        m[0] &&
        Number.isFinite(Math.fround(m[1])),
    )
  )
    throw new Error(`${label}: ${name} has a malformed member`);
  if (coefficients === null && members.length === 0)
    throw new Error(`${label}: ${name} has neither coefficients nor members`);
  if (
    !Array.isArray(aliases) ||
    !aliases.every((a) => typeof a === "string" && a)
  )
    throw new Error(`${label}: ${name} has an empty alias`);
}

/**
 * Throws when a definition leads back to itself through its members, resolved
 * as `stationDefinitions` resolves them: the engine refuses such a set.
 */
export function checkCycles(
  own: ReadonlyMap<string, ConstituentDefinition>,
  shared: ReadonlyMap<string, ConstituentDefinition>,
  label: string,
): void {
  const resolve = (name: string) => stationDefinitions([name], own, shared)[0];
  const done = new Set<ConstituentDefinition>();
  const visit = (
    d: ConstituentDefinition,
    path: Set<ConstituentDefinition>,
  ) => {
    if (done.has(d)) return;
    if (path.has(d))
      throw new Error(`${label}: ${d.name} is cyclic through its members`);
    path.add(d);
    for (const [member] of d.members ?? []) {
      const next = resolve(member);
      if (next) visit(next, path);
    }
    path.delete(d);
    done.add(d);
  };
  for (const d of new Set([...own.values(), ...shared.values()]))
    visit(d, new Set());
}
