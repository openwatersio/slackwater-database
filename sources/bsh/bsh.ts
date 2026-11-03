export const SITE = "https://gezeiten.bsh.de";

export type Extreme = { time: Date; high: boolean; level: number };

export type Gauge = {
  bshnr: string;
  name: string;
  latitude: number;
  longitude: number;
};

export type Metrics = {
  events: number;
  predicted: number;
  matched: number;
  timeMean: number;
  timeSd: number;
  highMean: number;
  lowMean: number;
  timeP95: number;
  heightSd: number;
};

export function placeUrl(bshnr: string) {
  return `${SITE}/data/DE_${bshnr.padStart(5, "_")}_tides.json`;
}

export function parseOverview(json: unknown): Gauge[] {
  const gauges = (json as { gauges?: unknown[] }).gauges;
  if (!Array.isArray(gauges)) throw new Error("BSH overview has no gauges");
  return gauges.map((g) => {
    const { bshnr, station_name, latitude, longitude } = g as Record<
      string,
      unknown
    >;
    if (
      typeof bshnr !== "string" ||
      // Gauge numbers become cache file names.
      !/^[0-9A-Z]{1,5}$/.test(bshnr) ||
      typeof station_name !== "string" ||
      typeof latitude !== "number" ||
      typeof longitude !== "number"
    )
      throw new Error(`Unexpected BSH gauge: ${JSON.stringify(g)}`);
    return { bshnr, name: station_name, latitude, longitude };
  });
}

/**
 * Predicted high and low waters for one year, or none when BSH publishes no
 * heights there. Heights are centimetres on the place's own reference (usually
 * PNP), so only their scatter is comparable with ours.
 */
export function parsePlace(json: unknown, year: number): Extreme[] {
  const years = (json as { years?: Record<string, unknown>[] }).years;
  if (!Array.isArray(years)) throw new Error("BSH place has no years");
  const entry = years.map((y) => y[String(year)]).find(Boolean) as
    { hwnw_prediction?: { data?: Record<string, unknown>[] } } | undefined;
  const data = entry?.hwnw_prediction?.data ?? [];
  const extremes = data
    .filter((e) => e["height"] != null)
    .map((e) => {
      const { timestamp, height, type } = e;
      // Timestamps carry their offset, e.g. "2026-01-01 04:50:00+01:00".
      if (
        typeof timestamp !== "string" ||
        !/[+-]\d\d:\d\d$/.test(timestamp) ||
        typeof height !== "number" ||
        (type !== "HW" && type !== "NW")
      )
        throw new Error(`Unexpected BSH event: ${JSON.stringify(e)}`);
      const time = new Date(timestamp.replace(" ", "T"));
      if (!Number.isFinite(+time))
        throw new Error(`Invalid BSH time: ${timestamp}`);
      return { time, high: type === "HW", level: height / 100 };
    });
  if (extremes.some((e, i) => i > 0 && +e.time <= +extremes[i - 1]!.time))
    throw new Error("BSH events must increase in time");
  return extremes;
}

/**
 * Pair each BSH event with our nearest event of the same type within three
 * hours. Times are ours minus BSH's, in minutes; negative means we are early.
 * `predicted` counts our events from the first to the last of either side's
 * paired events, so extra highs or lows on our side show even though every
 * BSH event still finds a partner. Pairing is not one to one, and events with
 * no partner within three hours drop out of the time statistics.
 */
export function compare(reference: Extreme[], predicted: Extreme[]): Metrics {
  const time: number[] = [],
    high: number[] = [],
    low: number[] = [],
    height: number[] = [];
  let first = Infinity,
    last = -Infinity;
  for (const event of reference) {
    let best: { minutes: number; level: number } | undefined;
    for (const other of predicted) {
      if (other.high !== event.high) continue;
      const minutes = (+other.time - +event.time) / 60_000;
      if (
        Math.abs(minutes) <= 180 &&
        (!best || Math.abs(minutes) < Math.abs(best.minutes))
      )
        best = { minutes, level: other.level - event.level };
    }
    if (!best) continue;
    const partner = +event.time + best.minutes * 60_000;
    first = Math.min(first, +event.time, partner);
    last = Math.max(last, +event.time, partner);
    time.push(best.minutes);
    (event.high ? high : low).push(best.minutes);
    height.push(best.level);
  }
  if (!time.length) throw new Error("No events matched");
  return {
    events: reference.length,
    predicted: predicted.filter((e) => +e.time >= first && +e.time <= last)
      .length,
    matched: time.length,
    timeMean: mean(time),
    timeSd: sd(time),
    highMean: mean(high),
    lowMean: mean(low),
    timeP95: percentile(time.map(Math.abs), 0.95),
    heightSd: sd(height),
  };
}

function mean(xs: number[]) {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN;
}

function sd(xs: number[]) {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

function percentile(xs: number[], q: number) {
  return [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * q) - 1]!;
}

/** How far a gauge may drift from its baseline before validation fails. */
export const TOLERANCE = {
  minutes: 2,
  heightSd: 0.02,
  fraction: 0.01,
};

/** Regressions of `current` against `baseline`; improvements are not errors. */
export function regressions(baseline: Metrics, current: Metrics) {
  const issues: string[] = [];
  const worse = (key: keyof Metrics, delta: number, by: number) => {
    if (delta > by) issues.push(`${key} ${baseline[key]} → ${current[key]}`);
  };
  // Biases count by magnitude, so a gauge may cross zero while improving.
  for (const key of ["timeMean", "highMean", "lowMean"] as const)
    worse(
      key,
      Math.abs(current[key]) - Math.abs(baseline[key]),
      TOLERANCE.minutes,
    );
  worse("timeSd", current.timeSd - baseline.timeSd, TOLERANCE.minutes);
  worse("heightSd", current.heightSd - baseline.heightSd, TOLERANCE.heightSd);
  worse("events", 1 - current.events / baseline.events, TOLERANCE.fraction);
  worse(
    "predicted",
    Math.abs(current.predicted / current.events - 1) -
      Math.abs(baseline.predicted / baseline.events - 1),
    TOLERANCE.fraction,
  );
  worse(
    "matched",
    baseline.matched / baseline.events - current.matched / current.events,
    TOLERANCE.fraction,
  );
  return issues;
}
