import FlatBuffers
import Foundation

/// The file is not a station database: too short, or the "TCDB" file identifier
/// is missing.
public struct InvalidStationDatabase: Error {}

public enum StationKind: Hashable {
  case tide
  case current
}

public enum StationType: Hashable {
  case reference
  case subordinate
}

public enum HeightOffsetType: Hashable {
  case ratio
  case fixed
}

public struct StationSource: Equatable {
  public let name: String?
  public let id: String?
  public let url: String?
  public let publishedHarmonics: Bool
}

public struct StationLicense: Equatable {
  public let type: String?
  public let url: String?
  public let notes: String?
  public let commercialUse: Bool
}

public struct TideOffsets: Equatable {
  public let reference: String
  public let timeHigh: Int
  public let timeLow: Int
  public let heightType: HeightOffsetType
  public let heightHigh: Double
  public let heightLow: Double
}

public struct CurrentOffsets: Equatable {
  public let reference: String
  public let slackBeforeFlood: Int?
  public let slackBeforeEbb: Int?
  public let floodTime: Int?
  public let ebbTime: Int?
  public let floodSpeedRatio: Double?
  public let ebbSpeedRatio: Double?
}

public struct TideDerivedCurrent: Equatable {
  public let reference: String
  public let highWaterLagMinutes: Int
  public let lowWaterLagMinutes: Int
}

public struct CurrentRecord: Equatable {
  public let floodDirection: Double?
  public let ebbDirection: Double?
  public let meanFlow: Double?
  public let tideReference: String?
  public let offsets: CurrentOffsets?
  public let magnitudeNote: String?
  public let derived: TideDerivedCurrent?
}

/// A station database file (`.tcdb`, schemas/database.fbs in
/// openwatersio/slackwater-database), read in place.
///
/// The buffer is never decoded up front. Opening a memory-mapped file and
/// iterating identity (id, name, coordinates) touches only the head pages of
/// the file, because the builder writes every station table before any
/// prediction data. Reading one station's constituents faults in only the
/// pages that hold them, so a widget extension touching one station stays
/// cheap.
///
///     let db = try StationDatabase(contentsOf: url)
///     let nearest = db.min { distance(to: $0) < distance(to: $1) }
///     let station = db.station(id: "noaa/9447130")
///     let m2 = station?.constituents.first { $0.name == "M2" }
public struct StationDatabase: RandomAccessCollection {
  let root: Slackwater_Root

  /// Read a database from bytes already in memory (e.g. downloaded).
  public init(data: Data) throws {
    // The "TCDB" file identifier occupies bytes 4..<8 of every database file.
    // Checked directly instead of running the FlatBuffers verifier, which
    // would walk — and page in — the entire buffer.
    guard data.count >= 8, data.dropFirst(4).prefix(4).elementsEqual("TCDB".utf8)
    else { throw InvalidStationDatabase() }
    // ByteBuffer retains the Data without copying, so a mapped file stays
    // mapped for the life of the database.
    var buffer = ByteBuffer(data: data)
    root = getRoot(byteBuffer: &buffer)
  }

  /// Memory-map a database file. Pages fault in as they are read.
  public init(contentsOf url: URL) throws {
    try self.init(data: Data(contentsOf: url, options: .mappedIfSafe))
  }

  /// Release tag of the database that produced the file, e.g. "0.9.20260801".
  public var version: String? { root.version }

  /// Binary search on the id-sorted stations vector; no scan, no decode.
  public func station(id: String) -> Station? {
    root.stationsBy(key: id).map { Station(raw: $0, root: root) }
  }

  // RandomAccessCollection: stations in id order.
  public var startIndex: Int { 0 }
  public var endIndex: Int { Int(root.stationsCount) }
  public subscript(position: Int) -> Station {
    Station(raw: root.stations(at: Int32(position))!, root: root)
  }
}

/// One station, read lazily from the buffer. Each property decodes on access
/// and nothing is cached, so keep a value you use repeatedly in a local.
///
/// Identity, quality, provenance, tide/current data, and subordinate offsets
/// have typed accessors. Generated FlatBuffers accessors remain internal.
public struct Station: Identifiable {
  /// The project half of every station credit, and the fallback for a file
  /// written before credits were stored in it.
  public static let projectCredit =
    "Slackwater database (https://github.com/openwatersio/slackwater-database)"

  let raw: Slackwater_Station
  let root: Slackwater_Root

  // MARK: Identity

  public var id: String { raw.id }
  public var name: String { raw.name }
  public var kind: StationKind { raw.kind == .current ? .current : .tide }
  public var type: StationType { raw.type == .subordinate ? .subordinate : .reference }
  public var latitude: Double { raw.latitude }
  public var longitude: Double { raw.longitude }
  /// IANA timezone identifier, e.g. "America/Los_Angeles".
  public var timezone: String? { raw.timezone }
  /// Upstream's region as published ("NJ", "Nova Scotia").
  public var region: String? { raw.region }
  public var country: String? { raw.country }
  public var continent: String? { raw.continent }
  public var locality: String? { raw.locality }
  public var regionCode: String? { raw.regionCode }
  public var countryCode: String { raw.countryCode }
  public var context: String? { raw.context }
  public var contextDerived: Bool { raw.contextDerived }
  public var cities: [String] {
    (0..<raw.citiesCount).compactMap { raw.cities(at: $0) }
  }
  /// Alternate names and slugs for search. Lower-cased, deduplicated.
  public var aliases: [String] {
    (0..<raw.aliasesCount).compactMap { raw.aliases(at: $0) }
  }

  // MARK: Quality gate

  /// Whether the station passes the database's default quality filter.
  public var accepted: Bool { raw.accepted }
  /// Quality score, 0–100.
  public var score: Int { Int(raw.score) }
  public var qualityReason: String? { raw.quality?.reason }

  // MARK: Typed metadata

  public var source: StationSource? {
    raw.source.map {
      StationSource(
        name: $0.name, id: $0.id, url: $0.url,
        publishedHarmonics: $0.publishedHarmonics)
    }
  }

  public var license: StationLicense? {
    raw.license.map {
      StationLicense(
        type: $0.type, url: $0.url, notes: $0.notes,
        commercialUse: $0.commercialUse)
    }
  }

  public var tideOffsets: TideOffsets? {
    raw.offsets.map {
      TideOffsets(
        reference: $0.reference,
        timeHigh: Int($0.timeHigh),
        timeLow: Int($0.timeLow),
        heightType: $0.heightType == .fixed ? .fixed : .ratio,
        heightHigh: Double($0.heightHigh),
        heightLow: Double($0.heightLow))
    }
  }

  public var current: CurrentRecord? {
    raw.current.map { current in
      CurrentRecord(
        floodDirection: current.floodDirectionMissing ? nil : Double(current.floodDirection),
        ebbDirection: current.ebbDirectionMissing ? nil : Double(current.ebbDirection),
        meanFlow: current.meanFlowMissing ? nil : Double(current.meanFlow),
        tideReference: current.tideReference,
        offsets: current.offsets.map { offsets in
          CurrentOffsets(
            reference: offsets.reference,
            slackBeforeFlood: offsets.slackBeforeFloodMissing
              ? nil : Int(offsets.slackBeforeFlood),
            slackBeforeEbb: offsets.slackBeforeEbbMissing ? nil : Int(offsets.slackBeforeEbb),
            floodTime: offsets.floodTimeMissing ? nil : Int(offsets.floodTime),
            ebbTime: offsets.ebbTimeMissing ? nil : Int(offsets.ebbTime),
            floodSpeedRatio: offsets.floodSpeedRatioMissing
              ? nil : Double(offsets.floodSpeedRatio),
            ebbSpeedRatio: offsets.ebbSpeedRatioMissing
              ? nil : Double(offsets.ebbSpeedRatio))
        },
        magnitudeNote: current.magnitudeNote,
        derived: current.derived.map {
          TideDerivedCurrent(
            reference: $0.reference,
            highWaterLagMinutes: Int($0.highWaterLagMinutes),
            lowWaterLagMinutes: Int($0.lowWaterLagMinutes))
        })
    }
  }

  // MARK: Prediction data

  /// The station whose record holds the prediction data this one predicts from:
  /// a subordinate's reference, otherwise itself. One hop — a reference that is
  /// itself subordinate is not resolved again, and neither is a station whose
  /// reference is missing from the file.
  private var predictionSource: Station {
    guard let reference = raw.offsets?.reference,
      let source = root.stationsBy(key: reference)
    else { return self }
    return Station(raw: source, root: root)
  }

  /// Amplitude in metres (tides) or knots (currents); phase in degrees.
  public struct Constituent {
    public let name: String
    public let amplitude: Double
    public let phase: Double
  }

  /// Harmonic constituents, names resolved through the file's name table. A
  /// subordinate carries none of its own and reports its reference's, which are
  /// the ones its prediction starts from.
  public var constituents: [Constituent] {
    let raw = predictionSource.raw
    return (0..<raw.constituentsCount).compactMap { index in
      guard let c = raw.constituents(at: index),
        let name = root.constituentNames(at: Int32(c.name))
      else { return nil }
      return Constituent(
        name: name, amplitude: Double(c.amplitude), phase: Double(c.phase))
    }
  }

  /// Vertical datums in metres above the station's zero, keyed by name
  /// ("MLLW", "MSL", ...). A subordinate reports its reference's, which describe
  /// the reference's water: they are not reduced through `raw.offsets`, because
  /// the extreme corrections have no principled meaning for a mean level like
  /// MSL or MTL. For the pair that does reduce, see `astronomicalBounds`.
  public var datums: [String: Double] {
    let raw = predictionSource.raw
    var values: [String: Double] = [:]
    for index in 0..<raw.datumsCount {
      guard let d = raw.datums(at: index),
        let name = root.datumNames(at: Int32(d.name))
      else { continue }
      values[name] = Double(d.value)
    }
    return values
  }

  /// The datum key heights on charts are referenced to, e.g. "MLLW".
  public var chartDatum: String? { raw.chartDatum }

  // MARK: Attribution

  /// The complete notice to display when showing or redistributing this
  /// station: the creator credit and, where a Creative Commons licence
  /// applies, the licence and a pointer to what was modified. Displaying it is
  /// the whole of the obligation. Written into the file by the builder, so
  /// this package keeps no table of sources; a file predating the field falls
  /// back to the project credit.
  public var attribution: String {
    raw.attribution ?? Self.projectCredit
  }

  /// Height of mean sea level above the chart datum
  /// (`datums[MSL] - datums[chartDatum]`): add it to a prediction about MSL to
  /// reference the height to the chart datum. Nil when either datum is absent.
  public var chartDatumShift: Double? {
    let datums = self.datums
    guard let chartDatum = raw.chartDatum,
      let msl = datums["MSL"], let zero = datums[chartDatum]
    else { return nil }
    return msl - zero
  }

  // MARK: Astronomical range

  /// The floor and ceiling of this station's predictions, in metres above its
  /// chart datum.
  public struct AstronomicalBounds {
    /// Lowest Astronomical Tide.
    public let lat: Double
    /// Highest Astronomical Tide.
    public let hat: Double
  }

  /// Lowest and highest astronomical tide, in metres above this station's chart
  /// datum. Nil when the station predicting for this one has no LAT and HAT.
  ///
  /// For a subordinate this is the reference's range reduced through
  /// `raw.offsets` — the same correction the predictor applies to the extremes
  /// themselves, and exact for both offset kinds because each is monotonic in
  /// the reference height. The result is the floor of a prediction rather than
  /// a hydrographic datum, which is why it is not in `datums`: applied to a
  /// single pair of levels the extreme corrections leave an object no datum
  /// ordering holds for (docs/datums.md).
  public var astronomicalBounds: AstronomicalBounds? {
    // The datums are in the prediction source's frame, so its own chart datum
    // is the zero they sit above — not this station's, which can name a
    // different datum than the record the values came from.
    let source = predictionSource
    let datums = source.datums
    guard let chartDatum = source.raw.chartDatum, let zero = datums[chartDatum],
      let lat = datums["LAT"], let hat = datums["HAT"]
    else { return nil }
    guard let offsets = raw.offsets else {
      return AstronomicalBounds(lat: lat - zero, hat: hat - zero)
    }
    let low = Double(offsets.heightLow)
    let high = Double(offsets.heightHigh)
    let ratio = offsets.heightType == .ratio
    return AstronomicalBounds(
      lat: ratio ? (lat - zero) * low : (lat - zero) + low,
      hat: ratio ? (hat - zero) * high : (hat - zero) + high)
  }
}
