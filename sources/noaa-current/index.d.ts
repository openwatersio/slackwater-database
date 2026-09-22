export interface FetchOptions {
  /** Delay before each request, ms. NOAA throttles bulk callers. Default 400. */
  paceMs?: number;
  /** Injectable fetch, for tests. */
  fetchFn?: typeof fetch;
  /** `application` parameter NOAA uses to identify a caller. */
  application?: string;
}

export interface NoaaStation {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** H = harmonic, S = subordinate (may still carry own harcon), W = weak/rotary. */
  type: "H" | "S" | "W";
  /** The station's reference bin. harcon is EMPTY at any other bin. */
  currbin: number;
}

export interface NoaaConstituent {
  constituentName: string;
  /** Knots under units=english; cm/s under units=metric. */
  majorAmplitude: number;
  /** Greenwich phase, degrees. */
  majorPhaseGMT: number;
  /** Major-axis azimuth, degrees true — the flood set. */
  azi: number;
  /** Z0: net mean flow along the major axis, signed. */
  majorMeanSpeed: number;
  /** DC cross-axis flow, knots — the minor-axis counterpart to `majorMeanSpeed`. */
  minorMeanSpeed: number;
  binNbr: number;
}

export interface CurrentPrediction {
  /** ISO 8601, UTC. */
  time: string;
  /** 'unknown' for any Type NOAA sends that isn't one of the three — never folded in. */
  kind: "slack" | "flood" | "ebb" | "unknown";
  /** Signed major-axis velocity, knots. */
  velocityMajor: number;
  meanFloodDir: number;
  meanEbbDir: number;
}

export interface HarmonicStation {
  /** `id` at the primary bin, `id@bin` for a reference at another bin. */
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  type: "harmonic";
  floodDirection: number;
  ebbDirection: number;
  /** Z0 mean flow, knots. */
  offset: number;
  constituents: { name: string; amplitude: number; phase: number }[];
}

export interface SubordinateStation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  type: "subordinate";
  /** Bundle key of the harmonic station this reduces against. */
  reference: string;
  floodDirection: number;
  ebbDirection: number;
  /** Seconds. A slack takes the offset for the phase it precedes. */
  slackBeforeFloodOffset: number;
  slackBeforeEbbOffset: number;
  floodTimeOffset: number;
  ebbTimeOffset: number;
  /** Ratios applied to the reference peak speed, not deltas. */
  floodSpeedRatio: number;
  ebbSpeedRatio: number;
}

export interface CrossFlowCensus {
  /** What was measured, carried inline so the number explains itself. */
  measured: string;
  /** Harmonic records sampled, `@bin` entries included. */
  records: number;
  gte0_25kn: number;
  gte0_50kn: number;
  /** Where the flood axis describes the station worst. */
  worstRatio: {
    id: string;
    crossFlow: number;
    /** Σ|majorAmplitude| + |Z0| — a theoretical max if every constituent aligned in phase, not a realized peak speed. */
    alongAxisPeak: number;
    ratio: number;
  };
  /** Largest cross-flow in knots — usually a different station from `worstRatio`. */
  worstAbsolute: { id: string; crossFlow: number };
}

export interface Bundle {
  note: string;
  generated: string;
  /**
   * How much the major-axis model drops. Null when the bundle has no harmonic
   * stations. Never carried per station — see docs/schema.md.
   */
  crossFlow: CrossFlowCensus | null;
  stations: (HarmonicStation | SubordinateStation)[];
}

export interface GoldenFixture {
  note: string;
  station: string;
  bin: number;
  start: string;
  end: string;
  floodDirection: number;
  ebbDirection: number;
  offset: number;
  constituents: { name: string; amplitude: number; phase: number }[];
  events: CurrentPrediction[];
  /** Present when NOAA's predictions product was unavailable at capture time. */
  predictionsError?: string;
}

export interface ExtractOptions extends FetchOptions {
  /** [south, west, north, east]. Omit for all US stations. */
  box?: [number, number, number, number];
  /** Explicit station ids; overrides `box`. */
  stations?: string[];
  log?: (message: string) => void;
}

export interface ExtractResult {
  bundle: Bundle;
  skipped: {
    typeW: number;
    emptyHarcon: string[];
    noReference: string[];
    failed: string[];
    unresolvable: number;
  };
}

export function getJson(url: string, opts?: FetchOptions): Promise<unknown>;
export function fetchStationList(opts?: FetchOptions): Promise<NoaaStation[]>;
export function fetchHarcon(
  stationId: string,
  bin: number,
  opts?: FetchOptions,
): Promise<NoaaConstituent[]>;
export function fetchOffsets(
  stationId: string,
  currbin: number,
  opts?: FetchOptions,
): Promise<Record<string, number | string>>;
export function fetchCurrentPredictions(
  stationId: string,
  bin: number,
  start: Date,
  end: Date,
  opts?: FetchOptions,
): Promise<CurrentPrediction[]>;
export function extractBundle(opts?: ExtractOptions): Promise<ExtractResult>;
export function harmonicKey(
  id: string,
  bin: number,
  primaryBin: number,
): string;
export function captureGolden(
  stationId: string,
  currbin: number,
  start: Date,
  end: Date,
  opts?: FetchOptions,
): Promise<GoldenFixture>;

export const MDAPI: string;
export const DATAGETTER: string;
export const UA: string;
