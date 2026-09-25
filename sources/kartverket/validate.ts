import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { useStation, type Station } from "@slackwater/engine";
import {
  FIXTURES_DIR,
  refreshSnapshot,
  sourceUrl,
  verifySnapshot,
} from "./import.ts";
import { parseXml } from "./kartverket.ts";

type Point = { time: Date; level: number };
type Extreme = Point & { high: boolean };
type Window = { start: string; end: string };

export const WINDOWS: Window[] = [
  { start: "2020-01-01T00:00:00Z", end: "2020-01-04T00:00:00Z" },
  { start: "2020-07-01T00:00:00Z", end: "2020-07-04T00:00:00Z" },
  { start: "2030-01-01T00:00:00Z", end: "2030-01-04T00:00:00Z" },
  { start: "2030-07-01T00:00:00Z", end: "2030-07-04T00:00:00Z" },
  { start: "2040-01-01T00:00:00Z", end: "2040-01-04T00:00:00Z" },
  { start: "2040-07-01T00:00:00Z", end: "2040-07-04T00:00:00Z" },
  { start: "2040-12-29T00:00:00Z", end: "2041-01-01T00:00:00Z" },
];

export function validationRequests(codes: string[]) {
  return codes.flatMap((code) =>
    WINDOWS.flatMap((window) =>
      (["pre", "tab"] as const).map((datatype) => ({
        code,
        window,
        datatype,
        path: `validation/stations/${code}-${window.start.slice(0, 10)}-${datatype}.xml`,
        url: sourceUrl({
          tide_request: "stationdata",
          stationcode: code,
          fromtime: window.start.slice(0, 16),
          totime: window.end.slice(0, 16),
          datatype,
          refcode: "msl",
          interval: "60",
          tzone: "0",
          dst: "0",
          lang: "en",
        }),
      })),
    ),
  );
}

export function parsePredictions(
  xml: string,
  code: string,
  datatype: "pre" | "tab",
  window: Window,
): Extreme[] {
  const tide = parseXml(xml);
  const location = (
    tide["stationdata"] as { location?: Record<string, unknown> } | undefined
  )?.location;
  if (location?.["@code"] !== code)
    throw new Error(`Unexpected prediction station: ${code}`);
  const data = location["data"] as Record<string, unknown> | undefined;
  if (
    data?.["@unit"] !== "cm" ||
    data["@reflevelcode"] !== "MSL" ||
    data["@type"] !== "prediction"
  ) {
    throw new Error(
      `Unexpected prediction unit, datum, or type: ${code}: ${JSON.stringify(data && Object.fromEntries(Object.entries(data).filter(([key]) => key.startsWith("@"))))}`,
    );
  }
  const nodes = data["waterlevel"];
  const points = (Array.isArray(nodes) ? nodes : nodes ? [nodes] : []).map(
    (node: Record<string, string>) => {
      const timestamp = node["@time"] ?? "";
      if (!/(Z|\+00:00)$/.test(timestamp))
        throw new Error("Prediction timestamp must be UTC");
      const time = new Date(timestamp);
      const raw = node["@value"];
      if (!raw?.trim()) throw new Error("Missing prediction height");
      const level = Number(raw) / 100;
      finite([+time, level]);
      if (+time < +new Date(window.start) || +time > +new Date(window.end))
        throw new Error("Prediction outside requested window");
      const flag = node["@flag"];
      if (
        datatype === "pre" ? flag !== "pre" : flag !== "high" && flag !== "low"
      )
        throw new Error(`Unexpected prediction flag: ${flag}`);
      return { time, level, high: flag === "high" };
    },
  );
  if (!points.length) throw new Error("Empty prediction response");
  if (
    points.some(
      (point, index) => index > 0 && +point.time <= +points[index - 1]!.time,
    )
  )
    throw new Error("Prediction timestamps must increase");
  if (datatype === "pre") {
    const start = +new Date(window.start);
    const expected = (+new Date(window.end) - start) / 3_600_000 + 1;
    if (
      points.length !== expected ||
      points.some((point, index) => +point.time !== start + index * 3_600_000)
    )
      throw new Error("Incomplete hourly prediction timeline");
  }
  return points;
}

function finite(values: number[]) {
  if (!values.length) throw new Error("Empty comparison");
  if (!values.every(Number.isFinite))
    throw new Error("Comparison must be finite");
}

export function rmse(errors: number[]) {
  finite(errors);
  return Math.sqrt(
    errors.reduce((sum, error) => sum + error ** 2, 0) / errors.length,
  );
}

export function percentile(values: number[], quantile: number) {
  finite(values);
  if (!(quantile > 0 && quantile <= 1)) throw new Error("Invalid quantile");
  return [...values].sort((a, b) => a - b)[
    Math.ceil(values.length * quantile) - 1
  ]!;
}

export function maximumAbsoluteError(errors: number[]) {
  finite(errors);
  return Math.max(...errors.map(Math.abs));
}

export function seriesMetrics(series: { error: number }[]) {
  const errors = series.map(({ error }) => error);
  return {
    rmse: rmse(errors),
    p95: percentile(errors.map(Math.abs), 0.95),
    maximum: maximumAbsoluteError(errors),
  };
}

export function assertSeries(series: { error: number }[]) {
  const metrics = seriesMetrics(series);
  if (metrics.maximum > 0.05)
    throw new Error(`maximum ${metrics.maximum} exceeds 0.05 m`);
  if (metrics.p95 > 0.03) throw new Error(`p95 ${metrics.p95} exceeds 0.03 m`);
  if (metrics.rmse > 0.02)
    throw new Error(`RMSE ${metrics.rmse} exceeds 0.02 m`);
  return metrics;
}

export function compareSeries(provider: Point[], predicted: Point[]) {
  if (provider.length !== predicted.length)
    throw new Error("Timeline count mismatch");
  return provider.map((point, index) => {
    const other = predicted[index]!;
    if (+point.time !== +other.time)
      throw new Error("Timeline timestamp mismatch");
    finite([point.level, other.level]);
    return { time: point.time, error: other.level - point.level };
  });
}

export function matchExtremes(
  provider: Extreme[],
  predicted: Extreme[],
  window?: Window,
) {
  if (!provider.length) throw new Error("Empty extremes comparison");
  if (window) {
    // Include boundary matches within the approved time tolerance, retaining every interior event.
    predicted = predicted.filter(
      (event) =>
        (+event.time >= +new Date(window.start) &&
          +event.time <= +new Date(window.end)) ||
        provider.some(
          (point) =>
            point.high === event.high &&
            Math.abs(+point.time - +event.time) <= 5 * 60_000,
        ),
    );
  }
  if (provider.length !== predicted.length)
    throw new Error(
      `Extreme count mismatch: provider ${provider.length}, Slackwater ${predicted.length}`,
    );
  const ordered = [...predicted].sort((a, b) => +a.time - +b.time);
  return [...provider]
    .sort((a, b) => +a.time - +b.time)
    .map((point, index) => {
      const other = ordered[index]!;
      if (point.high !== other.high)
        throw new Error("Extreme high/low mismatch");
      finite([+point.time, +other.time, point.level, other.level]);
      return {
        time: point.time,
        timeErrorMinutes: Math.abs(+other.time - +point.time) / 60_000,
        heightError: other.level - point.level,
      };
    });
}

export function assertExtreme({
  timeErrorMinutes,
  heightError,
}: {
  timeErrorMinutes: number;
  heightError: number;
}) {
  finite([timeErrorMinutes, heightError]);
  if (Math.abs(timeErrorMinutes) > 5)
    throw new Error(`Extreme time ${timeErrorMinutes} exceeds 5 minutes`);
  if (Math.abs(heightError) > 0.05)
    throw new Error(`Extreme height ${heightError} exceeds 0.05 m`);
}

export async function validate(fixtures = FIXTURES_DIR) {
  const { stations, contents } = await verifySnapshot(fixtures);
  const failures: string[] = [];
  const results = [];
  for (const { code } of stations) {
    const station: Station = JSON.parse(
      await readFile(
        new URL(`../../data/kartverket/${code}.json`, import.meta.url),
        "utf8",
      ),
    );
    const predictor = useStation({ ...station, id: `kartverket/${code}` });
    const errors: { error: number }[] = [];
    const extremes: { timeErrorMinutes: number; heightError: number }[] = [];
    const check = (label: string, fn: () => unknown) => {
      try {
        fn();
      } catch (error) {
        failures.push(`${code} ${label}: ${(error as Error).message}`);
      }
    };
    for (const request of validationRequests([code])) {
      const xml = contents.get(request.path);
      if (!xml)
        throw new Error(
          `Missing validation fixture: ${request.path}; run refresh-validation`,
        );
      const provider = parsePredictions(
        xml,
        code,
        request.datatype,
        request.window,
      );
      const options = {
        start: new Date(request.window.start),
        end: new Date(request.window.end),
        datum: "MSL",
      };
      const label = request.window.start.slice(0, 10);
      if (request.datatype === "pre") {
        const points = compareSeries(
          provider,
          provider.map(({ time }) =>
            predictor.getWaterLevelAtTime({ time, datum: "MSL" }),
          ),
        );
        const timeline = compareSeries(
          provider,
          predictor.getTimelinePrediction({ ...options, timeFidelity: 3600 })
            .timeline,
        );
        errors.push(...points, ...timeline);
        check(`${label} heights`, () => assertSeries(points));
        check(`${label} timeline`, () => assertSeries(timeline));
      } else {
        check(`${label} extremes`, () => {
          const matched = matchExtremes(
            provider,
            predictor.getExtremesPrediction({
              ...options,
              start: new Date(+options.start - 600_000),
              end: new Date(+options.end + 600_000),
            }).extremes,
            request.window,
          );
          extremes.push(...matched);
          assertExtreme({
            timeErrorMinutes: Math.max(
              ...matched.map((e) => e.timeErrorMinutes),
            ),
            heightError: maximumAbsoluteError(
              matched.map((e) => e.heightError),
            ),
          });
        });
      }
    }
    const metrics = seriesMetrics(errors);
    const result = {
      code,
      ...metrics,
      extremeMinutes: Math.max(...extremes.map((e) => e.timeErrorMinutes)),
      extremeHeight: Math.max(...extremes.map((e) => Math.abs(e.heightError))),
    };
    results.push(result);
    console.log(
      `${code}: RMSE ${metrics.rmse.toFixed(6)} m; p95 ${metrics.p95.toFixed(6)} m; max ${metrics.maximum.toFixed(6)} m; extremes ${result.extremeMinutes.toFixed(3)} min / ${result.extremeHeight.toFixed(6)} m`,
    );
  }
  if (failures.length)
    throw new Error(
      `Kartverket comparison failed (${failures.length}):\n${failures.join("\n")}`,
    );
  console.log(
    `Validated ${stations.length} stations across ${WINDOWS.length} windows.`,
  );
  return results;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const action = process.argv.includes("--refresh")
    ? refreshSnapshot(FIXTURES_DIR, globalThis.fetch, true).then(() =>
        console.log("Refreshed Kartverket validation fixtures."),
      )
    : validate();
  action.catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
