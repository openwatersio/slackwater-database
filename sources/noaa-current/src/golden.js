// Capture a validation fixture: a station's constituents PLUS NOAA's own published
// predictions for the same station and days.
//
// This is the heart of how anything here gets trusted. A current engine is a pile of
// trigonometry that always produces plausible-looking output; the only way to know it
// is right is to feed it NOAA's constituents, predict the same window NOAA published,
// and diff. Both halves come from NOAA, so the comparison is self-contained and the
// resulting fixture replays offline forever.

import { fetchHarcon, fetchCurrentPredictions } from "./noaa.js";

/**
 * @param {string} stationId
 * @param {number} currbin the station's reference bin — harcon is EMPTY at any other
 * @param {Date} start
 * @param {Date} end
 */
export async function captureGolden(stationId, currbin, start, end, opts = {}) {
  const cons = await fetchHarcon(stationId, currbin, opts);
  if (!cons.length) {
    throw new Error(
      `${stationId}: empty harcon at bin ${currbin} — wrong bin, or a true subordinate`,
    );
  }

  let events = [];
  let predictionsError;
  try {
    events = await fetchCurrentPredictions(
      stationId,
      currbin,
      start,
      end,
      opts,
    );
  } catch (e) {
    // The currents_predictions product has had outages (it was down 2026-07-18, which
    // cost us a day of wrong conclusions). Capture the constituents anyway and let the
    // consuming test skip until this is re-run.
    predictionsError = e.message;
  }

  const azi = cons[0].azi ?? 0;
  return {
    note:
      "NOAA CO-OPS: harmonic constituents + NOAA's own published predictions for the " +
      "same window. Public domain. Regenerate with `noaa-current-stations golden`.",
    station: stationId,
    bin: currbin,
    start: start.toISOString(),
    end: end.toISOString(),
    floodDirection: azi,
    ebbDirection: (azi + 180) % 360,
    offset: cons[0].majorMeanSpeed ?? 0,
    constituents: cons.map((c) => ({
      name: c.constituentName,
      amplitude: c.majorAmplitude,
      phase: c.majorPhaseGMT,
    })),
    events,
    ...(predictionsError ? { predictionsError } : {}),
  };
}
