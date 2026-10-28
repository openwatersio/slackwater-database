// Builds the .tcdb fixture the Swift tests read, through the same
// buildDatabase the shipped file comes from — so the tests exercise real
// builder output, not bytes frozen in git. Run by pretest; the output is
// git-ignored. Imports the builder source, which needs the root's generated
// FlatBuffers code — pretest runs the root `generate` first.

import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "../../database/src/database/reader.ts";
import { buildDatabase } from "../../database/src/database/builder.ts";
import type { StationInput } from "../../database/src/types.ts";

// Every station carries full identity: the builder requires name, timezone,
// continent, country, an ISO country code, source, and license on each record.
const identity = {
  timezone: "America/Los_Angeles",
  continent: "Americas",
  country: "United States",
  country_code: "US",
  source: {
    name: "Test Source",
    id: "9447130",
    published_harmonics: true,
    url: "https://example.com/9447130",
  },
  license: {
    type: "public domain",
    commercial_use: true,
    url: "https://example.com/license",
  },
};

const stations: StationInput[] = [
  {
    ...identity,
    id: "test/current",
    name: "A current",
    latitude: 48.1,
    longitude: -122.8,
    current: {
      flood_direction: 90,
      ebb_direction: 270,
      mean_flow: 0.4,
      tide_reference: "test/reference",
      offsets: {
        reference: "test/reference",
        slack_before_flood: -30,
        flood_time: 0,
        flood_speed_ratio: 0.8,
      },
    },
  },
  {
    // The three chs_fit gates sort last so the index-based assertions above hold.
    ...identity,
    id: "test/zfit-bounded",
    name: "A bounded gate",
    latitude: 48.2,
    longitude: -122.9,
    current: {
      flood_direction: 90,
      chs_fit: {
        tier: "bounded",
        days: 210,
        slack_bound_minutes: 40,
        provisional_slack_minutes: 45,
        evidence: "fit-2026-10-22-8f85912-r2",
      },
    },
  },
  {
    ...identity,
    id: "test/zfit-online",
    name: "An online gate",
    latitude: 48.3,
    longitude: -123.0,
    current: {
      flood_direction: 90,
      chs_fit: {
        tier: "online",
        miss: { clause: "slack_median", value: null, near_bar: true },
        miss_context: "rapids",
        evidence: "fit-2026-10-22-8f85912-r2",
      },
    },
  },
  {
    ...identity,
    id: "test/reference",
    name: "Reference",
    latitude: 47.6,
    longitude: -122.3,
    region: "WA",
    region_code: "US-WA",
    locality: "Seattle",
    context: "Seattle, WA",
    context_derived: false,
    cities: ["Seattle"],
    type: "reference",
    chart_datum: "MLLW",
    datums_source: "observed",
    datum_frame: "gauge",
    datum_coverage: { months: 24, observed_hours: 17520, inferred_hours: 24 },
    epoch: { start: "2007-01-01", end: "2026-01-01" },
    datum_epoch: { start: "2020-01-01", end: "2021-12-31" },
    aliases: ["elliott bay", "seattle"],
    harmonic_constituents: [
      { name: "M2", amplitude: 1.063, phase: 10.8 },
      { name: "S2", amplitude: 0.268, phase: 25.2 },
    ],
    datums: { MLLW: 2.419, MSL: 4.443, LAT: 1.8, HAT: 6.1 },
    quality: {
      id: "test/reference",
      accepted: true,
      score: 87,
      factors: {
        epoch: 1,
        recency: 0.75,
        source: 1,
        quality: 1,
        amplitude: 0.5,
        coverage: 1,
      },
      issues: ["MLW (3.827) < LAT (3.831)"],
    },
  },
  {
    ...identity,
    id: "test/subordinate",
    name: "Subordinate",
    type: "subordinate",
    latitude: 47.7,
    longitude: -122.5,
    // Subordinates carry a chart datum of their own but no datums; the values
    // come from the reference.
    chart_datum: "MLLW",
    offsets: {
      reference: "test/reference",
      time: { high: 12, low: -6 },
      height: { high: 1.1, low: 0.9, type: "ratio" },
    },
    quality: {
      id: "test/subordinate",
      accepted: false,
      score: 0,
      reason: "duplicate",
      redundant: "test/reference",
    },
  },
  {
    // Sorts after test/subordinate so the id-ordered assertions above it hold.
    ...identity,
    id: "test/subordinate-fixed",
    name: "Subordinate with fixed offsets",
    type: "subordinate",
    latitude: 47.8,
    longitude: -122.6,
    offsets: {
      reference: "test/reference",
      time: { high: 20, low: 10 },
      height: { high: 0.3, low: -0.2, type: "fixed" },
    },
  },
];

// A tier byte past the last one this reader knows: built as final, then patched
// to raw 3 below, since the builder only writes known tiers.
stations.push({
  ...identity,
  id: "test/zfit-unknown",
  name: "An unknown-tier gate",
  latitude: 48.4,
  longitude: -123.1,
  current: {
    flood_direction: 90,
    chs_fit: {
      tier: "final",
      days: 210,
      evidence: "fit-2026-10-22-8f85912-r2",
    },
  },
});

const bytes = buildDatabase(stations, {
  credits: new Map([["Test Source", null]]),
  version: "0.0.0-fixture",
  routes: {
    tide: [
      {
        slug: "reference",
        station_ids: ["test/reference"],
        former_paths: ["old-reference"],
      },
    ],
    current: [{ slug: "a-current", station_ids: ["test/current"] }],
  },
});
const unknownFit = openDatabase(bytes);
for (let i = 0; i < unknownFit.stationsLength(); i++) {
  const station = unknownFit.stations(i)!;
  if (station.id() !== "test/zfit-unknown") continue;
  const fit = station.current()!.chsFit()!;
  bytes[fit.bb_pos + fit.bb!.__offset(fit.bb_pos, 4)] = 3;
}
const out = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "Tests",
  "SlackwaterDatabaseTests",
  "fixture.tcdb",
);
writeFileSync(out, bytes);
console.log(`generated ${out}: ${bytes.length} bytes`);
