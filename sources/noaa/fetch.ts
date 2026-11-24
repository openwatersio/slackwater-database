const ATTEMPTS = 5;
// Unpaced runs get a 403 from NOAA a few thousand requests in.
// The noaa-current import paces the same API at 300ms and completes.
const PACE_MS = 300;

type Fetch = (
  url: string,
  init?: any,
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
  headers: { get(name: string): string | null };
}>;

/**
 * Fetch JSON from NOAA's metadata API and return what `pick` finds in it,
 * retrying when it finds nothing.
 */
export async function fetchNoaa<T>(
  url: string,
  pick: (json: any) => T | undefined,
  {
    fetch = globalThis.fetch as Fetch,
    init = {},
  }: { fetch?: Fetch; init?: any } = {},
): Promise<T> {
  let res: any;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    // NOAA occasionally answers 200 with an error body, and a retry has to
    // bypass the cache or it reads that same body back. It also throttles
    // with a 403 whose body may not be JSON.
    const r = await fetch(
      url,
      attempt > 1 ? { ...init, cache: "reload" } : init,
    );
    const text = await r.text();
    // Only a request that reached NOAA counts against its limit; `hit` and
    // `stale` are answered from the local cache.
    const cacheStatus = r.headers.get("x-local-cache-status");
    if (cacheStatus !== "hit" && cacheStatus !== "stale") {
      await new Promise((resolve) => setTimeout(resolve, PACE_MS));
    }
    try {
      res = JSON.parse(text);
    } catch {
      res = { status: r.status, body: text };
    }
    const picked = r.ok ? pick(res) : undefined;
    if (picked !== undefined) return picked;
    // Back off 2s, 4s, 8s, 16s so a throttle has time to lift.
    if (attempt < ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
    }
  }
  throw new Error(
    `No data from ${url} after ${ATTEMPTS} attempts: ${JSON.stringify(res).slice(0, 200)}`,
  );
}
