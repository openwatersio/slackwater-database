import { test } from "node:test";
import assert from "node:assert/strict";
import { validateBundle } from "../src/validate.js";

const harmonic = (id, extra = {}) => ({
  id,
  name: id,
  type: "harmonic",
  latitude: 48,
  longitude: -123,
  floodDirection: 90,
  ebbDirection: 270,
  offset: -0.5,
  constituents: [{ name: "M2", amplitude: 2, phase: 100 }],
  ...extra,
});
const sub = (id, reference, extra = {}) => ({
  id,
  name: id,
  type: "subordinate",
  latitude: 48,
  longitude: -123,
  reference,
  ...extra,
});

test("a healthy bundle passes and reports counts", () => {
  const v = validateBundle({ stations: [harmonic("A"), sub("B", "A")] });
  assert.equal(v.ok, true);
  assert.deepEqual(v.errors, []);
  assert.deepEqual(v.counts, { harmonic: 1, subordinate: 1, total: 2 });
});

test("catches a subordinate pointing at a missing reference", () => {
  // The silent failure: that station simply yields no prediction.
  const v = validateBundle({ stations: [harmonic("A"), sub("B", "GONE@4")] });
  assert.equal(v.ok, false);
  assert.match(v.errors[0], /B→GONE@4/);
});

test("catches duplicate ids", () => {
  const v = validateBundle({ stations: [harmonic("A"), harmonic("A")] });
  assert.equal(v.ok, false);
  assert.match(v.errors.join(), /duplicate/);
});

test("catches a harmonic station with no constituents", () => {
  const v = validateBundle({ stations: [harmonic("A", { constituents: [] })] });
  assert.equal(v.ok, false);
  assert.match(v.errors.join(), /no constituents/);
});

test("catches a bundle that lost Z0 entirely", () => {
  // The regression this whole project started from — systematic slack-timing error.
  const v = validateBundle({
    stations: [harmonic("A", { offset: undefined })],
  });
  assert.equal(v.ok, false);
  assert.match(v.errors.join(), /Z0/);
});

test("a Z0 of exactly 0 is legitimate, not missing", () => {
  const v = validateBundle({ stations: [harmonic("A", { offset: 0 })] });
  assert.equal(v.ok, true);
});

test("catches a station missing a finite latitude/longitude", () => {
  const v1 = validateBundle({
    stations: [harmonic("A", { latitude: undefined })],
  });
  assert.equal(v1.ok, false);
  assert.match(v1.errors.join(), /latitude\/longitude/);

  const v2 = validateBundle({
    stations: [harmonic("A"), sub("B", "A", { longitude: undefined })],
  });
  assert.equal(v2.ok, false);
  assert.match(v2.errors.join(), /latitude\/longitude/);
});

test("rejects a malformed bundle rather than throwing", () => {
  assert.equal(validateBundle({}).ok, false);
  assert.equal(validateBundle(null).ok, false);
  assert.equal(validateBundle({}).crossFlow, null);
});

test("a partial census (no worstRatio yet) returns cleanly rather than throwing", () => {
  // Regression for a real crash: bin/noaa-current-stations.mjs's logCrossFlow guarded
  // `!cf` but then dereferenced `cf.worstRatio.ratio` and `cf.worstAbsolute.crossFlow`
  // unconditionally — a bundle whose census is present but partial (e.g. mid-refactor,
  // or a future producer that hasn't filled it in) threw TypeError instead of
  // reporting. That crash is in the CLI formatter, not here — validateBundle itself
  // never dereferenced into crossFlow beyond an optional-chained `cf?.worstRatio`, so
  // the coverage this test can honestly add is that a partial census doesn't upset
  // validateBundle's own return. (The CLI formatter fix — `if (!cf?.worstRatio)
  // return log(...)` — isn't covered here because exercising it would mean exporting
  // or restructuring the CLI, which is out of scope for this fix.)
  const v = validateBundle({
    stations: [harmonic("A")],
    crossFlow: { records: 5 },
  });
  assert.equal(v.ok, true);
  assert.deepEqual(v.crossFlow, { records: 5 });
});

const census = (extra = {}) => ({
  measured: "NOAA minorMeanSpeed …",
  records: 2,
  gte0_25kn: 1,
  gte0_50kn: 0,
  worstRatio: { id: "A", crossFlow: 0.1, alongAxisPeak: 1.0, ratio: 0.1 },
  worstAbsolute: { id: "A", crossFlow: 0.1 },
  ...extra,
});

test("accepts a bundle whose cross-flow ratio is within the bound", () => {
  const v = validateBundle({ stations: [harmonic("A")], crossFlow: census() });
  assert.equal(v.ok, true);
  assert.equal(v.crossFlow.worstRatio.ratio, 0.1);
});

test("rejects a bundle where the flood axis stops describing a station", () => {
  const v = validateBundle({
    stations: [harmonic("A")],
    crossFlow: census({
      worstRatio: { id: "BAD", crossFlow: 0.9, alongAxisPeak: 1.0, ratio: 0.9 },
    }),
  });
  assert.equal(v.ok, false);
  assert.match(v.errors.join(), /BAD/);
  assert.match(v.errors.join(), /cross-flow/i);
});

test("a bundle predating the census is valid, not broken", () => {
  // The vendored extract in slackwater-ios has no crossFlow block. A check that
  // postdates a bundle must not turn that bundle red.
  const v = validateBundle({ stations: [harmonic("A")] });
  assert.equal(v.ok, true);
  assert.equal(v.crossFlow, null);
});

test("a null census (no harmonic stations) is valid", () => {
  const v = validateBundle({ stations: [harmonic("A")], crossFlow: null });
  assert.equal(v.ok, true);
});
