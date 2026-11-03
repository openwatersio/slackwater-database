// One-axis consumers omit this constant cross-flow even at major-axis slack.

/** Provenance, carried in the census so the number explains itself in the file. */
const MEASURED =
  "NOAA minorMeanSpeed — flow perpendicular to the flood axis, present at all times including slack";

const r3 = (n) => Math.round(n * 1000) / 1000;

/**
 * @param {{id: string, crossFlow: number, alongAxisPeak: number}[]} samples
 * @returns {object|null} the census, or null when there is nothing to measure
 */
export function crossFlowCensus(samples) {
  if (!samples?.length) return null;

  let gte0_25kn = 0;
  let gte0_50kn = 0;
  // Kept as raw (unrounded) values through the loop — comparing a raw incoming
  // value against an already-r3-rounded stored one lets a within-0.0005 runner-up
  // win by rounding luck. Rounding happens once, on the way out.
  let worstRatio = null;
  let worstAbsolute = null;

  for (const s of samples) {
    // A station with no along-axis flow has no axis to be wrong about.
    const ratio = s.alongAxisPeak > 0 ? s.crossFlow / s.alongAxisPeak : 0;
    if (s.crossFlow >= 0.25) gte0_25kn += 1;
    if (s.crossFlow >= 0.5) gte0_50kn += 1;

    // Tracked separately on purpose: the largest ratio and the largest current
    // are usually different stations, and they answer different questions.
    if (!worstRatio || ratio > worstRatio.ratio) {
      worstRatio = {
        id: s.id,
        crossFlow: s.crossFlow,
        alongAxisPeak: s.alongAxisPeak,
        ratio,
      };
    }
    if (!worstAbsolute || s.crossFlow > worstAbsolute.crossFlow) {
      worstAbsolute = { id: s.id, crossFlow: s.crossFlow };
    }
  }

  return {
    measured: MEASURED,
    records: samples.length,
    gte0_25kn,
    gte0_50kn,
    worstRatio: worstRatio && {
      id: worstRatio.id,
      crossFlow: r3(worstRatio.crossFlow),
      alongAxisPeak: r3(worstRatio.alongAxisPeak),
      ratio: r3(worstRatio.ratio),
    },
    worstAbsolute: worstAbsolute && {
      id: worstAbsolute.id,
      crossFlow: r3(worstAbsolute.crossFlow),
    },
  };
}
