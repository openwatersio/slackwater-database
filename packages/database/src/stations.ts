import {
  Constituent,
  ChsFitTier,
  Datum,
  DatumFrame,
  DatumsSource,
  HeightOffsetType,
  Kind,
  type Root,
  StationType,
} from "./generated/fbs/slackwater.ts";
import { PROJECT_CREDIT } from "./attribution.js";
import type {
  AstronomicalBounds,
  ChsFitClause,
  ChsFitContext,
  ChsFitData,
  CurrentData,
  HarmonicConstituent,
  Station,
  StationData,
  StationQuality,
} from "./types.js";

const CHS_FIT_TIER_NAMES: Record<number, ChsFitData["tier"]> = {
  [ChsFitTier.Final]: "final",
  [ChsFitTier.Bounded]: "bounded",
  [ChsFitTier.Online]: "online",
};

export function qualityFilter(station: Station): boolean {
  return station.quality?.accepted ?? true;
}

/** A reader and identity cache owned by one loaded database. */
export function createStationReader(db: Root) {
  const constituentNames: string[] = Array.from(
    { length: db.constituentNamesLength() },
    (_, i) => db.constituentNames(i),
  );

  /** All datum keys present across the database (e.g. "MLLW", "MSL", "NAVD88"). */
  const datums: string[] = Array.from(
    { length: db.datumNamesLength() },
    (_, i) => db.datumNames(i),
  );

  const indexCache = new Map<string, number>();
  const stationCache = new Map<number, Station>();
  let all: Station[] | undefined;
  let accepted: Station[] | undefined;
  let qualities: Map<string, StationQuality> | undefined;

  // Only successful lookups enter this cache; no full identity scan is needed.
  function findIndex(id: string): number | undefined {
    const cached = indexCache.get(id);
    if (cached !== undefined) return cached;
    let low = 0;
    let high = db.stationsLength() - 1;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      const candidate = db.stations(middle)!.id()!;
      if (candidate === id) {
        indexCache.set(id, middle);
        return middle;
      }
      if (candidate < id) low = middle + 1;
      else high = middle - 1;
    }
    return undefined;
  }

  function at(index: number): Station {
    let station = stationCache.get(index);
    if (!station) {
      station = readStation(index);
      stationCache.set(index, station);
      indexCache.set(station.id, index);
    }
    return station;
  }

  function byId(id: string): Station | undefined {
    const index = findIndex(id);
    return index === undefined ? undefined : at(index);
  }

  function isAccepted(index: number): boolean {
    const table = db.stations(index)!;
    return !table.quality() || table.accepted();
  }

  // Stations that predict from another station's harmonics (subordinates use
  // their reference station); resolve an id to the buffer index of its record.
  function dataIndex(station: Station): number {
    const own = findIndex(station.id)!;
    if (station.type !== "subordinate" || !station.offsets) return own;
    const { reference } = station.offsets;
    const index = findIndex(reference);
    if (index !== undefined) return index;
    // A filtered rebuild can leave out the reference, but buildDatabase stores
    // what the subordinate resolved to, so its own record holds the same data.
    const table = db.stations(own)!;
    if (table.constituentsLength() > 0 || table.datumsLength() > 0) return own;
    throw new Error(`No data record for station ${reference}`);
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

  // The quality gate (accepted, score) is inline on the station table, so the
  // identity scan reads it from head pages; the detail behind it lives in a
  // Quality table at the tail and decodes only on access, like prediction data.
  function readQuality(
    index: number,
    id: string,
    accepted: boolean,
    score: number,
  ): StationQuality {
    const detail = () => db.stations(index)!.quality();
    // id comes from station identity rather than a second copy in the database.
    const quality = { id, accepted, score } as StationQuality;
    Object.defineProperties(quality, {
      factors: {
        enumerable: true,
        configurable: true,
        get: () => {
          const f = detail()?.factors();
          if (!f) return undefined;
          return {
            epoch: f.epoch(),
            recency: f.recency(),
            source: f.source(),
            quality: f.quality(),
            amplitude: f.amplitude(),
            coverage: f.coverage(),
          };
        },
      },
      issues: {
        enumerable: true,
        configurable: true,
        get: () => {
          const t = detail();
          if (!t) return undefined;
          return Array.from({ length: t.issuesLength() }, (_, i) =>
            t.issues(i),
          );
        },
      },
      reason: {
        enumerable: true,
        configurable: true,
        get: () => detail()?.reason() ?? undefined,
      },
      redundant: {
        enumerable: true,
        configurable: true,
        get: () => detail()?.redundant() ?? undefined,
      },
      seasonal_dominant: {
        enumerable: true,
        configurable: true,
        // Absent in a file written before the field existed, which reads back
        // false — the same answer as a station that simply is not seasonal.
        get: () => detail()?.seasonalDominant() || undefined,
      },
    });
    return quality;
  }

  // `index` is the record that holds the datums — the reference's, for a
  // subordinate — so its own chart_datum is the zero the LAT/HAT sit above.
  function readOwnBounds(index: number): AstronomicalBounds | undefined {
    const chartDatum = db.stations(index)!.chartDatum();
    if (chartDatum === null) return undefined;
    const values = readDatums(index);
    const zero = values[chartDatum];
    const lat = values["LAT"];
    const hat = values["HAT"];
    if (zero === undefined || lat === undefined || hat === undefined)
      return undefined;
    return { lat: lat - zero, hat: hat - zero };
  }

  function readAstronomicalBounds(
    station: Station,
  ): AstronomicalBounds | undefined {
    const bounds = readOwnBounds(dataIndex(station));
    // The same guard dataIndex uses, so the reduction runs exactly when the
    // bounds above came from another station's record.
    const offsets =
      station.type === "subordinate" ? station.offsets : undefined;
    if (!bounds || !offsets) return bounds;
    // Exact for both kinds: a ratio scales the height above chart datum, a fixed
    // offset translates it, and both are monotonic in the reference height.
    const { type, high, low } = offsets.height;
    return type === "ratio"
      ? { lat: bounds.lat * low, hat: bounds.hat * high }
      : { lat: bounds.lat + low, hat: bounds.hat + high };
  }

  function readEpoch(index: number): StationData["epoch"] {
    const epoch = db.stations(index)!.epoch();
    if (!epoch) return undefined;
    return { start: epoch.start()!, end: epoch.end()! };
  }

  function readDatumEpoch(index: number): StationData["datum_epoch"] {
    const epoch = db.stations(index)!.datumEpoch();
    return epoch ? { start: epoch.start()!, end: epoch.end()! } : undefined;
  }

  function readDatumFrame(index: number): StationData["datum_frame"] {
    switch (db.stations(index)!.datumFrame()) {
      case DatumFrame.Gauge:
        return "gauge";
      case DatumFrame.Constituent:
        return "constituent";
      default:
        return undefined;
    }
  }

  function readDatumCoverage(index: number): StationData["datum_coverage"] {
    const coverage = db.stations(index)!.datumCoverage();
    return coverage
      ? {
          months: coverage.months(),
          observed_hours: coverage.observedHours(),
          inferred_hours: coverage.inferredHours(),
        }
      : undefined;
  }

  function readDatumsSource(index: number): StationData["datums_source"] {
    switch (db.stations(index)!.datumsSource()) {
      case DatumsSource.Observed:
        return "observed";
      case DatumsSource.Harmonic:
        return "harmonic";
      default:
        return undefined;
    }
  }

  function readCurrent(index: number): CurrentData | undefined {
    const table = db.stations(index)!.current();
    if (!table) return undefined;
    const current: CurrentData = {};
    if (!table.floodDirectionMissing())
      current.flood_direction = table.floodDirection();
    if (!table.ebbDirectionMissing())
      current.ebb_direction = table.ebbDirection();
    if (!table.meanFlowMissing()) current.mean_flow = table.meanFlow();
    const tideReference = table.tideReference();
    if (tideReference) current.tide_reference = tideReference;
    const offsets = table.offsets();
    if (offsets) {
      const values: NonNullable<CurrentData["offsets"]> = {
        reference: offsets.reference()!,
      };
      if (!offsets.slackBeforeFloodMissing())
        values.slack_before_flood = offsets.slackBeforeFlood();
      if (!offsets.slackBeforeEbbMissing())
        values.slack_before_ebb = offsets.slackBeforeEbb();
      if (!offsets.floodTimeMissing()) values.flood_time = offsets.floodTime();
      if (!offsets.ebbTimeMissing()) values.ebb_time = offsets.ebbTime();
      if (!offsets.floodSpeedRatioMissing())
        values.flood_speed_ratio = offsets.floodSpeedRatio();
      if (!offsets.ebbSpeedRatioMissing())
        values.ebb_speed_ratio = offsets.ebbSpeedRatio();
      current.offsets = values;
    }
    const magnitudeNote = table.magnitudeNote();
    if (magnitudeNote) current.magnitude_note = magnitudeNote;
    const derived = table.derived();
    if (derived) {
      current.derived = {
        reference: derived.reference()!,
        high_water_lag_minutes: derived.highWaterLagMinutes(),
        low_water_lag_minutes: derived.lowWaterLagMinutes(),
      };
    }
    const fit = table.chsFit();
    if (fit) {
      const known = CHS_FIT_TIER_NAMES[fit.tier()];
      const data: ChsFitData = {
        tier: known ?? "online",
        evidence: fit.evidence()!,
      };
      // A tier this reader does not know reads as online, with no measured numbers.
      if (known) {
        if (fit.days()) data.days = fit.days() as 60 | 210;
        if (fit.slackBoundMinutes())
          data.slack_bound_minutes = fit.slackBoundMinutes();
        if (fit.provisionalSlackMinutes())
          data.provisional_slack_minutes = fit.provisionalSlackMinutes();
      }
      const miss = fit.miss();
      if (miss) {
        data.miss = {
          clause: miss.clause()! as ChsFitClause,
          value: miss.valueMissing() ? null : miss.value(),
        };
        if (miss.nearBar()) data.miss.near_bar = true;
      }
      const missContext = fit.missContext();
      if (missContext) data.miss_context = missContext as ChsFitContext;
      current.chs_fit = data;
    }
    return current;
  }

  function readStation(index: number): Station {
    const t = db.stations(index)!;

    const station = { id: t.id()! } as Station;
    station.name = t.name()!;
    station.kind = t.kind() === Kind.Current ? "current" : "tide";
    station.latitude = t.latitude();
    station.longitude = t.longitude();
    const locality = t.locality();
    if (locality !== null) station.locality = locality;
    const region = t.region();
    if (region !== null) station.region = region;
    const regionCode = t.regionCode();
    if (regionCode !== null) station.region_code = regionCode;
    station.country = t.country()!;
    station.country_code = t.countryCode()!;
    station.continent = t.continent()!;
    station.timezone = t.timezone()!;
    const context = t.context();
    if (context !== null) {
      station.context = context;
      station.context_derived = t.contextDerived();
    }
    station.type =
      t.type() === StationType.Subordinate ? "subordinate" : "reference";
    // Optional in the data (many subordinates omit it); keep the key absent
    // rather than surfacing FlatBuffers' null.
    const disclaimers = t.disclaimers();
    if (disclaimers !== null) station.disclaimers = disclaimers;

    const chartDatum = t.chartDatum();
    if (chartDatum !== null) station.chart_datum = chartDatum;

    const source = t.source();
    if (source) {
      station.source = {
        name: source.name()!,
        id: source.id()!,
        published_harmonics: source.publishedHarmonics(),
        url: source.url()!,
      };
    }
    // Written into the file by the builder, so a reader never needs its own
    // table of sources. Older files predating the field fall back to the
    // project credit.
    station.attribution = t.attribution() ?? PROJECT_CREDIT;

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
    if (t.citiesLength() > 0) {
      station.cities = Array.from({ length: t.citiesLength() }, (_, i) =>
        t.cities(i),
      );
    }
    if (station.kind === "current") {
      Object.defineProperty(station, "current", {
        enumerable: true,
        configurable: true,
        get: () => readCurrent(index),
      });
    }

    // Presence check only: following the field offset stays on head pages.
    if (t.quality() !== null) {
      station.quality = readQuality(index, station.id, t.accepted(), t.score());
    }

    // Reading these fields decodes one station's data from the buffer.
    // No prediction cache: retaining results would accumulate heavy data
    // on the heap as more stations are accessed.
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
      astronomical_bounds: {
        enumerable: true,
        configurable: true,
        get: () => readAstronomicalBounds(station),
      },
      epoch: {
        enumerable: true,
        configurable: true,
        // A station's own epoch wins; a subordinate without one reports the
        // source-reported period of its reference. Same precedence
        // the quality evaluation uses, so a read/write round-trip is lossless.
        get: () => readEpoch(index) ?? readEpoch(dataIndex(station)),
      },
      datum_epoch: {
        enumerable: true,
        configurable: true,
        get: () => readDatumEpoch(dataIndex(station)),
      },
      datum_frame: {
        enumerable: true,
        configurable: true,
        get: () => readDatumFrame(dataIndex(station)),
      },
      datum_coverage: {
        enumerable: true,
        configurable: true,
        get: () => readDatumCoverage(dataIndex(station)),
      },
      datums_source: {
        enumerable: true,
        configurable: true,
        get: () => readDatumsSource(dataIndex(station)),
      },
    });

    return station;
  }

  return {
    at,
    indexOf: findIndex,
    isAccepted,
    byId,
    datums,
    get all(): Station[] {
      return (all ??= Array.from({ length: db.stationsLength() }, (_, i) =>
        at(i),
      ));
    },
    get accepted(): Station[] {
      // Rejected identities need not be materialized to select accepted ones.
      if (!accepted) {
        accepted = [];
        for (let i = 0; i < db.stationsLength(); i++) {
          if (isAccepted(i)) accepted.push(at(i));
        }
      }
      return accepted;
    },
    get qualityMap(): Map<string, StationQuality> {
      if (!qualities) {
        qualities = new Map();
        for (let i = 0; i < db.stationsLength(); i++) {
          const station = at(i);
          if (station.quality) qualities.set(station.id, station.quality);
        }
      }
      return qualities;
    },
  };
}

export type StationReader = ReturnType<typeof createStationReader>;
