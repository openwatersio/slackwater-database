import * as flatbuffers from "flatbuffers";
import { getDatabaseBytes } from "#database-bytes";
import { Constituent } from "./generated/fbs/neaps/constituent.ts";
import { Datum } from "./generated/fbs/neaps/datum.ts";
import { DatumsSource } from "./generated/fbs/neaps/datums-source.ts";
import { HeightOffsetType } from "./generated/fbs/neaps/height-offset-type.ts";
import { StationType } from "./generated/fbs/neaps/station-type.ts";
import { TideDatabase } from "./generated/fbs/neaps/tide-database.ts";
import { NO_CHART_DATUM } from "./database/builder.js";
import quality from "../quality.json" with { type: "json" };
import type { HarmonicConstituent, Station, StationData } from "./types.js";

// The whole database is one FlatBuffers file (schemas/tide-database.fbs). On
// Node the bytes are a Buffer — external memory, off the V8 heap; in the
// browser an ArrayBuffer from fetch. Identity fields are materialized into
// plain objects once, below; the prediction data (harmonic_constituents,
// datums, epoch) is decoded from the buffer only when a station's fields are
// accessed, so importing this module holds no prediction data on the heap.
const db = TideDatabase.getRootAsTideDatabase(
  new flatbuffers.ByteBuffer(await getDatabaseBytes()),
);

const constituentNames: string[] = Array.from(
  { length: db.constituentNamesLength() },
  (_, i) => db.constituentNames(i),
);

/** All datum keys present across the database (e.g. "MLLW", "MSL", "NAVD88"). */
export const datums: string[] = Array.from(
  { length: db.datumNamesLength() },
  (_, i) => db.datumNames(i),
);

const indexById = new Map<string, number>();

// Stations that predict from another station's harmonics (subordinates use
// their reference station); resolve an id to the buffer index of its record.
function dataIndex(station: Station): number {
  const id =
    station.type === "subordinate" && station.offsets
      ? station.offsets.reference
      : station.id;
  const index = indexById.get(id);
  if (index === undefined) throw new Error(`No data record for station ${id}`);
  return index;
}

function readConstituents(index: number): HarmonicConstituent[] {
  const table = db.stations(index)!;
  const constituent = new Constituent();
  return Array.from({ length: table.constituentsLength() }, (_, i) => {
    table.constituents(i, constituent);
    return {
      name: constituentNames[constituent.name()]!,
      amplitude: constituent.amplitude(),
      phase: constituent.phase(),
    };
  });
}

function readDatums(index: number): Record<string, number> {
  const table = db.stations(index)!;
  const datum = new Datum();
  const result: Record<string, number> = {};
  for (let i = 0; i < table.datumsLength(); i++) {
    table.datums(i, datum);
    result[datums[datum.name()]!] = datum.value();
  }
  return result;
}

function readEpoch(index: number): StationData["epoch"] {
  const table = db.stations(index)!;
  const start = table.epochStart();
  const end = table.epochEnd();
  return start && end ? { start, end } : undefined;
}

function readStation(index: number): Station {
  const t = db.stations(index)!;

  const station = { id: t.id()! } as Station;
  station.name = t.name()!;
  station.latitude = t.latitude();
  station.longitude = t.longitude();
  const region = t.region();
  if (region !== null) station.region = region;
  station.country = t.country()!;
  station.continent = t.continent()!;
  station.timezone = t.timezone()!;
  station.type =
    t.type() === StationType.Subordinate ? "subordinate" : "reference";
  station.disclaimers = t.disclaimers()!;

  const chartDatum = t.chartDatum();
  if (chartDatum !== NO_CHART_DATUM) station.chart_datum = datums[chartDatum]!;
  if (t.datumsSource() === DatumsSource.Observed)
    station.datums_source = "observed";
  else if (t.datumsSource() === DatumsSource.Harmonic)
    station.datums_source = "harmonic";

  const source = t.source();
  if (source) {
    station.source = {
      name: source.name()!,
      id: source.id()!,
      published_harmonics: source.publishedHarmonics(),
      url: source.url()!,
    };
  }

  const license = t.license();
  if (license) {
    station.license = {
      type: license.type()!,
      commercial_use: license.commercialUse(),
      url: license.url()!,
    };
    const notes = license.notes();
    if (notes !== null) station.license.notes = notes;
  }

  const offsets = t.offsets();
  if (offsets) {
    station.offsets = {
      reference: offsets.reference()!,
      time: { high: offsets.timeHigh(), low: offsets.timeLow() },
      height: {
        high: offsets.heightHigh(),
        low: offsets.heightLow(),
        type:
          offsets.heightType() === HeightOffsetType.Fixed ? "fixed" : "ratio",
      },
    };
  }

  if (t.aliasesLength() > 0) {
    station.aliases = Array.from({ length: t.aliasesLength() }, (_, i) =>
      t.aliases(i),
    );
  }

  // Getters keep the sync API: reading these fields decodes one station's data
  // from the buffer. No caching — a persistent cache on these module-level
  // objects would pull the heavy data back onto the heap.
  Object.defineProperties(station, {
    harmonic_constituents: {
      enumerable: true,
      configurable: true,
      get: () => readConstituents(dataIndex(station)),
    },
    datums: {
      enumerable: true,
      configurable: true,
      get: () => readDatums(dataIndex(station)),
    },
    epoch: {
      enumerable: true,
      configurable: true,
      get: () => readEpoch(index),
    },
  });

  return station;
}

export const allStations: Station[] = Array.from(
  { length: db.stationsLength() },
  (_, i) => readStation(i),
);

allStations.forEach((station, i) => indexById.set(station.id, i));

export const stationsById = new Map(allStations.map((s) => [s.id, s]));

export const qualityMap = new Map(quality.map((s) => [s.id, s]));

export function qualityFilter(station: Station): boolean {
  return qualityMap.get(station.id)?.accepted ?? false;
}

export const stations: Station[] = allStations.filter(qualityFilter);
