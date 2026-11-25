// Compares hourly heights predicted from the database's NOAA constants with
// NOAA's own hourly predictions, once with IHO's nodal corrections and the
// engine's catalog and once with what the database declares for NOAA
// (Schureman's corrections and NOAA's own definitions). Changes no tracked
// file, and fetches NOAA's current predictions on every run.
//
//   npm run report:predictions -w sources/noaa
//
// NOAA takes f and u once a year and the engine at each hour, so neither run
// reproduces NOAA exactly; the comparison is between the two runs.

import { createTidePredictor } from "@slackwater/engine";
import { loadStations } from "@slackwater/database";

// The 20 reference stations of NOAA's calibration (#426): strong diurnal
// tides in the Pacific Northwest and Alaska, and every other coast.
const STATIONS = [
  "9449880",
  "9455920",
  "9435380",
  "9462620",
  "9410170",
  "9447130",
  "8443970",
  "8518750",
  "8724580",
  "8771450",
  "1612340",
  "8665530",
  "9452210",
  "8729840",
  "8651370",
  "9414290",
  "9439040",
  "9457292",
  "9451600",
  "8410140",
];
// Two seasons of one year, and a month near the other end of the nodal cycle.
const MONTHS = [
  ["20260101", "20260131"],
  ["20260701", "20260731"],
  ["20301201", "20301231"],
];

const rms = (e: number[]) =>
  Math.sqrt(e.reduce((sum, x) => sum + x * x, 0) / e.length);
const largest = (e: number[]) => Math.max(...e.map(Math.abs));
const mm = (m: number) => (m * 1000).toFixed(1);

const db = await loadStations();
console.log(
  "| Station | IHO RMS (mm) | IHO largest | Declared RMS | Declared largest |",
);
console.log("| --- | --: | --: | --: | --: |");
for (const id of STATIONS) {
  const station = db.all.find(
    (s) =>
      s.source?.id === id &&
      s.source.url.includes("noaa.gov") &&
      s.type === "reference",
  );
  if (!station) throw new Error(`no NOAA reference station ${id}`);
  // A database built before NOAA declared its set would compare IHO with IHO.
  if (station.node_corrections !== "schureman")
    throw new Error(
      `${id} reads ${station.node_corrections}, not schureman; rebuild the database (npm run build -w packages/database)`,
    );
  const iho = createTidePredictor(station.harmonic_constituents);
  const declared = createTidePredictor(station.harmonic_constituents, {
    ...(station.constituent_definitions
      ? { definitions: station.constituent_definitions }
      : {}),
    nodeCorrections: station.node_corrections,
  });
  const ihoErrors: number[] = [];
  const declaredErrors: number[] = [];
  for (const [begin, end] of MONTHS) {
    const url = `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=predictions&interval=h&datum=MSL&units=metric&time_zone=gmt&format=json&station=${id}&begin_date=${begin}&end_date=${end}`;
    const body = (await (await fetch(url)).json()) as {
      predictions?: { t: string; v: string }[];
      error?: { message: string };
    };
    if (!body.predictions?.length)
      throw new Error(
        `${id} ${begin}: ${body.error?.message ?? "no predictions"}`,
      );
    for (const { t, v } of body.predictions) {
      const time = new Date(`${t.replace(" ", "T")}:00Z`);
      ihoErrors.push(iho.getWaterLevelAtTime({ time }).level - Number(v));
      declaredErrors.push(
        declared.getWaterLevelAtTime({ time }).level - Number(v),
      );
    }
  }
  console.log(
    `| ${station.name} (${id}) | ${mm(rms(ihoErrors))} | ${mm(largest(ihoErrors))} | ${mm(rms(declaredErrors))} | ${mm(largest(declaredErrors))} |`,
  );
}
