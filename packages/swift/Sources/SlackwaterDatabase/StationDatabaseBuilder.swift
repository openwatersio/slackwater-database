import FlatBuffers
import Foundation

/// A station's whole record, ready for `StationDatabase.build`. Every field is
/// a `var`, so a test can read a database, edit stations, and write a new one.
public struct StationInput: Sendable, Equatable {
  public var id: String
  public var name: String
  public var kind: StationKind
  public var type: StationType
  public var latitude: Double
  public var longitude: Double
  public var timezone: String?
  public var locality: String?
  public var region: String?
  public var regionCode: String?
  public var country: String?
  public var countryCode: String
  public var continent: String?
  public var context: String?
  public var contextDerived: Bool
  public var cities: [String]
  /// Written lower-cased and deduplicated, as the schema promises.
  public var aliases: [String]

  public var accepted: Bool
  /// 0–255 fits the file; the quality pass writes 0–100.
  public var score: Int
  public var qualityReason: String?
  public var qualityRedundant: String?
  public var qualityIssues: [String]
  public var qualityFactors: StationQualityFactors?
  public var seasonalDominant: Bool

  public var source: StationSource?
  public var license: StationLicense?
  public var disclaimers: String?
  /// The complete notice. Nil composes one at build time from `license` and
  /// the source's entry in `build`'s `credits`. A given notice must start with
  /// the project credit and carry the licence clause `license` requires (none
  /// for a licence `StationAttribution.licenseNames` doesn't list), and then:
  /// - with a credits entry for its source, equal the notice that entry composes;
  /// - without one, be the notice `StationInput(_:)` read, with the `source`
  ///   and `license` it was read with. A hand-written notice, or a copy whose
  ///   source or licence changed, needs a credits entry or a nil attribution.
  public var attribution: String?

  /// This record's own constituents. A subordinate's are normally empty.
  public var constituents: [Station.Constituent]
  /// This record's own datums. A subordinate's are normally empty.
  public var datums: [String: Double]
  public var datumsSource: StationDatumsSource?
  public var chartDatum: String?
  public var datumFrame: StationDatumFrame?
  public var datumCoverage: StationDatumCoverage?
  public var epoch: StationEpoch?
  public var datumEpoch: StationEpoch?
  public var tideOffsets: TideOffsets?
  /// Nil fields write the format's `*Missing` flags, so nil and a measured 0 stay distinct.
  public var current: CurrentRecord?

  var preserved = PreservedFields()

  /// Everything the file stores for `station`, taken from its own record: a
  /// subordinate's reference is not resolved into its constituents, datums,
  /// epochs, or datum metadata. `attribution` is the stored notice, or nil for
  /// a file that predates the field.
  public init(_ station: Station) {
    let raw = station.raw
    let quality = raw.quality
    let current = station.current
    self.init(
      id: station.id,
      name: station.name,
      kind: station.kind,
      type: station.type,
      latitude: station.latitude,
      longitude: station.longitude,
      timezone: station.timezone,
      locality: station.locality,
      region: station.region,
      regionCode: station.regionCode,
      country: station.country,
      countryCode: station.countryCode,
      continent: station.continent,
      context: station.context,
      contextDerived: station.contextDerived,
      cities: station.cities,
      aliases: station.aliases,
      accepted: station.accepted,
      score: station.score,
      qualityReason: quality?.reason,
      qualityRedundant: quality?.redundant,
      qualityIssues: quality.map { q in (0..<q.issuesCount).compactMap { q.issues(at: $0) } } ?? [],
      qualityFactors: quality?.factors.map {
        StationQualityFactors(
          epoch: Double($0.epoch), recency: Double($0.recency), source: Double($0.source),
          quality: Double($0.quality), amplitude: Double($0.amplitude),
          coverage: Double($0.coverage))
      },
      seasonalDominant: station.seasonalDominant,
      source: station.source,
      license: station.license,
      disclaimers: raw.disclaimers,
      attribution: raw.attribution,
      constituents: station.storedConstituents,
      datums: station.storedDatums,
      datumsSource: raw.datumsSource == .observed
        ? .observed : raw.datumsSource == .harmonic ? .harmonic : nil,
      chartDatum: station.chartDatum,
      datumFrame: station.storedDatumFrame,
      datumCoverage: station.storedDatumCoverage,
      epoch: station.storedEpoch,
      datumEpoch: station.storedDatumEpoch,
      tideOffsets: station.tideOffsets,
      current: current)
    preserved.hadQualityTable = quality != nil
    preserved.readNotice = ReadNotice(
      attribution: attribution, source: source, license: license)
    if let fit = raw.current?.chsFit {
      preserved.readChsFit = current?.chsFit
      preserved.rawChsFit = RawChsFit(
        tier: fit.tier, days: fit.days, slackBoundMinutes: fit.slackBoundMinutes,
        provisionalSlackMinutes: fit.provisionalSlackMinutes)
    }
  }

  /// `kind` defaults to `.current` when `current` is set, otherwise `.tide`.
  /// `type` defaults to `.subordinate` when `tideOffsets` or `current.offsets`
  /// is set, otherwise `.reference`.
  public init(
    id: String,
    name: String,
    kind: StationKind? = nil,
    type: StationType? = nil,
    latitude: Double,
    longitude: Double,
    timezone: String? = nil,
    locality: String? = nil,
    region: String? = nil,
    regionCode: String? = nil,
    country: String? = nil,
    countryCode: String,
    continent: String? = nil,
    context: String? = nil,
    contextDerived: Bool = false,
    cities: [String] = [],
    aliases: [String] = [],
    accepted: Bool = true,
    score: Int = 0,
    qualityReason: String? = nil,
    qualityRedundant: String? = nil,
    qualityIssues: [String] = [],
    qualityFactors: StationQualityFactors? = nil,
    seasonalDominant: Bool = false,
    source: StationSource? = nil,
    license: StationLicense? = nil,
    disclaimers: String? = nil,
    attribution: String? = nil,
    constituents: [Station.Constituent] = [],
    datums: [String: Double] = [:],
    datumsSource: StationDatumsSource? = nil,
    chartDatum: String? = nil,
    datumFrame: StationDatumFrame? = nil,
    datumCoverage: StationDatumCoverage? = nil,
    epoch: StationEpoch? = nil,
    datumEpoch: StationEpoch? = nil,
    tideOffsets: TideOffsets? = nil,
    current: CurrentRecord? = nil
  ) {
    self.id = id
    self.name = name
    self.kind = kind ?? (current == nil ? .tide : .current)
    self.type = type ?? (tideOffsets != nil || current?.offsets != nil ? .subordinate : .reference)
    self.latitude = latitude
    self.longitude = longitude
    self.timezone = timezone
    self.locality = locality
    self.region = region
    self.regionCode = regionCode
    self.country = country
    self.countryCode = countryCode
    self.continent = continent
    self.context = context
    self.contextDerived = contextDerived
    self.cities = cities
    self.aliases = aliases
    self.accepted = accepted
    self.score = score
    self.qualityReason = qualityReason
    self.qualityRedundant = qualityRedundant
    self.qualityIssues = qualityIssues
    self.qualityFactors = qualityFactors
    self.seasonalDominant = seasonalDominant
    self.source = source
    self.license = license
    self.disclaimers = disclaimers
    self.attribution = attribution
    self.constituents = constituents
    self.datums = datums
    self.datumsSource = datumsSource
    self.chartDatum = chartDatum
    self.datumFrame = datumFrame
    self.datumCoverage = datumCoverage
    self.epoch = epoch
    self.datumEpoch = datumEpoch
    self.tideOffsets = tideOffsets
    self.current = current
  }
}

/// Quality scoring factors, each 0–1.
public struct StationQualityFactors: Hashable, Sendable {
  public var epoch: Double
  public var recency: Double
  public var source: Double
  public var quality: Double
  public var amplitude: Double
  public var coverage: Double

  public init(
    epoch: Double, recency: Double, source: Double, quality: Double, amplitude: Double,
    coverage: Double
  ) {
    self.epoch = epoch
    self.recency = recency
    self.source = source
    self.quality = quality
    self.amplitude = amplitude
    self.coverage = coverage
  }
}

/// How a station's datums were reduced; nil in `StationInput` writes unknown.
public enum StationDatumsSource: Hashable, Sendable {
  case observed
  case harmonic
}

/// What `StationInput(_:)` read that the public fields can't hold, so a
/// rebuild writes the record as it was stored.
struct PreservedFields: Sendable, Equatable {
  /// The TypeScript reader treats a station with no quality table as accepted
  /// and omits its `quality`, so a stored table is kept even when empty.
  var hadQualityTable = false
  /// The public reader turns an unknown tier into `.online` with no numbers;
  /// these keep the stored values while `current.chsFit` is unedited.
  var readChsFit: ChsFit?
  var rawChsFit: RawChsFit?
  /// The notice and what it was composed for, so one kept unchanged can be
  /// written without a credits entry to check it against.
  var readNotice: ReadNotice?

  // Bookkeeping, not station data: it never makes two inputs unequal.
  static func == (_: Self, _: Self) -> Bool { true }
}

struct ReadNotice: Sendable, Equatable {
  var attribution: String?
  var source: StationSource?
  var license: StationLicense?
}

struct RawChsFit: Sendable {
  var tier: UInt8
  var days: UInt16
  var slackBoundMinutes: UInt16
  var provisionalSlackMinutes: UInt16
}

/// A station or route `StationDatabase.build` refuses, with the reason.
public struct StationDatabaseBuildError: Error, Equatable, CustomStringConvertible, LocalizedError {
  public let message: String
  public init(_ message: String) { self.message = message }
  public var description: String { message }
  public var errorDescription: String? { message }
}

extension StationDatabase {
  /// Serialize stations into the `.tcdb` format, following the layout rules of
  /// the TypeScript `buildDatabase` (packages/database/src/database/builder.ts):
  /// stations sorted by id so readers can binary-search them, and every
  /// station's prediction data written before any station table, so it lands
  /// together at the tail and an identity scan touches only head pages.
  ///
  /// `credits` maps each `source.name` to its credit line, nil when it needs
  /// none. A station whose `attribution` is nil gets a notice composed from it
  /// and its `license`; one whose source has no entry is refused. A given
  /// notice is checked as `StationInput.attribution` describes.
  ///
  /// `constituentDefinitions` is the shared set (`StationDatabase.constituentDefinitions`
  /// reads it back). It must hold `@slackwater/engine`'s catalog lines as they
  /// are, which the builder can't check: a reader released before definitions
  /// predicts with its own catalog instead. Each source's own set and node corrections travel on
  /// `StationInput.source`. Each set must spell every name or alias once, and
  /// every stored constituent and every member must resolve as the readers
  /// resolve them, in the source's own set first and then the shared one,
  /// without a cycle; a subordinate whose reference is in the file is predicted
  /// from the reference's record, so its own constituents are not checked.
  /// No two of a source's definitions may replace one shared definition, and
  /// speeds aren't checked against coefficients. With an empty shared set and no
  /// source that has its own definitions or Schureman's corrections, names
  /// aren't checked and the file has no definitions, as one written before
  /// them. Stations whose sources share a name must carry the same definitions
  /// and node corrections.
  ///
  /// Throws `StationDatabaseBuildError` for what `buildDatabase` refuses, with
  /// these differences: `country` is not matched against `countryCode`, integer
  /// fields that would overflow their FlatBuffers type are refused rather than
  /// truncated, datum coverage counts must fit a 32-bit `Int`, a listed licence
  /// needs a URL, a kept `attribution` needs no credits entry while it, its
  /// source and its licence are as read, a station with tide offsets must be
  /// subordinate, and a subordinate whose tide reference is absent must carry
  /// prediction data of its own.
  public static func build(
    _ stations: [StationInput], version: String? = nil,
    routes: [StationRouteKind: [StationRoute]] = [:],
    credits: [String: String?] = [:],
    constituentDefinitions: [Station.ConstituentDefinition]
  ) throws -> Data {
    // strcmp order on UTF-8, which FlatBuffers key lookup binary-searches by.
    var sorted = stations.sorted { $0.id.utf8.lexicographicallyPrecedes($1.id.utf8) }
    for (index, station) in sorted.enumerated() {
      try requireIdentity(station)
      if index > 0, sorted[index - 1].id.utf8.elementsEqual(station.id.utf8) {
        throw StationDatabaseBuildError("duplicate station id \(station.id)")
      }
    }
    try requireReferencedData(sorted)
    try checkDefinitions(sorted, shared: constituentDefinitions)
    for index in sorted.indices {
      let station = sorted[index]
      let entry = station.source?.name.flatMap { credits[$0] }
      if let attribution = station.attribution {
        // A credits entry is the current decision, so a kept notice must match it.
        guard let credit = entry else {
          // buildDatabase requires a credit decision for every source; a notice
          // passes without one only as it was read, for the source and licence it was read with.
          let unchanged = ReadNotice(
            attribution: attribution, source: station.source, license: station.license)
          if station.preserved.readNotice != unchanged {
            throw StationDatabaseBuildError(
              "Station \(station.id) attribution can't be checked without a credits entry for its source \(station.source?.name ?? "without a name"); set attribution to nil and pass credits")
          }
          continue
        }
        let notice = StationAttribution.notice(credit: credit, license: station.license)
        if attribution != notice {
          throw StationDatabaseBuildError(
            "Station \(station.id) attribution does not match the notice its credits entry composes, \"\(notice)\"; set attribution to nil or update credits")
        }
        continue
      }
      guard let credit = entry else {
        throw StationDatabaseBuildError(
          "\(station.id): no credit decision for source \(station.source?.name ?? "without a name")")
      }
      sorted[index].attribution = StationAttribution.notice(credit: credit, license: station.license)
    }
    let preparedRoutes = try prepareRoutes(sorted, routes)
    let definitions = constituentDefinitions + sorted.flatMap { $0.source?.constituentDefinitions ?? [] }
    var writer = try DatabaseWriter(
      stations: sorted,
      sharedDefinitions: constituentDefinitions,
      constituentNames: NameTable(
        sorted.flatMap { ($0.constituents + ($0.current?.minorConstituents ?? [])).map(\.name) }
          + definitions.flatMap { [$0.name] + $0.aliases + $0.members.map(\.name) }),
      datumNames: NameTable(sorted.flatMap { $0.datums.keys }))
    return try writer.write(version: version, routes: preparedRoutes)
  }
}

private struct NameTable {
  let names: [String]
  let index: [String: UInt16]

  init(_ all: [String]) throws {
    names = Set(all).sorted { $0.utf8.lexicographicallyPrecedes($1.utf8) }
    guard names.count <= Int(UInt16.max) else {
      throw StationDatabaseBuildError("Name table overflows ushort: \(names.count) names")
    }
    index = Dictionary(uniqueKeysWithValues: names.enumerated().map { ($1, UInt16($0)) })
  }
}

private struct DatabaseWriter {
  let stations: [StationInput]
  let sharedDefinitions: [Station.ConstituentDefinition]
  let constituentNames: NameTable
  let datumNames: NameTable
  var fbb: FlatBufferBuilder
  // Source, license, and epoch tables repeat across most of a catalog, so
  // identical ones are written once and shared.
  var sourceOffsets: [StationSource: Offset] = [:]
  var licenseOffsets: [StationLicense: Offset] = [:]
  var epochOffsets: [StationEpoch: Offset] = [:]
  // A source's definitions, written once and shared by its stations.
  var definitionOffsets: [[Station.ConstituentDefinition]: Offset] = [:]

  init(
    stations: [StationInput], sharedDefinitions: [Station.ConstituentDefinition],
    constituentNames: NameTable, datumNames: NameTable
  ) {
    self.stations = stations
    self.sharedDefinitions = sharedDefinitions
    self.constituentNames = constituentNames
    self.datumNames = datumNames
    fbb = FlatBufferBuilder(initialSize: Int32(clamping: max(1 << 16, stations.count * 1536)))
  }

  mutating func str(_ value: String?) -> Offset { fbb.createShared(string: value) }

  mutating func sharedStrings(_ values: [String]) -> Offset {
    let offsets = values.map { fbb.createShared(string: $0) }
    return fbb.createVector(ofOffsets: offsets)
  }

  mutating func write(version: String?, routes: [StationRouteKind: [StationRoute]]) throws
    -> Data
  {
    // Phase 1: definitions, prediction vectors and quality detail, which land at the tail.
    let sharedDefinitionsVector = writeDefinitions(sharedDefinitions)
    for station in stations {
      guard let own = station.source?.constituentDefinitions, !own.isEmpty,
        definitionOffsets[own] == nil
      else { continue }
      definitionOffsets[own] = writeDefinitions(own)
    }
    var prediction: [(constituents: Offset, minor: Offset, datums: Offset, quality: Offset)] = []
    prediction.reserveCapacity(stations.count)
    for station in stations {
      let constituents = writeConstituents(station.constituents)
      let minor = writeConstituents(station.current?.minorConstituents ?? [])
      let datums = writeDatums(station.datums)
      let quality = writeQuality(station)
      prediction.append((constituents, minor, datums, quality))
    }

    // Phase 2: identity, sub-tables, and the station tables, which land at the head.
    var stationOffsets: [Offset] = []
    stationOffsets.reserveCapacity(stations.count)
    for (index, station) in stations.enumerated() {
      stationOffsets.append(try writeStation(station, prediction: prediction[index]))
    }

    let tideRoutes = writeRoutes(routes[.tide] ?? [])
    let currentRoutes = writeRoutes(routes[.current] ?? [])

    // Phase 3: the root, at the very head.
    let stationsVector = fbb.createVector(ofOffsets: stationOffsets)
    let constituentNamesVector = sharedStrings(constituentNames.names)
    let datumNamesVector = sharedStrings(datumNames.names)
    let versionOffset = str(version)
    let root = Slackwater_Root.startRoot(&fbb)
    Slackwater_Root.add(version: versionOffset, &fbb)
    Slackwater_Root.addVectorOf(stations: stationsVector, &fbb)
    Slackwater_Root.addVectorOf(constituentNames: constituentNamesVector, &fbb)
    Slackwater_Root.addVectorOf(datumNames: datumNamesVector, &fbb)
    Slackwater_Root.addVectorOf(tideRoutes: tideRoutes, &fbb)
    Slackwater_Root.addVectorOf(currentRoutes: currentRoutes, &fbb)
    Slackwater_Root.add(formatVersion: UInt16(StationDatabase.formatVersion), &fbb)
    Slackwater_Root.addVectorOf(constituentDefinitions: sharedDefinitionsVector, &fbb)
    Slackwater_Root.finish(&fbb, end: Slackwater_Root.endRoot(&fbb, start: root))
    return fbb.data
  }

  mutating func writeConstituents(_ constituents: [Station.Constituent]) -> Offset {
    guard !constituents.isEmpty else { return Offset() }
    let structs = constituents.map {
      Slackwater_Constituent(
        name: constituentNames.index[$0.name]!, amplitude: Float($0.amplitude),
        phase: Float($0.phase))
    }
    return fbb.createVector(ofStructs: structs)
  }

  mutating func writeDefinitions(_ definitions: [Station.ConstituentDefinition]) -> Offset {
    guard !definitions.isEmpty else { return Offset() }
    let tables = definitions.map { d -> Offset in
      // checkDefinitions keeps every coefficient inside Int8.
      let coefficients = d.coefficients.map { fbb.createVector($0.map { Int8($0) }) } ?? Offset()
      let members =
        d.members.isEmpty
        ? Offset()
        : fbb.createVector(
          ofStructs: d.members.map {
            Slackwater_ConstituentMember(
              name: constituentNames.index[$0.name]!, factor: Float($0.factor))
          })
      let aliases =
        d.aliases.isEmpty ? Offset() : fbb.createVector(d.aliases.map { constituentNames.index[$0]! })
      return Slackwater_ConstituentDefinition.createConstituentDefinition(
        &fbb, name: constituentNames.index[d.name]!, speed: d.speed,
        coefficientsVectorOffset: coefficients, membersVectorOffset: members,
        aliasesVectorOffset: aliases)
    }
    return fbb.createVector(ofOffsets: tables)
  }

  mutating func writeDatums(_ datums: [String: Double]) -> Offset {
    guard !datums.isEmpty else { return Offset() }
    let structs = datums.keys.sorted().map {
      Slackwater_Datum(name: datumNames.index[$0]!, value: Float(datums[$0]!))
    }
    return fbb.createVector(ofStructs: structs)
  }

  mutating func writeQuality(_ s: StationInput) -> Offset {
    // The TypeScript reader reads a station without this table as accepted.
    guard
      s.qualityFactors != nil || !s.qualityIssues.isEmpty || s.qualityReason != nil
        || s.qualityRedundant != nil || s.seasonalDominant || !s.accepted || s.score != 0
        || s.preserved.hadQualityTable
    else { return Offset() }
    let issues = s.qualityIssues.isEmpty ? Offset() : sharedStrings(s.qualityIssues)
    let reason = str(s.qualityReason)
    let redundant = str(s.qualityRedundant)
    let start = Slackwater_Quality.startQuality(&fbb)
    // Structs are written inline at the add site.
    Slackwater_Quality.add(
      factors: s.qualityFactors.map {
        Slackwater_QualityFactors(
          epoch: Float($0.epoch), recency: Float($0.recency), source: Float($0.source),
          quality: Float($0.quality), amplitude: Float($0.amplitude),
          coverage: Float($0.coverage))
      }, &fbb)
    Slackwater_Quality.addVectorOf(issues: issues, &fbb)
    Slackwater_Quality.add(reason: reason, &fbb)
    Slackwater_Quality.add(redundant: redundant, &fbb)
    if s.seasonalDominant { Slackwater_Quality.add(seasonalDominant: true, &fbb) }
    return Slackwater_Quality.endQuality(&fbb, start: start)
  }

  mutating func writeEpoch(_ epoch: StationEpoch?) -> Offset {
    guard let epoch else { return Offset() }
    if let offset = epochOffsets[epoch] { return offset }
    // The reader returns "" for an absent bound, so "" writes it absent again.
    let start = str(epoch.start.isEmpty ? nil : epoch.start)
    let end = str(epoch.end.isEmpty ? nil : epoch.end)
    let table = Slackwater_Epoch.startEpoch(&fbb)
    Slackwater_Epoch.add(start: start, &fbb)
    Slackwater_Epoch.add(end: end, &fbb)
    let offset = Slackwater_Epoch.endEpoch(&fbb, start: table)
    epochOffsets[epoch] = offset
    return offset
  }

  mutating func writeSource(_ source: StationSource?) -> Offset {
    guard let source else { return Offset() }
    if let offset = sourceOffsets[source] { return offset }
    let name = str(source.name)
    let id = str(source.id)
    let url = str(source.url)
    let start = Slackwater_Source.startSource(&fbb)
    Slackwater_Source.add(name: name, &fbb)
    Slackwater_Source.add(id: id, &fbb)
    Slackwater_Source.add(url: url, &fbb)
    Slackwater_Source.add(publishedHarmonics: source.publishedHarmonics, &fbb)
    Slackwater_Source.addVectorOf(
      constituentDefinitions: definitionOffsets[source.constituentDefinitions] ?? Offset(), &fbb)
    Slackwater_Source.add(
      nodeCorrections: source.nodeCorrections == .schureman ? .schureman : .iho, &fbb)
    let offset = Slackwater_Source.endSource(&fbb, start: start)
    sourceOffsets[source] = offset
    return offset
  }

  mutating func writeLicense(_ license: StationLicense?) -> Offset {
    guard let license else { return Offset() }
    if let offset = licenseOffsets[license] { return offset }
    let type = str(license.type)
    let url = str(license.url)
    let notes = str(license.notes)
    let start = Slackwater_License.startLicense(&fbb)
    Slackwater_License.add(type: type, &fbb)
    Slackwater_License.add(url: url, &fbb)
    Slackwater_License.add(notes: notes, &fbb)
    Slackwater_License.add(commercialUse: license.commercialUse, &fbb)
    let offset = Slackwater_License.endLicense(&fbb, start: start)
    licenseOffsets[license] = offset
    return offset
  }

  mutating func writeTideOffsets(_ offsets: TideOffsets?, id: String) throws -> Offset {
    guard let offsets else { return Offset() }
    let timeHigh = try int32(offsets.timeHigh, "offsets.timeHigh", id)
    let timeLow = try int32(offsets.timeLow, "offsets.timeLow", id)
    let reference = str(offsets.reference)
    let start = Slackwater_TideOffsets.startTideOffsets(&fbb)
    Slackwater_TideOffsets.add(reference: reference, &fbb)
    Slackwater_TideOffsets.add(timeHigh: timeHigh, &fbb)
    Slackwater_TideOffsets.add(timeLow: timeLow, &fbb)
    if offsets.heightType == .fixed { Slackwater_TideOffsets.add(heightType: .fixed, &fbb) }
    Slackwater_TideOffsets.add(heightHigh: Float(offsets.heightHigh), &fbb)
    Slackwater_TideOffsets.add(heightLow: Float(offsets.heightLow), &fbb)
    return Slackwater_TideOffsets.endTideOffsets(&fbb, start: start)
  }

  mutating func writeChsFit(_ fit: ChsFit?, preserved: PreservedFields, id: String) throws
    -> Offset
  {
    guard let fit else { return Offset() }
    let stored: RawChsFit
    if let raw = preserved.rawChsFit, preserved.readChsFit == fit {
      stored = raw
    } else {
      // ushort fields where 0 means absent.
      for (key, value) in [
        ("days", fit.days), ("slackBoundMinutes", fit.slackBoundMinutes),
        ("provisionalSlackMinutes", fit.provisionalSlackMinutes),
      ] {
        if let value, !(1...Int(UInt16.max)).contains(value) {
          throw StationDatabaseBuildError(
            "\(id): chsFit.\(key) \(value) is not a whole number from 1 to 65535")
        }
      }
      let tier: Slackwater_ChsFitTier =
        switch fit.tier {
        case .final: .final_
        case .bounded: .bounded
        case .online: .online
        }
      stored = RawChsFit(
        tier: tier.rawValue, days: UInt16(fit.days ?? 0),
        slackBoundMinutes: UInt16(fit.slackBoundMinutes ?? 0),
        provisionalSlackMinutes: UInt16(fit.provisionalSlackMinutes ?? 0))
    }
    var miss = Offset()
    if let m = fit.miss {
      let clause = str(m.clause)
      let start = Slackwater_ChsFitMiss.startChsFitMiss(&fbb)
      Slackwater_ChsFitMiss.add(clause: clause, &fbb)
      if let value = m.value {
        Slackwater_ChsFitMiss.add(value: value, &fbb)
      } else {
        Slackwater_ChsFitMiss.add(valueMissing: true, &fbb)
      }
      if m.nearBar { Slackwater_ChsFitMiss.add(nearBar: true, &fbb) }
      miss = Slackwater_ChsFitMiss.endChsFitMiss(&fbb, start: start)
    }
    let missContext = str(fit.missContext)
    let evidence = str(fit.evidence)
    let start = Slackwater_ChsFit.startChsFit(&fbb)
    // Zeros are the defaults, so absent values are not written.
    Slackwater_ChsFit.add(tier: stored.tier, &fbb)
    Slackwater_ChsFit.add(days: stored.days, &fbb)
    Slackwater_ChsFit.add(slackBoundMinutes: stored.slackBoundMinutes, &fbb)
    Slackwater_ChsFit.add(provisionalSlackMinutes: stored.provisionalSlackMinutes, &fbb)
    Slackwater_ChsFit.add(miss: miss, &fbb)
    Slackwater_ChsFit.add(missContext: missContext, &fbb)
    Slackwater_ChsFit.add(evidence: evidence, &fbb)
    return Slackwater_ChsFit.endChsFit(&fbb, start: start)
  }

  mutating func writeCurrentOffsets(_ o: CurrentOffsets?, id: String) throws -> Offset {
    guard let o else { return Offset() }
    let slackBeforeFlood = try o.slackBeforeFlood.map { try int32($0, "slackBeforeFlood", id) }
    let slackBeforeEbb = try o.slackBeforeEbb.map { try int32($0, "slackBeforeEbb", id) }
    let floodTime = try o.floodTime.map { try int32($0, "floodTime", id) }
    let ebbTime = try o.ebbTime.map { try int32($0, "ebbTime", id) }
    let reference = str(o.reference)
    let start = Slackwater_CurrentOffsets.startCurrentOffsets(&fbb)
    Slackwater_CurrentOffsets.add(reference: reference, &fbb)
    if let v = slackBeforeFlood { Slackwater_CurrentOffsets.add(slackBeforeFlood: v, &fbb) }
    if let v = slackBeforeEbb { Slackwater_CurrentOffsets.add(slackBeforeEbb: v, &fbb) }
    if let v = floodTime { Slackwater_CurrentOffsets.add(floodTime: v, &fbb) }
    if let v = ebbTime { Slackwater_CurrentOffsets.add(ebbTime: v, &fbb) }
    if let v = o.floodSpeedRatio {
      Slackwater_CurrentOffsets.add(floodSpeedRatio: Float(v), &fbb)
    }
    if let v = o.ebbSpeedRatio { Slackwater_CurrentOffsets.add(ebbSpeedRatio: Float(v), &fbb) }
    if slackBeforeFlood == nil {
      Slackwater_CurrentOffsets.add(slackBeforeFloodMissing: true, &fbb)
    }
    if slackBeforeEbb == nil { Slackwater_CurrentOffsets.add(slackBeforeEbbMissing: true, &fbb) }
    if floodTime == nil { Slackwater_CurrentOffsets.add(floodTimeMissing: true, &fbb) }
    if ebbTime == nil { Slackwater_CurrentOffsets.add(ebbTimeMissing: true, &fbb) }
    if o.floodSpeedRatio == nil {
      Slackwater_CurrentOffsets.add(floodSpeedRatioMissing: true, &fbb)
    }
    if o.ebbSpeedRatio == nil { Slackwater_CurrentOffsets.add(ebbSpeedRatioMissing: true, &fbb) }
    return Slackwater_CurrentOffsets.endCurrentOffsets(&fbb, start: start)
  }

  mutating func writeCurrent(
    _ c: CurrentRecord?, minor: Offset, preserved: PreservedFields, id: String
  ) throws -> Offset {
    guard let c else { return Offset() }
    var derived = Offset()
    if let d = c.derived {
      let high = try int32(d.highWaterLagMinutes, "derived.highWaterLagMinutes", id)
      let low = try int32(d.lowWaterLagMinutes, "derived.lowWaterLagMinutes", id)
      let reference = str(d.reference)
      let start = Slackwater_TideDerivedCurrent.startTideDerivedCurrent(&fbb)
      Slackwater_TideDerivedCurrent.add(reference: reference, &fbb)
      Slackwater_TideDerivedCurrent.add(highWaterLagMinutes: high, &fbb)
      Slackwater_TideDerivedCurrent.add(lowWaterLagMinutes: low, &fbb)
      derived = Slackwater_TideDerivedCurrent.endTideDerivedCurrent(&fbb, start: start)
    }
    let chsFit = try writeChsFit(c.chsFit, preserved: preserved, id: id)
    let offsets = try writeCurrentOffsets(c.offsets, id: id)
    let tideReference = str(c.tideReference)
    let magnitudeNote = str(c.magnitudeNote)
    let start = Slackwater_Current.startCurrent(&fbb)
    if let v = c.floodDirection { Slackwater_Current.add(floodDirection: Float(v), &fbb) }
    if let v = c.ebbDirection { Slackwater_Current.add(ebbDirection: Float(v), &fbb) }
    if let v = c.meanFlow { Slackwater_Current.add(meanFlow: Float(v), &fbb) }
    if c.floodDirection == nil { Slackwater_Current.add(floodDirectionMissing: true, &fbb) }
    if c.ebbDirection == nil { Slackwater_Current.add(ebbDirectionMissing: true, &fbb) }
    if c.meanFlow == nil { Slackwater_Current.add(meanFlowMissing: true, &fbb) }
    Slackwater_Current.add(tideReference: tideReference, &fbb)
    Slackwater_Current.add(offsets: offsets, &fbb)
    Slackwater_Current.add(magnitudeNote: magnitudeNote, &fbb)
    Slackwater_Current.add(derived: derived, &fbb)
    Slackwater_Current.add(chsFit: chsFit, &fbb)
    Slackwater_Current.addVectorOf(minorConstituents: minor, &fbb)
    Slackwater_Current.add(minorMeanFlow: c.minorMeanFlow.map { Float($0) }, &fbb)
    Slackwater_Current.add(azimuth: c.azimuth.map { Float($0) }, &fbb)
    return Slackwater_Current.endCurrent(&fbb, start: start)
  }

  mutating func writeDatumCoverage(_ coverage: StationDatumCoverage?, id: String) throws -> Offset {
    guard let coverage else { return Offset() }
    let months = try coverageCount(coverage.months, "datumCoverage.months", id)
    let observed = try coverageCount(coverage.observedHours, "datumCoverage.observedHours", id)
    let inferred = try coverageCount(coverage.inferredHours, "datumCoverage.inferredHours", id)
    let start = Slackwater_DatumCoverage.startDatumCoverage(&fbb)
    Slackwater_DatumCoverage.add(months: months, &fbb)
    Slackwater_DatumCoverage.add(observedHours: observed, &fbb)
    Slackwater_DatumCoverage.add(inferredHours: inferred, &fbb)
    return Slackwater_DatumCoverage.endDatumCoverage(&fbb, start: start)
  }

  mutating func writeStation(
    _ s: StationInput,
    prediction: (constituents: Offset, minor: Offset, datums: Offset, quality: Offset)
  ) throws -> Offset {
    guard (0...Int(UInt8.max)).contains(s.score) else {
      throw StationDatabaseBuildError("\(s.id): score \(s.score) does not fit a ubyte")
    }
    let id = fbb.create(string: s.id)
    let name = str(s.name)
    let timezone = str(s.timezone)
    let locality = str(s.locality)
    let region = str(s.region)
    let regionCode = str(s.regionCode)
    let country = str(s.country)
    let countryCode = str(s.countryCode)
    let continent = str(s.continent)
    let context = str(s.context)
    let chartDatum = str(s.chartDatum)
    let disclaimers = str(s.disclaimers)
    let aliases =
      s.aliases.isEmpty ? Offset() : sharedStrings(unique(s.aliases.map { $0.lowercased() }))
    let cities = s.cities.isEmpty ? Offset() : sharedStrings(unique(s.cities))
    let epoch = writeEpoch(s.epoch)
    let datumEpoch = writeEpoch(s.datumEpoch)
    let source = writeSource(s.source)
    let attribution = str(s.attribution)
    let license = writeLicense(s.license)
    let offsets = try writeTideOffsets(s.tideOffsets, id: s.id)
    let current = try writeCurrent(
      s.current, minor: prediction.minor, preserved: s.preserved, id: s.id)
    let datumCoverage = try writeDatumCoverage(s.datumCoverage, id: s.id)

    let start = Slackwater_Station.startStation(&fbb)
    Slackwater_Station.add(id: id, &fbb)
    Slackwater_Station.add(name: name, &fbb)
    if s.kind == .current { Slackwater_Station.add(kind: .current, &fbb) }
    if s.type == .subordinate { Slackwater_Station.add(type: .subordinate, &fbb) }
    Slackwater_Station.add(latitude: s.latitude, &fbb)
    Slackwater_Station.add(longitude: s.longitude, &fbb)
    Slackwater_Station.add(timezone: timezone, &fbb)
    Slackwater_Station.add(region: region, &fbb)
    Slackwater_Station.add(country: country, &fbb)
    Slackwater_Station.add(continent: continent, &fbb)
    Slackwater_Station.addVectorOf(aliases: aliases, &fbb)
    if s.accepted { Slackwater_Station.add(accepted: true, &fbb) }
    Slackwater_Station.add(score: UInt8(s.score), &fbb)
    Slackwater_Station.addVectorOf(constituents: prediction.constituents, &fbb)
    Slackwater_Station.addVectorOf(datums: prediction.datums, &fbb)
    switch s.datumsSource {
    case .observed: Slackwater_Station.add(datumsSource: .observed, &fbb)
    case .harmonic: Slackwater_Station.add(datumsSource: .harmonic, &fbb)
    case nil: break
    }
    Slackwater_Station.add(chartDatum: chartDatum, &fbb)
    Slackwater_Station.add(offsets: offsets, &fbb)
    Slackwater_Station.add(current: current, &fbb)
    Slackwater_Station.add(epoch: epoch, &fbb)
    Slackwater_Station.add(datumEpoch: datumEpoch, &fbb)
    Slackwater_Station.add(datumCoverage: datumCoverage, &fbb)
    switch s.datumFrame {
    case .gauge: Slackwater_Station.add(datumFrame: .gauge, &fbb)
    case .constituent: Slackwater_Station.add(datumFrame: .constituent, &fbb)
    case nil: break
    }
    Slackwater_Station.add(quality: prediction.quality, &fbb)
    Slackwater_Station.add(source: source, &fbb)
    Slackwater_Station.add(license: license, &fbb)
    Slackwater_Station.add(disclaimers: disclaimers, &fbb)
    Slackwater_Station.add(attribution: attribution, &fbb)
    Slackwater_Station.add(locality: locality, &fbb)
    Slackwater_Station.add(regionCode: regionCode, &fbb)
    Slackwater_Station.add(countryCode: countryCode, &fbb)
    Slackwater_Station.add(context: context, &fbb)
    if s.contextDerived { Slackwater_Station.add(contextDerived: true, &fbb) }
    Slackwater_Station.addVectorOf(cities: cities, &fbb)
    return Slackwater_Station.endStation(&fbb, start: start)
  }

  mutating func writeRoutes(_ routes: [StationRoute]) -> Offset {
    guard !routes.isEmpty else { return Offset() }
    let offsets = routes.map { route -> Offset in
      let slug = fbb.create(string: route.slug)
      let stationIDs = sharedStrings(route.stationIDs)
      let formerPaths = route.formerPaths.isEmpty ? Offset() : sharedStrings(route.formerPaths)
      let start = Slackwater_StationRoute.startStationRoute(&fbb)
      Slackwater_StationRoute.add(slug: slug, &fbb)
      Slackwater_StationRoute.addVectorOf(stationIds: stationIDs, &fbb)
      Slackwater_StationRoute.addVectorOf(formerPaths: formerPaths, &fbb)
      return Slackwater_StationRoute.endStationRoute(&fbb, start: start)
    }
    return fbb.createVector(ofOffsets: offsets)
  }
}

private func int32(_ value: Int, _ field: String, _ id: String) throws -> Int32 {
  guard let result = Int32(exactly: value) else {
    throw StationDatabaseBuildError("\(id): \(field) \(value) does not fit an int")
  }
  return result
}

/// A `uint` the verifying open accepts: one that fits `Int` on a 32-bit watch.
private func coverageCount(_ value: Int, _ field: String, _ id: String) throws -> UInt32 {
  guard (0...Int(Int32.max)).contains(value) else {
    throw StationDatabaseBuildError("\(id): \(field) \(value) is not from 0 to \(Int32.max)")
  }
  return UInt32(value)
}

private func unique(_ values: [String]) -> [String] {
  var seen = Set<String>()
  return values.filter { seen.insert($0).inserted }
}

private func isBlank(_ value: String?) -> Bool {
  value?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true
}

private func isUpperASCII(_ c: UInt8) -> Bool { (0x41...0x5A).contains(c) }
private func isDigitASCII(_ c: UInt8) -> Bool { (0x30...0x39).contains(c) }

/// ^[A-Z]{2}$
private func isCountryCode(_ code: String) -> Bool {
  let bytes = Array(code.utf8)
  return bytes.count == 2 && bytes.allSatisfy(isUpperASCII)
}

/// ^[A-Z]{2}-[A-Z0-9]{1,3}$
private func isRegionCode(_ code: String) -> Bool {
  let bytes = Array(code.utf8)
  return (4...6).contains(bytes.count) && bytes[0..<2].allSatisfy(isUpperASCII)
    && bytes[2] == 0x2D && bytes[3...].allSatisfy { isUpperASCII($0) || isDigitASCII($0) }
}

/// ^[a-z0-9-]+$
private func isSlug(_ slug: String) -> Bool {
  !slug.isEmpty
    && slug.utf8.allSatisfy { (0x61...0x7A).contains($0) || isDigitASCII($0) || $0 == 0x2D }
}

private func label(_ kind: StationKind) -> String { kind == .tide ? "tide" : "current" }

private func requireIdentity(_ station: StationInput) throws {
  let id = station.id
  if isBlank(id) { throw StationDatabaseBuildError("Station has no id") }
  if station.kind == .tide, station.current != nil {
    throw StationDatabaseBuildError("Station \(id) declares tide kind with current data")
  }
  // The TypeScript reader resolves tide offsets only for a subordinate.
  if station.type == .reference, station.tideOffsets != nil {
    throw StationDatabaseBuildError("Station \(id) carries tide offsets but is not subordinate")
  }
  if let v = station.current?.minorMeanFlow, !v.isFinite {
    throw StationDatabaseBuildError("\(id): minorMeanFlow must be finite when present")
  }
  if let v = station.current?.azimuth, !v.isFinite {
    throw StationDatabaseBuildError("\(id): azimuth must be finite when present")
  }
  if let minor = station.current?.minorConstituents,
    minor.contains(where: { $0.name.isEmpty || !$0.amplitude.isFinite || !$0.phase.isFinite })
  {
    throw StationDatabaseBuildError("\(id): invalid minor constituents")
  }
  for (field, value) in [
    ("name", station.name), ("timezone", station.timezone), ("continent", station.continent),
  ] where isBlank(value) {
    throw StationDatabaseBuildError("Station \(id) has no \(field)")
  }
  if !station.latitude.isFinite || !station.longitude.isFinite || abs(station.latitude) > 90
    || abs(station.longitude) > 180
  {
    throw StationDatabaseBuildError("Station \(id) has invalid coordinates")
  }
  if let attribution = station.attribution,
    !attribution.hasPrefix(StationAttribution.projectCredit)
  {
    throw StationDatabaseBuildError(
      "Station \(id) attribution must start with the project credit; set it to nil to compose one")
  }
  if station.source == nil { throw StationDatabaseBuildError("Station \(id) has no source") }
  guard let license = station.license else {
    throw StationDatabaseBuildError("Station \(id) has no license")
  }
  // A kept notice must still carry what the station's licence requires, so an
  // edited licence can't ship under the notice of the old one.
  if let clause = StationAttribution.licenseClause(license) {
    if license.url?.isEmpty ?? true {
      throw StationDatabaseBuildError(
        "Station \(id) license \(license.type ?? "") has no url, which its notice must give")
    }
    if let attribution = station.attribution, !attribution.hasSuffix(clause) {
      throw StationDatabaseBuildError(
        "Station \(id) attribution does not end with its license notice \"\(clause)\"; set it to nil to compose one")
    }
  } else if let attribution = station.attribution, StationAttribution.carriesLicenseClause(attribution) {
    throw StationDatabaseBuildError(
      "Station \(id) attribution names a licence its license \(license.type ?? "without a type") does not need; set it to nil to compose one")
  }
  if station.country?.isEmpty ?? true {
    throw StationDatabaseBuildError("Station \(id) has no country; the schema requires one")
  }
  guard isCountryCode(station.countryCode) else {
    throw StationDatabaseBuildError(
      "Station \(id) has invalid country_code \"\(station.countryCode)\"")
  }
  // builder.ts also checks country against country_code with the JS-only
  // country-code-lookup package; this package carries no country table, so it skips that match.
  if let regionCode = station.regionCode, !regionCode.isEmpty,
    !isRegionCode(regionCode) || !regionCode.hasPrefix("\(station.countryCode)-")
  {
    throw StationDatabaseBuildError(
      "Station \(id) region_code \(regionCode) does not match \(station.countryCode)")
  }
}

/// The TypeScript reader predicts a subordinate whose tide reference is absent
/// from the subordinate's own record, and throws when that record is empty.
/// Current offsets and `tideReference` are not checked: neither reader resolves
/// them, and a current's tide reference can live in another file.
private func requireReferencedData(_ stations: [StationInput]) throws {
  let ids = Set(stations.map(\.id))
  for station in stations where station.type == .subordinate {
    guard let reference = station.tideOffsets?.reference, !ids.contains(reference),
      station.constituents.isEmpty, station.datums.isEmpty
    else { continue }
    throw StationDatabaseBuildError(
      "Station \(station.id) references missing station \(reference) and has no prediction data of its own")
  }
}

/// What `checkDefinitions` in packages/database/src/database/definitions.ts refuses.
private func checkDefinitions(
  _ stations: [StationInput], shared: [Station.ConstituentDefinition]
) throws {
  let common = try bySpelling(shared, "shared definitions")
  try requireMembers(shared, own: [:], common, "shared definitions")
  var sources: [[Station.ConstituentDefinition]: [String: Station.ConstituentDefinition]] = [:]
  // A TypeScript reader keys a source's definitions by its name.
  var byName: [String: StationSource] = [:]
  let ids = Set(stations.map(\.id))
  let changesPredictions = stations.contains {
    guard let source = $0.source else { return false }
    return !source.constituentDefinitions.isEmpty || source.nodeCorrections != .iho
  }
  for station in stations {
    if let source = station.source, let name = source.name {
      if let first = byName[name] {
        if first.constituentDefinitions != source.constituentDefinitions
          || first.nodeCorrections != source.nodeCorrections
        {
          throw StationDatabaseBuildError(
            "\(name): stations of one source carry different constituent definitions or node corrections")
        }
      } else {
        byName[name] = source
      }
    }
    let set = station.source?.constituentDefinitions ?? []
    let own: [String: Station.ConstituentDefinition]
    if let known = sources[set] {
      own = known
    } else {
      let label = station.source?.name ?? "Station \(station.id) source"
      own = try bySpelling(set, label)
      try requireMembers(set, own: own, common, label)
      try requireOneReplacement(own, common, label)
      sources[set] = own
    }
    // A file without definitions, as one written before them.
    if shared.isEmpty, !changesPredictions { continue }
    // Readers predict a subordinate whose reference is in the file from the reference's record.
    if station.type == .subordinate, let reference = station.tideOffsets?.reference,
      ids.contains(reference)
    {
      continue
    }
    for c in station.constituents + (station.current?.minorConstituents ?? [])
    where own[c.name] == nil && common[c.name] == nil {
      throw StationDatabaseBuildError("\(station.id): no definition for constituent \(c.name)")
    }
  }
}

/// The definition a reader picks for `name`, as `Station.constituentDefinitions` does.
private func pick(
  _ name: String, own: [String: Station.ConstituentDefinition],
  _ common: [String: Station.ConstituentDefinition]
) -> Station.ConstituentDefinition? {
  if let mine = own[name] { return mine }
  guard let shared = common[name] else { return nil }
  return ([shared.name] + shared.aliases).lazy.compactMap { own[$0] }.first ?? shared
}

/// Every member of `set` resolves, and no definition leads back to itself
/// through its members.
private func requireMembers(
  _ set: [Station.ConstituentDefinition], own: [String: Station.ConstituentDefinition],
  _ common: [String: Station.ConstituentDefinition], _ label: String
) throws {
  for d in set {
    for member in d.members where pick(member.name, own: own, common) == nil {
      throw StationDatabaseBuildError(
        "\(label): \(d.name) names member \(member.name), which nothing defines")
    }
  }
  // A cycle through shared definitions alone shows when the shared set is
  // checked, so walking from this set's definitions finds every other one.
  var done = Set<Station.ConstituentDefinition>()
  for d in set {
    var path = Set<Station.ConstituentDefinition>()
    func visit(_ definition: Station.ConstituentDefinition) throws {
      if done.contains(definition) { return }
      guard path.insert(definition).inserted else {
        throw StationDatabaseBuildError("\(label): \(d.name) is cyclic through its members")
      }
      for member in definition.members {
        if let next = pick(member.name, own: own, common) { try visit(next) }
      }
      path.remove(definition)
      done.insert(definition)
    }
    try visit(d)
  }
}

/// No two of a source's definitions replace one shared definition under
/// different spellings, and no one replaces two: the engine would get two
/// lines for one entry, or one line for two.
private func requireOneReplacement(
  _ own: [String: Station.ConstituentDefinition],
  _ common: [String: Station.ConstituentDefinition], _ label: String
) throws {
  for shared in Set(common.values) {
    var replacing: [Station.ConstituentDefinition] = []
    for spelling in [shared.name] + shared.aliases {
      if let d = own[spelling], !replacing.contains(d) { replacing.append(d) }
    }
    if replacing.count > 1 {
      throw StationDatabaseBuildError(
        "\(label): \(replacing.map(\.name).joined(separator: " and ")) both replace the shared \(shared.name)")
    }
  }
  for d in Set(own.values) {
    var replaced: [Station.ConstituentDefinition] = []
    for spelling in [d.name] + d.aliases {
      if let shared = common[spelling], !replaced.contains(shared) { replaced.append(shared) }
    }
    if replaced.count > 1 {
      throw StationDatabaseBuildError(
        "\(label): \(d.name) replaces both the shared \(replaced.map(\.name).joined(separator: " and "))")
    }
  }
}

/// `definitions` by every name and alias, after checking each definition is
/// well formed and each spelling appears once.
private func bySpelling(_ definitions: [Station.ConstituentDefinition], _ label: String) throws
  -> [String: Station.ConstituentDefinition]
{
  var index: [String: Station.ConstituentDefinition] = [:]
  for d in definitions {
    guard !d.name.isEmpty, d.speed.isFinite, d.speed >= 0 else {
      throw StationDatabaseBuildError(
        "\(label): \(d.name.isEmpty ? "a definition" : d.name) has no name or a bad speed")
    }
    if let c = d.coefficients, c.count != 7 || c.contains(where: { Int8(exactly: $0) == nil }) {
      throw StationDatabaseBuildError("\(label): \(d.name) needs 7 integer coefficients or nil")
    }
    if d.coefficients == nil, d.members.isEmpty {
      throw StationDatabaseBuildError("\(label): \(d.name) has neither coefficients nor members")
    }
    // The file stores a factor as a float.
    if d.members.contains(where: { $0.name.isEmpty || !Float($0.factor).isFinite }) {
      throw StationDatabaseBuildError("\(label): \(d.name) has a malformed member")
    }
    if d.aliases.contains("") {
      throw StationDatabaseBuildError("\(label): \(d.name) has an empty alias")
    }
    for spelling in [d.name] + d.aliases {
      guard index.updateValue(d, forKey: spelling) == nil else {
        throw StationDatabaseBuildError("\(label): \(spelling) is defined twice")
      }
    }
  }
  return index
}

private func prepareRoutes(
  _ stations: [StationInput], _ routes: [StationRouteKind: [StationRoute]]
) throws -> [StationRouteKind: [StationRoute]] {
  var kinds: [String: StationKind] = [:]
  for station in stations { kinds[station.id] = station.kind }
  var prepared: [StationRouteKind: [StationRoute]] = [:]
  for (routeKind, stationKind) in [(StationRouteKind.tide, StationKind.tide), (.current, .current)] {
    let name = label(stationKind)
    var slugs = Set<String>()
    var records: [StationRoute] = []
    for route in routes[routeKind] ?? [] {
      if !isSlug(route.slug) || slugs.contains(route.slug) {
        throw StationDatabaseBuildError(
          "\(name) route has invalid or duplicate slug \"\(route.slug)\"")
      }
      if route.stationIDs.isEmpty {
        throw StationDatabaseBuildError("\(name)/\(route.slug) has no station ids")
      }
      for id in route.stationIDs {
        guard let kind = kinds[id] else {
          throw StationDatabaseBuildError("\(name)/\(route.slug) references missing station \(id)")
        }
        if kind != stationKind {
          throw StationDatabaseBuildError(
            "\(name)/\(route.slug) references \(label(kind)) station \(id)")
        }
      }
      slugs.insert(route.slug)
      records.append(
        StationRoute(
          slug: route.slug, stationIDs: unique(route.stationIDs),
          formerPaths: unique(route.formerPaths)))
    }
    prepared[routeKind] = records.sorted { $0.slug.utf8.lexicographicallyPrecedes($1.slug.utf8) }
  }
  return prepared
}
