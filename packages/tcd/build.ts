#!/usr/bin/env node
/**
 * Generates XTide-compatible harmonics.txt and offsets.xml files from station JSON
 * data. These files are then compiled into a binary TCD (Tide Constituent Database)
 * using `build_tide_db` from tcd-utils.
 */

import { writeFile, mkdir } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { create } from "xmlbuilder2";
import tidePredictor, { astro } from "@neaps/tide-predictor";
import { stations, type Station, type StationData } from "@neaps/tide-database";

const constituents = tidePredictor.constituents;

const outDir = join(dirname(fileURLToPath(import.meta.url)), "dist");

// ---------------------------------------------------------------------------
// Unit systems
// ---------------------------------------------------------------------------

type UnitSystem = "metric" | "imperial";

const METERS_PER_FOOT = 0.3048;

function convertLength(meters: number, units: UnitSystem): number {
  return units === "imperial" ? meters / METERS_PER_FOOT : meters;
}

function unitLabel(units: UnitSystem): string {
  return units === "imperial" ? "feet" : "meters";
}

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
// libtcd has a 30-byte buffer for timezone names (29 chars max)
const TZ_MAX_LEN = 29;

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

function formatStationName(station: Station): string {
  let name = station.name.replace(/"/g, "'");
  if (station.region) {
    name += `, ${station.region}`;
  }
  if (station.country) {
    name += `, ${station.country}`;
  }
  return name;
}

// ---------------------------------------------------------------------------
// Generate harmonics.txt
// ---------------------------------------------------------------------------

const HARMONICS_HEADER = `# Tide Harmonics Database
# Generated by tide-database (https://openwaters.io/tides/database)
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
  masterConstituents: string[],
  units: UnitSystem,
): string {
  const lines: string[] = [];
  const masterSet = new Set(masterConstituents);

  // Legal boilerplate - build_tide_db requires "MERCHANTABILITY" in the preamble
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
      // build_tide_db uses fgets with a 256-byte buffer, so lines must be <255 chars.
      // Wrap long note lines at word boundaries to avoid splitting mid-word.
      const notePrefix = "# note: ";
      const contPrefix = "# ";
      const maxLen = 254; // max chars per line (excluding \n)

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
    // Determine chart datum for this station
    const chartDatum = station.chart_datum ?? "MLLW";
    lines.push(`# datum: ${chartDatum}`);
    lines.push(`# restriction: Public Domain`);
    lines.push(`# confidence: 10`);
    lines.push(`# !units: ${unitLabel(units)}`);
    lines.push(`# !longitude: ${station.longitude.toFixed(4)}`);
    lines.push(`# !latitude: ${station.latitude.toFixed(4)}`);

    // Station name
    lines.push(formatStationName(station));

    // Time zone: phases are in UTC, so meridian is 0:00
    // libtcd has a 30-byte tzfile limit (29 chars + null)
    lines.push(`0:00 ${tcdTimezone(station.timezone)}`);

    // Datum offset Z₀: mean sea level above the station's chart datum
    const msl = station.datums?.["MSL"] ?? 0;
    const datumValue = station.datums?.[chartDatum] ?? 0;
    const datumOffset = convertLength(msl - datumValue, units);
    lines.push(`${datumOffset.toFixed(4)} ${unitLabel(units)}`);

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
        const amp = convertLength(hc.amplitude, units);
        lines.push(
          `${name.padEnd(10)}     ${amp.toFixed(4).padStart(7)}  ${hc.phase.toFixed(2).padStart(6)}`,
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

function addOffsetElements(
  parent: ReturnType<typeof create>,
  timeOffset: number,
  heightOffset: number,
  heightType: string,
  units: UnitSystem,
) {
  if (timeOffset !== 0) {
    parent.ele("timeadd").att("value", formatTimeOffset(timeOffset)).up();
  }
  if (heightType === "fixed" && heightOffset !== 0) {
    parent
      .ele("leveladd")
      .att("value", convertLength(heightOffset, units).toFixed(3))
      .att("units", unitLabel(units))
      .up();
  }
  if (heightType === "ratio" && heightOffset !== 0 && heightOffset !== 1) {
    parent.ele("levelmultiply").att("value", heightOffset.toFixed(3)).up();
  }
}

function generateOffsetsXml(
  stations: Station[],
  referenceStations: Station[],
  units: UnitSystem,
): string {
  const doc = create({ version: "1.0", encoding: "ISO-8859-1" });

  doc.com(" Tide database subordinate stations ");
  doc.com(
    " Generated by tide-database (https://openwaters.io/tides/database) ",
  );
  doc.com(`

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

`);

  const root = doc.ele("document");

  // Build a map of reference station names for subordinate station references
  const refNameMap = new Map<string, string>();
  for (const station of referenceStations) {
    refNameMap.set(station.id, formatStationName(station));
  }

  const subordinateStations = stations.filter(
    (s) => s.type === "subordinate" && s.offsets,
  );
  console.error(
    `Writing ${subordinateStations.length} subordinate station records...`,
  );

  for (const station of subordinateStations) {
    const offsets = station.offsets!;
    const refName = refNameMap.get(offsets.reference);

    if (!refName) {
      console.error(
        `WARNING: Subordinate station "${station.name}" references unknown station "${offsets.reference}", skipping`,
      );
      continue;
    }

    const stationName = formatStationName(station);

    const el = root
      .ele("subordinatestation")
      .att("name", stationName)
      .att("latitude", station.latitude.toFixed(4))
      .att("longitude", station.longitude.toFixed(4))
      .att("timezone", station.timezone)
      .att("country", station.country ?? "")
      .att("source", station.source.name)
      .att("restriction", "Public Domain")
      .att("station_id_context", station.id.split("/")[0]!)
      .att("station_id", station.source.id)
      .att("reference", refName);

    // Determine if we need simple or complex offsets
    const timeHigh = offsets.time?.high ?? 0;
    const timeLow = offsets.time?.low ?? 0;
    const heightType = offsets.height?.type ?? "ratio";
    const heightHigh = offsets.height?.high ?? (heightType === "ratio" ? 1 : 0);
    const heightLow = offsets.height?.low ?? (heightType === "ratio" ? 1 : 0);

    const isSimple = timeHigh === timeLow && heightHigh === heightLow;

    if (isSimple) {
      const simple = el.ele("simpleoffsets");
      addOffsetElements(simple, timeHigh, heightHigh, heightType, units);
      simple.up();
    } else {
      const offsetsEl = el.ele("offsets");

      const max = offsetsEl.ele("max");
      addOffsetElements(max, timeHigh, heightHigh, heightType, units);
      max.up();

      const min = offsetsEl.ele("min");
      addOffsetElements(min, timeLow, heightLow, heightType, units);
      min.up();

      offsetsEl.up();
    }

    el.up();
  }

  return doc.end({ prettyPrint: true }) + "\n";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.error("Loading stations...");

  const tideStations = stations.filter((s: Station) => s.kind !== "current");
  const referenceStations = tideStations.filter(
    (s: Station) => s.type === "reference",
  );
  const subordinateStations = tideStations.filter(
    (s: Station) => s.type === "subordinate",
  );

  console.error(
    `Found ${tideStations.length} stations (${referenceStations.length} reference, ${subordinateStations.length} subordinate)`,
  );

  console.error("Building master constituent list...");
  const masterConstituents = buildConstituentList(tideStations);
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

  // Generate output files for both unit systems
  await mkdir(outDir, { recursive: true });

  for (const units of ["metric", "imperial"] as UnitSystem[]) {
    const suffix = units === "metric" ? "-metric" : "-imperial";

    console.error(`\nGenerating harmonics${suffix}.txt...`);
    const harmonicsTxt = generateHarmonicsTxt(
      tideStations,
      masterConstituents,
      units,
    );

    console.error(`Generating offsets${suffix}.xml...`);
    const offsetsXml = generateOffsetsXml(
      tideStations,
      referenceStations,
      units,
    );

    const harmonicsPath = join(outDir, `harmonics${suffix}.txt`);
    const offsetsPath = join(outDir, `offsets${suffix}.xml`);

    await writeFile(harmonicsPath, harmonicsTxt, "utf-8");
    await writeFile(offsetsPath, offsetsXml, "utf-8");

    console.error(`Wrote ${harmonicsPath}`);
    console.error(`Wrote ${offsetsPath}`);

    const harmonicsLines = harmonicsTxt.split("\n").length;
    const offsetsLines = offsetsXml.split("\n").length;
    console.error(
      `  harmonics${suffix}.txt: ${harmonicsLines} lines (${(harmonicsTxt.length / 1024 / 1024).toFixed(1)} MB)`,
    );
    console.error(
      `  offsets${suffix}.xml: ${offsetsLines} lines (${(offsetsXml.length / 1024).toFixed(1)} KB)`,
    );
  }

  console.error(`\nReference stations: ${referenceStations.length}`);
  console.error(
    `Subordinate stations: ${subordinateStations.filter((s) => s.offsets).length}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
