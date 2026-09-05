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

export interface StationData {
  // Basic station information
  name: string;
  continent: string;
  country: string;
  region?: string;
  timezone: string;
  disclaimers: string;
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
  chart_datum: string;

  // Epoch - the time period over which the harmonic constituents were computed
  epoch?: {
    start: string; // Date in YYYY-MM-DD format
    end: string; // Date in YYYY-MM-DD format
  };

  // Alternate names and slugs, for search.
  aliases?: string[];
}

// Current-station data. This repo ships no current data yet; the database
// format carries a slot for it so downstream catalogs can write theirs through
// buildDatabase. Directions are degrees true, speeds knots, time offsets
// minutes, speed ratios unitless multipliers on the reference current.
export interface CurrentData {
  /** Degrees true. */
  flood_direction?: number;
  ebb_direction?: number;
  /** Knots; the constant term added to the harmonic sum. */
  mean_flow?: number;
  /** Id of the tide station whose extremes pair with this current, if any. */
  tide_reference?: string;
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
} & Partial<StationData>;

export interface Station extends StationData {
  id: string;
}

// The light fields the search/geo/list paths need. Used at build time to
// construct the search indexes; at runtime the same fields are read from the
// database file (see stations.ts).
export type StationMetaKey =
  | "name"
  | "latitude"
  | "longitude"
  | "region"
  | "country"
  | "continent"
  | "timezone"
  | "type"
  | "disclaimers"
  | "chart_datum"
  | "datums_source"
  | "source"
  | "license"
  | "offsets";

export type StationMeta = { id: string } & Pick<StationData, StationMetaKey>;
