// Compare BSH's 2026 tables, the TICON records the BSH validator paired with
// these gauges, and Open Waters' fits of PEGELONLINE (data/wsv) with the
// observed high and low waters of January to June 2026.
//
// Observed events come from PEGELONLINE's 1-minute levels in the water-levels
// lake (datum epoch 1, which every gauge here has alone; flags as the fits
// read them): a 31-minute running mean's highest (or lowest) point within 3 h of
// each predicted event. Reads BSH responses from the cache
// `npm run validate -w sources/bsh` fills.
// Usage: node docs/research/harmonic-inequalities/measurements/lake-obs.ts
import { readFile } from "node:fs/promises";
import { DuckDBInstance } from "@duckdb/node-api";
import { createTidePredictor } from "@slackwater/engine";
import { cachedLakeFile } from "@slackwater/harmonic-analysis/lake";
import {
  compare,
  parsePlace,
  type Extreme,
} from "../../../../sources/bsh/bsh.ts";

const root = new URL("../../../../", import.meta.url);
const json = async (path: string) =>
  JSON.parse(await readFile(new URL(path, root), "utf8"));
// BSH place, PEGELONLINE gauge, and the TICON record main's BSH baseline paired.
const gauges = [
  ["509A", "9510070", "helgolandbinnenhafen-9510070-deu-wsv"],
  ["506P", "5990020", "cuxhaven-825-deu-uhslc_fd"],
  ["103P", "4990010", "bhvalterleuchtturm-4990010-deu-wsv"],
  ["508P", "5952050", "stpaulitg-stp-deu-cmems"],
  ["702A", "5970022", "elmshornhafen-5970022-deu-wsv"],
  ["814P", "3790010", "papenburg-3790010-deu-wsv"],
  ["816P", "3770030", "herbrumhafendamm-3770030-deu-wsv"],
] as const;
const start = Date.UTC(2026, 0, 1);
const end = Date.UTC(2026, 6, 1);
const db = await (await DuckDBInstance.create()).connect();

for (const [bshnr, id, ticon] of gauges) {
  const file = await cachedLakeFile(`obs/pegelonline/${id}/2026.parquet`);
  if (!file) throw new Error(`the lake has no 2026 for pegelonline/${id}`);
  const rows = (
    await db.runAndReadAll(
      `SELECT epoch_ms(time) AS t, level_m AS l FROM read_parquet('${file}')
       WHERE flag IN (0, 2) AND level_m IS NOT NULL ORDER BY t`,
    )
  ).getRowObjectsJS() as { t: bigint; l: number }[];
  const t = rows.map((r) => Number(r.t));
  const level = rows.map((r) => r.l);
  // A 31-minute running mean, against seiche and wave noise.
  let lo = 0;
  let hi = 0;
  let sum = 0;
  const smooth = t.map((ti) => {
    while (hi < t.length && t[hi]! <= ti + 15 * 60_000) sum += level[hi++]!;
    while (t[lo]! < ti - 15 * 60_000) sum -= level[lo++]!;
    return sum / (hi - lo);
  });
  const observed = (predicted: Extreme[]): Extreme[] =>
    predicted.flatMap((p) => {
      let best = -1;
      for (let i = 0; i < t.length && t[i]! <= +p.time + 3 * 3_600_000; i++)
        if (
          t[i]! >= +p.time - 3 * 3_600_000 &&
          (best < 0 ||
            (p.high ? smooth[i]! > smooth[best]! : smooth[i]! < smooth[best]!))
        )
          best = i;
      // An extreme at the window's edge is the next tide's slope, not this one's turn.
      return best >= 0 && Math.abs(t[best]! - +p.time) <= 2.9 * 3_600_000
        ? [{ time: new Date(t[best]!), high: p.high, level: smooth[best]! }]
        : [];
    });
  const inWindow = (events: Extreme[]) =>
    events.filter((e) => +e.time >= start && +e.time < end);
  const predict = async (path: string) =>
    createTidePredictor(
      (await json(path)).harmonic_constituents,
    ).getExtremesPrediction({
      start: new Date(start - 86_400_000),
      end: new Date(end + 86_400_000),
    });
  const row = (name: string, events: Extreme[]) => {
    // Predicted minus observed, in minutes: negative is early.
    const m = compare(observed(inWindow(events)), events);
    return `${name} ${m.timeMean.toFixed(1)} ± ${m.timeSd.toFixed(1)} (HW ${m.highMean.toFixed(1)} / LW ${m.lowMean.toFixed(1)}, n=${m.matched})`;
  };
  const bsh = parsePlace(await json(`tmp/bsh/2026/${bshnr}.json`), 2026);
  console.log(
    [
      bshnr,
      row("BSH", inWindow(bsh)),
      row("TICON", await predict(`data/ticon/${ticon}.json`)),
      row("fit", await predict(`data/wsv/${id}.json`)),
    ].join(" | "),
  );
}
