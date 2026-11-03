import { constituents as catalogue } from "@slackwater/engine";
import { computeDatums, toFixed } from "@slackwater/datums";
import { normalize, sourceMetadata } from "@slackwater/stations";
import type { StationData } from "@slackwater/database";
import names from "./names.json" with { type: "json" };
import { resolveConstituent } from "../jhod/jhod.ts";

export const YEAR = 2026;
export const SOURCE_NAME = "Japan Meteorological Agency";
export const INDEX_URL = `https://www.data.jma.go.jp/gmd/kaiyou/db/tide/suisan/station${YEAR}.php`;
export const constantsUrl = (id: string) =>
  new URL(`harms60.php?stn=${id}&year=${YEAR}&tyear=${YEAR}`, INDEX_URL).href;
export type Gauge = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  z0: number;
};
export type Harmonics = Gauge & {
  epoch: NonNullable<StationData["epoch"]>;
  seasonalEpoch: NonNullable<StationData["epoch"]>;
  constituents: StationData["harmonic_constituents"];
};
function text(html: string) {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim();
}
function number(value: string | undefined) {
  if (!value || !/^-?\d+(?:\.\d+)?$/.test(value))
    throw new Error(`Invalid number: ${value}`);
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error(`Invalid number: ${value}`);
  return result;
}
function rows(html: string) {
  return [...html.matchAll(/<tr\b[^>]*>(.*?)<\/tr>/gis)].map((m) =>
    [...m[1]!.matchAll(/<t[dh]\b[^>]*>(.*?)<\/t[dh]>/gis)].map((c) =>
      text(c[1]!),
    ),
  );
}
export function parseInventory(html: string): Gauge[] {
  const gauges = [...html.matchAll(/<tr\b[^>]*>(.*?)<\/tr>/gis)]
    .filter((m) => m[1]!.includes("harms60.php"))
    .map((m) => {
      const row = rows(m[0])[0]!;
      const id = /harms60\.php\?stn=([A-Z0-9]{2})/.exec(m[1]!)?.[1];
      const coordinate = (value: string | undefined) => {
        const c = /^(\d+)゜(\d+)'$/.exec(value ?? "");
        if (!c || Number(c[2]) >= 60) throw new Error("Invalid coordinates");
        return Number(c[1]) + Number(c[2]) / 60;
      };
      if (!id || id !== row[1] || row.length !== 18)
        throw new Error("Invalid inventory row");
      return {
        id,
        name: row[2]!,
        latitude: coordinate(row[3]),
        longitude: coordinate(row[4]),
        z0: toFixed(number(row[5]) / 100, 3),
      };
    });
  if (!gauges.length || new Set(gauges.map((g) => g.id)).size !== gauges.length)
    throw new Error("Empty or duplicate inventory");
  for (const g of gauges) {
    if (
      !g.name ||
      !(g.id in names) ||
      g.latitude < 20 ||
      g.latitude > 46 ||
      g.longitude < 122 ||
      g.longitude > 154 ||
      g.z0 < 0
    )
      throw new Error(`Unreviewed or invalid gauge: ${g.id}`);
  }
  return gauges;
}
function period(html: string, kind: string) {
  const raw = new RegExp(kind + "周期（年）([^<]*)").exec(html)?.[1]?.trim();
  if (!raw || !/^\d{4}(?:-\d{2})?(?:,\d{2}(?:-\d{2})?)*$/.test(raw))
    throw new Error("Missing analysis years");
  const parts = raw.split(/[-,]/).map(Number),
    start = parts[0]!;
  const years = [start];
  for (const short of parts.slice(1)) {
    let year = Math.floor(years.at(-1)! / 100) * 100 + short;
    if (year < years.at(-1)!) year += 100;
    years.push(year);
  }
  if (
    start < 1900 ||
    years.some((y, i) => y > YEAR || (i > 0 && y < years[i - 1]!))
  )
    throw new Error("Invalid analysis years");
  return { start: `${start}-01-01`, end: `${years.at(-1)}-12-31` };
}
export function parseHarmonics(html: string, gauge: Gauge): Harmonics {
  if (
    !html.includes("遅角は現地子午線を基準にしています。") ||
    !html.includes(`分潮一覧表 ${gauge.name}</title>`)
  )
    throw new Error("Missing phase reference or station mismatch");
  const lon = /経度<\/h3>.*?(\d+)度 (\d+)分 (\d+)秒/s.exec(html);
  if (!lon || Number(lon[2]) >= 60 || Number(lon[3]) >= 60)
    throw new Error("Missing longitude");
  const longitude =
    Number(lon[1]) + Number(lon[2]) / 60 + Number(lon[3]) / 3600;
  if (Math.abs(longitude - gauge.longitude) > 1 / 60)
    throw new Error("Longitude mismatch");
  const table = /<table[^>]*summary="60分潮一覧"[^>]*>(.*?)<\/table>/s.exec(
    html,
  )?.[1];
  if (
    !table ||
    !table.includes("振幅（cm）") ||
    !table.includes("速度（度/時）") ||
    !table.includes("遅角（°）")
  )
    throw new Error("Missing constituent table or units");
  const data = rows(table).slice(1);
  if (data.length !== 60 || data.some((r) => r.length !== 4))
    throw new Error("Expected 60 constituent rows");
  const constituents = data.map((row) => {
    const published = row[0]!.split(/\s|\(/)[0]!.replace("ψ", "Ψ");
    const name = resolveConstituent(published, number(row[1]));
    const amplitude = number(row[2]) / 100,
      phase = number(row[3]);
    if (amplitude < 0 || phase < 0 || phase > 360)
      throw new Error("Invalid amplitude or phase");
    const species = catalogue[name]!.coefficients?.[0];
    if (typeof species !== "number") throw new Error("Missing tidal species");
    // JMA explicitly references the local meridian: G = kappa - species * east longitude.
    const greenwich = phase - species * longitude;
    return {
      name,
      amplitude: toFixed(amplitude, 4),
      phase: toFixed(((greenwich % 360) + 360) % 360, 11),
    };
  });
  if (new Set(constituents.map((c) => c.name)).size !== 60)
    throw new Error("Duplicate constituents");
  return {
    ...gauge,
    longitude,
    epoch: period(html, "短"),
    seasonalEpoch: period(html, "長"),
    constituents,
  };
}
export function buildStation(h: Harmonics): StationData {
  const { datums } = computeDatums(h.constituents, {});

  return normalize({
    name: (names as Record<string, string>)[h.id]!,
    latitude: h.latitude,
    longitude: h.longitude,
    country: "Japan",
    type: "reference",
    source: {
      name: SOURCE_NAME,
      id: h.id,
      url: constantsUrl(h.id),
      published_harmonics: true,
    },
    license: {
      type: "cc-by-4.0",
      commercial_use: true,
      url: "https://creativecommons.org/licenses/by/4.0/",
    },
    disclaimers: sourceMetadata(SOURCE_NAME).credit!,
    chart_datum: "CD",
    datums: { ...datums, MSL: 0, CD: -h.z0 },
    datums_source: "harmonic",
    harmonic_constituents: h.constituents,
    epoch: h.epoch,
  });
}

export function parsePredictions(html: string) {
  if (!html.includes("潮位表基準面上の値") || !html.includes("単位：センチ"))
    throw new Error("Missing prediction datum or units");
  const data = rows(html).filter((row) =>
    /^\d{4}\/\d{2}\/\d{2}/.test(row[0] ?? ""),
  );
  if (data.length !== 7 || data.some((row) => row.length !== 25))
    throw new Error("Incomplete hourly predictions");
  const first = new Date(
    data[0]![0]!.slice(0, 10).replaceAll("/", "-") + "T00:00:00+09:00",
  );
  for (const [i, row] of data.entries()) {
    const date = row[0]!.slice(0, 10).replaceAll("/", "-");
    const parsed = new Date(date + "T00:00:00+09:00");
    if (
      !Number.isFinite(+parsed) ||
      +parsed !== +first + i * 86400000 ||
      new Date(+parsed + 9 * 3600000).toISOString().slice(0, 10) !== date
    )
      throw new Error("Invalid prediction dates");
  }
  return data.flatMap((row) => {
    const date = row[0]!.slice(0, 10).replaceAll("/", "-");
    return row.slice(1).map((v, hour) => ({
      time: new Date(`${date}T${String(hour).padStart(2, "0")}:00:00+09:00`),
      level: number(v) / 100,
    }));
  });
}
