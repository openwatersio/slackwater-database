import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createTidePredictor } from "@slackwater/engine";
import { DATA_DIR } from "@slackwater/stations";
import type { StationData } from "@slackwater/database";
import { verifySnapshot, FIXTURES_DIR, stationIds } from "./import.ts";
import { parsePredictions } from "./jma.ts";
export async function validate(dir = FIXTURES_DIR, dataDir = DATA_DIR) {
  const { harmonics, contents } = await verifySnapshot(dir);
  if (
    JSON.stringify((await stationIds(join(dataDir, "jma"))).sort()) !==
    JSON.stringify(harmonics.map((h) => h.id).sort())
  )
    throw new Error("Snapshot and imported station sets differ");
  const stations = new Map<string, StationData>();
  for (const h of harmonics) {
    const station = JSON.parse(
      await readFile(join(dataDir, "jma", `${h.id}.json`), "utf8"),
    ) as StationData;
    if (
      station.source.id !== h.id ||
      station.latitude !== h.latitude ||
      station.longitude !== h.longitude ||
      !isDeepStrictEqual(station.epoch, h.epoch) ||
      !isDeepStrictEqual(station.harmonic_constituents, h.constituents) ||
      station.datums["MSL"] !== 0 ||
      station.datums["CD"] !== -h.z0 ||
      station.chart_datum !== "CD"
    )
      throw new Error(`Imported record differs from JMA snapshot: ${h.id}`);
    stations.set(h.id, station);
  }
  const results = [];
  for (const [path, html] of contents) {
    if (!path.endsWith("-predictions.html")) continue;
    const id = path.slice(0, 2),
      h = harmonics.find((h) => h.id === id);
    if (!h || !html.includes(`毎時潮位　${h.name}<`))
      throw new Error(`Prediction station mismatch: ${path}`);
    const station = stations.get(id)!;
    const predictor = createTidePredictor(station.harmonic_constituents);
    const points = parsePredictions(html);
    const errors = points.map(
      (p) =>
        predictor.getWaterLevelAtTime({ time: p.time }).level -
        station.datums["CD"]! -
        p.level,
    );
    const rmse = Math.sqrt(
        errors.reduce((s, e) => s + e * e, 0) / errors.length,
      ),
      maximum = Math.max(...errors.map(Math.abs));
    // Project regression limits; not a statement of publisher uncertainty.
    if (!Number.isFinite(rmse) || rmse > 0.03 || maximum > 0.065)
      throw new Error(
        `${path}: prediction comparison failed: RMSE ${rmse}, max ${maximum} m`,
      );
    results.push({ path, points: points.length, rmse, maximum });
  }
  if (results.length !== 16)
    throw new Error("Expected four seasonal comparisons for four stations");
  return results;
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  validate()
    .then(console.table)
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    });
