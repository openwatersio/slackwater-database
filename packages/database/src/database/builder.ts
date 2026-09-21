import {
  Constituent,
  Current,
  CurrentOffsets,
  Datum,
  DatumsSource,
  Epoch,
  HeightOffsetType,
  Kind,
  License,
  Quality,
  QualityFactors,
  Root,
  Source,
  Station,
  StationRoute as StationRouteTable,
  StationType,
  TideDerivedCurrent,
  TideOffsets,
} from "../generated/fbs/neaps.ts";
import * as flatbuffers from "flatbuffers";
import countryLookup from "country-code-lookup";
import { attributionFor } from "../attribution.ts";
import type {
  DatabaseRoutes,
  StationInput,
  StationRouteInput,
} from "../types.js";

/**
 * Serialize stations into the FlatBuffers database format
 * (schemas/database.fbs). Stations are sorted by id — the vector key — so
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
  {
    version,
    routes = { tide: [], current: [] },
  }: { version?: string; routes?: DatabaseRoutes } = {},
): Uint8Array {
  // Ids are ASCII, so JS string order matches the strcmp order FlatBuffers key
  // lookup expects.
  const sorted = [...stations].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  sorted.forEach((station, index) => {
    requireIdentity(station);
    if (index > 0 && sorted[index - 1]!.id === station.id)
      throw new Error(`duplicate station id ${station.id}`);
  });
  const preparedRoutes = prepareRoutes(sorted, routes);

  const constituentNames = nameTable(
    sorted.flatMap((s) => (s.harmonic_constituents ?? []).map((c) => c.name)),
  );
  const datumNames = nameTable(
    sorted.flatMap((s) => Object.keys(s.datums ?? {})),
  );

  const builder = new flatbuffers.Builder(1 << 22);
  const str = (v: string | undefined): number =>
    v === undefined ? 0 : builder.createSharedString(v);

  // Phase 1: lookup data — prediction vectors and quality detail — together at
  // the tail of the file.
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

    let quality = 0;
    if (s.quality) {
      const q = s.quality;
      let issues = 0;
      if (q.issues?.length) {
        issues = Quality.createIssuesVector(
          builder,
          q.issues.map((issue) => builder.createSharedString(issue)),
        );
      }
      const reason = str(q.reason);
      const redundant = str(q.redundant);
      Quality.startQuality(builder);
      if (q.factors) {
        // Structs are written inline at the add site.
        const f = q.factors;
        Quality.addFactors(
          builder,
          QualityFactors.createQualityFactors(
            builder,
            f.epoch,
            f.recency,
            f.source,
            f.quality,
            f.amplitude,
            f.coverage,
          ),
        );
      }
      Quality.addIssues(builder, issues);
      Quality.addReason(builder, reason);
      Quality.addRedundant(builder, redundant);
      quality = Quality.endQuality(builder);
    }

    return { constituents, datums, quality };
  });

  // Phase 2: identity — strings, sub-tables, and the station tables themselves —
  // together at the head. Source, license, and epoch tables repeat across most
  // of a catalog, so identical ones are written once and shared.
  const sourceOffsets = new Map<string, number>();
  const licenseOffsets = new Map<string, number>();
  const epochOffsets = new Map<string, number>();

  const stationOffsets = sorted.map((s, i) => {
    const id = builder.createString(s.id);
    // The schema requires name; endStation would reject a missing one anyway,
    // but with an unhelpful "field 6 must be set". Fail with the station id.
    if (s.name === undefined)
      throw new Error(`Station ${s.id} has no name; the schema requires one`);
    const name = builder.createSharedString(s.name);
    const timezone = str(s.timezone);
    const locality = str(s.locality);
    const region = str(s.region);
    const regionCode = str(s.region_code);
    const country = str(s.country);
    const countryCode = builder.createSharedString(s.country_code!);
    const continent = str(s.continent);
    const context = str(s.context);
    const chartDatum = str(s.chart_datum);
    const disclaimers = str(s.disclaimers);

    let aliases = 0;
    if (s.aliases?.length) {
      // The schema promises lower-cased, deduplicated aliases.
      const normalized = [...new Set(s.aliases.map((a) => a.toLowerCase()))];
      aliases = Station.createAliasesVector(
        builder,
        normalized.map((a) => builder.createSharedString(a)),
      );
    }

    let cities = 0;
    if (s.cities?.length) {
      cities = Station.createCitiesVector(
        builder,
        [...new Set(s.cities)].map((city) => builder.createSharedString(city)),
      );
    }

    let epoch = 0;
    if (s.epoch) {
      const { start, end } = s.epoch;
      epoch = memo(epochOffsets, s.epoch, () =>
        Epoch.createEpoch(builder, str(start), str(end)),
      );
    }

    let source = 0;
    if (s.source) {
      const { name, id, url, published_harmonics } = s.source;
      source = memo(sourceOffsets, s.source, () =>
        Source.createSource(
          builder,
          str(name),
          str(id),
          str(url),
          published_harmonics,
        ),
      );
    }

    // Assembled here, not in each reader: a reader would otherwise need its own
    // table of sources and its own reading of what each licence requires.
    const attribution = str(attributionFor(s.source?.name, s.license));

    let license = 0;
    if (s.license) {
      const { type, url, notes, commercial_use } = s.license;
      license = memo(licenseOffsets, s.license, () =>
        License.createLicense(
          builder,
          str(type),
          str(url),
          str(notes),
          commercial_use,
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
      if (s.offsets.height.type === "fixed")
        TideOffsets.addHeightType(builder, HeightOffsetType.Fixed);
      TideOffsets.addHeightHigh(builder, s.offsets.height.high);
      TideOffsets.addHeightLow(builder, s.offsets.height.low);
      offsets = TideOffsets.endTideOffsets(builder);
    }

    let current = 0;
    if (s.current) {
      const c = s.current;
      let derived = 0;
      if (c.derived) {
        const reference = builder.createSharedString(c.derived.reference);
        TideDerivedCurrent.startTideDerivedCurrent(builder);
        TideDerivedCurrent.addReference(builder, reference);
        TideDerivedCurrent.addHighWaterLagMinutes(
          builder,
          c.derived.high_water_lag_minutes,
        );
        TideDerivedCurrent.addLowWaterLagMinutes(
          builder,
          c.derived.low_water_lag_minutes,
        );
        derived = TideDerivedCurrent.endTideDerivedCurrent(builder);
      }
      let currentOffsets = 0;
      if (c.offsets) {
        const o = c.offsets;
        const reference = builder.createSharedString(o.reference);
        CurrentOffsets.startCurrentOffsets(builder);
        CurrentOffsets.addReference(builder, reference);
        if (o.slack_before_flood !== undefined)
          CurrentOffsets.addSlackBeforeFlood(builder, o.slack_before_flood);
        if (o.slack_before_ebb !== undefined)
          CurrentOffsets.addSlackBeforeEbb(builder, o.slack_before_ebb);
        if (o.flood_time !== undefined)
          CurrentOffsets.addFloodTime(builder, o.flood_time);
        if (o.ebb_time !== undefined)
          CurrentOffsets.addEbbTime(builder, o.ebb_time);
        if (o.flood_speed_ratio !== undefined)
          CurrentOffsets.addFloodSpeedRatio(builder, o.flood_speed_ratio);
        if (o.ebb_speed_ratio !== undefined)
          CurrentOffsets.addEbbSpeedRatio(builder, o.ebb_speed_ratio);
        if (o.slack_before_flood === undefined)
          CurrentOffsets.addSlackBeforeFloodMissing(builder, true);
        if (o.slack_before_ebb === undefined)
          CurrentOffsets.addSlackBeforeEbbMissing(builder, true);
        if (o.flood_time === undefined)
          CurrentOffsets.addFloodTimeMissing(builder, true);
        if (o.ebb_time === undefined)
          CurrentOffsets.addEbbTimeMissing(builder, true);
        if (o.flood_speed_ratio === undefined)
          CurrentOffsets.addFloodSpeedRatioMissing(builder, true);
        if (o.ebb_speed_ratio === undefined)
          CurrentOffsets.addEbbSpeedRatioMissing(builder, true);
        currentOffsets = CurrentOffsets.endCurrentOffsets(builder);
      }
      const tideReference = str(c.tide_reference);
      const magnitudeNote = str(c.magnitude_note);
      Current.startCurrent(builder);
      if (c.flood_direction !== undefined)
        Current.addFloodDirection(builder, c.flood_direction);
      if (c.ebb_direction !== undefined)
        Current.addEbbDirection(builder, c.ebb_direction);
      if (c.mean_flow !== undefined) Current.addMeanFlow(builder, c.mean_flow);
      if (c.flood_direction === undefined)
        Current.addFloodDirectionMissing(builder, true);
      if (c.ebb_direction === undefined)
        Current.addEbbDirectionMissing(builder, true);
      if (c.mean_flow === undefined) Current.addMeanFlowMissing(builder, true);
      Current.addTideReference(builder, tideReference);
      Current.addOffsets(builder, currentOffsets);
      Current.addMagnitudeNote(builder, magnitudeNote);
      Current.addDerived(builder, derived);
      current = Current.endCurrent(builder);
    }

    Station.startStation(builder);
    Station.addId(builder, id);
    Station.addName(builder, name);
    if (stationKind(s) === "current") Station.addKind(builder, Kind.Current);
    if (s.type === "subordinate")
      Station.addType(builder, StationType.Subordinate);
    if (s.latitude !== undefined) Station.addLatitude(builder, s.latitude);
    if (s.longitude !== undefined) Station.addLongitude(builder, s.longitude);
    Station.addTimezone(builder, timezone);
    Station.addRegion(builder, region);
    Station.addCountry(builder, country);
    Station.addContinent(builder, continent);
    Station.addAliases(builder, aliases);
    if (s.quality?.accepted ?? true) Station.addAccepted(builder, true);
    if (s.quality?.score) Station.addScore(builder, s.quality.score);
    Station.addConstituents(builder, prediction[i]!.constituents);
    Station.addDatums(builder, prediction[i]!.datums);
    if (s.datums_source === "observed")
      Station.addDatumsSource(builder, DatumsSource.Observed);
    else if (s.datums_source === "harmonic")
      Station.addDatumsSource(builder, DatumsSource.Harmonic);
    Station.addChartDatum(builder, chartDatum);
    Station.addOffsets(builder, offsets);
    Station.addCurrent(builder, current);
    Station.addEpoch(builder, epoch);
    Station.addQuality(builder, prediction[i]!.quality);
    Station.addSource(builder, source);
    Station.addLicense(builder, license);
    Station.addDisclaimers(builder, disclaimers);
    Station.addAttribution(builder, attribution);
    Station.addLocality(builder, locality);
    Station.addRegionCode(builder, regionCode);
    Station.addCountryCode(builder, countryCode);
    Station.addContext(builder, context);
    if (s.context_derived) Station.addContextDerived(builder, true);
    Station.addCities(builder, cities);
    return Station.endStation(builder);
  });

  const routeOffsets = (records: StationRouteInput[]): number[] =>
    records.map((route) => {
      const slug = builder.createString(route.slug);
      const stationIds = StationRouteTable.createStationIdsVector(
        builder,
        route.station_ids.map((id) => builder.createSharedString(id)),
      );
      const formerPaths = route.former_paths?.length
        ? StationRouteTable.createFormerPathsVector(
            builder,
            route.former_paths.map((path) => builder.createSharedString(path)),
          )
        : 0;
      StationRouteTable.startStationRoute(builder);
      StationRouteTable.addSlug(builder, slug);
      StationRouteTable.addStationIds(builder, stationIds);
      StationRouteTable.addFormerPaths(builder, formerPaths);
      return StationRouteTable.endStationRoute(builder);
    });

  const tideRouteOffsets = routeOffsets(preparedRoutes.tide);
  const tideRoutesVector = tideRouteOffsets.length
    ? Root.createTideRoutesVector(builder, tideRouteOffsets)
    : 0;
  const currentRouteOffsets = routeOffsets(preparedRoutes.current);
  const currentRoutesVector = currentRouteOffsets.length
    ? Root.createCurrentRoutesVector(builder, currentRouteOffsets)
    : 0;

  // Phase 3: the root — stations vector and name tables — at the very head.
  const stationsVector = Root.createStationsVector(builder, stationOffsets);
  const constituentNamesVector = Root.createConstituentNamesVector(
    builder,
    constituentNames.names.map((n) => builder.createSharedString(n)),
  );
  const datumNamesVector = Root.createDatumNamesVector(
    builder,
    datumNames.names.map((n) => builder.createSharedString(n)),
  );
  const versionOffset = str(version);

  Root.finishRootBuffer(
    builder,
    Root.createRoot(
      builder,
      versionOffset,
      stationsVector,
      constituentNamesVector,
      datumNamesVector,
      tideRoutesVector,
      currentRoutesVector,
    ),
  );

  return builder.asUint8Array();
}

function prepareRoutes(
  stations: StationInput[],
  routes: DatabaseRoutes,
): DatabaseRoutes {
  const kinds = new Map(
    stations.map((station) => [station.id, stationKind(station)]),
  );
  const prepare = (
    kind: keyof DatabaseRoutes,
    records: StationRouteInput[],
  ): StationRouteInput[] => {
    const slugs = new Set<string>();
    return records
      .map((route) => {
        if (!/^[a-z0-9-]+$/.test(route.slug) || slugs.has(route.slug))
          throw new Error(
            `${kind} route has invalid or duplicate slug ${JSON.stringify(route.slug)}`,
          );
        if (route.station_ids.length === 0)
          throw new Error(`${kind}/${route.slug} has no station ids`);
        for (const id of route.station_ids) {
          const stationKind = kinds.get(id);
          if (!stationKind)
            throw new Error(
              `${kind}/${route.slug} references missing station ${id}`,
            );
          if (stationKind !== kind)
            throw new Error(
              `${kind}/${route.slug} references ${stationKind} station ${id}`,
            );
        }
        slugs.add(route.slug);
        return {
          slug: route.slug,
          station_ids: [...new Set(route.station_ids)],
          former_paths: [...new Set(route.former_paths ?? [])],
        };
      })
      .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  };
  return {
    tide: prepare("tide", routes.tide),
    current: prepare("current", routes.current),
  };
}

function requireIdentity(station: StationInput): void {
  if (!station.id.trim()) throw new Error("Station has no id");
  stationKind(station);
  for (const field of ["name", "timezone", "continent"] as const) {
    if (!station[field]?.trim())
      throw new Error(`Station ${station.id} has no ${field}`);
  }
  if (
    !Number.isFinite(station.latitude) ||
    !Number.isFinite(station.longitude) ||
    Math.abs(station.latitude!) > 90 ||
    Math.abs(station.longitude!) > 180
  )
    throw new Error(`Station ${station.id} has invalid coordinates`);
  if (!station.source) throw new Error(`Station ${station.id} has no source`);
  if (!station.license) throw new Error(`Station ${station.id} has no license`);
  if (!station.country)
    throw new Error(
      `Station ${station.id} has no country; the schema requires one`,
    );
  if (!/^[A-Z]{2}$/.test(station.country_code ?? ""))
    throw new Error(
      `Station ${station.id} has invalid country_code ${JSON.stringify(station.country_code)}`,
    );

  const country = countryLookup.byIso(station.country_code!);
  if (!country || country.country !== station.country)
    throw new Error(
      `Station ${station.id} country ${station.country} does not match ${station.country_code}`,
    );

  if (
    station.region_code &&
    (!/^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(station.region_code) ||
      !station.region_code.startsWith(`${station.country_code}-`))
  )
    throw new Error(
      `Station ${station.id} region_code ${station.region_code} does not match ${station.country_code}`,
    );
}

function stationKind(station: StationInput): "tide" | "current" {
  if (station.kind === "tide" && station.current)
    throw new Error(
      `Station ${station.id} declares tide kind with current data`,
    );
  return station.kind ?? (station.current ? "current" : "tide");
}

/** Unique sorted names plus a name → ushort index map. */
function nameTable(all: string[]): {
  names: string[];
  index: Map<string, number>;
} {
  const names = [...new Set(all)].sort();
  if (names.length > 0xffff)
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
