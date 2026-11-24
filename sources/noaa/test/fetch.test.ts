import { afterEach, describe, expect, test, vi } from "vitest";
import { fetchNoaa } from "../fetch.ts";

afterEach(() => {
  vi.useRealTimers();
});

const response = (status: number, body: string) =>
  new Response(body, { status });

describe("fetchNoaa", () => {
  test("retries a throttle and an error body, bypassing the cache, until it finds what it wants", async () => {
    vi.useFakeTimers();
    const replies = [
      response(403, "<html>Forbidden</html>"),
      response(200, JSON.stringify({ errorMsg: "try again" })),
      response(200, JSON.stringify({ stations: [{ id: "1" }] })),
    ];
    const calls: unknown[] = [];
    const fetch = async (_url: string, init?: unknown) => {
      calls.push(init);
      return replies.shift()!;
    };
    const found = fetchNoaa("https://noaa.test", (json) => json.stations?.[0], {
      fetch,
      init: { headers: { "User-Agent": "slackwater-database" } },
    });
    await vi.runAllTimersAsync();
    expect(await found).toEqual({ id: "1" });
    expect(calls).toEqual([
      { headers: { "User-Agent": "slackwater-database" } },
      { headers: { "User-Agent": "slackwater-database" }, cache: "reload" },
      { headers: { "User-Agent": "slackwater-database" }, cache: "reload" },
    ]);
  });

  test("names the URL and the last answer when every attempt fails", async () => {
    vi.useFakeTimers();
    const found = fetchNoaa("https://noaa.test", (json) => json.stations?.[0], {
      fetch: async () => response(200, JSON.stringify({ errorMsg: "down" })),
    });
    const failed = expect(found).rejects.toThrow(
      'No data from https://noaa.test after 5 attempts: {"errorMsg":"down"}',
    );
    await vi.runAllTimersAsync();
    await failed;
  });
});
