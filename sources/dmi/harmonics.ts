import {
  constituents,
  createTidePredictor,
  fit,
  type HarmonicFit,
} from "@slackwater/engine";
import {
  fitSelected,
  harmonicSamples,
  publishedConstants,
  type Sample,
  type HarmonicConstituent,
} from "@slackwater/harmonic-analysis";

const MAJORS =
  "M2 S2 N2 K1 O1 K2 P1 Q1 Sa Ssa Mm Mf MSf 2Q1 sigma1 rho1 M1 chi1 pi1 S1 psi1 phi1 theta1 J1 OO1 2N2 mu2 nu2 lambda2 L2 T2 R2 eta2 M3 MK3 MO3 SO3 SK3 MN4 M4 MS4 MK4 S4 SK4 2MK5 2SK5 M6 2MS6 2SM6 2MK6 MSK6 2MN6 M8 M10 M12".split(
    " ",
  );
const models = new Map(Object.values(constituents).map((c) => [c.name, c]));
export type Metrics = { rms: number; p95: number; max: number };
export type FitResult = {
  accepted: boolean;
  constituents: HarmonicConstituent[];
  offset: number;
  height: Metrics;
  stabilityRms: number;
  training: { start: string; end: string; count: number };
  validation: { start: string; end: string; count: number };
};

export function heightGate(height: Metrics, stabilityRms: number): boolean {
  return (
    [height.rms, height.p95, height.max, stabilityRms].every(
      (n) => Number.isFinite(n) && n >= 0,
    ) &&
    height.rms <= 0.02 &&
    height.p95 <= 0.04 &&
    height.max <= 0.1 &&
    stabilityRms <= 0.005
  );
}

export function storedHeight(
  terms: HarmonicConstituent[],
  samples: Sample[],
): Metrics {
  if (!samples.length) throw new Error("Missing validation samples");
  if (
    !Array.isArray(terms) ||
    !terms.length ||
    terms.some(
      (c) =>
        !c ||
        !models.has(c.name) ||
        !Number.isFinite(c.amplitude) ||
        c.amplitude < 0 ||
        !Number.isFinite(c.phase),
    )
  )
    throw new Error("Invalid stored constituent");
  const predictor = createTidePredictor(terms, { offset: false });
  const errors = samples
    .map((s) =>
      Math.abs(
        predictor.getWaterLevelAtTime({ time: new Date(s.t) }).level - s.level,
      ),
    )
    .sort((a, b) => a - b);
  return {
    rms: Math.sqrt(errors.reduce((sum, e) => sum + e * e, 0) / errors.length),
    p95: errors[Math.ceil(errors.length * 0.95) - 1]!,
    max: errors.at(-1)!,
  };
}

/** A fit as it is stored, rounded, with the mean offset of that representation. */
function fitted(samples: Sample[], result: HarmonicFit) {
  const fit = publishedConstants(result.constituents);
  const predictor = createTidePredictor(fit, { offset: false });
  const offset = Number(
    (
      samples.reduce(
        (sum, s) =>
          sum +
          s.level -
          predictor.getWaterLevelAtTime({ time: new Date(s.t) }).level,
        0,
      ) / samples.length
    ).toFixed(3),
  );
  return { fit, offset, predictor: createTidePredictor(fit, { offset }) };
}

export function fitSeries(
  training: Sample[],
  validation: Sample[],
  options: { names?: string[]; extras?: boolean } = {},
): FitResult {
  for (const rows of [training, validation]) {
    if (
      rows.length < 100 ||
      rows.some(
        (s, i) =>
          !Number.isFinite(s.level) ||
          !Number.isFinite(s.t) ||
          (i > 0 && s.t <= rows[i - 1]!.t),
      )
    )
      throw new Error("Insufficient, non-finite or unordered samples");
  }
  if (training.at(-1)!.t >= validation[0]!.t)
    throw new Error("Training and validation overlap");
  const spanHours = (training.at(-1)!.t - training[0]!.t) / 3600000;
  if (spanHours < 365.25 * 24)
    throw new Error("Training must span a complete annual cycle");
  const names = options.names ?? MAJORS;
  // Alternate ten-minute samples: two disjoint regular series, sampled finely
  // enough that the highest harmonics stay below their Nyquist frequency.
  const firstRows = training.filter((_, i) => i % 2 === 0),
    secondRows = training.filter((_, i) => i % 2 === 1);
  const selected = fitSelected(
    harmonicSamples(firstRows),
    names,
    options.extras !== false,
  );
  const chosen = selected.constituents.map((c) => c.name);
  const first = fitted(firstRows, selected),
    second = fitted(
      secondRows,
      fit(harmonicSamples(secondRows), chosen, { dropDependent: true }),
    );
  const errors: number[] = [];
  let squares = 0,
    stability = 0;
  for (const s of validation) {
    const time = new Date(s.t);
    const a = first.predictor.getWaterLevelAtTime({ time }).level;
    const b = second.predictor.getWaterLevelAtTime({ time }).level;
    const error = a - s.level;
    squares += error * error;
    stability += (a - b) ** 2;
    errors.push(Math.abs(error));
  }
  errors.sort((a, b) => a - b);
  const height = {
    rms: Math.sqrt(squares / errors.length),
    p95: errors[Math.ceil(errors.length * 0.95) - 1]!,
    max: errors.at(-1)!,
  };
  const stabilityRms = Math.sqrt(stability / errors.length);
  const bounds = (rows: Sample[]) => ({
    start: new Date(rows[0]!.t).toISOString(),
    end: new Date(rows.at(-1)!.t).toISOString(),
    count: rows.length,
  });
  return {
    accepted: heightGate(height, stabilityRms),
    constituents: first.fit,
    offset: first.offset,
    height,
    stabilityRms,
    training: bounds(training),
    validation: bounds(validation),
  };
}
