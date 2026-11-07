import Foundation
import XCTest

@testable import SlackwaterDatabase

/// Writes databases through `StationDatabase.build` and reads them back with
/// the same reader that opens the TypeScript-built fixture.
final class StationDatabaseBuilderTests: XCTestCase {
  func fixture() throws -> StationDatabase {
    try StationDatabase(contentsOf: StationDatabaseTests.url)
  }

  func routes(of db: StationDatabase) -> [StationRouteKind: [StationRoute]] {
    [.tide: db.stationRoutes(kind: .tide), .current: db.stationRoutes(kind: .current)]
  }

  func rebuild(_ db: StationDatabase, editing edit: (inout [StationInput]) -> Void = { _ in })
    throws -> StationDatabase
  {
    var inputs = db.map(StationInput.init)
    edit(&inputs)
    return try StationDatabase(
      data: StationDatabase.build(inputs, version: db.version, routes: routes(of: db)))
  }

  func assertSameStation(_ a: Station, _ b: Station, file: StaticString = #filePath, line: UInt = #line) {
    func eq<T: Equatable>(_ x: T, _ y: T, _ field: String) {
      XCTAssertEqual(x, y, "\(a.id).\(field)", file: file, line: line)
    }
    eq(a.id, b.id, "id")
    eq(a.name, b.name, "name")
    eq(a.kind, b.kind, "kind")
    eq(a.type, b.type, "type")
    eq(a.latitude, b.latitude, "latitude")
    eq(a.longitude, b.longitude, "longitude")
    eq(a.timezone, b.timezone, "timezone")
    eq(a.region, b.region, "region")
    eq(a.country, b.country, "country")
    eq(a.continent, b.continent, "continent")
    eq(a.locality, b.locality, "locality")
    eq(a.regionCode, b.regionCode, "regionCode")
    eq(a.countryCode, b.countryCode, "countryCode")
    eq(a.context, b.context, "context")
    eq(a.contextDerived, b.contextDerived, "contextDerived")
    eq(a.cities, b.cities, "cities")
    eq(a.aliases, b.aliases, "aliases")
    eq(a.accepted, b.accepted, "accepted")
    eq(a.score, b.score, "score")
    eq(a.qualityReason, b.qualityReason, "qualityReason")
    eq(a.seasonalDominant, b.seasonalDominant, "seasonalDominant")
    eq(a.source, b.source, "source")
    eq(a.license, b.license, "license")
    eq(a.epoch, b.epoch, "epoch")
    eq(a.datumEpoch, b.datumEpoch, "datumEpoch")
    eq(a.datumFrame, b.datumFrame, "datumFrame")
    eq(a.datumCoverage, b.datumCoverage, "datumCoverage")
    eq(a.tideOffsets, b.tideOffsets, "tideOffsets")
    eq(a.current, b.current, "current")
    eq(a.constituents, b.constituents, "constituents")
    eq(a.datums, b.datums, "datums")
    eq(a.chartDatum, b.chartDatum, "chartDatum")
    eq(a.chartDatumShift, b.chartDatumShift, "chartDatumShift")
    eq(a.astronomicalBounds?.lat, b.astronomicalBounds?.lat, "astronomicalBounds.lat")
    eq(a.astronomicalBounds?.hat, b.astronomicalBounds?.hat, "astronomicalBounds.hat")
    eq(a.attribution, b.attribution, "attribution")
    // Fields only the generated accessors reach, and the record's own prediction data.
    eq(StationInput(a), StationInput(b), "StationInput")
    eq(a.raw.attribution, b.raw.attribution, "raw.attribution")
    eq(a.raw.quality == nil, b.raw.quality == nil, "raw.quality")
  }

  func testRoundTripsTheFixtureFieldForField() throws {
    let original = try fixture()
    let rebuilt = try rebuild(original)
    XCTAssertEqual(rebuilt.version, original.version)
    XCTAssertEqual(rebuilt.count, original.count)
    for (a, b) in zip(original, rebuilt) { assertSameStation(a, b) }
    for kind in [StationRouteKind.tide, .current] {
      XCTAssertEqual(rebuilt.stationRoutes(kind: kind), original.stationRoutes(kind: kind))
    }
    XCTAssertEqual(
      rebuilt.stationRoute(kind: .tide, slug: "reference"),
      original.stationRoute(kind: .tide, slug: "reference"))

    // Quality detail the public accessors don't expose.
    let reference = try XCTUnwrap(StationInput(XCTUnwrap(rebuilt.station(id: "test/reference"))))
    XCTAssertEqual(reference.qualityIssues, ["MLW (3.827) < LAT (3.831)"])
    XCTAssertEqual(reference.qualityFactors?.recency, 0.75)
    XCTAssertEqual(reference.datumsSource, .observed)
    XCTAssertEqual(reference.disclaimers, "Dries out at low water.")
    let subordinate = try XCTUnwrap(rebuilt.station(id: "test/subordinate"))
    XCTAssertEqual(subordinate.raw.quality?.redundant, "test/reference")
    XCTAssertEqual(subordinate.raw.constituentsCount, 0)
    XCTAssertNil(try XCTUnwrap(rebuilt.station(id: "test/subordinate-fixed")).raw.quality)
  }

  // Catches a schema field StationInput doesn't carry, which the accessor
  // comparisons can't see.
  func testRebuildStoresTheSameFieldsInEveryTable() throws {
    let original = try fixture()
    let data = try StationDatabase.build(
      original.map(StationInput.init), version: original.version, routes: routes(of: original))
    let before = Layout(bytes: [UInt8](try Data(contentsOf: StationDatabaseTests.url)))
    XCTAssertEqual(Layout(bytes: [UInt8](data)).storedFields, before.storedFields)
    XCTAssertEqual(before.storedFields.count, original.count)
  }

  func testEditsSurviveARebuild() throws {
    let original = try fixture()
    let rebuilt = try rebuild(original) { inputs in
      let ref = inputs.firstIndex { $0.id == "test/reference" }!
      inputs[ref].name = "Renamed"
      inputs[ref].constituents = inputs[ref].constituents.map {
        Station.Constituent(name: $0.name, amplitude: $0.amplitude * 2, phase: $0.phase)
      }
      var copy = inputs[ref]
      copy.id = "test/reference-copy"
      inputs.append(copy)

      let current = inputs.firstIndex { $0.id == "test/current" }!
      inputs[current].current?.offsets?.reference = "test/reference-copy"
      inputs[current].current?.offsets?.floodTime = nil
      inputs[current].current?.meanFlow = nil
      inputs[current].current?.minorMeanFlow = nil

      inputs.removeAll { $0.id == "test/subordinate-fixed" }
    }

    XCTAssertEqual(
      rebuilt.map(\.id),
      [
        "test/current", "test/reference", "test/reference-copy", "test/subordinate",
        "test/zfit-bounded", "test/zfit-online", "test/zfit-unknown",
      ])
    let reference = try XCTUnwrap(rebuilt.station(id: "test/reference"))
    XCTAssertEqual(reference.name, "Renamed")
    let originalM2 = try XCTUnwrap(original.station(id: "test/reference")?.constituents.first)
    XCTAssertEqual(reference.constituents.first?.amplitude, originalM2.amplitude * 2)
    // A subordinate predicts from its reference's edited constituents.
    XCTAssertEqual(rebuilt.station(id: "test/subordinate")?.constituents, reference.constituents)

    let copy = try XCTUnwrap(rebuilt.station(id: "test/reference-copy"))
    XCTAssertEqual(copy.name, "Renamed")
    XCTAssertEqual(copy.datums, reference.datums)

    let current = try XCTUnwrap(rebuilt.station(id: "test/current")?.current)
    XCTAssertEqual(current.offsets?.reference, "test/reference-copy")
    XCTAssertNil(current.offsets?.floodTime)
    XCTAssertEqual(current.offsets?.slackBeforeFlood, -30)
    XCTAssertNil(current.meanFlow)
    XCTAssertNil(current.minorMeanFlow)
    XCTAssertEqual(current.azimuth, 0)
    let raw = try XCTUnwrap(rebuilt.station(id: "test/current")?.raw.current)
    XCTAssertTrue(raw.meanFlowMissing)
    XCTAssertTrue(try XCTUnwrap(raw.offsets).floodTimeMissing)
    XCTAssertNil(rebuilt.station(id: "test/subordinate-fixed"))
  }

  func testBuildsAStationFromScratch() throws {
    let license = StationLicense(
      type: "cc-by-4.0", url: "https://creativecommons.org/licenses/by/4.0/", commercialUse: true)
    var input = StationInput(
      id: "test/new", name: "New", latitude: 1, longitude: 2, timezone: "Etc/UTC",
      country: "United States", countryCode: "US", continent: "Americas",
      aliases: ["New", "new", "NEW place"],
      source: StationSource(name: "S", id: "1", url: nil, publishedHarmonics: false),
      current: CurrentRecord(floodDirection: 0, chsFit: ChsFit(tier: .final, days: 30, evidence: "e")))
    XCTAssertEqual(input.kind, .current)
    XCTAssertNil(input.attribution)
    // The notice is composed at build time, so a licence set after init still counts.
    input.license = license
    assertBuildFails([input], "test/new: no credit decision for source S")

    let db = try StationDatabase(data: StationDatabase.build([input], credits: ["S": "Credit line"]))
    let station = try XCTUnwrap(db.station(id: "test/new"))
    XCTAssertEqual(station.aliases, ["new", "new place"])
    XCTAssertEqual(station.current?.floodDirection, 0)
    XCTAssertNil(station.current?.ebbDirection)
    XCTAssertEqual(station.current?.chsFit, ChsFit(tier: .final, days: 30, evidence: "e"))
    XCTAssertEqual(
      station.attribution,
      "\(Station.projectCredit). Credit line."
        + " Licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)."
        + " Modified: see \(StationAttribution.modificationsURL)")
    XCTAssertEqual(db.version, nil)

    // A source that needs no credit is a decision too.
    let uncredited = try StationDatabase(data: StationDatabase.build([input], credits: ["S": nil]))
    XCTAssertEqual(
      uncredited.station(id: "test/new")?.attribution,
      "\(Station.projectCredit). Licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)."
        + " Modified: see \(StationAttribution.modificationsURL)")
  }

  func testRejectsAnAttributionWithoutTheProjectCredit() throws {
    var station = try StationInput(XCTUnwrap(fixture().station(id: "test/reference")))
    XCTAssertEqual(station.attribution, Station.projectCredit)
    for notice in ["", "Someone else's notice"] {
      station.attribution = notice
      assertBuildFails(
        [station],
        "Station test/reference attribution must start with the project credit; set it to nil to compose one")
    }
  }

  static let ccBy = StationLicense(
    type: "cc-by-4.0", url: "https://creativecommons.org/licenses/by/4.0/", commercialUse: true)

  func testRejectsAKeptNoticeThatNoLongerMatchesItsLicense() throws {
    let source = "Test Source"
    // Public domain to CC BY, keeping the public-domain notice.
    var relicensed = try StationInput(XCTUnwrap(fixture().station(id: "test/reference")))
    relicensed.license = Self.ccBy
    let clause = try XCTUnwrap(StationAttribution.licenseClause(Self.ccBy))
    assertBuildFails(
      [relicensed],
      "Station test/reference attribution does not end with its license notice \"\(clause)\"; set it to nil to compose one")
    relicensed.attribution = nil
    let composed = try StationDatabase(data: StationDatabase.build([relicensed], credits: [source: nil]))
    let cc = try StationInput(XCTUnwrap(composed.station(id: "test/reference")))
    XCTAssert(try XCTUnwrap(cc.attribution).hasSuffix(clause))
    // A hand-written credit needs the credits entry that composes it.
    var credited = cc
    credited.attribution = "\(Station.projectCredit). A credit. \(clause)"
    assertBuildFails(
      [credited],
      "Station test/reference attribution can't be checked without a credits entry for its source Test Source; set attribution to nil and pass credits")
    XCTAssertNoThrow(try StationDatabase.build([credited], credits: [source: "A credit"]))

    // CC BY back to public domain, keeping the CC BY notice.
    var publicDomain = cc
    publicDomain.license = StationLicense(type: "public domain", url: nil, commercialUse: true)
    assertBuildFails(
      [publicDomain],
      "Station test/reference attribution names a licence its license public domain does not need; set it to nil to compose one")

    // CC BY needs its licence URI.
    var noURL = cc
    noURL.license?.url = nil
    noURL.attribution = nil
    XCTAssertThrowsError(try StationDatabase.build([noURL], credits: [source: nil])) {
      XCTAssertEqual(
        ($0 as? StationDatabaseBuildError)?.message,
        "Station test/reference license cc-by-4.0 has no url, which its notice must give")
    }
  }

  // A credits entry is the current decision for its source, so a kept notice must match it.
  func testRejectsAKeptNoticeThatDisagreesWithItsCreditsEntry() throws {
    let linz = "This work is based on Toitū Te Whenua Land Information New Zealand data"
    let dmi = "Danish Meteorological Institute (DMI), https://www.dmi.dk"
    var station = try StationInput(XCTUnwrap(fixture().station(id: "test/reference")))
    station.source = StationSource(name: "LINZ", id: "1", url: nil, publishedHarmonics: true)
    station.license = Self.ccBy
    station.attribution = StationAttribution.notice(credit: linz, license: Self.ccBy)
    XCTAssertNoThrow(try StationDatabase.build([station], credits: ["LINZ": linz]))
    // With no entry, a hand-written notice can't be checked.
    assertBuildFails(
      [station],
      "Station test/reference attribution can't be checked without a credits entry for its source LINZ; set attribution to nil and pass credits")

    func assertMismatch(_ s: StationInput, _ credits: [String: String?], line: UInt = #line) {
      let expected = StationAttribution.notice(
        credit: credits[s.source!.name!]!, license: s.license)
      assertBuildFails(
        [s],
        credits: credits,
        "Station test/reference attribution does not match the notice its credits entry composes, \"\(expected)\"; set attribution to nil or update credits",
        line: line)
    }

    // Source changed to DMI, notice still credits LINZ.
    var moved = station
    moved.source?.name = "DMI"
    assertMismatch(moved, ["DMI": dmi])

    // The credit dropped from a notice whose source needs one.
    var uncredited = station
    uncredited.attribution =
      "\(Station.projectCredit). \(try XCTUnwrap(StationAttribution.licenseClause(Self.ccBy)))"
    assertMismatch(uncredited, ["LINZ": linz])

    // The source's credit line updated, the stored notice not.
    assertMismatch(station, ["LINZ": "\(linz), updated"])
  }

  // buildDatabase needs a credit decision for every source, so a notice without
  // one is written only as it was read.
  func testKeepsANoticeWithoutCreditsOnlyWhileItsSourceAndLicenseAreAsRead() throws {
    let db = try fixture()
    let routes = self.routes(of: db)
    let inputs = db.map(StationInput.init)
    // Unchanged, and an unchanged copy under a new id: builds.
    var copy = try XCTUnwrap(inputs.first { $0.id == "test/reference" })
    copy.id = "test/reference-copy"
    XCTAssertNoThrow(try StationDatabase.build(inputs + [copy], routes: routes))

    let refused =
      "Station test/reference-copy attribution can't be checked without a credits entry for its source %@; set attribution to nil and pass credits"
    var moved = copy
    moved.source?.name = "Other Source"
    assertBuildFails(
      inputs + [moved], routes: routes, refused.replacingOccurrences(of: "%@", with: "Other Source"))

    var relicensed = copy
    relicensed.license?.notes = "Different terms"
    assertBuildFails(
      inputs + [relicensed], routes: routes,
      refused.replacingOccurrences(of: "%@", with: "Test Source"))
  }

  func testRefusesAHandWrittenNoticeWithoutACreditsEntry() throws {
    var station = StationInput(
      id: "test/new", name: "New", latitude: 1, longitude: 2, timezone: "Etc/UTC",
      country: "United States", countryCode: "US", continent: "Americas",
      source: StationSource(name: "S", id: "1", url: nil, publishedHarmonics: false),
      license: Self.ccBy,
      attribution: StationAttribution.notice(credit: nil, license: Self.ccBy))
    assertBuildFails(
      [station],
      "Station test/new attribution can't be checked without a credits entry for its source S; set attribution to nil and pass credits")
    XCTAssertNoThrow(try StationDatabase.build([station], credits: ["S": nil]))
    station.attribution = nil
    XCTAssertNoThrow(try StationDatabase.build([station], credits: ["S": nil]))
  }

  func testRefusesValuesThatOverflowTheirField() throws {
    let inputs = try fixture().map(StationInput.init)
    let sub = try XCTUnwrap(inputs.firstIndex { $0.id == "test/subordinate" })
    var scored = inputs
    scored[sub].score = 300
    assertBuildFails(scored, "test/subordinate: score 300 does not fit a ubyte")
    var late = inputs
    late[sub].tideOffsets?.timeHigh = Int(Int32.max) + 1
    assertBuildFails(late, "test/subordinate: offsets.timeHigh 2147483648 does not fit an int")

    var reference = try StationInput(XCTUnwrap(fixture().station(id: "test/reference")))
    reference.datumCoverage?.observedHours = Int(UInt32.max) + 1
    assertBuildFails(
      [reference], "test/reference: datumCoverage.observedHours 4294967296 is not from 0 to 2147483647")
    // A uint the verifying open would refuse, because it overflows Int on a watch.
    reference.datumCoverage?.observedHours = Int(Int32.max) + 1
    assertBuildFails(
      [reference], "test/reference: datumCoverage.observedHours 2147483648 is not from 0 to 2147483647")
  }

  // "Licensed" in a source's own words isn't a licence clause.
  func testAcceptsTheWordLicensedOutsideALicenseClause() throws {
    var station = try StationInput(XCTUnwrap(fixture().station(id: "test/reference")))
    station.attribution = "\(Station.projectCredit). Licensed by the harbour authority"
    XCTAssertNoThrow(
      try StationDatabase.build([station], credits: ["Test Source": "Licensed by the harbour authority"]))
    station.attribution = "\(Station.projectCredit). Modified: see \(StationAttribution.modificationsURL)"
    XCTAssertThrowsError(try StationDatabase.build([station]))
  }

  func testInfersTypeFromOffsetsAndRejectsAReferenceWithTideOffsets() throws {
    let offsets = TideOffsets(
      reference: "x/ref", timeHigh: 0, timeLow: 0, heightType: .ratio, heightHigh: 1, heightLow: 1)
    let tide = StationInput(id: "x/sub", name: "Sub", latitude: 0, longitude: 0, countryCode: "US", tideOffsets: offsets)
    XCTAssertEqual(tide.type, .subordinate)
    let current = StationInput(
      id: "x/c", name: "C", latitude: 0, longitude: 0, countryCode: "US",
      current: CurrentRecord(offsets: CurrentOffsets(reference: "x/cref")))
    XCTAssertEqual(current.type, .subordinate)
    XCTAssertEqual(
      StationInput(id: "x/r", name: "R", latitude: 0, longitude: 0, countryCode: "US").type, .reference)

    var station = try StationInput(XCTUnwrap(fixture().station(id: "test/subordinate-fixed")))
    station.type = .reference
    assertBuildFails([station], "Station test/subordinate-fixed carries tide offsets but is not subordinate")
  }

  // The TypeScript reader reads a station without a quality table as accepted.
  func testWritesAQualityTableForARejectedOrScoredStation() throws {
    var station = try StationInput(XCTUnwrap(fixture().station(id: "test/subordinate-fixed")))
    station.type = .reference
    station.tideOffsets = nil
    let plain = try StationDatabase(data: StationDatabase.build([station]))
    XCTAssertNil(plain.station(id: "test/subordinate-fixed")?.raw.quality)

    station.accepted = false
    let rejected = try StationDatabase(data: StationDatabase.build([station]))
    XCTAssertNotNil(rejected.station(id: "test/subordinate-fixed")?.raw.quality)
    XCTAssertEqual(rejected.station(id: "test/subordinate-fixed")?.accepted, false)

    // An empty stored table, as buildDatabase writes for any `quality` block, survives a rebuild.
    station.preserved.hadQualityTable = true
    let empty = try StationDatabase(data: StationDatabase.build([station.withAccepted(true)]))
    let reread = try StationInput(XCTUnwrap(empty.station(id: "test/subordinate-fixed")))
    let again = try StationDatabase(data: StationDatabase.build([reread]))
    XCTAssertNotNil(again.station(id: "test/subordinate-fixed")?.raw.quality)
    station.preserved.hadQualityTable = false

    station.accepted = true
    station.score = 12
    let scored = try StationDatabase(data: StationDatabase.build([station]))
    XCTAssertNotNil(scored.station(id: "test/subordinate-fixed")?.raw.quality)
    XCTAssertEqual(scored.station(id: "test/subordinate-fixed")?.score, 12)
  }

  func testKeepsAnUnknownChsFitTierUntilTheFitIsEdited() throws {
    let rebuilt = try rebuild(fixture())
    let fit = try XCTUnwrap(rebuilt.station(id: "test/zfit-unknown")?.raw.current?.chsFit)
    XCTAssertEqual(fit.tier, 3)
    XCTAssertEqual(fit.days, 210)
    XCTAssertEqual(rebuilt.station(id: "test/zfit-unknown")?.current?.chsFit?.tier, .online)

    let edited = try rebuild(fixture()) { inputs in
      let gate = inputs.firstIndex { $0.id == "test/zfit-unknown" }!
      inputs[gate].current?.chsFit?.days = 100
    }
    let written = try XCTUnwrap(edited.station(id: "test/zfit-unknown")?.raw.current?.chsFit)
    XCTAssertEqual(written.tier, 0)
    XCTAssertEqual(written.days, 100)
    XCTAssertEqual(edited.station(id: "test/zfit-unknown")?.current?.chsFit?.days, 100)
  }

  func testRejectsASubordinateLeftWithNothingToPredictFrom() throws {
    let db = try fixture()
    var inputs = db.map(StationInput.init)
    inputs.removeAll { $0.id == "test/reference" }
    let routes = self.routes(of: db).mapValues { $0.filter { $0.slug != "reference" } }
    XCTAssertThrowsError(try StationDatabase.build(inputs, routes: routes)) {
      XCTAssertEqual(
        ($0 as? StationDatabaseBuildError)?.message,
        "Station test/subordinate references missing station test/reference and has no prediction data of its own")
    }

    // One carrying what it resolved to still reads without its reference.
    let reference = try XCTUnwrap(db.station(id: "test/reference"))
    for index in inputs.indices where inputs[index].type == .subordinate {
      inputs[index].constituents = reference.constituents
      inputs[index].datums = reference.datums
    }
    let resolved = try StationDatabase(data: StationDatabase.build(inputs, routes: routes))
    XCTAssertEqual(resolved.station(id: "test/subordinate")?.constituents, reference.constituents)
  }

  // A current's tide station can live in another file, as slackwater-ios
  // ships currents.tcdb beside stations.tcdb, and current offsets are unresolved.
  func testBuildsCurrentsWhoseReferencesLiveElsewhere() throws {
    let db = try fixture()
    let currents = db.filter { $0.kind == .current }.map(StationInput.init)
    var routes = self.routes(of: db)
    routes[.tide] = []
    let built = try StationDatabase(data: StationDatabase.build(currents, routes: routes))
    let current = try XCTUnwrap(built.station(id: "test/current")?.current)
    XCTAssertEqual(current.tideReference, "test/reference")
    XCTAssertEqual(current.offsets?.reference, "test/reference")
    XCTAssertNil(built.station(id: "test/reference"))
  }

  // Opt-in like StationDatabaseTests.testOpensTheShippedDatabase.
  func testRoundTripsTheShippedDatabase() throws {
    guard let path = ProcessInfo.processInfo.environment["SLACKWATER_TCDB"] else {
      throw XCTSkip("Set SLACKWATER_TCDB to a database file to run")
    }
    let original = try StationDatabase(contentsOf: URL(fileURLWithPath: path))
    let data = try StationDatabase.build(
      original.map(StationInput.init), version: original.version, routes: routes(of: original))
    let rebuilt = try StationDatabase(data: data)
    XCTAssertEqual(rebuilt.version, original.version)
    XCTAssertEqual(rebuilt.count, original.count)
    for (a, b) in zip(original, rebuilt) { assertSameStation(a, b) }
    for kind in [StationRouteKind.tide, .current] {
      XCTAssertEqual(rebuilt.stationRoutes(kind: kind), original.stationRoutes(kind: kind))
    }
    let layout = Layout(bytes: [UInt8](data))
    XCTAssertGreaterThan(layout.lowestPrediction, layout.highestStationTable)
    let stored = Layout(bytes: [UInt8](try Data(contentsOf: URL(fileURLWithPath: path))))
    let differing = zip(stored.storedFields, layout.storedFields).enumerated()
      .filter { $1.0 != $1.1 }.map { original[$0.offset].id }
    XCTAssertEqual(differing, [])
  }

  // Opt-in: the "Writing a database" examples in packages/swift/README.md,
  // copied verbatim, against the shipped file.
  func testTheReadmeExamplesBuildTheShippedDatabase() throws {
    guard let path = ProcessInfo.processInfo.environment["SLACKWATER_TCDB"] else {
      throw XCTSkip("Set SLACKWATER_TCDB to a database file to run")
    }
    let db = try StationDatabase(contentsOf: URL(fileURLWithPath: path))

    var stations = db.map(StationInput.init) // everything the file stores, per station
    let removed = "noaa/PUG1515"
    stations.removeAll { $0.id == removed }
    if let i = stations.firstIndex(where: { $0.id == "noaa/ACT0101" }) { // a subordinate current
      stations[i].current?.offsets?.reference = "noaa/ACT0091"
      stations[i].current?.offsets?.floodTime = nil // written as missing, not zero
    }
    // Every route must name stations in the file.
    var routes: [StationRouteKind: [StationRoute]] = [:]
    for kind in [StationRouteKind.tide, .current] {
      routes[kind] = db.stationRoutes(kind: kind).compactMap { route in
        let ids = route.stationIDs.filter { $0 != removed }
        return ids.isEmpty
          ? nil : StationRoute(slug: route.slug, stationIDs: ids, formerPaths: route.formerPaths)
      }
    }
    let data = try StationDatabase.build(stations, version: db.version, routes: routes)

    let built = try StationDatabase(data: data)
    XCTAssertNil(built.station(id: removed))
    let edited = try XCTUnwrap(built.station(id: "noaa/ACT0101")?.current?.offsets)
    XCTAssertEqual(edited.reference, "noaa/ACT0091")
    XCTAssertNil(edited.floodTime)
    XCTAssertNotNil(db.station(id: "noaa/ACT0101")?.current?.offsets?.floodTime)

    if var copy = stations.first(where: { $0.id == "noaa/ACT0101" }) {
      copy.id = "noaa/ACT0101-cc-by"
      copy.license = StationLicense(
        type: "cc-by-4.0", url: "https://creativecommons.org/licenses/by/4.0/", commercialUse: true)
      copy.attribution = nil
      stations.append(copy)
    }
    let relicensed = try StationDatabase.build(
      stations, version: db.version, routes: routes,
      credits: ["US National Oceanic and Atmospheric Administration": nil])

    let notice = try XCTUnwrap(
      StationDatabase(data: relicensed).station(id: "noaa/ACT0101-cc-by")?.attribution)
    XCTAssert(notice.contains("Licensed CC BY 4.0"), notice)
  }

  // Opt-in: holds the Swift notice constants to the notices attribution.ts wrote.
  func testShippedNoticesMatchTheSwiftConstants() throws {
    guard let path = ProcessInfo.processInfo.environment["SLACKWATER_TCDB"] else {
      throw XCTSkip("Set SLACKWATER_TCDB to a database file to run")
    }
    let db = try StationDatabase(contentsOf: URL(fileURLWithPath: path))
    var licensed = 0
    for station in db {
      let notice = station.attribution
      XCTAssert(notice.hasPrefix(StationAttribution.projectCredit), station.id)
      if let license = station.license, let type = license.type,
        let name = StationAttribution.licenseNames[type]
      {
        licensed += 1
        XCTAssert(
          notice.hasSuffix(
            "Licensed \(name) (\(license.url ?? "")). Modified: see \(StationAttribution.modificationsURL)"),
          "\(station.id): \(notice)")
      } else {
        XCTAssertFalse(notice.contains("Licensed "), "\(station.id): \(notice)")
      }
    }
    XCTAssertGreaterThan(licensed, 0)
  }

  // The layout rule from schemas/database.fbs, as test/database.test.ts asserts
  // it on the TypeScript side: every prediction vector and quality table sits
  // past the last station table.
  func testPredictionDataSitsAfterAllStationTables() throws {
    let original = try fixture()
    let inputs = original.map(StationInput.init)
    var many: [StationInput] = []
    for n in 0..<50 {
      for var input in inputs {
        input.id += "-\(n)"
        input.tideOffsets?.reference += "-\(n)"
        many.append(input)
      }
    }
    for data in [
      // The TypeScript-built fixture first, so a broken walk can't pass on its own.
      try Data(contentsOf: StationDatabaseTests.url),
      try StationDatabase.build(inputs, version: original.version, routes: routes(of: original)),
      try StationDatabase.build(many),
    ] {
      let layout = Layout(bytes: [UInt8](data))
      XCTAssertGreaterThan(layout.highestStationTable, 0)
      XCTAssertLessThan(layout.lowestPrediction, data.count)
      XCTAssertGreaterThan(layout.lowestPrediction, layout.highestStationTable)
    }
  }

  // MARK: Validation

  func assertBuildFails(
    _ stations: [StationInput], routes: [StationRouteKind: [StationRoute]] = [:],
    credits: [String: String?] = [:],
    _ message: String, file: StaticString = #filePath, line: UInt = #line
  ) {
    XCTAssertThrowsError(
      try StationDatabase.build(stations, routes: routes, credits: credits), file: file, line: line
    ) {
      XCTAssertEqual(($0 as? StationDatabaseBuildError)?.message, message, file: file, line: line)
    }
  }

  func testRejectsADuplicateId() throws {
    let inputs = try fixture().map(StationInput.init)
    assertBuildFails(inputs + [inputs[1]], "duplicate station id test/reference")
  }

  func testSortsUnsortedInput() throws {
    let original = try fixture()
    let db = try StationDatabase(data: StationDatabase.build(original.map(StationInput.init).reversed()))
    XCTAssertEqual(db.map(\.id), original.map(\.id))
    XCTAssertEqual(db.station(id: "test/zfit-online")?.name, "An online gate")
  }

  func testRejectsATideKindCarryingCurrentData() throws {
    var current = try StationInput(XCTUnwrap(fixture().station(id: "test/current")))
    current.kind = .tide
    assertBuildFails([current], "Station test/current declares tide kind with current data")
  }

  func testRejectsABadCountryCodeAndARegionOutsideIt() throws {
    var station = try StationInput(XCTUnwrap(fixture().station(id: "test/reference")))
    station.countryCode = "us"
    assertBuildFails([station], "Station test/reference has invalid country_code \"us\"")
    station.countryCode = "CA"
    assertBuildFails([station], "Station test/reference region_code US-WA does not match CA")
  }

  func testRejectsMissingIdentity() throws {
    var station = try StationInput(XCTUnwrap(fixture().station(id: "test/reference")))
    station.timezone = " "
    assertBuildFails([station], "Station test/reference has no timezone")
    station.timezone = "Etc/UTC"
    station.license = nil
    assertBuildFails([station], "Station test/reference has no license")
  }

  func testRejectsRoutesToMissingStationsOrTheWrongKind() throws {
    let inputs = try fixture().map(StationInput.init)
    assertBuildFails(
      inputs,
      routes: [.tide: [StationRoute(slug: "gone", stationIDs: ["test/gone"], formerPaths: [])]],
      "tide/gone references missing station test/gone")
    assertBuildFails(
      inputs,
      routes: [.tide: [StationRoute(slug: "flow", stationIDs: ["test/current"], formerPaths: [])]],
      "tide/flow references current station test/current")
    assertBuildFails(
      inputs,
      routes: [.current: [StationRoute(slug: "Bad Slug", stationIDs: ["test/current"], formerPaths: [])]],
      "current route has invalid or duplicate slug \"Bad Slug\"")
  }

  func testRejectsAChsFitBoundOutsideAUshort() throws {
    var gate = try StationInput(XCTUnwrap(fixture().station(id: "test/zfit-bounded")))
    gate.current?.chsFit?.days = 0
    assertBuildFails([gate], "test/zfit-bounded: chsFit.days 0 is not a whole number from 1 to 65535")
    gate.current?.chsFit?.days = 70_000
    assertBuildFails([gate], "test/zfit-bounded: chsFit.days 70000 is not a whole number from 1 to 65535")
  }

  // Consumers write non-finite values on purpose so their own validators can reject them.
  func testWritesNonFiniteMajorConstituentsAndOffsets() throws {
    var inputs = try fixture().map(StationInput.init)
    let ref = inputs.firstIndex { $0.id == "test/reference" }!
    inputs[ref].constituents[0].amplitude = .nan
    let sub = inputs.firstIndex { $0.id == "test/subordinate" }!
    inputs[sub].tideOffsets?.heightHigh = .infinity
    let db = try StationDatabase(data: StationDatabase.build(inputs))
    XCTAssertTrue(try XCTUnwrap(db.station(id: "test/reference")?.constituents.first).amplitude.isNaN)
    XCTAssertEqual(db.station(id: "test/subordinate")?.tideOffsets?.heightHigh, .infinity)

    var minor = inputs[0]
    minor.current?.minorConstituents?[0].phase = .nan
    assertBuildFails([minor], "test/current: invalid minor constituents")
  }
}

extension StationInput {
  fileprivate func withAccepted(_ accepted: Bool) -> StationInput {
    var copy = self
    copy.accepted = accepted
    return copy
  }
}

/// Walks the raw buffer for table and vector positions, which the generated
/// accessors keep private.
private struct Layout {
  let bytes: [UInt8]
  var highestStationTable = 0
  var lowestPrediction = Int.max
  /// Per station, which fields each of its tables stores, so a rebuild that
  /// drops a field the input type doesn't carry shows up as a difference.
  var storedFields: [String] = []

  /// Sub-table slots per table, in schemas/database.fbs field order.
  private struct Shape {
    var children: [Int: Shape] = [:]
    static let leaf = Shape()
    static let current = Shape(children: [4: .leaf, 6: .leaf, 10: Shape(children: [4: .leaf])])
    static let station = Shape(children: [
      17: .leaf, 18: .current, 19: .leaf, 20: .leaf, 21: .leaf, 22: .leaf, 31: .leaf, 33: .leaf,
    ])
  }

  private func describe(_ table: Int, _ shape: Shape) -> String {
    let slots = (0..<(u16(table - i32(table)) - 4) / 2).filter { field(table, $0) != nil }
    return slots.map { slot in
      guard let child = shape.children[slot], let f = field(table, slot) else { return "\(slot)" }
      return "\(slot){\(describe(deref(f), child))}"
    }.joined(separator: ",")
  }

  init(bytes: [UInt8]) {
    self.bytes = bytes
    let root = deref(0)
    guard let stationsField = field(root, 1) else { return }
    let stations = deref(stationsField)
    for i in 0..<u32(stations) {
      let station = deref(stations + 4 + 4 * i)
      storedFields.append(describe(station, .station))
      highestStationTable = max(highestStationTable, station)
      // Slots in schemas/database.fbs field order: constituents, datums, current, quality.
      for slot in [13, 14] {
        if let f = field(station, slot), u32(deref(f)) > 0 { note(deref(f) + 4) }
      }
      if let f = field(station, 20) { note(deref(f)) }
      if let c = field(station, 18), let minor = field(deref(c), 11), u32(deref(minor)) > 0 {
        note(deref(minor) + 4)
      }
    }
  }

  mutating func note(_ position: Int) { lowestPrediction = min(lowestPrediction, position) }

  func u16(_ at: Int) -> Int { Int(bytes[at]) | Int(bytes[at + 1]) << 8 }
  func u32(_ at: Int) -> Int { u16(at) | u16(at + 2) << 16 }
  func i32(_ at: Int) -> Int { Int(Int32(truncatingIfNeeded: u32(at))) }
  func deref(_ at: Int) -> Int { at + u32(at) }

  /// The absolute position of a table's field, or nil when it is absent.
  func field(_ table: Int, _ slot: Int) -> Int? {
    let vtable = table - i32(table)
    let entry = 4 + 2 * slot
    guard entry < u16(vtable) else { return nil }
    let offset = u16(vtable + entry)
    return offset == 0 ? nil : table + offset
  }
}
