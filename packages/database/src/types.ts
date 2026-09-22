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

  // How datums were derived: "observed" (from GESLA water-level measurements)
  // or "harmonic" (synthesized from harmonic constituents).
  datums_source?: "observed" | "harmonic";

  // The chart datum key used as the vertical reference (e.g., "MLLW", "LAT")
  chart_datum?: string;

  // Epoch - the time period over which the harmonic constituents were computed
  epoch?: {
    start: string; // Date in YYYY-MM-DD format
    end: string; // Date in YYYY-MM-DD format
  };

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
