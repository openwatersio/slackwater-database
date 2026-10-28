import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getJson,
  fetchStationList,
  fetchStationPosition,
} from "../src/noaa.js";

// retryMs: 0 everywhere — the backoff schedule isn't what's under test, the
// retry/no-retry decision is.
const opts = (fetchFn) => ({ paceMs: 0, retryMs: 0, fetchFn });

/** A fetchFn that fails `n` times with `status`, then succeeds. Counts calls. */
function flaky(n, status) {
  const calls = { count: 0 };
  const fn = async () => {
    calls.count++;
    if (calls.count <= n) return { ok: false, status };
    return { ok: true, json: async () => ({ ok: 1 }) };
  };
  return [fn, calls];
}

test("retries a 504 and returns the eventual success", async () => {
  const [fn, calls] = flaky(1, 504);
  assert.deepEqual(await getJson("u", opts(fn)), { ok: 1 });
  assert.equal(calls.count, 2);
});

test("retries a 429 too", async () => {
  const [fn, calls] = flaky(2, 429);
  assert.deepEqual(await getJson("u", opts(fn)), { ok: 1 });
  assert.equal(calls.count, 3);
});

test("does NOT retry a 4xx — that is a real answer about the station", async () => {
  const [fn, calls] = flaky(1, 404);
  await assert.rejects(() => getJson("u", opts(fn)), /NOAA 404/);
  assert.equal(calls.count, 1);
});

test("gives up after the retry budget and reports the status", async () => {
  const [fn, calls] = flaky(99, 503);
  await assert.rejects(
    () => getJson("u", { ...opts(fn), retries: 2 }),
    /NOAA 503/,
  );
  assert.equal(calls.count, 3); // initial + 2 retries
});

test("retries a network error, then rethrows it if it persists", async () => {
  let count = 0;
  const fn = async () => {
    count++;
    throw new Error("ECONNRESET");
  };
  await assert.rejects(
    () => getJson("u", { ...opts(fn), retries: 1 }),
    /ECONNRESET/,
  );
  assert.equal(count, 2);
});

test("list-only drift checks do not fetch or validate positions", async () => {
  let calls = 0;
  const station = { id: "SAV2304", lat: 32.04, lng: 80.85, currbin: 1 };
  const stations = await fetchStationList(
    opts(async () => {
      calls++;
      return {
        ok: true,
        json: async () => ({ stations: [station, { ...station, currbin: 2 }] }),
      };
    }),
  );
  assert.equal(calls, 1);
  assert.deepEqual(stations, [station]);
});

test("reads published coordinates from individual station metadata", async () => {
  const position = await fetchStationPosition(
    "SAV2304",
    opts(async (url) => {
      assert.match(url, /stations\/SAV2304.json$/);
      return {
        ok: true,
        json: async () => ({
          stations: [
            { id: "SAV2304", lat: 32.040889739990234, lng: -80.8485107421875 },
          ],
        }),
      };
    }),
  );
  assert.deepEqual(position, {
    lat: 32.040889739990234,
    lng: -80.8485107421875,
  });
});

test("a failed metadata lookup stops extraction instead of inventing a position", async () => {
  await assert.rejects(
    () =>
      fetchStationPosition(
        "SAV2304",
        opts(async () => ({ ok: false, status: 404 })),
      ),
    /NOAA 404/,
  );
});

for (const metadata of [
  [],
  [{ id: "SAV2304", lat: 32.04, lng: 80.85 }],
  [{ id: "OTHER", lat: 32.04, lng: -80.85 }],
]) {
  test(`refuses an invalid metadata fallback: ${JSON.stringify(metadata)}`, async () => {
    await assert.rejects(
      () =>
        fetchStationPosition(
          "SAV2304",
          opts(async (url) => ({
            ok: true,
            json: async () => ({
              stations: url.includes("stations.json")
                ? [{ id: "SAV2304", lat: 32.04, lng: 80.85 }]
                : metadata,
            }),
          })),
        ),
      /SAV2304.*outside NOAA/,
    );
  });
}
