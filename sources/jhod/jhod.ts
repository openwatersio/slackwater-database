import { constituents as catalogue } from "@slackwater/engine";
import { computeDatums, toFixed } from "@slackwater/datums";
import {
  normalize,
  predictionOptions,
  sourceMetadata,
} from "@slackwater/stations";
import type { StationData } from "@slackwater/database";

export const SOURCE_NAME =
  "Japan Coast Guard, Hydrographic and Oceanographic Department";
export const INDEX_URL =
  "https://www1.kaiho.mlit.go.jp/TIDE/gauge/index_eng.php";
export const gaugeUrl = (id: string) =>
  new URL(`gauge_eng.php?s=${id}`, INDEX_URL).href;
export const constantsUrl = (id: string) =>
  new URL(`../harmonic/constants/hc_e.php?s=${id}`, INDEX_URL).href;

export type Gauge = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
};
type Epoch = NonNullable<StationData["epoch"]>;
export type Harmonics = Gauge & {
  z0: number;
  epoch: Epoch;
  seasonalEpoch: Epoch;
  constituents: StationData["harmonic_constituents"];
};

const greek: Record<string, string> = {
  σ: "sigma",
  ρ: "rho",
  χ: "chi",
  π: "pi",
  Ψ: "psi",
  φ: "phi",
  θ: "theta",
  μ: "mu",
  ν: "nu",
  λ: "lambda",
};
const unique = [...new Set(Object.values(catalogue))];

export function resolveConstituent(published: string, speed: number) {
  // JHOD's M1 is half M2, not the catalogue's lunar-elliptic M1.
  const name =
    published === "M1"
      ? "M1C"
      : published.replace(/[σρχπΨφθμνλ]/g, (char) => greek[char]!);
  const matches = unique.filter(
    (c) =>
      Math.abs(c.speed - speed) < 0.00001 &&
      [c.name, ...c.aliases].some(
        (alias) => alias.toLowerCase() === name.toLowerCase(),
      ),
  );
  if (matches.length !== 1)
    throw new Error(`Unknown constituent: ${published} at ${speed} °/h`);
  return matches[0]!.name;
}

function text(html: string) {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim();
}

// JHOD omits several closing tr tags, so split on opening rows.
function tableRows(html: string) {
  return html
    .split(/<tr\b[^>]*>/i)
    .slice(1)
    .map((row) =>
      [...row.matchAll(/<td\b[^>]*>(.*?)<\/td>/gis)].map((cell) =>
        text(cell[1]!),
      ),
    );
}

function number(value: string | undefined) {
  if (value === undefined || !/^-?\d+(?:\.\d+)?$/.test(value))
    throw new Error(`Invalid numeric value: ${value}`);
  const result = Number(value);
  if (!Number.isFinite(result))
    throw new Error(`Invalid numeric value: ${value}`);
  return result;
}

export function parseInventory(html: string): Gauge[] {
  const markers = html.split(/L\.marker\(/).slice(1);
  const gauges = markers.map((marker) => {
    const match =
      /^\s*\[([\d.-]+),\s*([\d.-]+)\].*?gauge_eng\.php\?s=(\d{4})'>([^<]+)<\/a>/s.exec(
        marker,
      );
    if (!match) throw new Error("Incomplete gauge inventory marker");
    const [, lat, lon, id, name] = match;
    const latitude = number(lat),
      longitude = number(lon);
    if (latitude < 20 || latitude > 46 || longitude < 122 || longitude > 154)
      throw new Error(`${id}: invalid Japanese gauge position`);
    return { id: id!, name: text(name!), latitude, longitude };
  });
  if (!gauges.length || new Set(gauges.map((g) => g.id)).size !== gauges.length)
    throw new Error("Empty or duplicate gauge inventory");
  return gauges;
}

function period(value: string | undefined): Epoch {
  if (!/^(?:\d{4}(?:-\d{4})?)(?: \d{4}(?:-\d{4})?)*$/.test(value ?? ""))
    throw new Error(`Invalid analysis period: ${value}`);
  const years = value!.split(/[ -]/).map(Number);
  if (
    years.some(
      (year, i) =>
        year < 1800 || year > 2200 || (i > 0 && year < years[i - 1]!),
    )
  )
    throw new Error(`Invalid analysis period: ${value}`);
  // Epoch is a span; Izuhara's seasonal analysis explicitly omits 2018.
  return { start: `${years[0]}-01-01`, end: `${years.at(-1)}-12-31` };
}

export function parseHarmonics(html: string, gauge: Gauge): Harmonics {
  const tables = [...html.matchAll(/<table\b[^>]*>(.*?)<\/table>/gis)].map(
    (match) => match[1]!,
  );
  const constants = tables.find(
    (table) => /Harmonic|Component/.test(table) && /Amplitude/.test(table),
  );
  if (
    !constants ||
    !/Amplitude\s*（cm）/.test(text(constants)) ||
    !/Phase\s*（°）/.test(text(constants))
  )
    throw new Error(`${gauge.id}: missing constituent table or units`);
  const title = /Harmonic Constant \(([^)]+)\)/.exec(html)?.[1];
  if (title !== gauge.name)
    throw new Error(`${gauge.id}: station name mismatch: ${title}`);
  const levels = tables.find(
    (table) => /Datum Level\(DL\)/.test(text(table)) && /Z0/.test(text(table)),
  );
  const levelRows =
    levels && tableRows(levels).filter((row) => row.length === 4);
  if (!levelRows || levelRows.length !== 1)
    throw new Error(`${gauge.id}: missing datum levels`);
  const [analysis, seasonal, gaugeZero, z0cm] = levelRows[0]!;
  number(gaugeZero);
  const z0 = number(z0cm) / 100;
  if (z0 < 0) throw new Error(`${gauge.id}: negative Z0`);
  const rows = tableRows(constants).filter((row) => row.length > 0);
  if (rows.length !== 60)
    throw new Error(`${gauge.id}: expected 60 constituents`);
  const constituents = rows.map((row, i) => {
    if (row.length !== 6 || number(row[0]) !== i + 1)
      throw new Error(`${gauge.id}: malformed constituent row`);
    const speed = number(row[3]),
      amplitude = number(row[4]) / 100,
      phase = number(row[5]);
    if (amplitude < 0 || phase < 0 || phase > 360)
      throw new Error(`${gauge.id}: invalid constituent amplitude or phase`);
    const name = resolveConstituent(row[1]!, speed);
    // G = κ − species × east longitude: https://www1.kaiho.mlit.go.jp/TIDE/harmonic/kaisetsu.html
    const species = catalogue[name]!.coefficients?.[0];
    if (typeof species !== "number")
      throw new Error(`${name}: missing tidal species`);
    const greenwich = phase - species * gauge.longitude;
    return {
      name,
      amplitude: toFixed(amplitude, 4),
      phase: toFixed(((greenwich % 360) + 360) % 360, 11),
    };
  });
  if (new Set(constituents.map((c) => c.name)).size !== 60)
    throw new Error(`${gauge.id}: duplicate constituents`);
  return {
    ...gauge,
    z0,
    epoch: period(analysis),
    seasonalEpoch: period(seasonal),
    constituents,
  };
}

export function buildStation(h: Harmonics): StationData {
  const { datums } = computeDatums(
    h.constituents,
    {},
    predictionOptions({ source: { name: SOURCE_NAME }, latitude: h.latitude }),
  );
  const shifted = Object.fromEntries(
    Object.entries(datums).map(([key, value]) => [
      key,
      toFixed(value + h.z0, 3),
    ]),
  );
  return normalize({
    name: h.name,
    latitude: h.latitude,
    longitude: h.longitude,
    country: "Japan",
    type: "reference",
    chart_datum: "NLLW",
    source: {
      name: SOURCE_NAME,
      id: h.id,
      url: constantsUrl(h.id),
      published_harmonics: true,
    },
    license: {
      type: "Government Standard Terms of Use 2.0",
      commercial_use: true,
      url: "https://www1.kaiho.mlit.go.jp/copyright.html",
    },
    disclaimers: sourceMetadata(SOURCE_NAME).credit!,
    datums: { ...shifted, MSL: h.z0, NLLW: 0 },
    datums_source: "harmonic",
    harmonic_constituents: h.constituents,
    epoch: h.epoch,
  });
}

export function parsePredictions(html: string) {
  const date = /Tidal curve【 (\d{4})\/(\d{2})\/(\d{2}) /.exec(html);
  const section = html
    .split("<h2>Hourly prediction</h2>")[1]
    ?.split("</table>")[0];
  if (
    !date ||
    !section ||
    !/Unit：cm/.test(section) ||
    !/TimeZone\s+-09 00\(JST\)/.test(text(html))
  )
    throw new Error("Missing prediction date, units or JST timezone");
  const rows = tableRows(section);
  const values = rows[1];
  if (
    !values ||
    values.length !== 25 ||
    values[0] !== String(Number(date[2])) + date[3]
  )
    throw new Error("Incomplete hourly prediction table");
  return values.slice(1).map((value, hour) => {
    const time = new Date(
      `${date[1]}-${date[2]}-${date[3]}T${String(hour).padStart(2, "0")}:00:00+09:00`,
    );
    if (!Number.isFinite(+time)) throw new Error("Invalid prediction date");
    return { time, level: number(value) / 100 };
  });
}
