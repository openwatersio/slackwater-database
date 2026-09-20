/**
 * Generate tide predictions directly from station harmonics using @neaps/tide-predictor.
 * This serves as the baseline for validating XTide TCD predictions.
 */

import createTidePredictor from "@neaps/tide-predictor";
import type { Station } from "@neaps/tide-database";
import type { TideEvent } from "./xtide.js";

/**
 * Generate tide predictions from a reference station's harmonic constituents.
 *
 * @param station - Station with harmonic constituents
 * @param startDate - Start date for predictions
 * @param endDate - End date for predictions
 * @returns Array of tide events (high/low)
 */
export function getNeapsPredictions(
  station: Station,
  startDate: Date,
  endDate: Date,
): TideEvent[] {
  if (station.type !== "reference") {
    throw new Error(
      `Station ${station.id} is not a reference station. Cannot generate direct predictions from subordinate stations.`,
    );
  }

  if (
    !station.harmonic_constituents ||
    station.harmonic_constituents.length === 0
  ) {
    throw new Error(
      `Station ${station.id} has no harmonic constituents defined.`,
    );
  }

  // Create constituents array for tide-predictor
  const constituents = station.harmonic_constituents.map((hc) => ({
    name: hc.name,
    amplitude: hc.amplitude,
    phase: hc.phase,
  }));

  // Create tide predictor with Z₀ offset (MSL above MLLW)
  const msl = station.datums?.["MSL"] ?? 0;
  const mllw = station.datums?.["MLLW"] ?? 0;
  const z0 = msl && mllw ? msl - mllw : false;

  const predictor = createTidePredictor(constituents, {
    offset: z0,
  });

  // Get extreme predictions (high/low tides)
  const extremes = predictor.getExtremesPrediction({
    start: startDate,
    end: endDate,
  });

  // Convert to TideEvent format
  const events: TideEvent[] = extremes.map((extreme) => ({
    time: extreme.time,
    type: extreme.high ? "high" : "low",
    height: extreme.level, // level is the height in meters
  }));

  return events;
}

/**
 * Generate tide predictions for a subordinate station by applying offsets
 * to the reference station's predictions.
 *
 * @param station - Subordinate station with offsets
 * @param referenceStation - Reference station
 * @param startDate - Start date for predictions
 * @param endDate - End date for predictions
 * @returns Array of tide events (high/low)
 */
export function getSubordinatePredictions(
  station: Station,
  referenceStation: Station,
  startDate: Date,
  endDate: Date,
): TideEvent[] {
  if (station.type !== "subordinate" || !station.offsets) {
    throw new Error(
      `Station ${station.id} is not a subordinate station with offsets.`,
    );
  }

  // Get reference station predictions
  const refPredictions = getNeapsPredictions(
    referenceStation,
    startDate,
    endDate,
  );

  const offsets = station.offsets;
  const timeHigh = offsets.time?.high ?? 0;
  const timeLow = offsets.time?.low ?? 0;
  const heightType = offsets.height?.type ?? "ratio";
  const heightHigh = offsets.height?.high ?? (heightType === "ratio" ? 1 : 0);
  const heightLow = offsets.height?.low ?? (heightType === "ratio" ? 1 : 0);

  // Apply offsets to each prediction
  const subordinatePredictions: TideEvent[] = refPredictions.map((event) => {
    const isHigh = event.type === "high";
    const timeOffset = isHigh ? timeHigh : timeLow;
    const heightOffset = isHigh ? heightHigh : heightLow;

    // Apply time offset (in minutes)
    const newTime = new Date(event.time.getTime() + timeOffset * 60 * 1000);

    // Apply height offset
    let newHeight: number;
    if (heightType === "ratio") {
      newHeight = event.height * heightOffset;
    } else {
      // heightType === "fixed"
      newHeight = event.height + heightOffset;
    }

    return {
      time: newTime,
      type: event.type,
      height: newHeight,
    };
  });

  return subordinatePredictions;
}

/**
 * Get predictions for any station (reference or subordinate).
 *
 * @param station - Station to predict
 * @param stations - All stations (needed to find reference for subordinate stations)
 * @param startDate - Start date for predictions
 * @param endDate - End date for predictions
 * @returns Array of tide events
 */
export function getPredictions(
  station: Station,
  stations: Station[],
  startDate: Date,
  endDate: Date,
): TideEvent[] {
  if (station.type === "reference") {
    return getNeapsPredictions(station, startDate, endDate);
  } else if (station.type === "subordinate" && station.offsets) {
    const refId = station.offsets.reference;
    const refStation = stations.find((s) => s.id === refId);
    if (!refStation) {
      throw new Error(
        `Reference station ${refId} not found for subordinate station ${station.id}`,
      );
    }
    return getSubordinatePredictions(station, refStation, startDate, endDate);
  } else {
    throw new Error(
      `Cannot generate predictions for station ${station.id} of type ${station.type}`,
    );
  }
}

/**
 * Get max flood (high) and max ebb (low) predictions in knots for a current
 * station. A reference current is its harmonic sum plus the mean flow; a
 * subordinate shifts each extreme by its flood or ebb time offset and scales
 * it by its speed ratio.
 */
export function getCurrentPredictions(
  station: Station,
  stations: Station[],
  startDate: Date,
  endDate: Date,
): TideEvent[] {
  const offsets = station.current?.offsets;
  const reference = offsets
    ? stations.find((s) => s.id === offsets.reference)
    : station;
  if (!reference?.harmonic_constituents.length) {
    throw new Error(`No reference current with harmonics for ${station.id}`);
  }

  const predictor = createTidePredictor(reference.harmonic_constituents, {
    offset: reference.current?.mean_flow ?? 0,
  });
  const extremes = predictor.getExtremesPrediction({
    start: startDate,
    end: endDate,
  });

  return extremes.map((extreme) => {
    const flood = extreme.high;
    const minutes = (flood ? offsets?.flood_time : offsets?.ebb_time) ?? 0;
    const ratio =
      (flood ? offsets?.flood_speed_ratio : offsets?.ebb_speed_ratio) ?? 1;
    return {
      time: new Date(extreme.time.getTime() + minutes * 60 * 1000),
      type: flood ? "high" : "low",
      height: extreme.level * ratio,
    };
  });
}
