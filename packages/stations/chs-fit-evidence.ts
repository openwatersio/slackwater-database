import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { CHS_FIT_EVIDENCE, ROOT, type StationFile } from "./station-files.ts";

/** The snapshot of one results release: its `dispositions.json`, trimmed. */
export interface ChsFitSnapshot {
  release: string;
  stamp: string;
  engine: string;
  scorer: number;
  database: string;
  newest: { grid: number; fit_end: string };
  /** Each gate's `chs_fit`, keyed by the owned station file's first source. */
  gates: Record<string, Record<string, unknown>>;
}

const TAG = /^fit-(\d{4}-\d{2}-\d{2})-([0-9a-f]{7})-r(\d+)$/;

/**
 * The recipe stamp of a results release tag. Two stamps are separate
 * histories: a new stamp is a new target the apps may not ship yet.
 */
export function tagStamp(tag: string): string {
  return TAG.exec(tag)![2]!;
}

/**
 * Orders two tags of one stamp, oldest first: by fit end, then run number.
 * Returns null for tags of different stamps, which have no order.
 */
export function compareTags(a: string, b: string): number | null {
  const [x, y] = [TAG.exec(a)!, TAG.exec(b)!];
  if (x[2] !== y[2]) return null;
  return x[1]! < y[1]! ? -1 : x[1]! > y[1]! ? 1 : Number(x[3]) - Number(y[3]);
}

/**
 * What disagrees between each owned file's `chs_fit` and the results releases.
 * A gate must cite the newest snapshot that lists it, and match it. Each
 * problem starts with the file's repo-relative path.
 */
export function evidenceProblems(
  files: StationFile[],
  snapshotDir: string,
): string[] {
  const read = (tag: string) =>
    JSON.parse(
      readFileSync(join(snapshotDir, `${tag}.json`), "utf8"),
    ) as ChsFitSnapshot;
  const tags = existsSync(snapshotDir)
    ? readdirSync(snapshotDir)
        .filter((name) => name.endsWith(".json"))
        .map((name) => name.slice(0, -".json".length))
        .filter((tag) => CHS_FIT_EVIDENCE.test(tag))
        .sort((a, b) => compareTags(a, b) ?? (a < b ? -1 : 1))
    : [];
  // The newest snapshot of each stamp listing each gate.
  const newest = new Map<string, Map<string, string>>();
  for (const tag of tags) {
    const snapshot = read(tag);
    if (snapshot.release !== tag) continue;
    for (const id of Object.keys(snapshot.gates ?? {})) {
      if (!newest.has(id)) newest.set(id, new Map());
      newest.get(id)!.set(tagStamp(tag), tag);
    }
  }

  const cited = new Set(
    files.flatMap((f) => (f.chs_fit ? [f.chs_fit.evidence] : [])),
  );
  // With no block left anywhere, every stamp counts, so deleting them all fails.
  const citedStamps = new Set([...cited].map(tagStamp));
  const misnamed = tags.flatMap((tag) => {
    const { release } = read(tag);
    return release !== tag && !cited.has(tag)
      ? [
          `${relative(ROOT, join(snapshotDir, `${tag}.json`))}: is release ${release}, not ${tag}`,
        ]
      : [];
  });

  // A new recipe stamp is a new target, and every gate is curated afresh on it,
  // so one PR moves them all: the files cite one stamp at a time.
  const byCitedStamp = new Map<string, string[]>();
  for (const f of files)
    if (f.chs_fit) {
      const stamp = tagStamp(f.chs_fit.evidence);
      byCitedStamp.set(stamp, [...(byCitedStamp.get(stamp) ?? []), f.file]);
    }
  const mixed =
    byCitedStamp.size > 1
      ? [
          `chs_fit blocks cite ${byCitedStamp.size} recipe stamps; a stamp change moves every gate in one PR: ${[
            ...byCitedStamp,
          ]
            .map(
              ([stamp, paths]) =>
                `${stamp} (${paths.length === 1 ? paths[0] : `${paths.length} files, such as ${paths.slice(0, 3).join(", ")}`})`,
            )
            .join("; ")}`,
        ]
      : [];

  return [
    ...mixed,
    ...misnamed,
    ...files.flatMap((file) => {
      const id = file.sources[0]!;
      const fit = file.chs_fit;
      const byStamp = newest.get(id) ?? new Map<string, string>();
      if (!fit) {
        const measured = [...byStamp]
          .filter(([stamp]) => !citedStamps.size || citedStamps.has(stamp))
          .map(([, tag]) => tag);
        if (!measured.length) return [];
        return [
          `${file.file}: has no chs_fit, but ${measured.join(" and ")} measured gate ${id}${
            file.derived
              ? ", which the file derives; check the snapshot or the file's derived block"
              : ""
          }`,
        ];
      }
      const expected = byStamp.get(tagStamp(fit.evidence));
      const path = join(snapshotDir, `${fit.evidence}.json`);
      const where = `${file.file}: chs_fit`;
      if (!existsSync(path))
        return [`${where} cites ${fit.evidence}, but ${path} does not exist`];
      const snapshot = read(fit.evidence);
      if (snapshot.release !== fit.evidence)
        return [
          `${where} cites ${fit.evidence}, but ${path} is release ${snapshot.release}`,
        ];
      const gate = snapshot.gates?.[id];
      if (!gate)
        return [`${where} cites ${fit.evidence}, which lacks gate ${id}`];
      if (expected !== fit.evidence)
        return [
          `${where} cites ${fit.evidence}, but the newest snapshot listing gate ${id} is ${expected}; cite ${expected}`,
        ];
      const { evidence: _evidence, miss_context: _context, ...ours } = fit;
      const { evidence: _e, miss_context: _c, ...theirs } = gate;
      const differing = [
        ...new Set([...Object.keys(ours), ...Object.keys(theirs)]),
      ]
        .sort()
        .filter(
          (key) =>
            !isDeepStrictEqual(
              (ours as Record<string, unknown>)[key],
              theirs[key],
            ),
        );
      return differing.length
        ? [
            `${where} differs from ${fit.evidence} for gate ${id} in ${differing.join(", ")}`,
          ]
        : [];
    }),
  ];
}
