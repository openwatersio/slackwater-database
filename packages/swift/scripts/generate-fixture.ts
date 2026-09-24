// Builds the .tcdb fixture the Swift tests read, through the same
// buildDatabase the shipped file comes from — so the tests exercise real
// builder output, not bytes frozen in git. Run by pretest; the output is
// git-ignored. Imports the builder source, which needs the root's generated
// FlatBuffers code — pretest runs the root `generate` first.

import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
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
        flood_speed_ratio: 0.8,
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
    type: "reference",
    chart_datum: "MLLW",
    datums_source: "observed",
    epoch: { start: "2007-01-01", end: "2026-01-01" },
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

const bytes = buildDatabase(stations, { version: "0.0.0-fixture" });
const out = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "Tests",
  "SlackwaterDatabaseTests",
  "fixture.tcdb",
);
writeFileSync(out, bytes);
console.log(`generated ${out}: ${bytes.length} bytes`);
