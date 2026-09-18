import Foundation
import XCTest

@testable import NeapsTideDatabase

/// Reads the fixture that scripts/generate-fixture.ts writes through the
/// TypeScript buildDatabase — the same builder that produces the shipped
/// file. Regenerate it with `npm run test -w swift` (pretest) if missing.
final class TideDatabaseTests: XCTestCase {
  static let url = Bundle.module.url(forResource: "fixture", withExtension: "tcdb")!

  func open() throws -> TideDatabase {
    try TideDatabase(contentsOf: Self.url)
  }

  func testOpensAMappedFileAndReadsTheVersion() throws {
    let db = try open()
    XCTAssertEqual(db.version, "0.0.0-fixture")
    XCTAssertEqual(db.count, 3)
  }

  func testRejectsBytesWithoutTheFileIdentifier() throws {
    XCTAssertThrowsError(try TideDatabase(data: Data("not a database".utf8))) {
      XCTAssert($0 is NotATideDatabase)
    }
    XCTAssertThrowsError(try TideDatabase(data: Data())) {
      XCTAssert($0 is NotATideDatabase)
    }
  }

  func testIteratesIdentityInIdOrder() throws {
    let db = try open()
    XCTAssertEqual(db.map(\.id), ["test/current", "test/reference", "test/subordinate"])
    XCTAssertEqual(db.map(\.name), ["A current", "Reference", "Subordinate"])

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

    // Subordinates carry no constituents; prediction goes through offsets.
    let subordinate = try XCTUnwrap(open().station(id: "test/subordinate"))
    XCTAssertEqual(subordinate.constituents, [])
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
    XCTAssertNil(try XCTUnwrap(open().station(id: "test/subordinate")).chartDatumShift)
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

  // Sanity check against the real database, not the fixture. Opt-in because
  // the file is generated: NEAPS_TCDB=../database/src/generated/neaps.tcdb
  func testOpensTheShippedDatabase() throws {
    guard let path = ProcessInfo.processInfo.environment["NEAPS_TCDB"] else {
      throw XCTSkip("Set NEAPS_TCDB to a database file to run")
    }
    let db = try TideDatabase(contentsOf: URL(fileURLWithPath: path))
    XCTAssertNotNil(db.version)
    XCTAssertGreaterThan(db.count, 1000)
    let first = db[0]
    XCTAssertEqual(db.station(id: first.id)?.name, first.name)
    let reference = try XCTUnwrap(db.first { $0.type == .reference && $0.accepted })
    XCTAssertFalse(reference.constituents.isEmpty)
    XCTAssertFalse(reference.datums.isEmpty)
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
