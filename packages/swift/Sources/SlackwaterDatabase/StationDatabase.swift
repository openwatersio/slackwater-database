import FlatBuffers
import Foundation

/// The file is not a station database: too short, the "TCDB" file identifier
/// is missing, or the root table or its format version lies past the end. A
/// verifying open also throws it for a file that fails the FlatBuffers verifier, a name index past its table, or a string that is not UTF-8.
public struct InvalidStationDatabase: Error {}

/// The file is a station database in a newer format than this reader knows.
/// Upgrade the SlackwaterDatabase package to read it.
public struct UnsupportedStationDatabase: Error {
  /// The file's format major version.
  public let formatVersion: Int
}

public enum StationKind: Hashable, Sendable {
  case tide
  case current
}

public enum StationType: Hashable, Sendable {
  case reference
  case subordinate
}

public enum StationDatumFrame: Hashable, Sendable {
  case gauge
  case constituent
}

public struct StationDatumCoverage: Hashable, Sendable {
  public var months: Int
  public var observedHours: Int
  public var inferredHours: Int

  public init(months: Int, observedHours: Int, inferredHours: Int) {
    self.months = months
    self.observedHours = observedHours
    self.inferredHours = inferredHours
  }
}

public enum HeightOffsetType: Hashable, Sendable {
  case ratio
  case fixed
}

public enum StationRouteKind: Hashable, Sendable {
  case tide
  case current
}

public struct StationRoute: Equatable, Sendable {
  public let slug: String
  public let stationIDs: [String]
  public let formerPaths: [String]

  public init(slug: String, stationIDs: [String], formerPaths: [String]) {
    self.slug = slug
    self.stationIDs = stationIDs
    self.formerPaths = formerPaths
  }

  init(raw: Slackwater_StationRoute) {
    self.init(
      slug: raw.slug,
      stationIDs: (0..<raw.stationIdsCount).compactMap { raw.stationIds(at: $0) },
      formerPaths: (0..<raw.formerPathsCount).compactMap { raw.formerPaths(at: $0) })
  }
}

public struct StationSource: Hashable, Sendable {
  public var name: String?
  public var id: String?
  public var url: String?
  public var publishedHarmonics: Bool

  public init(name: String?, id: String?, url: String?, publishedHarmonics: Bool) {
    self.name = name
    self.id = id
    self.url = url
    self.publishedHarmonics = publishedHarmonics
  }
}

public struct StationLicense: Hashable, Sendable {
  public var type: String?
  public var url: String?
  public var notes: String?
  public var commercialUse: Bool

  public init(type: String?, url: String?, notes: String? = nil, commercialUse: Bool) {
    self.type = type
    self.url = url
    self.notes = notes
    self.commercialUse = commercialUse
  }
}

/// Dates as YYYY-MM-DD; an empty string is a bound the file does not record.
public struct StationEpoch: Hashable, Sendable {
  public var start: String
  public var end: String

  public init(start: String, end: String) {
    self.start = start
    self.end = end
  }
}

public struct TideOffsets: Equatable, Sendable {
  public var reference: String
  public var timeHigh: Int
  public var timeLow: Int
  public var heightType: HeightOffsetType
  public var heightHigh: Double
  public var heightLow: Double

  public init(
    reference: String, timeHigh: Int, timeLow: Int, heightType: HeightOffsetType,
    heightHigh: Double, heightLow: Double
  ) {
    self.reference = reference
    self.timeHigh = timeHigh
    self.timeLow = timeLow
    self.heightType = heightType
    self.heightHigh = heightHigh
    self.heightLow = heightLow
  }
}

public struct CurrentOffsets: Equatable, Sendable {
  public var reference: String
  public var slackBeforeFlood: Int?
  public var slackBeforeEbb: Int?
  public var floodTime: Int?
  public var ebbTime: Int?
  public var floodSpeedRatio: Double?
  public var ebbSpeedRatio: Double?

  public init(
    reference: String, slackBeforeFlood: Int? = nil, slackBeforeEbb: Int? = nil,
    floodTime: Int? = nil, ebbTime: Int? = nil, floodSpeedRatio: Double? = nil,
    ebbSpeedRatio: Double? = nil
  ) {
    self.reference = reference
    self.slackBeforeFlood = slackBeforeFlood
    self.slackBeforeEbb = slackBeforeEbb
    self.floodTime = floodTime
    self.ebbTime = ebbTime
    self.floodSpeedRatio = floodSpeedRatio
    self.ebbSpeedRatio = ebbSpeedRatio
  }
}

public struct TideDerivedCurrent: Equatable, Sendable {
  public var reference: String
  public var highWaterLagMinutes: Int
  public var lowWaterLagMinutes: Int

  public init(reference: String, highWaterLagMinutes: Int, lowWaterLagMinutes: Int) {
    self.reference = reference
    self.highWaterLagMinutes = highWaterLagMinutes
    self.lowWaterLagMinutes = lowWaterLagMinutes
  }
}

/// A fitted CHS gate's measured tier, from the results release `evidence` names.
/// `days`, the bounds and `miss` are nil when the gate has none.
public struct ChsFit: Equatable, Sendable {
  public enum Tier: Sendable { case final, bounded, online }
  public var tier: Tier
  public var days: Int?
  public var slackBoundMinutes: Int?
  public var provisionalSlackMinutes: Int?
  public var miss: ChsFitMiss?
  public var missContext: String?
  public var evidence: String

  public init(
    tier: Tier, days: Int? = nil, slackBoundMinutes: Int? = nil,
    provisionalSlackMinutes: Int? = nil, miss: ChsFitMiss? = nil, missContext: String? = nil,
    evidence: String
  ) {
    self.tier = tier
    self.days = days
    self.slackBoundMinutes = slackBoundMinutes
    self.provisionalSlackMinutes = provisionalSlackMinutes
    self.miss = miss
    self.missContext = missContext
    self.evidence = evidence
  }
}

/// The release-check clause an online gate missed. `value` is in the clause's
/// unit: percent of extrema for `reversed_axis`, slacks for `invented_slack` and
/// `missed_slack`, knots for `peak_speed`, minutes for the rest. It is nil when a
/// quarter had nothing to measure, never 0.
public struct ChsFitMiss: Equatable, Sendable {
  public var clause: String
  public var value: Double?
  public var nearBar: Bool

  public init(clause: String, value: Double?, nearBar: Bool = false) {
    self.clause = clause
    self.value = value
    self.nearBar = nearBar
  }
}

public struct CurrentRecord: Equatable, Sendable {
  public var floodDirection: Double?
  public var ebbDirection: Double?
  public var meanFlow: Double?
  /// Minor-axis constants in knots and Greenwich degrees; nil when not published.
  public var minorConstituents: [Station.Constituent]?
  public var minorMeanFlow: Double?
  /// Major-axis bearing in degrees true; nil when unknown.
  public var azimuth: Double?
  public var tideReference: String?
  public var offsets: CurrentOffsets?
  public var magnitudeNote: String?
  public var derived: TideDerivedCurrent?
  public var chsFit: ChsFit?

  public init(
    floodDirection: Double? = nil, ebbDirection: Double? = nil, meanFlow: Double? = nil,
    minorConstituents: [Station.Constituent]? = nil, minorMeanFlow: Double? = nil,
    azimuth: Double? = nil, tideReference: String? = nil, offsets: CurrentOffsets? = nil,
    magnitudeNote: String? = nil, derived: TideDerivedCurrent? = nil, chsFit: ChsFit? = nil
  ) {
    self.floodDirection = floodDirection
    self.ebbDirection = ebbDirection
    self.meanFlow = meanFlow
    self.minorConstituents = minorConstituents
    self.minorMeanFlow = minorMeanFlow
    self.azimuth = azimuth
    self.tideReference = tideReference
    self.offsets = offsets
    self.magnitudeNote = magnitudeNote
    self.derived = derived
    self.chsFit = chsFit
  }
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
// FlatBuffers retains Data; the hidden accessors only read it and never expose a mutable buffer.
public struct StationDatabase: RandomAccessCollection, @unchecked Sendable {
  let root: Slackwater_Root

  /// Read a database from bytes already in memory (e.g. downloaded).
  public init(data: Data) throws {
    // The "TCDB" file identifier occupies bytes 4..<8 of every database file.
    // Checked directly instead of running the FlatBuffers verifier, which
    // would walk — and page in — the entire buffer.
    try Self.checkHeader(data)
    // ByteBuffer retains the Data without copying, so a mapped file stays
    // mapped for the life of the database.
    var buffer = ByteBuffer(data: data)
    root = getRoot(byteBuffer: &buffer)
  }

  /// Memory-map a database file. Pages fault in as they are read.
  public init(contentsOf url: URL) throws {
    try self.init(data: Data(contentsOf: url, options: .mappedIfSafe))
  }

  /// Read bytes you didn't ship, such as a download, after checking all of
  /// them: the FlatBuffers verifier walks every table and vector, every
  /// constituent and datum name index is checked against its name table, and
  /// every string is checked for UTF-8. A file that fails throws
  /// `InvalidStationDatabase` here, so a truncated or corrupt file does not
  /// trap on a later read. It does not check that stations are sorted, that
  /// routes name stations in the file, or that references resolve: those give
  /// nil or wrong results, not traps. This reads the whole buffer once, so
  /// keep `init(data:)` for a bundled file.
  public init(verifying data: Data) throws {
    // Before the verifier, so a newer file it would refuse reports its version.
    try Self.checkHeader(data)
    // Not through init(data:): its unchecked root read traps on a root offset past Int32.
    var buffer = ByteBuffer(data: data)
    do {
      // Default limits: the shipped file of ~12k stations needs under 100k of the million tables allowed.
      root = try getCheckedRoot(byteBuffer: &buffer, fileId: "TCDB")
    } catch {
      throw InvalidStationDatabase()
    }
    try checkContents()
  }

  /// The format major version this package writes and the newest it reads
  /// (`Root.format_version` in schemas/database.fbs).
  public static let formatVersion = 2

  /// The file identifier and format version, read with bounds checks so any
  /// bytes are safe here. Files written before the version existed read as 0.
  static func checkHeader(_ data: Data) throws {
    // The "TCDB" file identifier occupies bytes 4..<8 of every database file.
    guard data.count >= 8, data.dropFirst(4).prefix(4).elementsEqual("TCDB".utf8),
      let version = formatVersion(of: data)
    else { throw InvalidStationDatabase() }
    guard version <= formatVersion else {
      throw UnsupportedStationDatabase(formatVersion: version)
    }
  }

  /// `Root.format_version` read through the root table's vtable by hand, nil
  /// when either lies outside `data`. The generated accessor has no bounds checks.
  static func formatVersion(of data: Data) -> Int? {
    func read<T: FixedWidthInteger>(_: T.Type, at offset: Int) -> T? {
      let size = MemoryLayout<T>.size
      guard offset >= 0, offset <= data.count - size else { return nil }
      var value = T.zero
      withUnsafeMutableBytes(of: &value) {
        $0.copyBytes(from: data[(data.startIndex + offset)..<(data.startIndex + offset + size)])
      }
      return T(littleEndian: value)
    }
    // Int(exactly:) so a root offset past Int32 can't trap on a 32-bit watch.
    guard let rootOffset = read(UInt32.self, at: 0).flatMap({ Int(exactly: $0) }),
      let vtableBack = read(Int32.self, at: rootOffset)
    else { return nil }
    // Offsets from the file can overflow a 32-bit Int, so every sum reports it.
    func add(_ a: Int, _ b: Int) -> Int? {
      let (sum, overflow) = a.addingReportingOverflow(b)
      return overflow ? nil : sum
    }
    let (vtable, overflow) = rootOffset.subtractingReportingOverflow(Int(vtableBack))
    // The vtable's second entry is the root table's size; the table must fit.
    guard !overflow, let vtableSize = read(UInt16.self, at: vtable),
      let tableSize = read(UInt16.self, at: vtable + 2),
      let tableEnd = add(rootOffset, Int(tableSize)), tableEnd <= data.count
    else { return nil }
    let slot = 16  // Root.format_version's vtable entry, as in the generated VTOFFSET.
    guard slot + 2 <= Int(vtableSize) else { return 0 }
    guard let field = read(UInt16.self, at: vtable + slot) else { return nil }
    if field == 0 { return 0 }
    return add(rootOffset, Int(field)).flatMap { read(UInt16.self, at: $0) }.map(Int.init)
  }

  /// `init(verifying:)` on a memory-mapped file. Reads after verifying go to
  /// the file, so it must not change while the database is open; a caller who
  /// can't promise that reads it into `Data` and uses `init(verifying:)`.
  public init(verifyingContentsOf url: URL) throws {
    try self.init(verifying: Data(contentsOf: url, options: .mappedIfSafe))
  }

  // The verifier checks structure, not that a name index lands inside its
  // table, nor that strings are UTF-8: the runtime reads an invalid one as nil,
  // which the generated required-string accessors force-unwrap.
  private func checkContents() throws {
    let constituentNames = root.constituentNamesCount
    let datumNames = root.datumNamesCount
    try requireText(root.version, root.versionSegmentArray)
    for i in 0..<constituentNames { try requireText(root.constituentNames(at: i)) }
    for i in 0..<datumNames { try requireText(root.datumNames(at: i)) }
    for routes in [
      (0..<root.tideRoutesCount).map { root.tideRoutes(at: $0) },
      (0..<root.currentRoutesCount).map { root.currentRoutes(at: $0) },
    ] {
      for route in routes {
        guard let route else { throw InvalidStationDatabase() }
        try requireText(route.slug)
        for i in 0..<route.stationIdsCount { try requireText(route.stationIds(at: i)) }
        for i in 0..<route.formerPathsCount { try requireText(route.formerPaths(at: i)) }
      }
    }
    for index in 0..<root.stationsCount {
      guard let station = root.stations(at: index) else { throw InvalidStationDatabase() }
      for i in 0..<station.constituentsCount
      where Int32(station.constituents(at: i)?.name ?? .max) >= constituentNames {
        throw InvalidStationDatabase()
      }
      for i in 0..<station.datumsCount
      where Int32(station.datums(at: i)?.name ?? .max) >= datumNames {
        throw InvalidStationDatabase()
      }
      try checkStrings(of: station)
      // uint counts the reader converts to Int, which is 32 bits on a watch.
      if let coverage = station.datumCoverage,
        [coverage.months, coverage.observedHours, coverage.inferredHours].contains(where: {
          $0 > UInt32(Int32.max)
        })
      {
        throw InvalidStationDatabase()
      }
      if let current = station.current {
        for i in 0..<current.minorConstituentsCount
        where Int32(current.minorConstituents(at: i)?.name ?? .max) >= constituentNames {
          throw InvalidStationDatabase()
        }
        try checkStrings(of: current)
      }
    }
  }

  private func checkStrings(of s: Slackwater_Station) throws {
    for value: String? in [s.id, s.name, s.country, s.countryCode] { try requireText(value) }
    try requireText(s.timezone, s.timezoneSegmentArray)
    try requireText(s.region, s.regionSegmentArray)
    try requireText(s.continent, s.continentSegmentArray)
    try requireText(s.chartDatum, s.chartDatumSegmentArray)
    try requireText(s.disclaimers, s.disclaimersSegmentArray)
    try requireText(s.attribution, s.attributionSegmentArray)
    try requireText(s.locality, s.localitySegmentArray)
    try requireText(s.regionCode, s.regionCodeSegmentArray)
    try requireText(s.context, s.contextSegmentArray)
    for i in 0..<s.aliasesCount { try requireText(s.aliases(at: i)) }
    for i in 0..<s.citiesCount { try requireText(s.cities(at: i)) }
    if let offsets = s.offsets { try requireText(offsets.reference) }
    for epoch in [s.epoch, s.datumEpoch].compactMap({ $0 }) {
      try requireText(epoch.start, epoch.startSegmentArray)
      try requireText(epoch.end, epoch.endSegmentArray)
    }
    if let quality = s.quality {
      try requireText(quality.reason, quality.reasonSegmentArray)
      try requireText(quality.redundant, quality.redundantSegmentArray)
      for i in 0..<quality.issuesCount { try requireText(quality.issues(at: i)) }
    }
    if let source = s.source {
      try requireText(source.name, source.nameSegmentArray)
      try requireText(source.id, source.idSegmentArray)
      try requireText(source.url, source.urlSegmentArray)
    }
    if let license = s.license {
      try requireText(license.type, license.typeSegmentArray)
      try requireText(license.url, license.urlSegmentArray)
      try requireText(license.notes, license.notesSegmentArray)
    }
  }

  private func checkStrings(of c: Slackwater_Current) throws {
    try requireText(c.tideReference, c.tideReferenceSegmentArray)
    try requireText(c.magnitudeNote, c.magnitudeNoteSegmentArray)
    if let offsets = c.offsets { try requireText(offsets.reference) }
    if let derived = c.derived { try requireText(derived.reference) }
    if let fit = c.chsFit {
      try requireText(fit.evidence)
      try requireText(fit.missContext, fit.missContextSegmentArray)
      if let miss = fit.miss { try requireText(miss.clause) }
    }
  }

  /// Release tag of the database that produced the file, e.g. "0.9.20260801".
  public var version: String? { root.version }

  /// Binary search on the id-sorted stations vector; no scan, no decode.
  public func station(id: String) -> Station? {
    root.stationsBy(key: id).map { Station(raw: $0, root: root) }
  }

  /// Binary search on the slug-sorted route vector.
  public func stationRoute(kind: StationRouteKind, slug: String) -> StationRoute? {
    let raw: Slackwater_StationRoute?
    switch kind {
    case .tide: raw = root.tideRoutesBy(key: slug)
    case .current: raw = root.currentRoutesBy(key: slug)
    }
    return raw.map(StationRoute.init)
  }

  public func stationRoutes(kind: StationRouteKind) -> [StationRoute] {
    switch kind {
    case .tide:
      return (0..<root.tideRoutesCount).compactMap {
        root.tideRoutes(at: $0).map(StationRoute.init)
      }
    case .current:
      return (0..<root.currentRoutesCount).compactMap {
        root.currentRoutes(at: $0).map(StationRoute.init)
      }
    }
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
// Both accessors retain the database's immutable Data; lazy reads have no shared mutable state.
public struct Station: Identifiable, @unchecked Sendable {
  /// The project half of every station credit, and the fallback for a file
  /// written before credits were stored in it.
  public static let projectCredit = StationAttribution.projectCredit

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
  /// Whether the peak of the seasonal curve (SA and SSA with their phases)
  /// exceeds the principal tide M2+S2+K1+O1 by more than 3 mm, so the yearly
  /// swing exceeds the daily one — a Great Lakes gauge, a river reach, a
  /// Baltic bodden.
  ///
  /// Accepted rather than rejected: the predictions are correct and only the
  /// frame is wrong. A view quoting a high and a low should read this and say
  /// what the water is, because an entire day can sit below the annual mean and
  /// read as a broken tide table. `quality.issues` gives both heights.
  public var seasonalDominant: Bool { raw.quality?.seasonalDominant ?? false }

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

  /// Source-reported analysis or datum period; TICON uses its constituent fit period.
  public var epoch: StationEpoch? {
    storedEpoch ?? predictionSource.storedEpoch
  }

  /// Mean-datum reduction period, which can differ from the constituent fit.
  public var datumEpoch: StationEpoch? { predictionSource.storedDatumEpoch }

  /// Zero of the stored datum values; nil means unspecified, including older files.
  public var datumFrame: StationDatumFrame? { predictionSource.storedDatumFrame }

  /// Hourly bins in the reference's observed reduction; nil means unspecified,
  /// or a count too large for `Int` on a 32-bit platform.
  public var datumCoverage: StationDatumCoverage? { predictionSource.storedDatumCoverage }

  // The stored* accessors read this record alone, never a subordinate's reference.

  var storedEpoch: StationEpoch? {
    raw.epoch.map { StationEpoch(start: $0.start ?? "", end: $0.end ?? "") }
  }

  var storedDatumEpoch: StationEpoch? {
    raw.datumEpoch.map { StationEpoch(start: $0.start ?? "", end: $0.end ?? "") }
  }

  var storedDatumFrame: StationDatumFrame? {
    switch raw.datumFrame {
    case .gauge: return .gauge
    case .constituent: return .constituent
    default: return nil
    }
  }

  // Nil when a count doesn't fit Int, which only a 32-bit Int can hit; the
  // verifying open refuses such a file.
  var storedDatumCoverage: StationDatumCoverage? {
    guard let coverage = raw.datumCoverage,
      let months = Int(exactly: coverage.months),
      let observed = Int(exactly: coverage.observedHours),
      let inferred = Int(exactly: coverage.inferredHours)
    else { return nil }
    return StationDatumCoverage(months: months, observedHours: observed, inferredHours: inferred)
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
        minorConstituents: current.minorConstituentsCount == 0 ? nil :
          (0..<current.minorConstituentsCount).compactMap { index in
            guard let c = current.minorConstituents(at: index),
              let name = root.constituentNames(at: Int32(c.name))
            else { return nil }
            return Constituent(
              name: name, amplitude: Double(c.amplitude), phase: Double(c.phase))
          },
        minorMeanFlow: current.minorMeanFlow.map { Double($0) },
        azimuth: current.azimuth.map { Double($0) },
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
        },
        chsFit: current.chsFit.map { fit in
          // A tier this reader does not know reads as online, with no measured numbers.
          let tier = Slackwater_ChsFitTier(rawValue: fit.tier)
          let known = tier != nil
          return ChsFit(
            tier: tier == .final_ ? .final : tier == .bounded ? .bounded : .online,
            days: !known || fit.days == 0 ? nil : Int(fit.days),
            slackBoundMinutes: !known || fit.slackBoundMinutes == 0
              ? nil : Int(fit.slackBoundMinutes),
            provisionalSlackMinutes: !known || fit.provisionalSlackMinutes == 0
              ? nil : Int(fit.provisionalSlackMinutes),
            miss: fit.miss.map {
              ChsFitMiss(
                clause: $0.clause,
                value: $0.valueMissing ? nil : $0.value,
                nearBar: $0.nearBar)
            },
            missContext: fit.missContext,
            evidence: fit.evidence)
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
  public struct Constituent: Equatable, Sendable {
    public var name: String
    public var amplitude: Double
    public var phase: Double

    public init(name: String, amplitude: Double, phase: Double) {
      self.name = name
      self.amplitude = amplitude
      self.phase = phase
    }
  }

  /// Harmonic constituents, names resolved through the file's name table. A
  /// subordinate carries none of its own and reports its reference's, which are
  /// the ones its prediction starts from.
  public var constituents: [Constituent] { predictionSource.storedConstituents }

  var storedConstituents: [Constituent] {
    (0..<raw.constituentsCount).compactMap { index in
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
  public var datums: [String: Double] { predictionSource.storedDatums }

  var storedDatums: [String: Double] {
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
  public struct AstronomicalBounds: Sendable {
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

/// A required string or a vector element, which the runtime reads as nil when
/// its bytes are not UTF-8.
private func requireText(_ value: String?) throws {
  if value == nil { throw InvalidStationDatabase() }
}

/// An optional string: `bytes` is nil when the field is absent, so present
/// bytes that read as nil are not UTF-8.
private func requireText(_ value: String?, _ bytes: [UInt8]?) throws {
  if bytes != nil, value == nil { throw InvalidStationDatabase() }
}
