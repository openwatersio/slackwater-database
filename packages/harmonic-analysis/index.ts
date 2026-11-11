import * as engine from "@slackwater/engine";
import { Matrix, SingularValueDecomposition } from "ml-matrix";

/**
 * Re-analyze tidal harmonics from raw water-level observations.
 *
 * Some GESLA-4 sources (notably WSV / pegelonline.wsv.de) timestamp their
 * water levels in local legal time but label the file "TIME ZONE HOURS 0"
 * (UTC), so TICON's published phases are not UTC-referenced (see issue #96).
 * This re-fits amplitude + UTC/Greenwich phase directly from the observations
 * with the timestamps interpreted in the correct IANA zone.
 *
 * Constituent frequencies are known, so analysis is ordinary linear least
 * squares: fit Z0 + Σ f_k·[p_k·cos(V0_k+u_k) + q_k·sin(V0_k+u_k)] where V0 is
 * the Greenwich equilibrium argument and (f,u) the nodal factor/angle (both
 * from @slackwater/engine, applied per-timestamp). Phase G = atan2(q,p) then lands in the
 * same Greenwich, nodal-corrected convention as the rest of the database.
 */

export interface HarmonicConstituent {
  name: string;
  amplitude: number;
  phase: number;
}

export interface Sample {
  t: number; // UTC epoch ms
  level: number; // meters
}

export interface FitOptions {
  solver?: "qr" | "svd";
}

const DEG = Math.PI / 180;
const DAY_MS = 86_400_000;

// Constituents whose engine definition has disagreed with TICON's (issue #76).
// Engine speeds are compared against these TICON reference speeds at fit time;
// any constituent still mismatched is skipped rather than fit at the wrong
// frequency. This self-heals — once the engine corrects a definition, it is
// included again.
const TICON_REFERENCE_SPEED: Record<string, number> = {
  SA: 0.0410686,
  // The TICON-4 manual swaps these two rows; TICON's published phases fit MKS2 at 257.555 and 3N2 at 245.555 (openwatersio/slackwater#359).
  MKS2: 29.0662415,
  "3N2": 28.4350877,
  "3L2": 29.5331208,
  T3: 44.9589333,
  R3: 45.0410706,
};
export function definitionMismatched(
  name: string,
  engineSpeed: number,
): boolean {
  const ref = TICON_REFERENCE_SPEED[name.toUpperCase()];
  return ref !== undefined && Math.abs(engineSpeed - ref) > 1e-4;
}

// Map DB/TICON constituent names (incl. aliases) to engine constituent keys.
const constituentKey = (() => {
  const idx = new Map<string, string>();
  for (const [key, c] of Object.entries(engine.constituents)) {
    idx.set(key.toUpperCase(), key);
    for (const alias of (c as { aliases?: string[] }).aliases ?? []) {
      idx.set(String(alias).toUpperCase(), key);
    }
  }
  return idx;
})();

/**
 * Parse GESLA-4 water levels, interpreting each timestamp as wall-clock time in
 * `tz` (an IANA zone) and converting to a true UTC instant. Use this for
 * sources whose files are mislabeled UTC; for correctly-labeled files use the
 * header-honoring `parseGeslaSamples` in datum.ts instead.
 */
export function parseGeslaSamplesInZone(text: string, tz: string): Sample[] {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  // Offset (minutes) of `tz` from UTC at the given UTC instant.
  const offsetMin = (utcMs: number): number => {
    const p: Record<string, string> = {};
    for (const part of fmt.formatToParts(new Date(utcMs))) {
      if (part.type !== "literal") p[part.type] = part.value;
    }
    const hh = p["hour"] === "24" ? 0 : Number(p["hour"]);
    const asUTC = Date.UTC(
      Number(p["year"]),
      Number(p["month"]) - 1,
      Number(p["day"]),
      hh,
      Number(p["minute"]),
      Number(p["second"]),
    );
    return Math.round((asUTC - utcMs) / 60_000);
  };

  // Wall-clock-in-tz → UTC instant. One refinement pass resolves DST shifts.
  const wallToUTC = (
    y: number,
    mo: number,
    d: number,
    h: number,
    mi: number,
    s: number,
  ): number => {
    const guess = Date.UTC(y, mo - 1, d, h, mi, s);
    const off = offsetMin(guess);
    const ts = guess - off * 60_000;
    const off2 = offsetMin(ts);
    return off2 === off ? ts : guess - off2 * 60_000;
  };

  const lines = text.split(/\r?\n/);
  let nullValue = -99.9999;
  for (const line of lines) {
    if (!line.startsWith("#")) break;
    const nv = line.match(/^#\s*NULL VALUE\s+(-?\d+(?:\.\d+)?)/);
    if (nv) nullValue = parseFloat(nv[1]!);
  }

  const samples: Sample[] = [];
  for (const line of lines) {
    if (!line || line.startsWith("#")) continue;
    const f = line.trim().split(/\s+/);
    if (f.length < 5 || f[4] !== "1") continue; // use-in-analysis flag
    const level = parseFloat(f[2]!);
    if (!Number.isFinite(level) || Math.abs(level - nullValue) < 1e-3) continue;
    const [y, mo, d] = f[0]!.split("/").map(Number);
    const [h, mi, s] = f[1]!.split(":").map(Number);
    const t = wallToUTC(y!, mo!, d!, h!, mi!, s!);
    if (Number.isFinite(t)) samples.push({ t, level });
  }
  return samples;
}

/**
 * Whether a record can support a meaningful re-analysis: at least a year of
 * span (to resolve annual constituents) and enough samples for the fit.
 */
export function isAnalyzable(
  samples: Sample[],
  nConstituents: number,
): boolean {
  if (samples.length < 4 * (1 + 2 * nConstituents)) return false;
  return spanMs(samples) >= 365 * DAY_MS;
}

/** Time from the earliest sample to the latest, in any sample order. */
function spanMs(samples: Sample[]): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of samples) {
    if (s.t < lo) lo = s.t;
    if (s.t > hi) hi = s.t;
  }
  return samples.length ? hi - lo : 0;
}

// 3N2 and N2, and 3L2 and L2, are one lunar perigee cycle apart (8.85 years),
// the only pairs among TICON's names more than a year apart. A shorter record
// can't separate them, and fitting both splits the larger line between the
// two, so it keeps the signal on its own.
const PERIGEE_PARTNER: Record<string, string> = { "3N2": "N2", "3L2": "L2" };
function unresolvedFromPartner(
  name: string,
  speed: number,
  spanHours: number,
): boolean {
  const partner = PERIGEE_PARTNER[name.toUpperCase()];
  return (
    !!partner &&
    360 / Math.abs(speed - engine.constituents[partner]!.speed) > spanHours
  );
}

/**
 * Least-squares fit of the named constituents to the samples, returning
 * amplitude (m) and UTC/Greenwich phase (deg) for each. Names not known to
 * the engine are dropped (callers should pass a covered set).
 */
export function fitHarmonics(
  samples: Sample[],
  names: string[],
  options: FitOptions = {},
): HarmonicConstituent[] {
  const spanHours = spanMs(samples) / 3_600_000;
  const cons = names
    .map((name) => ({
      name,
      c: engine.constituents[constituentKey.get(name.toUpperCase())!],
    }))
    .filter(
      (x): x is { name: string; c: (typeof engine.constituents)[string] } =>
        !!x.c &&
        !definitionMismatched(x.name, x.c.speed) &&
        !unresolvedFromPartner(x.name, x.c.speed, spanHours),
    );

  const ncol = 1 + 2 * cons.length;
  if (options.solver === "svd") {
    const rows = samples.map((sample) => {
      const row = new Array<number>(ncol).fill(0);
      row[0] = 1;
      const a = engine.astro(new Date(sample.t));
      for (let k = 0; k < cons.length; k++) {
        const con = cons[k]!.c;
        const { f, u } = con.correction(a);
        const arg = (con.value(a) + u) * DEG;
        row[1 + 2 * k] = f * Math.cos(arg);
        row[2 + 2 * k] = f * Math.sin(arg);
      }
      return row;
    });
    const x = new SingularValueDecomposition(new Matrix(rows), {
      autoTranspose: true,
    })
      .solve(Matrix.columnVector(samples.map(({ level }) => level)))
      .getColumn(0);
    if (!x.every(Number.isFinite))
      throw new Error("non-finite harmonic SVD solution");
    return cons.map((co, k) => {
      const p = x[1 + 2 * k]!;
      const q = x[2 + 2 * k]!;
      return {
        name: co.name,
        amplitude: Math.round(Math.hypot(p, q) * 1000) / 1000,
        phase:
          Math.round(((((Math.atan2(q, p) / DEG) % 360) + 360) % 360) * 100) /
          100,
      };
    });
  }
  const result = engine.fit(
    samples
      .toSorted((a, b) => a.t - b.t)
      .map(({ t, level }) => ({ time: new Date(t), value: level })),
    cons.map(({ c }) => c.name),
  );
  // Our own analyses are published to 1 mm and 0.01 degrees, as NOAA's
  // amplitudes are; finer digits sit below any fit's uncertainty.
  return result.constituents.map((c, i) => ({
    name: cons[i]!.name,
    amplitude: Math.round(c.amplitude * 1000) / 1000,
    phase: Math.round(c.phase * 100) / 100,
  }));
}

export { spreadSample, selectExtraConstituents } from "./selection.ts";

/**
 * Whether a constituent is long-period (species 0, such as SA, SSA or MM):
 * slower than 5°/h, a period over three days, which a Godin filter removes.
 */
export function isLongPeriod(name: string): boolean {
  const c = engine.constituents[constituentKey.get(name.toUpperCase())!];
  return !!c && c.speed < 5;
}

const HOUR_MS = 3_600_000;

/**
 * A running mean of `width` hours over hours i − lead to i − lead + width − 1,
 * NaN wherever a value is missing. An even width can't be centred, so the
 * Godin filter's two 24-hour passes lead by 11 and 12 hours, which cancel.
 */
function runningMean(xs: number[], width: number, lead: number): number[] {
  const out = new Array<number>(xs.length).fill(NaN);
  for (let i = lead; i + width - lead <= xs.length; i++) {
    let sum = 0;
    for (let k = i - lead; k < i - lead + width; k++) sum += xs[k]!;
    out[i] = sum / width;
  }
  return out;
}

/**
 * How well constituents predict the tide in these samples: the RMS, in metres,
 * of observed minus predicted levels after a Godin filter (24, 24 and 25-hour
 * running means; Godin 1972, The Analysis of Tides) has taken out the slow
 * part, such as weather and the datum. What is left is the diurnal and faster
 * tidal band, where those constituents' errors show, plus seiches and noise;
 * the filter also takes out the long-period constituents (isLongPeriod). Residuals are averaged
 * into whole UTC hours first; an hour counts only when the 71 hours around it
 * all have data. Constituents the engine doesn't know predict nothing.
 */
export function tidalResidual(
  constituents: HarmonicConstituent[],
  samples: Sample[],
): { rms: number; hours: number } {
  const residuals = tidalResiduals(constituents, samples);
  let sum = 0;
  for (const r of residuals.values()) sum += r * r;
  const hours = residuals.size;
  return { rms: hours ? Math.sqrt(sum / hours) : NaN, hours };
}

/** The filtered residual tidalResidual squares, by UTC hour (ms since the
 *  epoch / 3600000), for the hours it scores. */
export function tidalResiduals(
  constituents: HarmonicConstituent[],
  samples: Sample[],
): Map<number, number> {
  const out = new Map<number, number>();
  if (!samples.length) return out;
  const predictor = engine.createTidePredictor(constituents, { offset: false });
  // Samples in any order: the earliest anchors the hourly bins.
  const first = Math.floor(
    samples.reduce((m, s) => Math.min(m, s.t), Infinity) / HOUR_MS,
  );
  const sums: number[] = [];
  const counts: number[] = [];
  for (const { t, level } of samples) {
    const h = Math.floor(t / HOUR_MS) - first;
    sums[h] =
      (sums[h] ?? 0) +
      level -
      predictor.getWaterLevelAtTime({ time: new Date(t) }).level;
    counts[h] = (counts[h] ?? 0) + 1;
  }
  const hourly = Array.from({ length: sums.length }, (_, h) =>
    counts[h] ? sums[h]! / counts[h]! : NaN,
  );
  const slow = runningMean(
    runningMean(runningMean(hourly, 24, 11), 24, 12),
    25,
    12,
  );
  hourly.forEach((r, h) => {
    const fast = r - slow[h]!;
    if (Number.isFinite(fast)) out.set(first + h, fast);
  });
  return out;
}
