import { test } from "node:test";
import assert from "node:assert/strict";
import { getJson } from "../src/noaa.js";

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
