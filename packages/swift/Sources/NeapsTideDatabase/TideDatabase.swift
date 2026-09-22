import FlatBuffers
import Foundation

/// The file is not a tide database: too short, or the "TCDB" file identifier
/// is missing.
public struct NotATideDatabase: Error {}

/// A tide database file (`.tcdb`, schemas/database.fbs in
/// openwatersio/tide-database), read in place.
///
/// The buffer is never decoded up front. Opening a memory-mapped file and
/// iterating identity (id, name, coordinates) touches only the head pages of
/// the file, because the builder writes every station table before any
/// prediction data. Reading one station's constituents faults in only the
/// pages that hold them, so a widget extension touching one station stays
/// cheap.
///
///     let db = try TideDatabase(contentsOf: url)
///     let nearest = db.min { distance(to: $0) < distance(to: $1) }
///     let station = db.station(id: "noaa/9447130")
///     let m2 = station?.constituents.first { $0.name == "M2" }
public struct TideDatabase: RandomAccessCollection {
  let root: Neaps_Root

  /// Read a database from bytes already in memory (e.g. downloaded).
  public init(data: Data) throws {
    // The "TCDB" file identifier occupies bytes 4..<8 of every database file.
    // Checked directly instead of running the FlatBuffers verifier, which
    // would walk — and page in — the entire buffer.
    guard data.count >= 8, data.dropFirst(4).prefix(4).elementsEqual("TCDB".utf8)
    else { throw NotATideDatabase() }
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
/// Identity, the quality gate, constituents, and datums get typed accessors;
/// everything else in the schema (provenance, quality detail, current data,
/// subordinate offsets) is reachable through `raw`, the generated FlatBuffers
/// accessor.
public struct Station: Identifiable {
  /// The project half of every station credit, and the fallback for a file
  /// written before credits were stored in it.
  public static let projectCredit =
    "Neaps tide database (https://github.com/openwatersio/tide-database)"

  /// The generated accessor, for fields without a wrapper property.
  public let raw: Neaps_Station
  let root: Neaps_Root

  // MARK: Identity

  public var id: String { raw.id }
  public var name: String { raw.name }
  public var kind: Neaps_Kind { raw.kind }
  public var type: Neaps_StationType { raw.type }
  public var latitude: Double { raw.latitude }
  public var longitude: Double { raw.longitude }
  /// IANA timezone identifier, e.g. "America/Los_Angeles".
  public var timezone: String? { raw.timezone }
  /// Upstream's region as published ("NJ", "Nova Scotia").
  public var region: String? { raw.region }
  public var country: String? { raw.country }
  public var continent: String? { raw.continent }
  /// Alternate names and slugs for search. Lower-cased, deduplicated.
  public var aliases: [String] {
    (0..<raw.aliasesCount).compactMap { raw.aliases(at: $0) }
  }

  // MARK: Quality gate

  /// Whether the station passes the database's default quality filter.
  public var accepted: Bool { raw.accepted }
  /// Quality score, 0–100. Detail behind it is in `raw.quality`.
  public var score: Int { Int(raw.score) }

  // MARK: Prediction data

  /// Amplitude in metres (tides) or knots (currents); phase in degrees.
  public struct Constituent {
    public let name: String
    public let amplitude: Double
    public let phase: Double
  }

  /// Harmonic constituents, names resolved through the file's name table.
  /// Empty for subordinate stations — predict via `raw.offsets`.
  public var constituents: [Constituent] {
    (0..<raw.constituentsCount).compactMap { index in
      guard let c = raw.constituents(at: index),
        let name = root.constituentNames(at: Int32(c.name))
      else { return nil }
      return Constituent(
        name: name, amplitude: Double(c.amplitude), phase: Double(c.phase))
    }
  }

  /// Vertical datums in metres above the station's zero, keyed by name
  /// ("MLLW", "MSL", ...).
  public var datums: [String: Double] {
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
    guard let offsets = raw.offsets else { return ownBounds }
    // One hop only: a reference of a reference carries no datums of its own, so
    // `ownBounds` is nil there rather than recursing.
    guard let reference = root.stationsBy(key: offsets.reference),
      let bounds = Station(raw: reference, root: root).ownBounds
    else { return nil }
    let low = Double(offsets.heightLow)
    let high = Double(offsets.heightHigh)
    let ratio = offsets.heightType == .ratio
    return AstronomicalBounds(
      lat: ratio ? bounds.lat * low : bounds.lat + low,
      hat: ratio ? bounds.hat * high : bounds.hat + high)
  }

  private var ownBounds: AstronomicalBounds? {
    let datums = self.datums
    guard let chartDatum = raw.chartDatum, let zero = datums[chartDatum],
      let lat = datums["LAT"], let hat = datums["HAT"]
    else { return nil }
    return AstronomicalBounds(lat: lat - zero, hat: hat - zero)
  }
}
