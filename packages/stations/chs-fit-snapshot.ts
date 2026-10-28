import { isDeepStrictEqual } from "node:util";
import { chsFitProblems } from "./station-files.ts";

/** The fields of a results release's `dispositions.json` this repo reads. */
export interface Dispositions {
  release: string;
  stamp: string;
  engine: string;
  scorer: number;
  database: string;
  newest: { grid: number; fit_end: string };
  gates: Record<string, { chs_fit: unknown }>;
}

const sortKeys = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(sortKeys)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([key, inner]) => [key, sortKeys(inner)]),
        )
      : value;

/**
 * The snapshot of a release: its release, stamp, engine, scorer, database and
 * newest fields and each gate's `chs_fit` alone, keys sorted. Throws when the
 * release is not `tag`, or a gate holds a field this repo curates (`evidence`,
 * `miss_context`) or a shape it rejects.
 */
export function buildSnapshot(
  source: Dispositions,
  tag: string,
): Record<string, unknown> {
  if (source.release !== tag)
    throw new Error(`is release ${source.release}, not ${tag}`);
  const bare = Object.entries(source.gates)
    .filter(
      ([, gate]) => !gate || typeof gate.chs_fit !== "object" || !gate.chs_fit,
    )
    .map(([id]) => id);
  if (bare.length)
    throw new Error(`has no chs_fit for gate ${bare.join(", ")}`);
  const gates = Object.fromEntries(
    Object.entries(source.gates).map(([id, gate]) => [id, gate.chs_fit]),
  );
  const rejected = Object.entries(gates).flatMap(([id, fit]) => {
    const own = fit as Record<string, unknown>;
    const curated = ["evidence", "miss_context"].filter((key) => key in own);
    return [
      ...(curated.length
        ? [`${id}: holds ${curated.join(", ")}, which this repo curates`]
        : []),
      ...chsFitProblems({ ...own, evidence: tag }).map(
        (problem) => `${id}: ${problem}`,
      ),
    ];
  });
  if (rejected.length)
    throw new Error(
      `holds chs_fit shapes this repo rejects:\n  ${rejected.join("\n  ")}`,
    );
  const { release, stamp, engine, scorer, database, newest } = source;
  return sortKeys({
    release,
    stamp,
    engine,
    scorer,
    database,
    newest,
    gates,
  }) as Record<string, unknown>;
}

/** The top-level keys, and the gates and their keys, where two snapshots differ. */
export function snapshotDifferences(
  committed: Record<string, unknown>,
  built: Record<string, unknown>,
): string[] {
  const keys = (a: object, b: object) => [
    ...new Set([...Object.keys(a), ...Object.keys(b)]),
  ];
  const as = (v: unknown) => (v ?? {}) as Record<string, unknown>;
  const out: string[] = [];
  for (const key of keys(committed, built).sort()) {
    if (key === "gates") continue;
    if (!isDeepStrictEqual(committed[key], built[key])) out.push(key);
  }
  const [mine, theirs] = [as(committed["gates"]), as(built["gates"])];
  for (const id of keys(mine, theirs).sort()) {
    if (!(id in theirs)) out.push(`gate ${id} is not in the release`);
    else if (!(id in mine)) out.push(`gate ${id} is missing from the snapshot`);
    else if (!isDeepStrictEqual(mine[id], theirs[id])) {
      const [a, b] = [as(mine[id]), as(theirs[id])];
      const differing = keys(a, b)
        .sort()
        .filter((k) => !isDeepStrictEqual(a[k], b[k]));
      out.push(`gate ${id} differs in ${differing.join(", ")}`);
    }
  }
  return out;
}

/** The tags to verify, and the committed snapshots no station file cites. */
export function snapshotsToVerify(
  committed: string[],
  files: { chs_fit?: { evidence: string } }[],
): { verify: string[]; skipped: string[] } {
  const cited = new Set(
    files.flatMap((f) => (f.chs_fit ? [f.chs_fit.evidence] : [])),
  );
  return {
    verify: committed.filter((tag) => cited.has(tag)),
    skipped: committed.filter((tag) => !cited.has(tag)),
  };
}

/**
 * What a download status means: a missing release fails the check, any other
 * non-success is the network's problem and only warns.
 */
export function classifyStatus(
  status: number,
): "ok" | "missing" | "unreachable" {
  return status >= 200 && status < 300
    ? "ok"
    : status === 404
      ? "missing"
      : "unreachable";
}
