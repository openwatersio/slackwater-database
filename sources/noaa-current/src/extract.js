// Build a current-station bundle from NOAA CO-OPS metadata.
//
// Two station kinds end up in the bundle:
//   harmonic    — has its own constituents; predicted by summing them.
//   subordinate — no constituents; predicted by applying time/speed offsets to a
//                 reference station's harmonic prediction.
//
// The two traps this encodes, both found by validating against NOAA's own
// predictions (docs/noaa-api.md, docs/validation.md):
//   1. A reference is (station, BIN), not a station. Constituents vary by depth bin
//      and a station may publish several. Keying by id alone silently predicts from
//      the wrong depth — and a single-station test can pass by luck.
//   2. A `type: S` station is not necessarily offset-reduced. Many survey-derived
//      ones carry their own harcon and NOAA predicts those harmonically; applying
//      the reduction to them overshoots badly (PUG1716: 89 min wrong as a reduction,
//      6.8 min as harmonic). Always try own-harcon first.

import { fetchStationList, fetchHarcon, fetchOffsets } from "./noaa.js";
import { crossFlowCensus } from "./cross-flow.js";

const BUNDLE_NOTE =
  "Generated from NOAA CO-OPS mdapi (harcon@currbin + currentpredictionoffsets). " +
  "NOAA data is public domain; derived predictions are UNOFFICIAL and not for navigation.";

/** A harmonic entry's bundle key: plain id at the primary bin, `id@bin` otherwise. */
export const harmonicKey = (id, bin, primaryBin) =>
  bin === primaryBin ? id : `${id}@${bin}`;

/**
 * @param {object} opts
 * @param {[number,number,number,number]} [opts.box] [south, west, north, east]; omit for all US.
 * @param {string[]} [opts.stations] explicit station ids; overrides `box`.
 * @param {(msg: string) => void} [opts.log]
 */
export async function extractBundle(opts = {}) {
  const { box, stations: wanted, log = () => {}, ...fetchOpts } = opts;

  const all = await fetchStationList(fetchOpts);
  const primaryBin = new Map(all.map((s) => [s.id, s.currbin]));

  let selected = all;
  if (wanted?.length) {
    const want = new Set(wanted);
    selected = all.filter((s) => want.has(s.id));
    const missing = wanted.filter((id) => !selected.some((s) => s.id === id));
    if (missing.length)
      throw new Error(`not in NOAA's station list: ${missing.join(", ")}`);
  } else if (box) {
    const [south, west, north, east] = box;
    selected = all.filter(
      (s) => s.lat >= south && s.lat <= north && s.lng >= west && s.lng <= east,
    );
  }
  log(
    `${selected.length} stations selected (of ${all.length} US current stations)`,
  );

  const harmonic = new Map();
  const subs = [];
  const skipped = { typeW: 0, emptyHarcon: [], noReference: [], failed: [] };
  // Sampled as each harmonic record is built, because the minor axis is in the
  // harcon we already hold here and nowhere else downstream.
  const crossFlowSamples = [];

  // Store (id, bin) if it has a non-empty harcon. Returns whether it did.
  async function ensureHarmonic(key, id, bin, name, lat, lng) {
    if (harmonic.has(key)) return true;
    let cons;
    try {
      cons = await fetchHarcon(id, bin, fetchOpts);
    } catch (e) {
      skipped.failed.push(`${key}: ${e.message}`);
      return false;
    }
    if (!cons.length) return false;
    // azi is the major-axis azimuth (flood set); ebb is its reciprocal.
    // majorMeanSpeed is Z0 — the station's net mean flow along that axis. Omitting
    // it shifts every slack, because slack is where the curve crosses zero.
    const azi = cons[0].azi ?? 0;
    harmonic.set(key, {
      id: key,
      name,
      type: "harmonic",
      latitude: lat,
      longitude: lng,
      floodDirection: azi,
      ebbDirection: (azi + 180) % 360,
      offset: cons[0].majorMeanSpeed ?? 0,
      constituents: cons.map((c) => ({
        name: c.constituentName,
        amplitude: c.majorAmplitude, // knots, because units=english
        phase: c.majorPhaseGMT, // Greenwich phase — pairs with a Greenwich V₀
      })),
    });
    crossFlowSamples.push({
      id: key,
      crossFlow: Math.abs(cons[0].minorMeanSpeed ?? 0),
      alongAxisPeak:
        cons.reduce((sum, c) => sum + Math.abs(c.majorAmplitude ?? 0), 0) +
        Math.abs(cons[0].majorMeanSpeed ?? 0),
    });
    return true;
  }

  for (const s of selected) {
    if (s.type === "W") {
      skipped.typeW++;
      continue;
    } // weak/rotary — not modeled
    if (await ensureHarmonic(s.id, s.id, s.currbin, s.name, s.lat, s.lng))
      continue;
    if (s.type === "H") {
      skipped.emptyHarcon.push(s.id);
      continue;
    }

    let o;
    try {
      o = await fetchOffsets(s.id, s.currbin, fetchOpts);
    } catch (e) {
      skipped.failed.push(`${s.id}: ${e.message}`);
      continue;
    }
    if (!o.refStationId) {
      skipped.noReference.push(s.id);
      continue;
    }
    subs.push({
      id: s.id,
      name: s.name,
      type: "subordinate",
      latitude: s.lat,
      longitude: s.lng,
      reference: harmonicKey(
        o.refStationId,
        o.refStationBin,
        primaryBin.get(o.refStationId),
      ),
      _refId: o.refStationId,
      _refBin: o.refStationBin,
      floodDirection: o.meanFloodDir,
      ebbDirection: o.meanEbbDir,
      // Two slack offsets: a slack takes the offset for the phase it PRECEDES.
      slackBeforeFloodOffset: Math.round((o.sbfTimeAdjMin ?? 0) * 60),
      slackBeforeEbbOffset: Math.round((o.sbeTimeAdjMin ?? 0) * 60),
      floodTimeOffset: Math.round((o.mfcTimeAdjMin ?? 0) * 60),
      ebbTimeOffset: Math.round((o.mecTimeAdjMin ?? 0) * 60),
      floodSpeedRatio: o.mfcAmpAdj ?? 1, // ratios on the reference peak, not deltas
      ebbSpeedRatio: o.mecAmpAdj ?? 1,
    });
  }

  // Pull in each referenced (id, bin) that selection didn't already cover.
  for (const sub of subs) {
    if (harmonic.has(sub.reference)) continue;
    const ref = all.find((s) => s.id === sub._refId);
    if (!ref) {
      // No station-list record means no lat/lng — building the harmonic entry anyway
      // would silently violate the schema's required position fields.
      skipped.failed.push(
        `${sub.id}: reference station ${sub._refId} not in NOAA's station list`,
      );
      continue;
    }
    await ensureHarmonic(
      sub.reference,
      sub._refId,
      sub._refBin,
      ref.name,
      ref.lat,
      ref.lng,
    );
  }

  const resolved = subs.filter((x) => harmonic.has(x.reference));
  const unresolvable = subs.length - resolved.length;
  const stations = [
    ...harmonic.values(),
    ...resolved.map(({ _refId, _refBin, ...x }) => x),
  ];

  log(
    `${harmonic.size} harmonic, ${resolved.length} subordinate, ${skipped.typeW} type-W skipped, ` +
      `${unresolvable} unresolvable references dropped`,
  );
  for (const f of skipped.failed) log(`  failed: ${f}`);

  return {
    bundle: {
      note: BUNDLE_NOTE,
      generated: new Date().toISOString(),
      crossFlow: crossFlowCensus(crossFlowSamples),
      stations,
    },
    skipped: { ...skipped, unresolvable },
  };
}
