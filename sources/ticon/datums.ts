import type { PartialStationData } from "@slackwater/stations";
import {
  computeDatumsFromObservations,
  observedMeanLevel,
  toFixed,
  type Datums,
  type Sample,
} from "@slackwater/datums";

export const HARMONIC_KEYS = [
  "HAT",
  "LAT",
  "LLWLT",
  "MHWS",
  "MLWS",
  "NLLW",
  "ALLW",
  "TLT",
];
export const OBSERVED_KEYS = ["MSL", "MHHW", "MHW", "MTL", "MLW", "MLLW"];

export const HARMONIC_REDUCTION_NOTICE =
  "Harmonic datums retain every predicted turning point without prominence filtering.";

export const OBSERVED_DATUM_NOTICE =
  "Mean datums use one continuous observation window of whole years. Gaps shorter than 24 hours may contain model-assisted inferred hourly heights.";
export const HARMONIC_DATUM_NOTICE =
  "Datums derived from harmonic prediction; observations do not support a mean-datum reduction over twelve continuous whole months after bounded reconstruction of gaps shorter than 24 hours. Datum values carry higher uncertainty.";
export const OBSERVED_OFFSET_NOTICE =
  "A calendar-balanced mean of complete prepared observation months supplies the vertical offset; the months may span a different period from the pinned prediction.";
export const CONSTITUENT_FRAME_NOTICE =
  "Complete prepared observations do not cover every calendar month of the year for a balanced gauge mean; datums remain in the constituent frame (MSL = 0).";

export interface TiconDatumResult {
  datums: Datums;
  datums_source: "observed" | "harmonic";
  datum_frame: "gauge" | "constituent";
  epoch: { start: string; end: string };
  datum_epoch?: { start: string; end: string };
  datum_notice: string;
  datum_coverage?: NonNullable<PartialStationData["datum_coverage"]>;
}

export function reduceTiconDatums(
  samples: Sample[],
  constituents: PartialStationData["harmonic_constituents"],
  harmonic: Datums,
  fitEpoch: { start: Date; end: Date },
): TiconDatumResult {
  const observed = computeDatumsFromObservations(samples, constituents);
  if (observed) {
    return {
      datums: {
        ...Object.fromEntries(
          OBSERVED_KEYS.filter((key) => observed.datums[key] !== undefined).map(
            (key) => [key, observed.datums[key]!],
          ),
        ),
        ...shiftHarmonicDatums(harmonic, observed.datums["MSL"] ?? 0),
      },
      datums_source: "observed",
      datum_frame: "gauge",
      epoch: {
        start: fitEpoch.start.toISOString().slice(0, 10),
        end: fitEpoch.end.toISOString().slice(0, 10),
      },
      datum_epoch: {
        start: observed.start.toISOString().slice(0, 10),
        end: observed.end.toISOString().slice(0, 10),
      },
      datum_coverage: {
        months: observed.coverage.months,
        observed_hours: observed.coverage.observedHours,
        inferred_hours: observed.coverage.inferredHours,
      },
      datum_notice: `${OBSERVED_DATUM_NOTICE} ${HARMONIC_REDUCTION_NOTICE}`,
    };
  }
  const observedOffset = observedMeanLevel(samples, constituents);
  const offset = observedOffset ?? 0;
  return {
    datums: Object.fromEntries(
      Object.entries(harmonic).map(([key, value]) => [
        key,
        toFixed(value + offset, 3),
      ]),
    ),
    datums_source: "harmonic",
    datum_frame: observedOffset === undefined ? "constituent" : "gauge",
    epoch: {
      start: fitEpoch.start.toISOString().slice(0, 10),
      end: fitEpoch.end.toISOString().slice(0, 10),
    },
    datum_notice: `${HARMONIC_DATUM_NOTICE} ${observedOffset === undefined ? CONSTITUENT_FRAME_NOTICE : OBSERVED_OFFSET_NOTICE} ${HARMONIC_REDUCTION_NOTICE}`,
  };
}

/** Reject legacy reductions even when the constituents have not changed. */
export function cachedDatumNotice(
  station: Pick<
    PartialStationData,
    | "datums_source"
    | "datum_frame"
    | "datum_epoch"
    | "datum_coverage"
    | "disclaimers"
  >,
): string | undefined {
  const notice = storedDatumNotice(station);
  return notice && station.disclaimers?.includes(HARMONIC_REDUCTION_NOTICE)
    ? `${notice} ${HARMONIC_REDUCTION_NOTICE}`
    : undefined;
}

export function storedDatumNotice(
  station: Parameters<typeof cachedDatumNotice>[0],
): string | undefined {
  const observed = station.disclaimers?.includes(OBSERVED_DATUM_NOTICE);
  const harmonic = station.disclaimers?.includes(HARMONIC_DATUM_NOTICE);
  const gauge = station.disclaimers?.includes(OBSERVED_OFFSET_NOTICE);
  const constituent = station.disclaimers?.includes(CONSTITUENT_FRAME_NOTICE);
  if (
    (observed && (harmonic || gauge || constituent)) ||
    (gauge && constituent)
  )
    return undefined;
  if (
    station.datums_source === "observed" &&
    station.datum_frame === "gauge" &&
    station.datum_epoch &&
    validCoverage(station.datum_coverage, station.datum_epoch) &&
    station.disclaimers?.includes(OBSERVED_DATUM_NOTICE)
  )
    return OBSERVED_DATUM_NOTICE;
  if (
    station.datums_source === "harmonic" &&
    !station.datum_epoch &&
    !station.datum_coverage
  )
    for (const frame of [OBSERVED_OFFSET_NOTICE, CONSTITUENT_FRAME_NOTICE]) {
      const notice = `${HARMONIC_DATUM_NOTICE} ${frame}`;
      const expectedFrame =
        frame === OBSERVED_OFFSET_NOTICE ? "gauge" : "constituent";
      if (
        station.datum_frame === expectedFrame &&
        station.disclaimers?.includes(notice)
      )
        return notice;
    }
  return undefined;
}

function validCoverage(
  coverage: PartialStationData["datum_coverage"],
  epoch: { start: string; end: string },
): boolean {
  if (!coverage) return false;
  const start = new Date(epoch.start),
    end = new Date(epoch.end);
  end.setUTCDate(end.getUTCDate() + 1);
  const months =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    end.getUTCMonth() -
    start.getUTCMonth();
  return (
    Number.isSafeInteger(coverage.observed_hours) &&
    coverage.observed_hours > 0 &&
    Number.isSafeInteger(coverage.inferred_hours) &&
    coverage.inferred_hours >= 0 &&
    coverage.months === months &&
    months >= 12 &&
    months <= 228 &&
    months % 12 === 0 &&
    start.getUTCDate() === 1 &&
    end.getUTCDate() === 1 &&
    coverage.observed_hours + coverage.inferred_hours ===
      (+end - +start) / 3600000
  );
}

function shiftHarmonicDatums(harmonic: Datums, msl: number): Datums {
  return Object.fromEntries(
    HARMONIC_KEYS.filter((key) => harmonic[key] !== undefined).map((key) => [
      key,
      toFixed(harmonic[key]! + msl, 3),
    ]),
  );
}
