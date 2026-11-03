import { test } from "node:test";
import assert from "node:assert/strict";
import { captureGolden } from "../src/golden.js";

const capture = (azi) =>
  captureGolden("A", 2, new Date("2026-01-01"), new Date("2026-01-02"), {
    paceMs: 0,
    fetchFn: async (url) => ({
      ok: true,
      json: async () =>
        String(url).includes("harcon.json")
          ? {
              HarmonicConstituents: [
                {
                  constituentName: "M2",
                  majorAmplitude: 1,
                  majorPhaseGMT: 30,
                  majorMeanSpeed: 0,
                  azi,
                },
              ],
            }
          : { current_predictions: [] },
    }),
  });

test("golden fixtures preserve a measured northward axis", async () => {
  const fixture = await capture(0);
  assert.equal(fixture.floodDirection, 0);
  assert.equal(fixture.ebbDirection, 180);
});

test("golden fixtures leave missing directions absent", async () => {
  for (const azi of [undefined, null]) {
    const fixture = await capture(azi);
    assert.equal(Object.hasOwn(fixture, "floodDirection"), false);
    assert.equal(Object.hasOwn(fixture, "ebbDirection"), false);
  }
});

test("golden fixtures refuse a malformed axis", async () => {
  await assert.rejects(() => capture(Infinity), /A.*azimuth.*finite/);
});
