import { normalize, predictionOptions } from "@slackwater/stations";
import { computeDatums, toFixed } from "@slackwater/datums";
import type { StationData } from "@slackwater/database";
import { constituents as catalogue } from "@slackwater/engine";

const SOURCE_NAME = "Toitū Te Whenua Land Information New Zealand";

export type LinzHarmonics = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  epoch: NonNullable<StationData["epoch"]>;
  /** Mean sea level above chart datum, in metres. */
  z0: number;
  constituents: StationData["harmonic_constituents"];
};

const LINZ_SOURCE =
  "https://www.linz.govt.nz/products-services/data/types-linz-data/sea-level-data/tide-constituents";
// The wording LINZ's copyright page asks for on adapted data.
const LINZ_CREDIT =
  "This work is based on Toitū Te Whenua Land Information New Zealand data which are licensed by Toitū Te Whenua Land Information New Zealand for re-use under the Creative Commons Attribution 4.0 International licence.";
const SPEED_TOLERANCE = 0.0001;

// Header positions LINZ prints wrongly, as DDMM. Nelson's 1416 drops the 4
// of 41°16′S; its tide tables and TICON's Nelson gauge both put it at 41°16′.
const LATITUDE_FIXES: Record<string, string> = { "077": "4116" };

// LINZ names that resolve to more than one catalogue entry by speed alone, or
// to none by name. Each pins the entry whose speed matches LINZ's frequency.
const OVERRIDES: Record<string, string> = {
  H1: "alpha2",
  H2: "M(KS)2",
  LDA2: "lambda2",
  SIG1: "sigma1",
  OQ2: "OQ2_KV",
};

const unique = [...new Set(Object.values(catalogue))];

export function resolveConstituent(name: string, speed: number): string {
  const override = OVERRIDES[name];
  const matches = unique.filter(
    (candidate) =>
      Math.abs(candidate.speed - speed) <= SPEED_TOLERANCE &&
      (override
        ? candidate.name === override
        : [candidate.name, ...candidate.aliases].some(
            (alias) => alias.toLowerCase() === name.toLowerCase(),
          )),
  );
  if (matches.length !== 1)
    throw new Error(`Unknown constituent: ${name} at ${speed} °/h`);
  return matches[0]!.name;
}

/** Degrees-minutes as LINZ prints them (`4117`) to signed decimal degrees. */
function degreesMinutes(value: string, sign: 1 | -1) {
  if (!/^\d{4,5}$/.test(value)) throw new Error(`Invalid position: ${value}`);
  const degrees = Number(value.slice(0, -2));
  const minutes = Number(value.slice(-2));
  if (minutes >= 60) throw new Error(`Invalid position: ${value}`);
  return sign * Number((degrees + minutes / 60).toFixed(6));
}

/** `d/mm/yy` from the analysis line to an ISO date. */
function analysisDate(value: string) {
  const [day, month, year] = value.split("/").map(Number) as [
    number,
    number,
    number,
  ];
  const fullYear = year >= 50 ? 1900 + year : 2000 + year;
  const date = new Date(Date.UTC(fullYear, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day)
    throw new Error(`Invalid analysis date: ${value}`);
  return date.toISOString().slice(0, 10);
}

// A row is fixed-width Fortran output, so a wide amplitude can run into the
// month-year field (`0106/1219134.2423`); match on structure, not whitespace.
const ROW =
  /^\s*\d+\s+(\S+)\s+(\d*\.\d+)\s+\d+\s+\d{4}\/\d{4}\s*(-?\d*\.\d+)\s+(-?\d*\.\d+)\s*$/;

/**
 * Parse one LINZ harmonic analysis file. `id` is the site number from the
 * file name; the header's own station number disagrees with it for some sites.
 */
export function parseHarmonics(text: string, id: string): LinzHarmonics {
  const lines = text.split(/\r?\n/);
  if (!/Units in CM\s*$/.test(lines[0] ?? ""))
    throw new Error(`${id}: expected amplitudes in cm`);

  const header =
    /TIME ZONE =\s*(\d+), LATITUDE =\s*(\d+), LONGITUDE =\s*(\d+)/.exec(
      lines[1] ?? "",
    );
  if (!header) throw new Error(`${id}: missing station header`);
  // LINZ gives the zone in degrees east, and phases are referred to it.
  const zoneHours = Number(header[1]) / 15;
  if (zoneHours !== 12) throw new Error(`${id}: unexpected zone ${header[1]}`);

  const latitude = degreesMinutes(LATITUDE_FIXES[id] ?? header[2]!, -1);
  const longitude = degreesMinutes(header[3]!, 1);
  if (latitude > -29 || latitude < -53 || longitude < 165 || longitude > 179)
    throw new Error(`${id}: position outside New Zealand: ${header[2]}`);

  const analysis =
    /(\d{1,2}\/\d{2}\/\d{2}) TO\s+\d+H\s+(\d{1,2}\/\d{2}\/\d{2})/.exec(text);
  if (!analysis) throw new Error(`${id}: missing analysis period`);

  let z0: number | undefined;
  const constituents: StationData["harmonic_constituents"] = [];
  const table = lines.findIndex((line) => /^\s*NO NAME/.test(line));
  if (table === -1) throw new Error(`${id}: missing constituent table`);
  for (const line of lines.slice(table + 1)) {
    if (!line.trim()) continue;
    const row = ROW.exec(line);
    if (!row) throw new Error(`${id}: unreadable constituent row: ${line}`);
    const [, name, frequency, amplitude, phase] = row as unknown as [
      string,
      string,
      string,
      string,
      string,
    ];
    if (name === "Z0") {
      z0 = Number(amplitude) / 100;
      continue;
    }
    // Frequency is in cycles per hour.
    const speed = Number(frequency) * 360;
    constituents.push({
      name: resolveConstituent(name, speed),
      amplitude: toFixed(Number(amplitude) / 100, 6),
      // Phases are referred to NZST (UTC+12); move them to Greenwich.
      phase: toFixed(
        (((Number(phase) - speed * zoneHours) % 360) + 360) % 360,
        4,
      ),
    });
  }
  if (z0 === undefined) throw new Error(`${id}: missing Z0`);
  if (!constituents.some(({ name }) => name === "M2"))
    throw new Error(`${id}: missing M2`);

  // LINZ squashes many names (`PORTCHALMERS`); station files curate them.
  const name = (lines[0] ?? "")
    .replace(/\s*Units in CM\s*$/, "")
    .trim()
    .toLowerCase()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
  if (!name) throw new Error(`${id}: missing site name`);

  return {
    id,
    name,
    latitude,
    longitude,
    epoch: {
      start: analysisDate(analysis[1]!),
      end: analysisDate(analysis[2]!),
    },
    z0,
    constituents,
  };
}

/** The site number from a LINZ file name, such as `043PICTON_Harm_2005-2025.txt`. */
export function siteId(fileName: string) {
  const match = /^(\d+)/.exec(fileName);
  if (!match) throw new Error(`No site number in ${fileName}`);
  return match[1]!.padStart(3, "0");
}

export function buildStation(harmonics: LinzHarmonics): StationData {
  // Synthesised over the pinned datum epoch in the MSL = 0 frame, then lifted
  // by LINZ's observed MSL above chart datum, the zero of its predictions.
  const { datums } = computeDatums(
    harmonics.constituents,
    {},
    predictionOptions({
      source: { name: SOURCE_NAME },
      latitude: harmonics.latitude,
    }),
  );
  const shifted = Object.fromEntries(
    Object.entries(datums).map(([key, value]) => [
      key,
      toFixed(value + harmonics.z0, 3),
    ]),
  );

  return normalize({
    name: harmonics.name,
    latitude: harmonics.latitude,
    longitude: harmonics.longitude,
    country: "New Zealand",
    type: "reference",
    chart_datum: "CD",
    source: {
      name: SOURCE_NAME,
      id: harmonics.id,
      published_harmonics: true,
      url: LINZ_SOURCE,
    },
    license: {
      type: "cc-by-4.0",
      commercial_use: true,
      url: "https://creativecommons.org/licenses/by/4.0/",
      notes:
        "LINZ asks that attribution be in writing and not use its logo: https://www.linz.govt.nz/copyright",
    },
    disclaimers: LINZ_CREDIT,
    datums: { ...shifted, MSL: toFixed(harmonics.z0, 3), CD: 0 },
    datums_source: "harmonic",
    harmonic_constituents: harmonics.constituents,
    epoch: harmonics.epoch,
  });
}
