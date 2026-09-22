export type RwsDatum = "NAP" | "MSL";

export type RwsSourceMetadata = {
  qualityCode: string;
  status: string;
  commissioningOrganization: string;
  samplingHeight: number;
  referencePlane: string;
};

export type RwsEventInput = {
  timestampMs: number;
  type: string;
  heightCm: number;
};

export type RwsStationInput = {
  id: `rws/${string}`;
  name: string;
  latitude: number;
  longitude: number;
  datum: RwsDatum;
  tcdbStationId?: string;
  startMs: number;
  cadenceSeconds: 600;
  heightsCm: (number | null)[];
  sourceMetadata: RwsSourceMetadata;
  events: RwsEventInput[];
};

export type RwsPredictionsInput = {
  formatMajor: 1;
  datasetVersion: string;
  retrievedAtMs: number;
  catalogRequest: string;
  catalogSha256: string;
  sourceUrl: string;
  licenseUrl: string;
  supportedStartMs: number;
  supportedEndMs: number;
  refreshAfterMs: number;
  stations: RwsStationInput[];
};
