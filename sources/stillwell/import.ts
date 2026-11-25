import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { constituents as catalog } from "@slackwater/engine";
import { computeDatums } from "@slackwater/datums";
import {
  constituentsDigest,
  DATA_DIR,
  normalize,
  save,
} from "@slackwater/stations";
import {
  FINAL_FLAGS,
  matchKey,
  MEASURED_FLAGS,
  readStillwellSamples,
  sourceFinalYear,
  stillwellErrata,
  stillwellMatches,
  stillwellStations,
  type StillwellMatch,
  type StillwellStation,
} from "@slackwater/harmonic-analysis/stillwell";
import { verifyFit } from "@slackwater/harmonic-analysis/verify-fit";
import { reduceTiconDatums } from "../ticon/datums.ts";
import { candidateList, PROFILES, type Profile } from "./profiles.ts";
import { buildRecord, type StillwellProvenance } from "./record.ts";

const HOUR_MS = 3_600_000;
/** The longest window a fit takes: one nodal cycle, as the plan's Fit says. */
const MAX_FIT_YEARS = 19;
/** The shortest record a fit takes: under about 183 days the record can't
 *  separate P1 from K1 or K2 from S2, and they'd need inference from a
 *  neighbor, which the engine doesn't offer yet (plan, Constituent selection). */
const MIN_FIT_DAYS = 183;
/** Stillwell's own bound for two series of one gauge: hourly levels within
 *  1 cm RMS in the median month, with no lag
 *  (https://github.com/openwatersio/stillwell/blob/main/docs/stations.md#gauges-in-more-than-one-source). */
export const SAME_GAUGE_RMS = 0.01;

const year = (y: number) => ({
  start: new Date(Date.UTC(y, 0, 1)),
  end: new Date(Date.UTC(y + 1, 0, 1)),
});

/**
 * The TICON records Stillwell links a series to, each with Stillwell's level
 * comparison of the series against the record's GESLA copy, or null where
 * there is none. A link counts as the same gauge only with a comparison that
 * agrees within SAME_GAUGE_RMS at no lag: then the TICON record is analyzed
 * from the same levels, and its constants and ours describe one gauge.
 */
export function ticonLinks(
  station: Pick<StillwellStation, "id" | "same_as">,
  matches: ReadonlyMap<string, StillwellMatch>,
  hasTicon: (id: string) => boolean,
): StillwellProvenance["links"] {
  const links: StillwellProvenance["links"] = {};
  for (const link of station.same_as) {
    if (!link.startsWith("gesla/")) continue;
    const id = link.slice("gesla/".length);
    if (!/^[\w.-]+$/.test(id) || id.startsWith(".") || !hasTicon(id))
      continue;
    const m = matches.get(matchKey(station.id, link));
    links[id] = m ? { rms_m: m.rms_m, lag_h: m.lag_h, months: m.months } : null;
  }
  return links;
}

export const sameGauge = (
  link: StillwellProvenance["links"][string] | undefined,
): boolean => !!link && link.lag_h === 0 && link.rms_m <= SAME_GAUGE_RMS;

/** The latest year, at or before `last`, with at least half its hours of
 *  final values: the gauge's held-out year. */
async function heldOutYear(
  station: StillwellStation,
  last: number,
  read: (period: { start: Date; end: Date }) => Promise<unknown[]>,
): Promise<number | undefined> {
  const first = station.first?.getUTCFullYear() ?? last + 1;
  for (let y = last; y >= first; y--) {
    const { start, end } = year(y);
    const hours = (+end - +start) / HOUR_MS;
    if ((await read({ start, end })).length >= hours / 2) return y;
  }
  return undefined;
}

export interface ImportResult {
  id: string;
  status: "saved" | "skipped";
  reason?: string;
}

/** Fit, verify and save one Stillwell series. */
export async function importStation(
  profile: Profile,
  station: StillwellStation,
  context: {
    lastYear: number;
    settled: Date | undefined;
    matches: ReadonlyMap<string, StillwellMatch>;
    engine: string;
  },
): Promise<ImportResult> {
  const id = `${profile.source}/${encodeURIComponent(station.source_id)}`;
  const errata = Object.fromEntries(
    Object.entries(profile.errata).map(([k, v]) => [k, v.decision]),
  );
  const settledOption = context.settled ? { settled: context.settled } : {};
  const readFinal = (period: { start: Date; end: Date }) =>
    readStillwellSamples(station.id, period, FINAL_FLAGS, {
      hourly: true,
      errata,
      ...settledOption,
    });
  if (!station.first) return { id, status: "skipped", reason: "no values" };
  const heldOut = await heldOutYear(station, context.lastYear, readFinal);
  if (heldOut === undefined)
    return { id, status: "skipped", reason: "no year with half its hours final" };
  const start = new Date(
    Math.max(+station.first, +year(heldOut - MAX_FIT_YEARS).start),
  );
  const end = year(heldOut).start;
  if ((+end - +start) / 86_400_000 < MIN_FIT_DAYS)
    return {
      id,
      status: "skipped",
      reason: `under ${MIN_FIT_DAYS} days before ${heldOut}`,
    };

  const links = ticonLinks(station, context.matches, (t) =>
    existsSync(join(DATA_DIR, "ticon", `${t}.json`)),
  );
  const ticon = Object.keys(links).filter((t) => sameGauge(links[t]));
  const report = await verifyFit({
    series: station.id,
    start,
    end,
    names: candidateList(catalog),
    extras: false,
    seasonal: true,
    fitOptions: { robust: true },
    heldOut,
    ticon,
    errata,
    ...settledOption,
  });
  const published = report.fit.published;

  // Datums read every measured value, final or not, over the fit's window
  // and the held-out year: a datum needs complete months more than verified
  // ones (plan, Series).
  const measured = await readStillwellSamples(
    station.id,
    { start, end: year(heldOut).end },
    MEASURED_FLAGS,
    { hourly: true, errata },
  );
  const harmonic = computeDatums(published, {});
  const reduced = reduceTiconDatums(
    measured.map((s) => ({ time: new Date(s.t), level: s.level })),
    published,
    harmonic.datums,
    { start, end: new Date(+end - HOUR_MS) },
  );
  const digests = Object.fromEntries(
    ticon.map((t) => [
      t,
      constituentsDigest(
        JSON.parse(readFileSync(join(DATA_DIR, "ticon", `${t}.json`), "utf8"))
          .harmonic_constituents,
      ),
    ]),
  );
  const record = buildRecord({
    profile,
    station,
    report,
    constituents: published,
    datums: {
      datums: reduced.datums,
      datums_source: reduced.datums_source,
      datum_frame: reduced.datum_frame,
      ...(reduced.datum_epoch ? { datum_epoch: reduced.datum_epoch } : {}),
      ...(reduced.datum_coverage
        ? { datum_coverage: reduced.datum_coverage }
        : {}),
    },
    datumNotice: reduced.datum_notice,
    engine: context.engine,
    digests,
    links,
  });
  await save(profile.source, normalize(record));
  return { id, status: "saved" };
}

// Usage: npm run import -w sources/stillwell -- <source> [<station id>...]
//   [--shard <i>/<n>]
if (import.meta.main) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { shard: { type: "string" } },
  });
  const [source, ...only] = positionals;
  const profile = source ? PROFILES[source] : undefined;
  const shard = values.shard?.match(/^(\d+)\/(\d+)$/);
  if (!profile || (values.shard && !shard))
    throw new Error(
      `usage: import.ts <${Object.keys(PROFILES).join("|")}> [<station id>...] [--shard <i>/<n>]`,
    );
  // Every kept erratum of the source has a decision, so a new one stops the
  // import rather than one gauge's read.
  const undecided = (await stillwellErrata()).filter(
    (e) => e.source === profile.source && e.handling === "kept" && !profile.errata[e.id],
  );
  if (undecided.length)
    throw new Error(
      `decide Stillwell's kept errata in profiles.ts: ${undecided.map((e) => e.id).join(", ")}`,
    );
  const settled = profile.settled?.(new Date());
  const lastYear = await sourceFinalYear(profile.source, settled);
  const matches = await stillwellMatches();
  const engine = JSON.parse(
    await readFile(
      join(import.meta.dirname, "..", "..", "node_modules", "@slackwater", "engine", "package.json"),
      "utf8",
    ),
  ).version as string;
  const stations = [...(await stillwellStations()).values()]
    .filter((s) => s.source === profile.source)
    .filter((s) => !only.length || only.includes(s.id))
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .filter(
      (_, i) => !shard || i % Number(shard[2]) === Number(shard[1]) - 1,
    );
  for (const station of stations) {
    try {
      const result = await importStation(profile, station, {
        lastYear,
        settled,
        matches,
        engine,
      });
      console.log(JSON.stringify(result));
    } catch (err) {
      console.log(
        JSON.stringify({ id: station.id, status: "failed", reason: (err as Error).message }),
      );
    }
  }
}
