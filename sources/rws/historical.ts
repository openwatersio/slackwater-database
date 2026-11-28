/**
 * Print how the historical Rijkswaterstaat series quality keeps, and the other
 * records on their stations, compare with Rijkswaterstaat's astronomical
 * predictions for January 2026, as sources/rws/README.md reports them. Each
 * series is tested at the nearest catalogue location within 3 km that has a
 * prediction, with both means removed.
 *
 * Usage: npm run report:historical -w sources/rws
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createTidePredictor,
  type HarmonicConstituent,
} from "@slackwater/engine";
import { readStationFiles } from "../../packages/stations/station-files.ts";

const API = "https://ddapi20-waterwebservices.rijkswaterstaat.nl";
const CATALOG_URL = `${API}/METADATASERVICES/OphalenCatalogus`;
const OBSERVATIONS_URL = `${API}/ONLINEWAARNEMINGENSERVICES/OphalenWaarnemingen`;
const PERIOD = {
  Begindatumtijd: "2026-01-01T00:00:00.000+00:00",
  Einddatumtijd: "2026-02-01T00:00:00.000+00:00",
};
const CUTOFF = "2018-01-01";
const MAX_KM = 3;
const LOCATIONS_TRIED = 12;
/** The service answers a busy client with a 429 and an empty body otherwise. */
const PAUSE_MS = 2500;
const BUSY_RETRIES = 5;

const root = join(import.meta.dirname, "..", "..");

type Place = { lat: number; lon: number };
type Location = Place & { code: string };
type Level = { time: Date; level: number };
type Series = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  epoch: { start: string; end: string };
  harmonic_constituents: HarmonicConstituent[];
};
export type Score = { rms: number; sd: number };

export function kilometres(a: Place, b: Place): number {
  const radians = Math.PI / 180;
  const x =
    (b.lon - a.lon) * radians * Math.cos(((a.lat + b.lat) / 2) * radians);
  return 6371 * Math.hypot(x, (b.lat - a.lat) * radians);
}

/** RMS of the prediction's difference from the provider's series, in metres,
 *  with each series' mean removed, and the provider series' spread. */
export function score(pairs: [provider: number, predicted: number][]): Score {
  const mean = (i: 0 | 1) =>
    pairs.reduce((sum, pair) => sum + pair[i], 0) / pairs.length;
  const [provider, predicted] = [mean(0), mean(1)];
  const square = (sum: number, value: number) => sum + value * value;
  return {
    rms: Math.sqrt(
      pairs.map(([a, b]) => a - provider - (b - predicted)).reduce(square, 0) /
        pairs.length,
    ),
    sd: Math.sqrt(
      pairs.map(([a]) => a - provider).reduce(square, 0) / pairs.length,
    ),
  };
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function post(url: string, body: unknown, retries = BUSY_RETRIES) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response.status === 429 && retries > 0) {
    await pause(15_000 * (BUSY_RETRIES - retries + 1));
    return post(url, body, retries - 1);
  }
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

async function prediction(code: string): Promise<Level[]> {
  const { WaarnemingenLijst = [] } = await post(OBSERVATIONS_URL, {
    Locatie: { Code: code },
    AquoPlusWaarnemingMetadata: {
      AquoMetadata: {
        Grootheid: { Code: "WATHTE" },
        ProcesType: "astronomisch",
      },
    },
    Periode: PERIOD,
  });
  const channel = WaarnemingenLijst.find(
    (c: { MetingenLijst?: unknown[] }) => (c.MetingenLijst?.length ?? 0) > 100,
  );
  return (channel?.MetingenLijst ?? [])
    .map(
      (m: { Tijdstip: string; Meetwaarde: { Waarde_Numeriek: number } }) => ({
        time: new Date(m.Tijdstip),
        level: m.Meetwaarde.Waarde_Numeriek / 100,
      }),
    )
    .filter(({ level }: Level) => Math.abs(level) < 50);
}

function read(id: string): Series {
  const path = join(root, "data", `${id}.json`);
  return { id, ...JSON.parse(readFileSync(path, "utf8")) };
}

async function compare(series: Series, locations: Location[]) {
  const here = { lat: series.latitude, lon: series.longitude };
  const near = locations
    .map((location) => ({ ...location, km: kilometres(here, location) }))
    .filter(({ km }) => km <= MAX_KM)
    .sort((a, b) => a.km - b.km)
    .slice(0, LOCATIONS_TRIED);
  const predictor = createTidePredictor(series.harmonic_constituents, {
    offset: false,
  });
  for (const location of near) {
    const levels = await prediction(location.code);
    await pause(PAUSE_MS);
    if (levels.length === 0) continue;
    const pairs = levels
      .filter((_, i) => i % 3 === 0)
      .map(({ time, level }): [number, number] => [
        level,
        predictor.getWaterLevelAtTime({ time }).level,
      ]);
    return { location, ...score(pairs) };
  }
  return undefined;
}

async function main() {
  const { LocatieLijst } = await post(CATALOG_URL, {
    CatalogusFilter: {
      Compartimenten: true,
      Grootheden: true,
      ProcesTypes: true,
    },
  });
  const locations: Location[] = LocatieLijst.map(
    (l: { Code: string; Lat: number; Lon: number }) => ({
      code: l.Code,
      lat: l.Lat,
      lon: l.Lon,
    }),
  );
  console.log("| Station | Record | RWS location | km | RMS cm | Tide SD cm |");
  console.log("| --- | --- | --- | --- | --- | --- |");
  for (const file of readStationFiles()) {
    const historical = file.sources.filter((id) => id.endsWith("-rws_hist"));
    if (!historical.some((id) => read(id).epoch.end >= CUTOFF)) continue;
    for (const id of file.sources) {
      const series = read(id);
      if (id.endsWith("-rws_hist") && series.epoch.end < CUTOFF) continue;
      const result = await compare(series, locations);
      const here = { lat: series.latitude, lon: series.longitude };
      const cells = result
        ? [
            `\`${result.location.code}\``,
            kilometres(here, result.location).toFixed(2),
            (result.rms * 100).toFixed(1),
            (result.sd * 100).toFixed(1),
          ]
        : ["none", "", "", ""];
      console.log(`| ${[file.slug, id, ...cells].join(" | ")} |`);
    }
  }
}

if (import.meta.main) await main();
