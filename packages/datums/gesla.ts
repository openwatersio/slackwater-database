import type { Sample } from "@slackwater/datums";

const HOUR_MS = 60 * 60 * 1000;

/**
 * Parse a GESLA-4 station file into UTC water-level samples.
 *
 * Keeps only rows flagged use-in-analysis (`use_flag === 1`, which already
 * excludes QC spikes/doubtful/missing) and drops the -99.9999 null. Times are
 * converted to UTC using the header's `TIME ZONE HOURS` (expected 0 for GESLA-4,
 * honored defensively).
 */
export function parseGeslaSamples(text: string): Sample[] {
  const lines = text.split(/\r?\n/);

  let tzHours = 0;
  let nullValue = -99.9999; // GESLA-4 default; overridden by the header below
  for (const line of lines) {
    if (!line.startsWith("#")) break;
    const tz = line.match(/^#\s*TIME ZONE HOURS\s+(-?\d+(?:\.\d+)?)/);
    if (tz) tzHours = parseFloat(tz[1]!);
    const nv = line.match(/^#\s*NULL VALUE\s+(-?\d+(?:\.\d+)?)/);
    if (nv) nullValue = parseFloat(nv[1]!);
  }
  const tzMs = tzHours * HOUR_MS;

  const samples: Sample[] = [];
  for (const line of lines) {
    if (!line || line.startsWith("#")) continue;
    const f = line.trim().split(/\s+/);
    if (f.length < 5 || f[4] !== "1") continue;
    const level = parseFloat(f[2]!);
    if (!Number.isFinite(level) || Math.abs(level - nullValue) < 1e-3) continue;
    const t = Date.parse(`${f[0]!.replaceAll("/", "-")}T${f[1]}Z`);
    if (!Number.isFinite(t)) continue;
    samples.push({ time: new Date(t - tzMs), level });
  }
  return samples;
}
