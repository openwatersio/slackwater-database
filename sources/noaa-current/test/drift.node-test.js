import { test } from "node:test";
import assert from "node:assert/strict";
import { summarize, diffAgainstLock, buildLock } from "../src/drift.js";

const st = (id, type) => ({ id, type });
const lockOf = (...s) => ({ ...summarize(s) });

test("summarize counts by type and totals", () => {
  const s = summarize([st("A", "H"), st("B", "S"), st("C", "S"), st("D", "W")]);
  assert.deepEqual(s.counts, { H: 1, S: 2, W: 1, total: 4 });
});

test("no drift when the live list matches the lock", () => {
  const lock = lockOf(st("A", "H"), st("B", "S"));
  const d = diffAgainstLock(summarize([st("B", "S"), st("A", "H")]), lock); // order-independent
  assert.equal(d.drifted, false);
  assert.deepEqual([d.added, d.removed, d.retyped], [[], [], []]);
});

test("detects an added station — the 855 -> 856 case", () => {
  const lock = lockOf(st("A", "H"));
  const d = diffAgainstLock(
    summarize([st("A", "H"), st("PUG1519", "H")]),
    lock,
  );
  assert.equal(d.drifted, true);
  assert.deepEqual(d.added, ["PUG1519 (H)"]);
  assert.equal(d.counts.total, 2);
  assert.equal(d.expected.total, 1);
});

test("detects a removed station", () => {
  const d = diffAgainstLock(
    summarize([st("A", "H")]),
    lockOf(st("A", "H"), st("B", "S")),
  );
  assert.equal(d.drifted, true);
  assert.deepEqual(d.removed, ["B (S)"]);
});

test("detects a reclassification even though the count is unchanged", () => {
  // The case a count-only check misses entirely: same total, different prediction path.
  const lock = lockOf(st("A", "H"), st("B", "S"));
  const d = diffAgainstLock(summarize([st("A", "S"), st("B", "S")]), lock);
  assert.equal(d.counts.total, d.expected.total, "totals match");
  assert.equal(d.drifted, true, "but it must still fail");
  assert.deepEqual(d.retyped, ["A (H → S)"]);
});

test("buildLock carries counts, ids, and provenance", () => {
  const lock = buildLock([st("A", "H"), st("B", "S")]);
  assert.equal(lock.counts.total, 2);
  assert.deepEqual(lock.ids, ["A:H", "B:S"]);
  assert.match(lock.note, /noaa-current-stations check/);
  assert.ok(Date.parse(lock.generated));
});
