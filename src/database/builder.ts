import * as flatbuffers from "flatbuffers";
import { Constituent } from "../generated/fbs/neaps/constituent.ts";
import { Current } from "../generated/fbs/neaps/current.ts";
import { Datum } from "../generated/fbs/neaps/datum.ts";
import { DatumsSource } from "../generated/fbs/neaps/datums-source.ts";
import { HeightOffsetType } from "../generated/fbs/neaps/height-offset-type.ts";
import { Kind } from "../generated/fbs/neaps/kind.ts";
import { License } from "../generated/fbs/neaps/license.ts";
import { Source } from "../generated/fbs/neaps/source.ts";
import { Station } from "../generated/fbs/neaps/station.ts";
import { StationType } from "../generated/fbs/neaps/station-type.ts";
import { TideDatabase } from "../generated/fbs/neaps/tide-database.ts";
import { TideOffsets } from "../generated/fbs/neaps/tide-offsets.ts";
import type { StationInput } from "../types.js";

/** Sentinel index meaning "no chart datum" (schema default for chart_datum). */
export const NO_CHART_DATUM = 0xffff;

/**
 * Serialize stations into the FlatBuffers database format
 * (schemas/tide-database.fbs). Stations are sorted by id — the vector key — so
 * readers can binary-search the buffer.
 *
 * Build order matters and the schema cannot express it: FlatBuffers writes back
 * to front, so the prediction data (constituents and datums vectors) is written
 * first for every station, landing together at the tail of the file, and the
 * station tables are written together after, landing at the head. A naive
 * per-station loop would interleave ~100 bytes of identity with ~1,300 bytes of
 * constituents, making an identity scan over a memory-mapped file fault in
 * every page. test/database.test.ts asserts the layout.
 */
export function buildDatabase(
  stations: StationInput[],
  { version }: { version?: string } = {},
): Uint8Array {
  // Ids are ASCII, so JS string order matches the byte-wise UTF-8 order
  // FlatBuffers key lookup expects.
  const sorted = [...stations].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );

  const constituentNames = nameTable(
    sorted.flatMap((s) => (s.harmonic_constituents ?? []).map((c) => c.name)),
  );
  const datumNames = nameTable(
    sorted.flatMap((s) => [
      ...Object.keys(s.datums ?? {}),
      ...(s.chart_datum ? [s.chart_datum] : []),
    ]),
  );

  const builder = new flatbuffers.Builder(1 << 22);

  // Phase 1: prediction data, together at the tail of the file.
  const prediction = sorted.map((s) => {
    let constituents = 0;
    const hcs = s.harmonic_constituents ?? [];
    if (hcs.length > 0) {
      Station.startConstituentsVector(builder, hcs.length);
      for (let i = hcs.length - 1; i >= 0; i--) {
        const hc = hcs[i]!;
        Constituent.createConstituent(
          builder,
          constituentNames.index.get(hc.name)!,
          hc.amplitude,
          hc.phase,
        );
      }
      constituents = builder.endVector();
    }

    let datums = 0;
    const entries = Object.entries(s.datums ?? {});
    if (entries.length > 0) {
      Station.startDatumsVector(builder, entries.length);
      for (let i = entries.length - 1; i >= 0; i--) {
        const [name, value] = entries[i]!;
        Datum.createDatum(builder, datumNames.index.get(name)!, value);
      }
      datums = builder.endVector();
    }

    return { constituents, datums };
  });

  // Phase 2: identity — strings, sub-tables, and the station tables themselves —
  // together at the head. Source and license tables repeat across most of a
  // catalog, so identical ones are written once and shared.
  const sourceOffsets = new Map<string, number>();
  const licenseOffsets = new Map<string, number>();
  const str = (v: string | undefined): number =>
    v === undefined ? 0 : builder.createSharedString(v);

  const stationOffsets = sorted.map((s, i) => {
    const id = builder.createString(s.id);
    const name = str(s.name);
    const timezone = str(s.timezone);
    const region = str(s.region);
    const country = str(s.country);
    const continent = str(s.continent);
    const disclaimers = str(s.disclaimers);
    const epochStart = str(s.epoch?.start);
    const epochEnd = str(s.epoch?.end);

    let aliases = 0;
    if (s.aliases?.length) {
      aliases = Station.createAliasesVector(
        builder,
        s.aliases.map((a) => builder.createSharedString(a)),
      );
    }

    let source = 0;
    if (s.source) {
      const { name, id, published_harmonics, url } = s.source;
      source = memo(sourceOffsets, s.source, () =>
        Source.createSource(
          builder,
          str(name),
          str(id),
          published_harmonics,
          str(url),
        ),
      );
    }

    let license = 0;
    if (s.license) {
      const { type, commercial_use, url, notes } = s.license;
      license = memo(licenseOffsets, s.license, () =>
        License.createLicense(
          builder,
          str(type),
          commercial_use,
          str(url),
          str(notes),
        ),
      );
    }

    let offsets = 0;
    if (s.offsets) {
      const reference = builder.createSharedString(s.offsets.reference);
      TideOffsets.startTideOffsets(builder);
      TideOffsets.addReference(builder, reference);
      TideOffsets.addTimeHigh(builder, s.offsets.time.high);
      TideOffsets.addTimeLow(builder, s.offsets.time.low);
      TideOffsets.addHeightHigh(builder, s.offsets.height.high);
      TideOffsets.addHeightLow(builder, s.offsets.height.low);
      if (s.offsets.height.type === "fixed")
        TideOffsets.addHeightType(builder, HeightOffsetType.Fixed);
      offsets = TideOffsets.endTideOffsets(builder);
    }

    let current = 0;
    if (s.current) {
      const c = s.current;
      const tideStation = str(c.tide_station);
      Current.startCurrent(builder);
      if (c.flood_direction !== undefined)
        Current.addFloodDirection(builder, c.flood_direction);
      if (c.ebb_direction !== undefined)
        Current.addEbbDirection(builder, c.ebb_direction);
      if (c.mean_flood_speed !== undefined)
        Current.addMeanFloodSpeed(builder, c.mean_flood_speed);
      if (c.mean_ebb_speed !== undefined)
        Current.addMeanEbbSpeed(builder, c.mean_ebb_speed);
      Current.addTideStation(builder, tideStation);
      if (c.min_before_flood !== undefined)
        Current.addMinBeforeFlood(builder, c.min_before_flood);
      if (c.min_before_ebb !== undefined)
        Current.addMinBeforeEbb(builder, c.min_before_ebb);
      if (c.flood_time !== undefined)
        Current.addFloodTime(builder, c.flood_time);
      if (c.ebb_time !== undefined) Current.addEbbTime(builder, c.ebb_time);
      if (c.flood_speed_ratio !== undefined)
        Current.addFloodSpeedRatio(builder, c.flood_speed_ratio);
      if (c.ebb_speed_ratio !== undefined)
        Current.addEbbSpeedRatio(builder, c.ebb_speed_ratio);
      current = Current.endCurrent(builder);
    }

    Station.startStation(builder);
    Station.addId(builder, id);
    Station.addName(builder, name);
    if (s.kind === "current") Station.addKind(builder, Kind.Current);
    if (s.type === "subordinate")
      Station.addType(builder, StationType.Subordinate);
    if (s.latitude !== undefined) Station.addLatitude(builder, s.latitude);
    if (s.longitude !== undefined) Station.addLongitude(builder, s.longitude);
    Station.addTimezone(builder, timezone);
    Station.addRegion(builder, region);
    Station.addCountry(builder, country);
    Station.addContinent(builder, continent);
    Station.addAliases(builder, aliases);
    Station.addConstituents(builder, prediction[i]!.constituents);
    Station.addDatums(builder, prediction[i]!.datums);
    Station.addChartDatum(
      builder,
      s.chart_datum ? datumNames.index.get(s.chart_datum)! : NO_CHART_DATUM,
    );
    if (s.datums_source === "observed")
      Station.addDatumsSource(builder, DatumsSource.Observed);
    else if (s.datums_source === "harmonic")
      Station.addDatumsSource(builder, DatumsSource.Harmonic);
    Station.addEpochStart(builder, epochStart);
    Station.addEpochEnd(builder, epochEnd);
    Station.addOffsets(builder, offsets);
    Station.addCurrent(builder, current);
    Station.addSource(builder, source);
    Station.addLicense(builder, license);
    Station.addDisclaimers(builder, disclaimers);
    return Station.endStation(builder);
  });

  // Phase 3: the root — stations vector and name tables — at the very head.
  const stationsVector = TideDatabase.createStationsVector(
    builder,
    stationOffsets,
  );
  const constituentNamesVector = TideDatabase.createConstituentNamesVector(
    builder,
    constituentNames.names.map((n) => builder.createSharedString(n)),
  );
  const datumNamesVector = TideDatabase.createDatumNamesVector(
    builder,
    datumNames.names.map((n) => builder.createSharedString(n)),
  );
  const versionOffset = str(version);

  TideDatabase.startTideDatabase(builder);
  TideDatabase.addVersion(builder, versionOffset);
  TideDatabase.addConstituentNames(builder, constituentNamesVector);
  TideDatabase.addDatumNames(builder, datumNamesVector);
  TideDatabase.addStations(builder, stationsVector);
  TideDatabase.finishTideDatabaseBuffer(
    builder,
    TideDatabase.endTideDatabase(builder),
  );

  return builder.asUint8Array();
}

/** Unique sorted names plus a name → ushort index map. */
function nameTable(all: string[]): {
  names: string[];
  index: Map<string, number>;
} {
  const names = [...new Set(all)].sort();
  if (names.length >= NO_CHART_DATUM)
    throw new Error(`Name table overflows ushort: ${names.length} names`);
  return { names, index: new Map(names.map((n, i) => [n, i])) };
}

function memo(
  cache: Map<string, number>,
  value: object,
  create: () => number,
): number {
  const key = JSON.stringify(value);
  let offset = cache.get(key);
  if (offset === undefined) {
    offset = create();
    cache.set(key, offset);
  }
  return offset;
}
