#!/usr/bin/env node
/**
 * Generates XTide-compatible harmonics.txt and offsets.xml files from station JSON
 * data. These files are then compiled into a binary TCD (Tide Constituent Database)
 * using `build_tide_db` from tcd-utils.
 *
 * build_tide_db parses its input with fixed-size buffers and line matching rather
 * than real parsers; comments prefixed `build_tide_db:` mark each constraint. Source:
 * https://flaterco.com/files/xtide/tcd-utils-20240222.tar.xz (build_tide_db.c, xml.c)
 */

import { writeFile, mkdir } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import tidePredictor, { astro } from "@slackwater/engine";
import {
  stations,
  type CurrentData,
  type Station,
  type StationData,
} from "@slackwater/database";

const constituents = tidePredictor.constituents;

const outDir = join(dirname(fileURLToPath(import.meta.url)), "dist");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const START_YEAR = 1700;
const END_YEAR = 2100;
const NUM_YEARS = END_YEAR - START_YEAR + 1;

// ---------------------------------------------------------------------------
// Constituent handling
// ---------------------------------------------------------------------------

// Modulo operation that handles negative numbers correctly
function modulus(a: number, b: number): number {
  return ((a % b) + b) % b;
}

// ---------------------------------------------------------------------------
// Build master constituent list
// ---------------------------------------------------------------------------

/**
 * Build the master constituent list from station data.
 * Returns constituents in the order defined by tide-predictor.
 */
function buildConstituentList(stations: StationData[]): string[] {
  const usedConstituents = new Set<string>();

  // Scan all reference stations to find which constituents are used
  for (const station of stations) {
    if (station.type === "reference") {
      for (const hc of station.harmonic_constituents) {
        const constituent = constituents[hc.name];
        if (constituent) {
          usedConstituents.add(constituent.name);
        }
      }
    }
  }

  // Return constituents in the order they're defined in tide-predictor
  const names: string[] = [];
  const seen = new Set<string>();

  for (const key in constituents) {
    const constituent = constituents[key];
    if (
      constituent &&
      usedConstituents.has(constituent.name) &&
      !seen.has(constituent.name)
    ) {
      names.push(constituent.name);
      seen.add(constituent.name);
    }
  }

  return names;
}

/**
 * Resolve a station constituent name to the canonical name in our master list.
 * Since constituents are indexed by both name and aliases, this is straightforward.
 */
function resolveConstituentName(
  stationName: string,
  masterNames: Set<string>,
): string | null {
  // Try exact match first
  if (masterNames.has(stationName)) return stationName;

  // Look up in tide-predictor to get canonical name
  const tp = constituents[stationName];
  if (tp && masterNames.has(tp.name)) {
    return tp.name;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Compute equilibrium arguments and node factors
// ---------------------------------------------------------------------------

/**
 * Compute equilibrium argument (V₀ + u) for a constituent at a given time.
 * This is the phase of the constituent at Greenwich at the given time.
 */
function computeEquilibriumArgument(
  constituentName: string,
  time: Date,
): number {
  const constituent = constituents[constituentName];
  if (!constituent) return 0;

  const astroData = astro(time);
  const V0 = constituent.value(astroData);
  const { u } = constituent.correction(astroData);
  return modulus(V0 + u, 360);
}

/**
 * Compute node factor for a constituent at a given time.
 */
function computeNodeFactor(constituentName: string, time: Date): number {
  const constituent = constituents[constituentName];
  if (!constituent) return 1;

  const astroData = astro(time);
  const { f } = constituent.correction(astroData);
  return f;
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

/** Format time offset as -HH:MM or HH:MM */
function formatTimeOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "";
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${h}:${String(m).padStart(2, "0")}`;
}

/** Format station name for TCD (replace double quotes with single quotes) */
const TZ_MAX_LEN = 29; // build_tide_db: tzfile is a 30-byte field

function tcdTimezone(tz: string): string {
  if (tz.length <= TZ_MAX_LEN) return tz;

  // For timezones with two slashes (e.g., "America/Argentina/Buenos_Aires"),
  // try simplifying to one slash (e.g., "America/Buenos_Aires")
  const parts = tz.split("/");
  if (parts.length === 3) {
    const simplified = `${parts[0]}/${parts[2]}`;
    if (simplified.length <= TZ_MAX_LEN) {
      return simplified;
    }
  }

  // Fallback: warn and use UTC offset equivalent
  console.error(
    `Warning: timezone "${tz}" exceeds ${TZ_MAX_LEN} chars, using :UTC`,
  );
  return ":UTC";
}

/**
 * Name parts from most to least specific. Currents follow XTide's
 * "Name, Region Current" convention.
 */
function nameParts(station: Station): string[] {
  const parts = [station.name.replace(/"/g, "'")];
  if (station.region) parts.push(station.region);
  if (station.country && station.kind !== "current") {
    parts.push(station.country);
  }
  return parts;
}

function joinName(station: Station, parts: string[]): string {
  const name = parts.join(", ");
  return station.kind === "current" ? `${name} Current` : name;
}

// build_tide_db: 90-byte name buffer, which also holds the harmonics.txt newline
const REFERENCE_NAME_MAX_LEN = 88;
// build_tide_db: reads `<subordinatestation name="…"` into that same buffer and silently drops stations that overflow it
const SUBORDINATE_NAME_MAX_LEN = 63;

/** Subordinates find their reference by name, so duplicate names get their source id appended. */
function buildStationNames(stations: Station[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const s of stations) {
    const name = joinName(s, nameParts(s));
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  const names = new Map<string, string>();
  const stationNames = new Set<string>();
  for (const s of stations) {
    let parts = nameParts(s);
    const suffix =
      counts.get(joinName(s, parts))! > 1 ? ` (${s.source.id})` : "";
    const maxLen =
      s.type === "subordinate"
        ? SUBORDINATE_NAME_MAX_LEN
        : REFERENCE_NAME_MAX_LEN;

    let name = joinName(s, parts) + suffix;
    while (name.length > maxLen && parts.length > 1) {
      parts = parts.slice(0, -1);
      name = joinName(s, parts) + suffix;
    }
    if (name.length > maxLen) {
      throw new Error(
        `Station name "${name}" exceeds ${maxLen} chars (${s.id})`,
      );
    }
    if (stationNames.has(name)) {
      throw new Error(`Duplicate station name "${name}" (${s.id})`);
    }
    stationNames.add(name);
    names.set(s.id, name);
  }
  return names;
}

// ---------------------------------------------------------------------------
// Generate harmonics.txt
// ---------------------------------------------------------------------------

const HARMONICS_HEADER = `# Tide Harmonics Database
# Generated by slackwater-database (https://openwaters.io/tides/database)
#
# ********* NOT FOR NAVIGATION ********
#
# *** DO NOT RELY ON THIS DATA FILE FOR DECISIONS THAT CAN RESULT IN ***
# ***                   HARM TO ANYONE OR ANYTHING.                  ***
#
# This data file is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
#`;

function generateHarmonicsTxt(
  stations: Station[],
  names: Map<string, string>,
  masterConstituents: string[],
): string {
  const lines: string[] = [];
  const masterSet = new Set(masterConstituents);

  // build_tide_db: skips the preamble up to a line containing MERCHANTABILITY, then requires a lone "#" line
  lines.push(HARMONICS_HEADER);
  lines.push(`#
# ------------- Begin congen output -------------
#
# Number of constituents
${masterConstituents.length}`);

  // Constituent speeds
  lines.push(`#
# Constituent speeds
# Format:  identifier [whitespace] speed [CR]
# Speed is in degrees per solar hour.
# Identifier is just a name for the constituent.  They are for
# readability only; XTide assumes that the constituents will be listed
# in the same order throughout this file.`);

  for (const name of masterConstituents) {
    const speed = constituents[name]?.speed ?? 0;
    lines.push(`${name.padEnd(10)}                  ${speed.toFixed(7)}`);
  }

  // Starting year and equilibrium arguments
  lines.push(`#
# Starting year for equilibrium arguments and node factors
${START_YEAR}
#
# The following table gives equilibrium arguments for each year that
# we can predict tides for.  The equilibrium argument is in degrees for
# the meridian of Greenwich, at the beginning of each year.
#
# First line:  how many years in this table [CR]
# Remainder of table:  identifier [whitespace] arg [whitespace] arg...
# Carriage returns inside the table will be ignored.
#
# The identifiers are for readability only; XTide assumes that they
# are in the same order as defined above.
#
# DO NOT PUT COMMENT LINES INSIDE THE FOLLOWING TABLE.
# DO NOT REMOVE THE "*END*" AT THE END.
${NUM_YEARS}`);

  console.error("Computing equilibrium arguments...");
  for (const name of masterConstituents) {
    lines.push(name);
    // Compute equilibrium argument for Jan 1 of each year
    const values: number[] = [];
    for (let year = START_YEAR; year <= END_YEAR; year++) {
      const time = new Date(Date.UTC(year, 0, 1, 0, 0, 0));
      values.push(computeEquilibriumArgument(name, time));
    }
    // Write in rows of 10
    for (let i = 0; i < values.length; i += 10) {
      const row = values.slice(i, i + 10);
      lines.push(row.map((v) => v.toFixed(2).padStart(6)).join(" "));
    }
  }
  lines.push("*END*");

  // Node factors
  lines.push(`#
# Now come the node factors for the middle of each year that we can
# predict tides for.
#
# First line:  how many years in this table [CR]
# Remainder of table:  identifier [whitespace] factor [whitespace] factor...
# Carriage returns inside the table will be ignored.
#
# The identifiers are for readability only; XTide assumes that they
# are in the same order as defined above.
#
# DO NOT PUT COMMENT LINES INSIDE THE FOLLOWING TABLE.
# DO NOT REMOVE THE "*END*" AT THE END.
${NUM_YEARS}`);

  console.error("Computing node factors...");
  for (const name of masterConstituents) {
    lines.push(name);
    // Compute node factor for middle of each year (July 1)
    const values: number[] = [];
    for (let year = START_YEAR; year <= END_YEAR; year++) {
      const time = new Date(Date.UTC(year, 6, 1, 0, 0, 0));
      values.push(computeNodeFactor(name, time));
    }
    // Write in rows of 10
    for (let i = 0; i < values.length; i += 10) {
      const row = values.slice(i, i + 10);
      lines.push(row.map((v) => v.toFixed(4).padStart(6)).join(" "));
    }
  }
  lines.push("*END*");

  // Station data header
  lines.push(`#
# ------------- End congen output -------------
#
# Harmonic constants.
#
# First line:  name of location
# Second line:  time meridian [whitespace] tzfile
# Third line:  DATUM [whitespace] units
# Remaining lines:  identifier [whitespace] amplitude [whitespace] epoch
#
# The DATUM is the mean lower low water or equivalent constant for
# calibrating the tide height.
#
# These data sets are distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
#`);

  // Reference station records
  const referenceStations = stations.filter((s) => s.type === "reference");
  console.error(
    `Writing ${referenceStations.length} reference station records...`,
  );

  for (const station of referenceStations) {
    // Comments block
    lines.push(`# source: ${station.source.name}`);
    lines.push(`# station_id_context: ${station.id.split("/")[0]}`);
    lines.push(`# station_id: ${station.source.id}`);
    if (station.country) {
      lines.push(`# country: ${station.country}`);
    }
    if (station.disclaimers) {
      const notePrefix = "# note: ";
      const contPrefix = "# ";
      const maxLen = 254; // build_tide_db: reads lines with a 256-byte fgets, so longer lines split mid-record

      const words = station.disclaimers.split(/\s+/);
      let currentLine = notePrefix;
      for (const word of words) {
        const candidate =
          currentLine + (currentLine.endsWith(" ") ? "" : " ") + word;
        if (
          candidate.length > maxLen &&
          currentLine !== notePrefix &&
          currentLine !== contPrefix
        ) {
          lines.push(currentLine);
          currentLine = contPrefix + word;
        } else {
          currentLine = candidate;
        }
      }
      if (currentLine.length > 0) {
        lines.push(currentLine);
      }
    }
    // Currents are in knots and their datum offset is the mean flow; tides are in meters
    const current = station.kind === "current" ? station.current : undefined;
    const levelUnits = current ? "knots" : "meters";

    // Determine chart datum for this station
    const chartDatum = station.chart_datum ?? "MLLW";
    if (current) {
      // No datum line: build_tide_db stores its MLLW default, which XTide doesn't show for currents
      // XTide reads max_direction as flood and min_direction as ebb
      if (current.flood_direction !== undefined) {
        lines.push(`# max_direction: ${Math.round(current.flood_direction)}`);
      }
      if (current.ebb_direction !== undefined) {
        lines.push(`# min_direction: ${Math.round(current.ebb_direction)}`);
      }
    } else {
      lines.push(`# datum: ${chartDatum}`);
    }
    lines.push(`# restriction: Public Domain`);
    lines.push(`# confidence: 10`);
    lines.push(`# !units: ${levelUnits}`);
    lines.push(`# !longitude: ${station.longitude.toFixed(4)}`);
    lines.push(`# !latitude: ${station.latitude.toFixed(4)}`);

    // Station name
    lines.push(names.get(station.id)!);

    // Time zone: phases are in UTC, so meridian is 0:00
    lines.push(`0:00 ${tcdTimezone(station.timezone)}`);

    if (current) {
      lines.push(`${(current.mean_flow ?? 0).toFixed(4)} ${levelUnits}`);
    } else {
      // Datum offset Z₀: mean sea level above the station's chart datum
      const msl = station.datums?.["MSL"] ?? 0;
      const datumValue = station.datums?.[chartDatum] ?? 0;
      lines.push(`${(msl - datumValue).toFixed(4)} ${levelUnits}`);
    }

    // Build constituent map for this station
    const stationConstituents = new Map<
      string,
      { amplitude: number; phase: number }
    >();
    for (const hc of station.harmonic_constituents) {
      const resolved = resolveConstituentName(hc.name, masterSet);
      if (resolved) {
        stationConstituents.set(resolved, {
          amplitude: hc.amplitude,
          phase: modulus(hc.phase, 360),
        });
      }
    }

    // Write all constituents in master list order
    for (const name of masterConstituents) {
      const hc = stationConstituents.get(name);
      if (hc && (hc.amplitude !== 0 || hc.phase !== 0)) {
        lines.push(
          `${name.padEnd(10)}     ${hc.amplitude.toFixed(4).padStart(7)}  ${hc.phase.toFixed(2).padStart(6)}`,
        );
      } else {
        lines.push("x 0 0");
      }
    }
  }

  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Generate offsets.xml
// ---------------------------------------------------------------------------

type Attributes = [string, string][];

// build_tide_db: copies values verbatim from between the quotes without decoding entities, so values are written unescaped
function attr(value: string): string {
  if (value.includes('"')) {
    throw new Error(`offsets.xml values can't contain quotes: ${value}`);
  }
  return `"${value}"`;
}

function element(indent: string, tag: string, attrs: Attributes): string {
  return `${indent}<${tag}${attrs.map(([k, v]) => ` ${k}=${attr(v)}`).join("")}/>`;
}

function tideOffsetElements(
  indent: string,
  timeOffset: number,
  heightOffset: number,
  heightType: string,
): string[] {
  const lines: string[] = [];
  if (timeOffset !== 0) {
    lines.push(
      element(indent, "timeadd", [["value", formatTimeOffset(timeOffset)]]),
    );
  }
  if (heightType === "fixed" && heightOffset !== 0) {
    lines.push(
      element(indent, "leveladd", [
        ["value", heightOffset.toFixed(3)],
        ["units", "meters"],
      ]),
    );
  }
  if (heightType === "ratio" && heightOffset !== 0 && heightOffset !== 1) {
    lines.push(
      element(indent, "levelmultiply", [["value", heightOffset.toFixed(3)]]),
    );
  }
  return lines;
}

function tideOffsets(station: Station): string[] {
  const offsets = station.offsets!;
  const timeHigh = offsets.time?.high ?? 0;
  const timeLow = offsets.time?.low ?? 0;
  const heightType = offsets.height?.type ?? "ratio";
  const heightHigh = offsets.height?.high ?? (heightType === "ratio" ? 1 : 0);
  const heightLow = offsets.height?.low ?? (heightType === "ratio" ? 1 : 0);

  if (timeHigh === timeLow && heightHigh === heightLow) {
    return [
      "    <simpleoffsets>",
      ...tideOffsetElements("      ", timeHigh, heightHigh, heightType),
      "    </simpleoffsets>",
    ];
  }
  return [
    "    <offsets>",
    "      <max>",
    ...tideOffsetElements("        ", timeHigh, heightHigh, heightType),
    "      </max>",
    "      <min>",
    ...tideOffsetElements("        ", timeLow, heightLow, heightType),
    "      </min>",
    "    </offsets>",
  ];
}

/** Max is flood and min is ebb; speed ratios are unitless multipliers on the reference current. */
function currentOffsets(offsets: CurrentOffsets, station: Station): string[] {
  const extreme = (
    indent: string,
    time: number,
    ratio: number,
    direction: number | undefined,
  ) => [
    element(indent, "timeadd", [["value", formatTimeOffset(time)]]),
    element(indent, "levelmultiply", [["value", ratio.toFixed(3)]]),
    ...(direction === undefined
      ? []
      : [
          element(indent, "direction", [
            ["value", String(Math.round(direction))],
            ["units", "degrees true"],
          ]),
        ]),
  ];

  const lines = [
    "    <offsets>",
    "      <max>",
    ...extreme(
      "        ",
      offsets.flood_time,
      offsets.flood_speed_ratio,
      station.current?.flood_direction,
    ),
    "      </max>",
    "      <min>",
    ...extreme(
      "        ",
      offsets.ebb_time,
      offsets.ebb_speed_ratio,
      station.current?.ebb_direction,
    ),
    "      </min>",
  ];
  // build_tide_db: an explicit 0:00 slack offset means zero; omitted, XTide interpolates it
  if (offsets.slack_before_flood !== undefined) {
    lines.push(
      element("      ", "floodbegins", [
        ["value", formatTimeOffset(offsets.slack_before_flood)],
      ]),
    );
  }
  if (offsets.slack_before_ebb !== undefined) {
    lines.push(
      element("      ", "ebbbegins", [
        ["value", formatTimeOffset(offsets.slack_before_ebb)],
      ]),
    );
  }
  lines.push("    </offsets>");
  return lines;
}

function generateOffsetsXml(
  stations: Station[],
  names: Map<string, string>,
): string {
  const lines = [
    `<?xml version="1.0" encoding="ISO-8859-1"?>`,
    `<!-- Tide database subordinate stations -->`,
    `<!-- Generated by slackwater-database (https://openwaters.io/tides/database) -->`,
    `<!--

Offset tide stations for use with XTide version 2.2.2 or later.

All coordinates given in this file are approximate.  All tide
predictions produced through the application of offsets are
approximate.

********* NOT FOR NAVIGATION ********

*** DO NOT RELY ON THIS DATA FILE FOR DECISIONS THAT CAN RESULT IN ***
***                   HARM TO ANYONE OR ANYTHING.                  ***

This data file is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.

-->`,
    "<document>",
  ];

  const subordinateStations = stations.filter(
    (s) => s.type === "subordinate" && (currentOffsetsOf(s) || s.offsets),
  );
  console.error(
    `Writing ${subordinateStations.length} subordinate station records...`,
  );
  const referenceIds = new Set(
    stations.filter((s) => s.type === "reference").map((s) => s.id),
  );

  for (const station of subordinateStations) {
    const current = currentOffsetsOf(station);
    const reference = current?.reference ?? station.offsets!.reference;
    const refName = referenceIds.has(reference)
      ? names.get(reference)
      : undefined;

    if (!refName) {
      console.error(
        `WARNING: Subordinate station "${station.name}" references unknown station "${reference}", skipping`,
      );
      continue;
    }

    const attrs: Attributes = [
      ["latitude", station.latitude.toFixed(4)],
      ["longitude", station.longitude.toFixed(4)],
      ["timezone", tcdTimezone(station.timezone)],
      ["country", station.country ?? ""],
      ["source", station.source.name],
      ["restriction", "Public Domain"],
      ["station_id_context", station.id.split("/")[0]!],
      ["station_id", station.source.id],
      ["reference", refName],
    ];
    lines.push(
      // build_tide_db: finds each station by this literal prefix, so name must share its line
      `  <subordinatestation name=${attr(names.get(station.id)!)}`,
      // build_tide_db: reads one attribute per line
      ...attrs.map(
        ([k, v], i) =>
          `    ${k}=${attr(v)}${i === attrs.length - 1 ? ">" : ""}`,
      ),
      ...(current ? currentOffsets(current, station) : tideOffsets(station)),
      "  </subordinatestation>",
    );
  }

  lines.push("</document>");
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Current stations
// ---------------------------------------------------------------------------

type CurrentOffsets = NonNullable<CurrentData["offsets"]> & {
  flood_time: number;
  ebb_time: number;
  flood_speed_ratio: number;
  ebb_speed_ratio: number;
};

/** The offsets of a subordinate current, or undefined for a tide station or a current libtcd can't represent. */
function currentOffsetsOf(station: Station): CurrentOffsets | undefined {
  if (station.kind !== "current") return undefined;
  const offsets = station.current?.offsets;
  if (
    offsets?.flood_time === undefined ||
    offsets.ebb_time === undefined ||
    // build_tide_db: a levelmultiply of 0 means unset (1.0), so a zero speed ratio can't be represented
    !offsets.flood_speed_ratio ||
    !offsets.ebb_speed_ratio
  ) {
    return undefined;
  }
  return offsets as CurrentOffsets;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.error("Loading stations...");

  // Registry-only tide ports and identity-only current references carry no
  // constituents; XTide would list them and predict a flat line.
  const predictable = stations.filter(
    (s: Station) =>
      s.type === "subordinate" || s.harmonic_constituents.length > 0,
  );

  const unrepresentable = predictable.filter(
    (s) =>
      s.kind === "current" && s.type === "subordinate" && !currentOffsetsOf(s),
  );
  for (const s of unrepresentable) {
    console.error(
      `WARNING: Current "${s.name}" (${s.id}) lacks an extreme time or has a zero or missing speed ratio, skipping`,
    );
  }

  // Tides first, so adding currents leaves the tide records untouched.
  const tcdStations = [
    ...predictable.filter((s) => s.kind !== "current"),
    ...predictable.filter(
      (s) => s.kind === "current" && !unrepresentable.includes(s),
    ),
  ];
  const referenceStations = tcdStations.filter(
    (s: Station) => s.type === "reference",
  );
  const subordinateStations = tcdStations.filter(
    (s: Station) => s.type === "subordinate",
  );
  const currentCount = tcdStations.filter((s) => s.kind === "current").length;

  console.error(
    `Found ${tcdStations.length} stations (${referenceStations.length} reference, ${subordinateStations.length} subordinate, ${currentCount} currents)`,
  );

  const names = buildStationNames(tcdStations);

  console.error("Building master constituent list...");
  const masterConstituents = buildConstituentList(tcdStations);
  console.error(
    `Master constituent list: ${masterConstituents.length} constituents`,
  );
  console.error(`  ${masterConstituents.join(", ")}`);

  // Count how many station constituents we can cover
  let totalConstituents = 0;
  let coveredConstituents = 0;
  const masterSet = new Set(masterConstituents);
  const uncoveredNames = new Set<string>();

  for (const station of referenceStations) {
    for (const hc of station.harmonic_constituents) {
      totalConstituents++;
      const resolved = resolveConstituentName(hc.name, masterSet);
      if (resolved) {
        coveredConstituents++;
      } else {
        uncoveredNames.add(hc.name);
      }
    }
  }

  console.error(
    `Constituent coverage: ${coveredConstituents}/${totalConstituents} (${((coveredConstituents / totalConstituents) * 100).toFixed(1)}%)`,
  );
  if (uncoveredNames.size > 0) {
    console.error(
      `Uncovered constituent names (${uncoveredNames.size}): ${[...uncoveredNames].sort().join(", ")}`,
    );
  }

  await mkdir(outDir, { recursive: true });

  console.error(`\nGenerating harmonics.txt...`);
  const harmonicsTxt = generateHarmonicsTxt(
    tcdStations,
    names,
    masterConstituents,
  );

  console.error(`Generating offsets.xml...`);
  const offsetsXml = generateOffsetsXml(tcdStations, names);

  const harmonicsPath = join(outDir, "harmonics.txt");
  const offsetsPath = join(outDir, "offsets.xml");

  await writeFile(harmonicsPath, harmonicsTxt, "utf-8");
  await writeFile(offsetsPath, offsetsXml, "utf-8");

  console.error(`Wrote ${harmonicsPath}`);
  console.error(`Wrote ${offsetsPath}`);

  const harmonicsLines = harmonicsTxt.split("\n").length;
  const offsetsLines = offsetsXml.split("\n").length;
  console.error(
    `  harmonics.txt: ${harmonicsLines} lines (${(harmonicsTxt.length / 1024 / 1024).toFixed(1)} MB)`,
  );
  console.error(
    `  offsets.xml: ${offsetsLines} lines (${(offsetsXml.length / 1024).toFixed(1)} KB)`,
  );

  console.error(`\nReference stations: ${referenceStations.length}`);
  console.error(`Subordinate stations: ${subordinateStations.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
