// The two traps this extractor exists to encode, plus the response-shape handling.
// Everything runs against a fake NOAA — no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractBundle, harmonicKey } from "../src/extract.js";
import { fetchCurrentPredictions } from "../src/noaa.js";

const con = (
  name,
  amplitude,
  phase,
  azi = 90,
  majorMeanSpeed = -0.5,
  minorMeanSpeed = 0,
) => ({
  constituentName: name,
  majorAmplitude: amplitude,
  majorPhaseGMT: phase,
  azi,
  majorMeanSpeed,
  minorMeanSpeed,
});

// A fake NOAA built from a station list plus per-(id,bin) harcon and per-id offsets.
function fakeNoaa({ stations, harcon = {}, offsets = {} }) {
  return async (url) => {
    const ok = (body) => ({ ok: true, json: async () => body });
    if (url.includes("stations.json")) return ok({ stations });
    const h = url.match(
      /stations\/([^/]+)\/harcon\.json\?units=english&bin=(\d+)/,
    );
    if (h) return ok({ HarmonicConstituents: harcon[`${h[1]}@${h[2]}`] ?? [] });
    const o = url.match(
      /stations\/([^/]+)_(\d+)\/currentpredictionoffsets\.json/,
    );
    if (o) {
      const rec = offsets[o[1]];
      return rec ? ok(rec) : { ok: false, status: 404 };
    }
    return { ok: false, status: 404 };
  };
}

const run = (fake, opts = {}) =>
  extractBundle({ fetchFn: fake, paceMs: 0, ...opts });

test("harmonicKey: plain id at the primary bin, id@bin elsewhere", () => {
  assert.equal(harmonicKey("SFB1201", 26, 26), "SFB1201");
  assert.equal(harmonicKey("SFB1201", 10, 26), "SFB1201@10");
});

test("de-dupes the station list to the primary (first) bin", async () => {
  const fake = fakeNoaa({
    stations: [
      { id: "A", name: "A", lat: 48, lng: -123, type: "H", currbin: 26 },
      { id: "A", name: "A", lat: 48, lng: -123, type: "H", currbin: 10 },
    ],
    harcon: {
      "A@26": [con("M2", 2.359, 165.5)],
      "A@10": [con("M2", 1.935, 161.7)],
    },
  });
  const { bundle } = await run(fake);
  assert.equal(bundle.stations.length, 1);
  // The primary bin's constituents, not the second listing's.
  assert.equal(bundle.stations[0].constituents[0].amplitude, 2.359);
  // The double-count guard is also the reason census records == harmonic station count.
  assert.equal(bundle.crossFlow.records, 1);
});

test("trap 1: a subordinate referencing a NON-primary bin gets that exact bin", async () => {
  // SFB1201 publishes bin 26 (primary) and bin 10 with DIFFERENT constituents.
  // The subordinate references bin 10. Keying by id alone would hand it bin 26.
  const fake = fakeNoaa({
    stations: [
      {
        id: "SFB1201",
        name: "Ref",
        lat: 37,
        lng: -122,
        type: "H",
        currbin: 26,
      },
      { id: "PCT0236", name: "Sub", lat: 37, lng: -122, type: "S", currbin: 1 },
    ],
    harcon: {
      "SFB1201@26": [con("M2", 2.359, 165.5)],
      "SFB1201@10": [con("M2", 1.935, 161.7)],
    },
    offsets: {
      PCT0236: {
        refStationId: "SFB1201",
        refStationBin: 10,
        meanFloodDir: 60,
        meanEbbDir: 240,
        sbfTimeAdjMin: -12,
        sbeTimeAdjMin: 8,
        mfcTimeAdjMin: -5,
        mecTimeAdjMin: 3,
        mfcAmpAdj: 0.7,
        mecAmpAdj: 1.2,
      },
    },
  });
  const { bundle } = await run(fake);
  const sub = bundle.stations.find((s) => s.id === "PCT0236");
  assert.equal(sub.reference, "SFB1201@10", "must reference the exact bin");

  const ref = bundle.stations.find((s) => s.id === "SFB1201@10");
  assert.ok(ref, "the referenced non-primary bin must be in the bundle");
  assert.equal(
    ref.constituents[0].amplitude,
    1.935,
    "bin 10 constituents, not bin 26",
  );

  // Offsets: minutes in, seconds out; ratios pass through untouched.
  assert.equal(sub.slackBeforeFloodOffset, -720);
  assert.equal(sub.slackBeforeEbbOffset, 480);
  assert.equal(sub.floodSpeedRatio, 0.7);
  assert.equal(sub.ebbSpeedRatio, 1.2);
});

test("trap 2: a type-S station with its own harcon is harmonic, not a reduction", async () => {
  const fake = fakeNoaa({
    stations: [
      {
        id: "PUG1716",
        name: "Survey",
        lat: 48,
        lng: -123,
        type: "S",
        currbin: 12,
      },
    ],
    harcon: { "PUG1716@12": [con("M2", 1.5, 200)] },
    // Offsets exist too — the extractor must NOT reach for them.
    offsets: {
      PUG1716: {
        refStationId: "PUG1701",
        refStationBin: 18,
        mfcAmpAdj: 0.4,
        mecAmpAdj: 0.4,
      },
    },
  });
  const { bundle } = await run(fake);
  assert.equal(bundle.stations.length, 1);
  assert.equal(bundle.stations[0].type, "harmonic");
});

test("a true subordinate (empty own harcon) uses the offset reduction", async () => {
  const fake = fakeNoaa({
    stations: [
      { id: "REF", name: "Ref", lat: 41, lng: -71, type: "H", currbin: 5 },
      {
        id: "ACT1234",
        name: "True sub",
        lat: 41,
        lng: -71,
        type: "S",
        currbin: 2,
      },
    ],
    harcon: { "REF@5": [con("M2", 1.8, 322)] }, // ACT1234 has none at any bin
    offsets: {
      ACT1234: {
        refStationId: "REF",
        refStationBin: 5,
        mfcAmpAdj: 0.9,
        mecAmpAdj: 1.1,
      },
    },
  });
  const { bundle } = await run(fake);
  const sub = bundle.stations.find((s) => s.id === "ACT1234");
  assert.equal(sub.type, "subordinate");
  assert.equal(sub.reference, "REF"); // primary bin → plain id
});

test("captures Z0 and the flood/ebb axis from the constituent rows", async () => {
  const fake = fakeNoaa({
    stations: [
      { id: "A", name: "A", lat: 48, lng: -123, type: "H", currbin: 3 },
    ],
    harcon: { "A@3": [con("M2", 2, 100, 92.9, -0.619)] },
  });
  const { bundle } = await run(fake);
  const s = bundle.stations[0];
  assert.equal(s.offset, -0.619, "Z0 = majorMeanSpeed");
  assert.equal(s.floodDirection, 92.9);
  assert.equal(s.ebbDirection, 272.9);
});

test("drops subordinates whose reference never resolves, and reports it", async () => {
  const fake = fakeNoaa({
    stations: [
      {
        id: "ORPHAN",
        name: "Orphan",
        lat: 41,
        lng: -71,
        type: "S",
        currbin: 2,
      },
    ],
    offsets: { ORPHAN: { refStationId: "GONE", refStationBin: 4 } },
  });
  const { bundle, skipped } = await run(fake);
  assert.equal(bundle.stations.length, 0);
  assert.equal(skipped.unresolvable, 1);
});

test("bundle entries carry the station position", async () => {
  const fake = fakeNoaa({
    stations: [
      { id: "REF", name: "Ref", lat: 41, lng: -71, type: "H", currbin: 5 },
      { id: "ACT1234", name: "Sub", lat: 42, lng: -72, type: "S", currbin: 2 },
    ],
    harcon: { "REF@5": [con("M2", 1.8, 322)] },
    offsets: {
      ACT1234: {
        refStationId: "REF",
        refStationBin: 5,
        mfcAmpAdj: 0.9,
        mecAmpAdj: 1.1,
      },
    },
  });
  const { bundle } = await run(fake);
  for (const s of bundle.stations) {
    assert.equal(typeof s.latitude, "number");
    assert.equal(typeof s.longitude, "number");
  }
  const sub = bundle.stations.find((s) => s.id === "ACT1234");
  assert.equal(sub.latitude, 42);
  assert.equal(sub.longitude, -72);
});

test("a subordinate whose reference is absent from the station list is skipped, not silently unpositioned", async () => {
  // SFB1201 has harcon at bin 10 but is NOT in the stations list (a NOAA metadata gap).
  // Without a station-list record there is no lat/lng for it — building the harmonic
  // entry anyway would silently violate the schema's required latitude/longitude.
  const fake = fakeNoaa({
    stations: [
      { id: "PCT0236", name: "Sub", lat: 37, lng: -122, type: "S", currbin: 1 },
    ],
    harcon: { "SFB1201@10": [con("M2", 1.935, 161.7)] },
    offsets: {
      PCT0236: {
        refStationId: "SFB1201",
        refStationBin: 10,
        mfcAmpAdj: 0.7,
        mecAmpAdj: 1.2,
      },
    },
  });
  const { bundle, skipped } = await run(fake);
  assert.equal(
    bundle.stations.length,
    0,
    "neither the sub nor an unpositioned reference enters the bundle",
  );
  assert.equal(skipped.unresolvable, 1);
  assert.ok(
    skipped.failed.some((m) => m.includes("PCT0236") && m.includes("SFB1201")),
    "must log why, loudly",
  );
});

test("box and stations filters select without extra fetches", async () => {
  const stations = [
    { id: "IN", name: "In", lat: 48, lng: -123, type: "H", currbin: 1 },
    { id: "OUT", name: "Out", lat: 25, lng: -80, type: "H", currbin: 1 },
  ];
  const harcon = { "IN@1": [con("M2", 1, 0)], "OUT@1": [con("M2", 1, 0)] };
  const boxed = await run(fakeNoaa({ stations, harcon }), {
    box: [47, -125, 49.2, -122],
  });
  assert.deepEqual(
    boxed.bundle.stations.map((s) => s.id),
    ["IN"],
  );

  const picked = await run(fakeNoaa({ stations, harcon }), {
    stations: ["OUT"],
  });
  assert.deepEqual(
    picked.bundle.stations.map((s) => s.id),
    ["OUT"],
  );

  await assert.rejects(
    () => run(fakeNoaa({ stations, harcon }), { stations: ["NOPE"] }),
    /not in NOAA's station list: NOPE/,
  );
});

test("type-W stations are skipped, not silently dropped", async () => {
  const fake = fakeNoaa({
    stations: [
      { id: "W1", name: "Rotary", lat: 48, lng: -123, type: "W", currbin: 1 },
    ],
  });
  const { bundle, skipped } = await run(fake);
  assert.equal(bundle.stations.length, 0);
  assert.equal(skipped.typeW, 1);
});

test("parses both shapes NOAA has shipped for currents_predictions", async () => {
  const row = {
    Type: "flood",
    Time: "2026-07-19 01:44",
    Velocity_Major: 2.85,
    meanFloodDir: 3,
    meanEbbDir: 236,
  };
  for (const body of [
    { current_predictions: { cp: [row] } },
    { current_predictions: [row] },
  ]) {
    const out = await fetchCurrentPredictions(
      "PUG1717",
      35,
      new Date("2026-07-19"),
      new Date("2026-07-20"),
      {
        paceMs: 0,
        fetchFn: async () => ({ ok: true, json: async () => body }),
      },
    );
    assert.equal(out.length, 1);
    assert.equal(
      out[0].time,
      "2026-07-19T01:44:00.000Z",
      "gmt times parse as UTC",
    );
    assert.equal(out[0].kind, "flood");
    assert.equal(out[0].velocityMajor, 2.85);
    assert.equal(out[0].meanFloodDir, 3);
  }
});

test('an unrecognized event Type becomes "unknown", not a mislabeled ebb', async () => {
  const body = {
    current_predictions: {
      cp: [
        { Type: "slack", Time: "2026-06-06 04:14", Velocity_Major: 0 },
        { Type: "foo", Time: "2026-06-06 06:00", Velocity_Major: 1 },
      ],
    },
  };
  const out = await fetchCurrentPredictions("X", 1, new Date(), new Date(), {
    paceMs: 0,
    fetchFn: async () => ({ ok: true, json: async () => body }),
  });
  assert.deepEqual(
    out.map((e) => e.kind),
    ["slack", "unknown"],
  );
});

test("surfaces a NOAA error status rather than returning junk", async () => {
  await assert.rejects(
    () =>
      fetchCurrentPredictions("X", 0, new Date(), new Date(), {
        paceMs: 0,
        fetchFn: async () => ({ ok: false, status: 400 }),
      }),
    /NOAA 400/,
  );
});

test("records a cross-flow census on the bundle, without touching station records", async () => {
  const fake = fakeNoaa({
    stations: [
      { id: "A", name: "A", lat: 48, lng: -123, type: "H", currbin: 1 },
      { id: "B", name: "B", lat: 48, lng: -123, type: "H", currbin: 1 },
    ],
    harcon: {
      // A: 0.30 kn cross on a 2.5 kn axis (2.0 amplitude + 0.5 |Z0|) -> ratio 0.12
      "A@1": [con("M2", 2.0, 100, 90, -0.5, 0.3)],
      // B: 0.60 kn cross on a 1.2 kn axis -> ratio 0.5, and the worst on both counts
      "B@1": [con("M2", 1.0, 100, 90, -0.2, 0.6)],
    },
  });
  const { bundle } = await run(fake);

  assert.equal(bundle.crossFlow.records, 2);
  assert.equal(bundle.crossFlow.gte0_25kn, 2);
  assert.equal(bundle.crossFlow.gte0_50kn, 1);
  assert.equal(bundle.crossFlow.worstRatio.id, "B");
  assert.equal(bundle.crossFlow.worstRatio.ratio, 0.5);
  assert.equal(bundle.crossFlow.worstAbsolute.id, "B");

  // The whole point of #102: no minor-axis data reaches a station record.
  for (const s of bundle.stations) {
    assert.equal(
      JSON.stringify(s).includes("minor"),
      false,
      "no per-station minor field",
    );
  }
});

test("a bundle with no harmonic stations carries no census rather than an empty one", async () => {
  const fake = fakeNoaa({
    stations: [
      { id: "W1", name: "Rotary", lat: 48, lng: -123, type: "W", currbin: 1 },
    ],
  });
  const { bundle } = await run(fake);
  assert.equal(bundle.crossFlow, null);
});

test("subordinates are not sampled — they have no harcon of their own", async () => {
  const fake = fakeNoaa({
    stations: [
      { id: "REF", name: "Ref", lat: 41, lng: -71, type: "H", currbin: 5 },
      {
        id: "ACT1234",
        name: "True sub",
        lat: 41,
        lng: -71,
        type: "S",
        currbin: 2,
      },
    ],
    harcon: { "REF@5": [con("M2", 1.8, 322, 90, -0.2, 0.4)] },
    offsets: {
      ACT1234: {
        refStationId: "REF",
        refStationBin: 5,
        mfcAmpAdj: 0.9,
        mecAmpAdj: 1.1,
      },
    },
  });
  const { bundle } = await run(fake);
  assert.equal(bundle.stations.length, 2, "both stations are in the bundle");
  assert.equal(
    bundle.crossFlow.records,
    1,
    "but only the harmonic one is measured",
  );
  assert.equal(bundle.crossFlow.worstAbsolute.id, "REF");
});
