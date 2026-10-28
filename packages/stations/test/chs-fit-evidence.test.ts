import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StationFile } from "../station-files.ts";
import { compareTags, evidenceProblems } from "../chs-fit-evidence.ts";

const R2 = "fit-2026-10-22-8f85912-r2";
const R3 = "fit-2026-10-22-8f85912-r3";
const FILE = "stations/current/ca/bc/active-pass.yaml";
const GATE = {
  tier: "bounded",
  days: 210,
  slack_bound_minutes: 45,
  provisional_slack_minutes: 45,
};

let dir: string;
const save = (
  name: string,
  release: string,
  gates: object = { "chs-active-pass": GATE },
) =>
  writeFileSync(
    join(dir, `${name}.json`),
    JSON.stringify({
      release,
      stamp: "2026-10-22",
      engine: "x",
      scorer: 1,
      database: "d",
      newest: { grid: 1, fit_end: "2026-10-22" },
      gates,
    }),
  );

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "chs-fit-"));
  save(R2, R2);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const station = (
  chs_fit?: object,
  extra: object = {},
  id = "chs-active-pass",
  file = FILE,
): StationFile =>
  ({
    kind: "current",
    country: "CA",
    slug: "active-pass",
    file,
    sources: [id],
    ...extra,
    ...(chs_fit && { chs_fit }),
  }) as StationFile;

describe("compareTags", () => {
  it("orders one stamp by date, then numerically by run", () => {
    expect(
      [
        "fit-2026-10-23-8f85912-r2",
        "fit-2026-10-22-8f85912-r10",
        "fit-2026-10-22-8f85912-r9",
      ].sort((a, b) => compareTags(a, b)!),
    ).toEqual([
      "fit-2026-10-22-8f85912-r9",
      "fit-2026-10-22-8f85912-r10",
      "fit-2026-10-23-8f85912-r2",
    ]);
  });
  it("has no order across stamps", () => {
    expect(
      compareTags("fit-2026-10-22-aaaaaaa-r2", "fit-2026-10-22-bbbbbbb-r1"),
    ).toBeNull();
  });
});

describe("evidenceProblems", () => {
  it("accepts a chs_fit equal to the snapshot gate plus evidence and miss_context", () => {
    const file = station({ ...GATE, miss_context: "rapids", evidence: R2 });
    expect(evidenceProblems([file], dir)).toEqual([]);
  });

  it("names the field that differs", () => {
    const problems = evidenceProblems(
      [station({ ...GATE, slack_bound_minutes: 40, evidence: R2 })],
      dir,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(FILE);
    expect(problems[0]).toContain("slack_bound_minutes");
  });

  it("names a missing snapshot", () => {
    const tag = "fit-2026-10-22-8f85912-r9";
    const problems = evidenceProblems(
      [station({ ...GATE, evidence: tag })],
      dir,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(FILE);
    expect(problems[0]).toContain(`${tag}.json`);
  });

  it("rejects a snapshot whose release differs from its file name", () => {
    save(R3, "fit-2026-10-22-8f85912-r1");
    const problems = evidenceProblems(
      [station({ ...GATE, evidence: R3 })],
      dir,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(FILE);
  });

  it("rejects a gate absent from the cited snapshot", () => {
    save(R3, R3, {});
    const problems = evidenceProblems(
      [station({ ...GATE, evidence: R3 })],
      dir,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("chs-active-pass");
  });

  it("ignores a station no snapshot lists", () => {
    expect(
      evidenceProblems([station(undefined, {}, "chs-other")], dir),
    ).toEqual([]);
  });

  it("fails a gate citing r2 when an r3 snapshot lists it", () => {
    save(R3, R3, { "chs-active-pass": { tier: "online" } });
    const problems = evidenceProblems(
      [station({ ...GATE, evidence: R2 })],
      dir,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(FILE);
    expect(problems[0]).toContain(R3);
  });

  it("passes once the gate cites r3 with r3's values", () => {
    save(R3, R3, { "chs-active-pass": { tier: "online" } });
    expect(
      evidenceProblems([station({ tier: "online", evidence: R3 })], dir),
    ).toEqual([]);
  });

  it("expects the newer run of the same stamp, r1 to r2", () => {
    const r1 = "fit-2026-10-22-8f85912-r1";
    save(r1, r1);
    const problems = evidenceProblems(
      [station({ ...GATE, evidence: r1 })],
      dir,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(R2);
  });

  it("fails when the files cite two stamps, naming each", () => {
    const other = "fit-2026-10-22-aaaaaaa-r9";
    save(other, other, { "chs-b": GATE });
    const problems = evidenceProblems(
      [
        station({ ...GATE, evidence: R2 }),
        station(
          { ...GATE, evidence: other },
          {},
          "chs-b",
          "stations/current/ca/b.yaml",
        ),
      ],
      dir,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("8f85912");
    expect(problems[0]).toContain("aaaaaaa");
    expect(problems[0]).toContain("b.yaml");
  });

  it("does not expect a snapshot of another stamp", () => {
    const other = "fit-2026-10-22-aaaaaaa-r9";
    save(other, other, { "chs-active-pass": { tier: "online" } });
    expect(evidenceProblems([station({ ...GATE, evidence: R2 })], dir)).toEqual(
      [],
    );
  });

  it("names several cited stamps for a gate whose block was deleted", () => {
    const other = "fit-2026-10-22-aaaaaaa-r9";
    save(other, other, { "chs-active-pass": GATE, "chs-b": GATE });
    const problems = evidenceProblems(
      [
        station(undefined),
        station(
          { ...GATE, evidence: R2 },
          {},
          "chs-b",
          "stations/current/ca/b.yaml",
        ),
        station(
          { ...GATE, evidence: other },
          {},
          "chs-c",
          "stations/current/ca/c.yaml",
        ),
      ],
      dir,
    );
    const mine = problems.find((p) => p.startsWith(FILE))!;
    expect(mine).toContain(R2);
    expect(mine).toContain(other);
  });

  it("orders runs numerically, not as strings", () => {
    const r10 = "fit-2026-10-22-8f85912-r10";
    save(r10, r10, { "chs-active-pass": { tier: "online" } });
    const problems = evidenceProblems(
      [station({ ...GATE, evidence: R2 })],
      dir,
    );
    expect(problems[0]).toContain(r10);
  });

  it("fails every file whose block was deleted", () => {
    save(R3, R3, { "chs-active-pass": GATE, "chs-first-narrows": GATE });
    const problems = evidenceProblems(
      [
        station(),
        station(
          undefined,
          {},
          "chs-first-narrows",
          "stations/current/ca/bc/first-narrows.yaml",
        ),
      ],
      dir,
    );
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain(FILE);
    expect(problems[1]).toContain("first-narrows.yaml");
    expect(problems[1]).toContain(R3);
  });

  it("says when the gate without a block is derived", () => {
    const problems = evidenceProblems(
      [station(undefined, { derived: { reference: "x" } })],
      dir,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(FILE);
    expect(problems[0]).toContain("derive");
  });

  it("passes a snapshot gate that has no station file", () => {
    save(R3, R3, { "chs-active-pass": GATE, "chs-nowhere": GATE });
    expect(evidenceProblems([station({ ...GATE, evidence: R3 })], dir)).toEqual(
      [],
    );
  });

  it("ignores miss_context and evidence on the snapshot side", () => {
    save(R3, R3, {
      "chs-active-pass": {
        tier: "online",
        miss_context: "rapids",
        evidence: R3,
      },
    });
    expect(
      evidenceProblems([station({ tier: "online", evidence: R3 })], dir),
    ).toEqual([]);
  });

  it("reports a misnamed snapshot nobody cites", () => {
    save(R3, "fit-2026-10-22-8f85912-r1");
    const problems = evidenceProblems(
      [station({ ...GATE, evidence: R2 })],
      dir,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`${R3}.json`);
  });
});
