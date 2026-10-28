export interface HarmonicConstituent {
  name: string;
  description?: string;
  amplitude: number;
  phase: number;
  speed?: number;
}

export interface Constituent {
  name: string;
  description: string | null;
  speed: number;
}

export interface StationRouteInput {
  slug: string;
  station_ids: string[];
  former_paths?: string[];
}

export interface StationRoute {
  slug: string;
  /** Canonical web path, e.g. `/tides/ca/bc/victoria/`. */
  path: string;
  stationIds: string[];
  formerPaths: string[];
}

export interface DatabaseRoutes {
  tide: StationRouteInput[];
  current: StationRouteInput[];
}

export interface StationData {
  // Basic station information
  name: string;
  continent: string;
  country: string;
  country_code?: string;
  locality?: string;
  region?: string;
  region_code?: string;
  timezone: string;
  context?: string;
  context_derived?: boolean;
  cities?: string[];
  // Optional in the data (schemas/station.schema.json does not require it);
  // stations without one have the key absent.
  disclaimers?: string;
  type: "reference" | "subordinate";
  latitude: number;
  longitude: number;

  // Data source information
  source: {
    name: string;
    id: string;
    published_harmonics: boolean;
    url: string;
  };

  // License information
  license: {
    type: string;
    commercial_use: boolean;
    url: string;
    notes?: string;
  };

  // Harmonic constituents (empty array for subordinate stations)
  harmonic_constituents: HarmonicConstituent[];

  // Subordinate station offsets (empty object for reference stations)
  offsets?: {
    reference: string;
    height: { high: number; low: number; type: "ratio" | "fixed" };
    time: { high: number; low: number };
  };

  datums: Record<string, number>;

  // Mean-datum method: prepared water-level observations or harmonic synthesis.
  // Astronomical bounds can be synthesized even when the means are observed.
  datums_source?: "observed" | "harmonic";

  // Zero of the stored datum values; absence means the frame is unspecified.
  datum_frame?: "gauge" | "constituent";
  // Hourly bins in the observed reduction period, including model-assisted fills.
  datum_coverage?: {
    months: number;
    observed_hours: number;
    inferred_hours: number;
  };

  // The chart datum key used as the vertical reference (e.g., "MLLW", "LAT")
  chart_datum?: string;

  // Source-reported analysis or datum period; TICON uses its constituent fit period.
  epoch?: {
    start: string; // Date in YYYY-MM-DD format
    end: string; // Date in YYYY-MM-DD format
  };
  // Datum reduction period, which can differ from the constituent fit period.
  datum_epoch?: { start: string; end: string };

  // Alternate names and slugs, for search.
  aliases?: string[];
}

// Current-station data. Directions are degrees true, speeds knots, time
// offsets minutes, and speed ratios unitless multipliers on the reference
// current.
export interface TideDerivedCurrentData {
  reference: string;
  high_water_lag_minutes: number;
  low_water_lag_minutes: number;
}

/** How far a fitted CHS current gate's slack times are measured to hold. */
export type ChsFitTier = "final" | "bounded" | "online";
/** The release-check clause a gate missed. */
export type ChsFitClause =
  | "reversed_axis"
  | "invented_slack"
  | "missed_slack"
  | "slack_worst"
  | "slack_median"
  | "extremum_timing"
  | "peak_speed";
export type ChsFitContext = "slow_reversal" | "tidal_falls" | "rapids";
export interface ChsFitData {
  tier: ChsFitTier;
  /** Days of CHS predictions the fit used. */
  days?: 60 | 210;
  /** Minutes; slack lands within this of CHS (bounded tier). */
  slack_bound_minutes?: number;
  provisional_slack_minutes?: number;
  /**
   * The clause an online gate missed, and by how much, in the clause's unit:
   * percent of extrema for `reversed_axis`, slacks for `invented_slack` and
   * `missed_slack`, knots for `peak_speed`, minutes for the rest.
   */
  miss?: { clause: ChsFitClause; value: number | null; near_bar?: true };
  miss_context?: ChsFitContext;
  evidence: string;
}

export interface CurrentData {
  /** Degrees true. */
  flood_direction?: number;
  ebb_direction?: number;
  /** Knots; the constant term added to the harmonic sum. */
  mean_flow?: number;
  /** Id of the tide station whose extremes pair with this current, if any. */
  tide_reference?: string;
  magnitude_note?: string;
  derived?: TideDerivedCurrentData;
  chs_fit?: ChsFitData;
  /** Subordinate currents only. Times in minutes, ratios dimensionless. */
  offsets?: {
    reference: string;
    slack_before_flood?: number;
    slack_before_ebb?: number;
    flood_time?: number;
    ebb_time?: number;
    flood_speed_ratio?: number;
    ebb_speed_ratio?: number;
  };
}

/**
 * What buildDatabase accepts: a station id plus whatever fields the catalog
 * has. Downstream generators can pass filtered stations from this package or
 * records of their own (including current stations).
 */
export type StationInput = {
  id: string;
  kind?: "tide" | "current";
  current?: CurrentData;
  quality?: StationQuality;
} & Partial<StationData>;

// Quality evaluation for a station (packages/stations/evaluate-quality.ts). `accepted` is
// the default filter applied to the `stations` export; `score` is 0-100.
export interface StationQuality {
  /** The station's id — not stored in the database, filled from identity. */
  id: string;
  accepted: boolean;
  score: number;
  /** Scoring factors, each 0-1. */
  factors?: {
    epoch: number;
    recency: number;
    source: number;
    quality: number;
    amplitude: number;
    coverage: number;
  };
  /** Human-readable findings, e.g. "MLW (3.827) < LAT (3.831)". */
  issues?: string[];
  /** Rejection category ("duplicate", "datum", "constituents", ...), if rejected. */
  reason?: string;
  /** Id of the station that makes this one redundant, if any. */
  redundant?: string;
  /**
   * The peak of the seasonal curve (SA and SSA with their phases) exceeds the
   * principal tide M2+S2+K1+O1 by more than 3 mm, so the yearly swing exceeds
   * the daily one.
   *
   * Accepted rather than rejected: the predictions are correct and only the
   * frame is wrong. A consumer quoting a high and a low should read this and
   * say what the water is — a Great Lakes gauge, a river reach, a Baltic
   * bodden — because an entire 24-hour window can sit below the annual mean,
   * which is a true statement about the water and reads as a broken tide
   * table. `issues` gives both heights.
   */
  seasonal_dominant?: boolean;
}

/** The floor and ceiling of a station's predictions, in metres above its chart datum. */
export interface AstronomicalBounds {
  /** Lowest Astronomical Tide. */
  lat: number;
  /** Highest Astronomical Tide. */
  hat: number;
}

export interface Station extends StationData {
  id: string;
  country_code: string;
  kind: "tide" | "current";
  current?: CurrentData;
  quality?: StationQuality;
  /**
   * Lowest and highest astronomical tide, in metres above this station's chart
   * datum; absent when the station predicting for this one has no LAT and HAT.
   * A subordinate's is the reference's range reduced through `offsets.height`,
   * the floor of a prediction rather than a hydrographic datum — which is why
   * it is here and not in `datums`. See docs/datums.md.
   */
  astronomical_bounds?: AstronomicalBounds;
  /**
   * The credit to display when showing or redistributing this station, ready
   * to render as-is. Derived from `source`; see src/attribution.ts.
   */
  attribution: string;
}

// The light fields the search/geo/list paths need. Used at build time to
// construct the search indexes; at runtime the same fields are read from the
// database file (see stations.ts).
export type StationMetaKey =
  | "name"
  | "latitude"
  | "longitude"
  | "locality"
  | "region"
  | "region_code"
  | "country"
  | "country_code"
  | "continent"
  | "context"
  | "context_derived"
  | "cities"
  | "aliases"
  | "timezone"
  | "type"
  | "source";

export type StationMeta = { id: string } & Pick<StationData, StationMetaKey>;
