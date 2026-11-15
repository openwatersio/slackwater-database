import {
  constituents,
  fit,
  selectConstituents,
  type Candidate,
  type FittedConstituent,
  type HarmonicFit,
  type HarmonicSample,
} from "@slackwater/engine";

/**
 * Helpers for this database's own harmonic fits, which go through
 * `@slackwater/engine`'s `fit()` and `selectConstituents()`.
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

/** Database samples as the engine's fit takes them, in the same order. */
export function harmonicSamples(samples: readonly Sample[]): HarmonicSample[] {
  return samples.map(({ t, level }) => ({ time: new Date(t), value: level }));
}

/**
 * Candidates for `selectConstituents`: `names` first, in priority order, then
 * every other line in the engine's catalog. With no comparison constituent,
 * each is tested by the Rayleigh criterion against every candidate kept before
 * it, so a name in `names` wins a pair the record can't separate.
 */
export function catalogCandidates(names: readonly string[]): Candidate[] {
  const lines = new Set(names.map((name) => constituents[name]?.name ?? name));
  const rest = [
    ...new Set(
      Object.values(constituents)
        .filter((model) => model.speed > 0)
        .map((model) => model.name),
    ),
  ].filter((name) => !lines.has(name));
  return [...names, ...rest].map((name) => ({ name }));
}

/**
 * Fitted constants as this database publishes its own analyses: to 1 mm and
 * 0.01 degrees, as NOAA publishes its amplitudes. Finer digits sit below any
 * fit's uncertainty.
 */
export function publishedConstants(
  fitted: readonly FittedConstituent[],
): HarmonicConstituent[] {
  return fitted.map(({ name, amplitude, phase }) => ({
    name,
    amplitude: Math.round(amplitude * 1000) / 1000,
    phase: (Math.round(phase * 100) / 100) % 360,
  }));
}

/**
 * Fit `names`, extended with the catalog lines the record supports. Every
 * candidate passes the engine's selection, except that a name in `names`
 * below its SNR cut stays: its small amplitude is a measured value, not a
 * missing one. Throws on a name in `names` the engine doesn't know or the
 * sampling can't resolve. With `extras` false, only `names` are candidates.
 */
export function fitSelected(
  samples: readonly HarmonicSample[],
  names: readonly string[],
  extras = true,
): HarmonicFit {
  const given = new Set(names);
  const { selection } = selectConstituents(samples, {
    candidates: extras
      ? catalogCandidates(names)
      : names.map((name) => ({ name })),
  });
  const lost = selection.filter(
    (s) =>
      given.has(s.name) && (s.reason === "unknown" || s.reason === "nyquist"),
  );
  if (lost.length)
    throw new Error(
      `can't fit ${lost.map((s) => `${s.name} (${s.reason})`).join(", ")}`,
    );
  const chosen = selection
    .filter((s) => s.kept || (s.reason === "snr" && given.has(s.name)))
    .map((s) => s.name);
  return fit(samples, chosen, { dropDependent: true });
}
