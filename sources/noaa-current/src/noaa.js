// NOAA CO-OPS API client — the single place this org talks to tidesandcurrents.noaa.gov.
//
// Everything surprising about this API is documented in docs/noaa-api.md. The short
// version, because it costs people days:
//   - harcon.json returns an EMPTY constituent list unless you pass the station's
//     `currbin`. bin=0 looks like "NOAA has no current constituents". It does.
//   - `units=english` yields knots; `units=metric` yields cm/s. We use english.
//   - the station list repeats each station once per depth bin; de-dup keep-first.
//   - NOAA throttles bulk callers. An extraction is thousands of requests: pace them.

const MDAPI = "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi";
const DATAGETTER = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter";

// NOAA has been reported to 404 unfamiliar clients. We could not reproduce that in
// 2026-07 (see docs/noaa-api.md § User-Agent), but a real UA costs nothing and the
// `application` parameter below is NOAA's documented way to identify a caller.
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Paced JSON GET. NOAA throttles bulk callers, and an extraction is thousands of
 * requests — `paceMs` is the knob that keeps a full run from getting rate-limited.
 *
 * Retries 5xx/429 and network errors with exponential backoff. A full extraction is
 * ~2,800 requests over ~25 minutes; without this a single transient 504 fails the run
 * (2026-08-01: HUR0615 504'd once, discarding the whole monthly refresh). A 4xx is a
 * real answer about the station — retrying it just wastes the pacing budget.
 */
export async function getJson(
  url,
  { paceMs = 400, fetchFn = fetch, retries = 3, retryMs = 1000 } = {},
) {
  for (let attempt = 0; ; attempt++) {
    if (paceMs) await sleep(paceMs);
    let resp;
    try {
      resp = await fetchFn(url, { headers: { "User-Agent": UA } });
    } catch (e) {
      if (attempt >= retries) throw e;
      await sleep(retryMs * 2 ** attempt);
      continue;
    }
    if (resp.ok) return resp.json();
    if (attempt >= retries || (resp.status < 500 && resp.status !== 429)) {
      throw new Error(`NOAA ${resp.status} ${url}`);
    }
    await sleep(retryMs * 2 ** attempt);
  }
}

/** Every current-prediction station NOAA publishes, de-duped to its primary bin. */
export async function fetchStationList(opts = {}) {
  const list = await getJson(
    `${MDAPI}/stations.json?type=currentpredictions&units=english`,
    opts,
  );
  const seen = new Set();
  // The list repeats a station once per bin; the FIRST entry carries the primary bin.
  return list.stations.filter((s) =>
    seen.has(s.id) ? false : (seen.add(s.id), true),
  );
}

/**
 * Harmonic constituents at a specific depth bin. Returns [] when the station has
 * none at that bin — which is the normal, expected answer for a true subordinate,
 * and also what you get for ANY station if you pass the wrong bin.
 */
export async function fetchHarcon(stationId, bin, opts = {}) {
  const hc = await getJson(
    `${MDAPI}/stations/${stationId}/harcon.json?units=english&bin=${bin}`,
    opts,
  );
  return hc.HarmonicConstituents ?? [];
}

/** Subordinate-station time/speed offsets. Note the `<id>_<currbin>` composite path. */
export async function fetchOffsets(stationId, currbin, opts = {}) {
  return getJson(
    `${MDAPI}/stations/${stationId}_${currbin}/currentpredictionoffsets.json`,
    opts,
  );
}

/**
 * NOAA's own published slack/max-flood/max-ebb predictions — the oracle every
 * prediction engine in this org is validated against, and a live data source in
 * its own right.
 */
export async function fetchCurrentPredictions(
  stationId,
  bin,
  start,
  end,
  opts = {},
) {
  const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");
  const params = new URLSearchParams({
    product: "currents_predictions",
    interval: "max_slack",
    time_zone: "gmt",
    units: "english",
    format: "json",
    application: opts.application ?? "noaa-current-stations",
    station: stationId,
    bin: String(bin),
    begin_date: ymd(start),
    end_date: ymd(end),
  });
  const body = await getJson(`${DATAGETTER}?${params}`, { paceMs: 0, ...opts });
  // NOAA has shipped both shapes of this response.
  const rows = Array.isArray(body.current_predictions)
    ? body.current_predictions
    : (body.current_predictions?.cp ?? []);
  return rows.map((r) => {
    const raw = String(r.Type ?? r.type ?? "").toLowerCase();
    // Only these three are meaningful. Anything else becomes 'unknown' rather than
    // being folded into one of them — a mislabeled ebb is worse than an ignored row.
    const kind = raw.startsWith("slack")
      ? "slack"
      : raw.startsWith("flood")
        ? "flood"
        : raw.startsWith("ebb")
          ? "ebb"
          : "unknown";
    return {
      // "YYYY-MM-DD HH:MM" is UTC when requested with time_zone=gmt.
      time: new Date(
        String(r.Time ?? r.t).replace(" ", "T") + "Z",
      ).toISOString(),
      kind,
      velocityMajor: Number(r.Velocity_Major ?? r.velocity ?? 0),
      // Both directions are repeated on every row; they are the station's measured
      // principal axes and are more authoritative than anything hand-configured.
      meanFloodDir: Number(r.meanFloodDir),
      meanEbbDir: Number(r.meanEbbDir),
    };
  });
}

export { MDAPI, DATAGETTER, UA };
