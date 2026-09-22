import { test } from "node:test";
import assert from "node:assert/strict";
import { crossFlowCensus, CROSS_FLOW_RATIO_MAX } from "../src/cross-flow.js";
import { validateBundle } from "../src/validate.js";

const s = (id, crossFlow, alongAxisPeak) => ({ id, crossFlow, alongAxisPeak });

test("counts the knot thresholds and finds both worsts", () => {
  const c = crossFlowCensus([
    s("A", 0.1, 5.0), // under both thresholds
    s("B", 0.3, 4.0), // >= 0.25
    s("C", 0.6, 2.0), // >= 0.25 and >= 0.50; worst absolute
    s("D", 0.2, 0.5), // ratio 0.4 — worst ratio, but small in knots
  ]);
  assert.equal(c.records, 4);
  assert.equal(c.gte0_25kn, 2);
  assert.equal(c.gte0_50kn, 1);
  assert.equal(c.worstRatio.id, "D");
  assert.equal(c.worstRatio.ratio, 0.4);
  assert.equal(c.worstAbsolute.id, "C");
  assert.equal(c.worstAbsolute.crossFlow, 0.6);
});

test("the two worsts are independent — a big ratio is not a big current", () => {
  // D above has 4x C's ratio and a third of its cross-flow. Reporting only one
  // would hide either "the axis is wrong here" or "there is real water moving".
  const c = crossFlowCensus([s("C", 0.6, 2.0), s("D", 0.2, 0.5)]);
  assert.notEqual(c.worstRatio.id, c.worstAbsolute.id);
});

test("a zero along-axis peak yields ratio 0, not Infinity or NaN", () => {
  const c = crossFlowCensus([s("A", 0.3, 0)]);
  assert.equal(c.worstRatio.ratio, 0);
});

test("an empty sample set is null, not a census of nothing", () => {
  assert.equal(crossFlowCensus([]), null);
});

test("rounds to 3 decimals so a re-extract diff is reviewable", () => {
  const c = crossFlowCensus([s("A", 0.1234567, 1.9876543)]);
  assert.equal(c.worstRatio.crossFlow, 0.123);
  assert.equal(c.worstRatio.alongAxisPeak, 1.988);
  assert.equal(c.worstRatio.ratio, 0.062);
});

test("a near-tie is decided on raw values, not against an already-rounded stored one", () => {
  // TRUE_WORST is genuinely larger (0.2504 > 0.2502), but both round to 0.25 at 3
  // decimals. Comparing the second sample's raw value against the first's rounded
  // stored value would let LESSER win on rounding luck alone.
  const c = crossFlowCensus([
    { id: "TRUE_WORST", crossFlow: 0.2504, alongAxisPeak: 1 },
    { id: "LESSER", crossFlow: 0.2502, alongAxisPeak: 1 },
  ]);
  assert.equal(c.worstAbsolute.id, "TRUE_WORST");
  assert.equal(c.worstAbsolute.crossFlow, 0.25);
  assert.equal(c.worstRatio.id, "TRUE_WORST");
});

test("the bound rejects nothing that exists in the real data", () => {
  // Worst measured ratio across the 2,800 bin-records across NOAA's 850 harmonic
  // stations is 0.241 (BOS1130). Exercised through the real path, offline: the
  // actual census function feeding the actual validator, not just two constants.
  const census = crossFlowCensus([
    { id: "BOS1130", crossFlow: 0.178, alongAxisPeak: 0.74 },
  ]);
  assert.equal(census.worstRatio.ratio, 0.241);

  const v = validateBundle({
    stations: [
      {
        id: "BOS1130",
        name: "Boston",
        type: "harmonic",
        latitude: 42,
        longitude: -71,
        floodDirection: 0,
        ebbDirection: 180,
        offset: 0,
        constituents: [{ name: "M2", amplitude: 1, phase: 0 }],
      },
    ],
    crossFlow: census,
  });
  assert.equal(v.ok, true);

  assert.ok(
    CROSS_FLOW_RATIO_MAX > 0.241,
    "bound must not reject current NOAA data",
  );
});
