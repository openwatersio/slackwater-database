import Foundation
import XCTest

@testable import SlackwaterDatabase

/// Reads the fixture that scripts/generate-fixture.ts writes through the
/// TypeScript buildDatabase — the same builder that produces the shipped
/// file. Regenerate it with `npm run test -w swift` (pretest) if missing.
final class StationDatabaseTests: XCTestCase {
  static let url = Bundle.module.url(forResource: "fixture", withExtension: "tcdb")!

  func open() throws -> StationDatabase {
    try StationDatabase(contentsOf: Self.url)
  }

  func testOpensAMappedFileAndReadsTheVersion() throws {
    let db = try open()
    XCTAssertEqual(db.version, "0.0.0-fixture")
    XCTAssertEqual(db.count, 4)
  }

  func testRejectsBytesWithoutTheFileIdentifier() throws {
    XCTAssertThrowsError(try StationDatabase(data: Data("not a database".utf8))) {
      XCTAssert($0 is InvalidStationDatabase)
    }
    XCTAssertThrowsError(try StationDatabase(data: Data())) {
      XCTAssert($0 is InvalidStationDatabase)
    }
  }

  func testIteratesIdentityInIdOrder() throws {
    let db = try open()
    XCTAssertEqual(
      db.map(\.id),
      ["test/current", "test/reference", "test/subordinate", "test/subordinate-fixed"])
    XCTAssertEqual(
      db.map(\.name),
      ["A current", "Reference", "Subordinate", "Subordinate with fixed offsets"])

    let reference = db[1]
    XCTAssertEqual(reference.latitude, 47.6, accuracy: 1e-9)
    XCTAssertEqual(reference.longitude, -122.3, accuracy: 1e-9)
    XCTAssertEqual(reference.timezone, "America/Los_Angeles")
    XCTAssertEqual(reference.region, "WA")
    XCTAssertEqual(reference.country, "United States")
    XCTAssertEqual(reference.continent, "Americas")
    XCTAssertEqual(reference.aliases, ["elliott bay", "seattle"])
    XCTAssertEqual(reference.kind, .tide)
    XCTAssertEqual(reference.type, .reference)
    XCTAssertEqual(db[2].type, .subordinate)
    XCTAssertEqual(db[0].kind, .current)
  }

  func testLooksUpById() throws {
    let db = try open()
    XCTAssertEqual(db.station(id: "test/reference")?.name, "Reference")
    XCTAssertEqual(db.station(id: "test/subordinate")?.name, "Subordinate")
    XCTAssertNil(db.station(id: "test/nowhere"))
  }

  func testReadsConstituentsThroughTheNameTable() throws {
    let station = try XCTUnwrap(open().station(id: "test/reference"))
    let constituents = station.constituents
    XCTAssertEqual(constituents.map(\.name), ["M2", "S2"])
    XCTAssertEqual(constituents[0].amplitude, 1.063, accuracy: 1e-6)
    XCTAssertEqual(constituents[0].phase, 10.8, accuracy: 1e-5)

    // A subordinate's record holds no constituents of its own; the accessor
    // reports the reference's, which its prediction starts from.
    let subordinate = try XCTUnwrap(open().station(id: "test/subordinate"))
    XCTAssertEqual(subordinate.raw.constituentsCount, 0)
    XCTAssertEqual(subordinate.constituents, constituents)
    let offsets = try XCTUnwrap(subordinate.raw.offsets)
    XCTAssertEqual(offsets.reference, "test/reference")
    XCTAssertEqual(offsets.timeHigh, 12)
    XCTAssertEqual(offsets.timeLow, -6)
    XCTAssertEqual(offsets.heightHigh, 1.1, accuracy: 1e-6)
  }

  func testReadsDatumsAndDerivesTheChartDatumShift() throws {
    let station = try XCTUnwrap(open().station(id: "test/reference"))
    XCTAssertEqual(station.chartDatum, "MLLW")
    XCTAssertEqual(station.datums["MLLW"] ?? .nan, 2.419, accuracy: 1e-6)
    XCTAssertEqual(station.datums["MSL"] ?? .nan, 4.443, accuracy: 1e-6)
    XCTAssertEqual(station.chartDatumShift ?? .nan, 4.443 - 2.419, accuracy: 1e-6)

    // A subordinate reports its reference's datums, unreduced, against its own
    // chart datum.
    let subordinate = try XCTUnwrap(open().station(id: "test/subordinate"))
    XCTAssertEqual(subordinate.raw.datumsCount, 0)
    XCTAssertEqual(subordinate.datums, station.datums)
    XCTAssertEqual(subordinate.chartDatumShift ?? .nan, 4.443 - 2.419, accuracy: 1e-6)

    // No chart datum of its own, so no shift to take.
    XCTAssertNil(try XCTUnwrap(open().station(id: "test/subordinate-fixed")).chartDatumShift)
  }

  func testDerivesAstronomicalBoundsAboveChartDatum() throws {
    let db = try open()
    let lat = 1.8 - 2.419
    let hat = 6.1 - 2.419

    let reference = try XCTUnwrap(db.station(id: "test/reference")?.astronomicalBounds)
    XCTAssertEqual(reference.lat, lat, accuracy: 1e-5)
    XCTAssertEqual(reference.hat, hat, accuracy: 1e-5)

    let ratio = try XCTUnwrap(db.station(id: "test/subordinate")?.astronomicalBounds)
    XCTAssertEqual(ratio.lat, lat * 0.9, accuracy: 1e-5)
    XCTAssertEqual(ratio.hat, hat * 1.1, accuracy: 1e-5)

    let fixed = try XCTUnwrap(db.station(id: "test/subordinate-fixed")?.astronomicalBounds)
    XCTAssertEqual(fixed.lat, lat - 0.2, accuracy: 1e-5)
    XCTAssertEqual(fixed.hat, hat + 0.3, accuracy: 1e-5)

    // No LAT and HAT to reduce: the current station carries no datums.
    XCTAssertNil(db.station(id: "test/current")?.astronomicalBounds)
  }

  func testReadsTheQualityGateInline() throws {
    let db = try open()
    let accepted = try XCTUnwrap(db.station(id: "test/reference"))
    XCTAssertTrue(accepted.accepted)
    XCTAssertEqual(accepted.score, 87)
    XCTAssertEqual(accepted.raw.quality?.issues(at: 0), "MLW (3.827) < LAT (3.831)")

    let rejected = try XCTUnwrap(db.station(id: "test/subordinate"))
    XCTAssertFalse(rejected.accepted)
    XCTAssertEqual(rejected.raw.quality?.reason, "duplicate")
    XCTAssertEqual(rejected.raw.quality?.redundant, "test/reference")
  }

  func testReadsTypedMetadataAndCurrent() throws {
    let reference = try XCTUnwrap(open().station(id: "test/reference"))
    XCTAssertEqual(reference.kind, .tide)
    XCTAssertEqual(reference.type, .reference)
    XCTAssertEqual(reference.locality, "Seattle")
    XCTAssertEqual(reference.regionCode, "US-WA")
    XCTAssertEqual(reference.countryCode, "US")
    XCTAssertEqual(reference.context, "Seattle, WA")
    XCTAssertFalse(reference.contextDerived)
    XCTAssertEqual(reference.cities, ["Seattle"])
    XCTAssertEqual(reference.source?.name, "Test Source")
    XCTAssertEqual(reference.source?.publishedHarmonics, true)
    XCTAssertEqual(reference.license?.commercialUse, true)

    let tideOffsets = try XCTUnwrap(open().station(id: "test/subordinate")?.tideOffsets)
    XCTAssertEqual(tideOffsets.reference, "test/reference")
    XCTAssertEqual(tideOffsets.timeHigh, 12)
    XCTAssertEqual(tideOffsets.heightType, .ratio)
    XCTAssertEqual(try open().station(id: "test/subordinate")?.qualityReason, "duplicate")

    let current = try XCTUnwrap(open().station(id: "test/current")?.current)
    XCTAssertEqual(try XCTUnwrap(current.floodDirection), 90, accuracy: 1e-6)
    XCTAssertEqual(try XCTUnwrap(current.ebbDirection), 270, accuracy: 1e-6)
    XCTAssertEqual(try XCTUnwrap(current.meanFlow), 0.4, accuracy: 1e-6)
    XCTAssertEqual(current.tideReference, "test/reference")
    XCTAssertEqual(current.offsets?.slackBeforeFlood, -30)
    XCTAssertNil(current.offsets?.slackBeforeEbb)
    XCTAssertEqual(current.offsets?.floodTime, 0)
  }

  // Sanity check against the real database, not the fixture. Opt-in because
  // the file is generated: SLACKWATER_TCDB=../database/src/generated/slackwater.tcdb
  func testOpensTheShippedDatabase() throws {
    guard let path = ProcessInfo.processInfo.environment["SLACKWATER_TCDB"] else {
      throw XCTSkip("Set SLACKWATER_TCDB to a database file to run")
    }
    let db = try StationDatabase(contentsOf: URL(fileURLWithPath: path))
    XCTAssertNotNil(db.version)
    XCTAssertGreaterThan(db.count, 1000)
    let first = db[0]
    XCTAssertEqual(db.station(id: first.id)?.name, first.name)
    // Reference type alone does not imply harmonics: identity-only registry
    // ports and current stations are reference-type records without any.
    let reference = try XCTUnwrap(db.station(id: "noaa/9447130"))
    XCTAssertEqual(reference.kind, .tide)
    XCTAssertEqual(reference.type, .reference)
    XCTAssertTrue(reference.accepted)
    XCTAssertFalse(reference.constituents.isEmpty)
    XCTAssertFalse(reference.datums.isEmpty)

    // Every subordinate in the file resolves its reference, so no read of
    // prediction data comes back empty on real data.
    let subordinates = db.filter { $0.kind == .tide && $0.type == .subordinate }
    XCTAssertGreaterThan(subordinates.count, 1000)
    XCTAssertEqual(subordinates.filter { $0.constituents.isEmpty }.count, 0)
    XCTAssertEqual(subordinates.filter { $0.astronomicalBounds == nil }.count, 0)
  }

  func testReachesTheFullSchemaThroughRaw() throws {
    let db = try open()
    let source = try XCTUnwrap(db.station(id: "test/reference")?.raw.source)
    XCTAssertEqual(source.name, "Test Source")
    XCTAssertEqual(source.publishedHarmonics, true)

    let current = try XCTUnwrap(db.station(id: "test/current")?.raw.current)
    XCTAssertEqual(current.floodDirection, 90)
    XCTAssertEqual(current.ebbDirection, 270)
    XCTAssertEqual(current.meanFlow, 0.4, accuracy: 1e-6)
    XCTAssertEqual(current.tideReference, "test/reference")
    XCTAssertEqual(current.offsets?.slackBeforeFlood, -30)
    XCTAssertEqual(current.offsets?.floodSpeedRatio ?? .nan, 0.8, accuracy: 1e-6)
  }
}

extension Station.Constituent: Equatable {
  public static func == (lhs: Self, rhs: Self) -> Bool {
    lhs.name == rhs.name && lhs.amplitude == rhs.amplitude && lhs.phase == rhs.phase
  }
}
