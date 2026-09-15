import * as neaps from "@neaps/tide-predictor";

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
 * from @neaps, applied per-timestamp). Phase G = atan2(q,p) then lands in the
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

const DEG = Math.PI / 180;
const DAY_MS = 86_400_000;

// Constituents whose @neaps definition has disagreed with TICON's (issue #76).
// @neaps speeds are compared against these TICON-manual reference speeds at fit
// time; any constituent still mismatched is skipped rather than fit at the
// wrong frequency (e.g. @neaps "3N2" is a sextidiurnal at 85°/hr). This
// self-heals — once @neaps corrects a definition, it is included again.
const TICON_REFERENCE_SPEED: Record<string, number> = {
  SA: 0.0410686,
  MKS2: 28.4350877,
  "3N2": 29.0662415,
  "3L2": 29.5331208,
  T3: 44.9589333,
  R3: 45.0410706,
};
function definitionMismatched(name: string, neapsSpeed: number): boolean {
  const ref = TICON_REFERENCE_SPEED[name.toUpperCase()];
  return ref !== undefined && Math.abs(neapsSpeed - ref) > 1e-4;
}

// Map DB/TICON constituent names (incl. aliases) to @neaps constituent keys.
const constituentKey = (() => {
  const idx = new Map<string, string>();
  for (const [key, c] of Object.entries(neaps.constituents)) {
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
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of samples) {
    if (s.t < lo) lo = s.t;
    if (s.t > hi) hi = s.t;
  }
  return hi - lo >= 365 * DAY_MS;
}

/**
 * Least-squares fit of the named constituents to the samples, returning
 * amplitude (m) and UTC/Greenwich phase (deg) for each. Names not known to
 * @neaps are dropped (callers should pass a covered set).
 */
export function fitHarmonics(
  samples: Sample[],
  names: string[],
): HarmonicConstituent[] {
  const cons = names
    .map((name) => ({
      name,
      c: neaps.constituents[constituentKey.get(name.toUpperCase())!],
    }))
    .filter(
      (x): x is { name: string; c: (typeof neaps.constituents)[string] } =>
        !!x.c && !definitionMismatched(x.name, x.c.speed),
    );

  const ncol = 1 + 2 * cons.length;
  const ATA = Array.from({ length: ncol }, () => new Float64Array(ncol));
  const ATy = new Float64Array(ncol);
  const row = new Float64Array(ncol);
  row[0] = 1; // Z0 (mean) column

  for (const s of samples) {
    const a = neaps.astro(new Date(s.t));
    for (let k = 0; k < cons.length; k++) {
      const con = cons[k]!.c;
      const { f, u } = con.correction(a);
      const arg = (con.value(a) + u) * DEG;
      row[1 + 2 * k] = f * Math.cos(arg);
      row[2 + 2 * k] = f * Math.sin(arg);
    }
    for (let i = 0; i < ncol; i++) {
      const ri = row[i]!;
      ATy[i]! += ri * s.level;
      const Ai = ATA[i]!;
      for (let j = i; j < ncol; j++) Ai[j]! += ri * row[j]!;
    }
  }
  for (let i = 0; i < ncol; i++) {
    for (let j = 0; j < i; j++) ATA[i]![j] = ATA[j]![i]!;
  }

  const x = solveSymmetric(ATA, ATy);
  return cons.map((co, k) => {
    const p = x[1 + 2 * k]!;
    const q = x[2 + 2 * k]!;
    // Round to fit uncertainty: 1 mm amplitude, 0.01° phase (~1 s for M2).
    return {
      name: co.name,
      amplitude: Math.round(Math.hypot(p, q) * 1000) / 1000,
      phase:
        Math.round(((((Math.atan2(q, p) / DEG) % 360) + 360) % 360) * 100) /
        100,
    };
  });
}

/** Solve A·x = b for symmetric A via Gaussian elimination with partial pivoting. */
function solveSymmetric(A: Float64Array[], b: Float64Array): Float64Array {
  const n = b.length;
  const M = A.map((r, i) => Float64Array.from([...r, b[i]!]));
  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let r = i + 1; r < n; r++) {
      if (Math.abs(M[r]![i]!) > Math.abs(M[pivot]![i]!)) pivot = r;
    }
    [M[i], M[pivot]] = [M[pivot]!, M[i]!];
    const pv = M[i]![i]!;
    if (pv === 0) throw new Error("singular harmonic design matrix");
    for (let j = i; j <= n; j++) M[i]![j]! /= pv;
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const factor = M[r]![i]!;
      if (factor === 0) continue;
      for (let j = i; j <= n; j++) M[r]![j]! -= factor * M[i]![j]!;
    }
  }
  return Float64Array.from(M, (r) => r[n]!);
}
