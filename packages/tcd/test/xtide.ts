/**
 * XTide Docker interface for running tide predictions from TCD files.
 */

import { execFileSync } from "child_process";

export interface TideEvent {
  time: Date;
  // For currents, high is max flood and low is max ebb
  type: "high" | "low";
  height: number; // meters, or knots for currents
  units?: string; // as printed by XTide, e.g. "m" or "kt"
}

export type TcdVariant = "metric" | "imperial";

/**
 * Format a date for XTide command line (YYYY-MM-DD HH:MM)
 */
function formatXTideDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

/**
 * Parse XTide CSV output format.
 * Example line: "BOSTON, MA, United States",2026-01-01,8:35 AM EST,2.87 m,"High Tide"
 * Format: Location,Date,Time,Value,Event
 */
function parseXTideCSV(output: string): TideEvent[] {
  const events: TideEvent[] = [];
  const lines = output.trim().split("\n");

  for (const line of lines) {
    if (!line.trim() || line.startsWith("#") || line.startsWith("Location,")) {
      continue; // Skip comments and header
    }

    // Parse CSV with quoted fields
    const parts = line.match(/("([^"]*)"|[^,]+)/g);
    if (!parts || parts.length < 5) continue;

    const dateStr = parts[1]?.replace(/"/g, "").trim();
    const timeStr = parts[2]?.replace(/"/g, "").trim();
    const valueStr = parts[3]?.replace(/"/g, "").trim();
    const eventStr = parts[4]?.replace(/"/g, "").trim();

    if (!dateStr || !timeStr || !eventStr) continue;

    // Only process tide and current extremes
    const isTide = eventStr.includes("Tide");
    const isCurrent = eventStr === "Max Flood" || eventStr === "Max Ebb";
    if (!isTide && !isCurrent) continue;

    // Parse date and time
    // Format: "2026-01-01" and "8:35 AM EST"
    // We need to convert to UTC
    const dateTimeStr = `${dateStr} ${timeStr}`;
    const time = new Date(dateTimeStr);
    if (isNaN(time.getTime())) {
      console.warn(`Could not parse date: ${dateTimeStr}`);
      continue;
    }

    // Parse height (format: "2.87 m", "-0.42 m", or "1.73 kt")
    const heightMatch = valueStr?.match(/(-?\d+\.?\d*)\s*(\S*)/);
    if (!heightMatch) continue;
    const height = parseFloat(heightMatch[1]!);
    if (isNaN(height)) continue;

    // Determine type
    const type =
      eventStr.toLowerCase().includes("high") || eventStr === "Max Flood"
        ? "high"
        : "low";

    events.push({ time, type, height, units: heightMatch[2]! });
  }

  return events;
}

/**
 * Get tide predictions from XTide using the built TCD file.
 *
 * @param stationName - Full station name as it appears in the TCD (e.g., "Boston, MA, United States")
 * @param startDate - Start date for predictions
 * @param endDate - End date for predictions
 * @returns Array of tide events (high/low)
 */
export function getXTidePredictions(
  stationName: string,
  startDate: Date,
  endDate: Date,
  variant: TcdVariant = "metric",
): TideEvent[] {
  const startStr = formatXTideDate(startDate);
  const endStr = formatXTideDate(endDate);

  // Run XTide via Docker using execFileSync for safety
  const args = [
    ...xtideCommand(variant),
    // -l: location
    "-l",
    stationName,
    // -b: begin time
    "-b",
    startStr,
    // -e: end time
    "-e",
    endStr,
    // -f c: CSV format
    "-f",
    "c",
    // -m p: mode=plain (no colors/formatting)
    "-m",
    "p",
    // -u m: units=meters
    "-u",
    "m",
  ];

  try {
    console.log("Running XTide command:", ["docker", ...args]);
    const output = execFileSync("docker", args, {
      encoding: "utf-8",
      cwd: process.cwd(),
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large outputs
    });

    return parseXTideCSV(output);
  } catch (error: any) {
    throw new Error(
      `XTide command failed for station "${stationName}": ${error.message}`,
    );
  }
}

/**
 * Get XTide's "about" listing for a station as a map of field to value, e.g.
 * "Coordinates", "Reference", "Native units", "Flood direction".
 */
export function getXTideAbout(
  stationName: string,
  variant: TcdVariant = "metric",
): Map<string, string> {
  const output = execFileSync(
    "docker",
    [...xtideCommand(variant), "-l", stationName, "-m", "a"],
    { encoding: "latin1", cwd: process.cwd() },
  );

  const fields = new Map<string, string>();
  for (const line of output.split("\n")) {
    const match = line.match(/^(\S+(?: \S+)*)\s{2,}(.*)$/);
    if (match && !fields.has(match[1]!)) {
      fields.set(match[1]!, match[2]!.trim());
    }
  }
  return fields;
}

function xtideCommand(variant: TcdVariant): string[] {
  return [
    "compose",
    "run",
    "--rm",
    "-e",
    `HFILE_PATH=/data/harmonics-${variant}.tcd`,
    "xtide",
  ];
}

/**
 * Check if XTide Docker image is available.
 */
export function checkXTideAvailable(): boolean {
  try {
    execFileSync("docker", ["compose", "config", "xtide"], {
      stdio: "ignore",
      cwd: process.cwd(),
    });
    return true;
  } catch {
    return false;
  }
}
