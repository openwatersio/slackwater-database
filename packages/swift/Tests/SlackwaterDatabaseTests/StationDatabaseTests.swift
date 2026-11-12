import FlatBuffers
import Foundation
import XCTest

@testable import SlackwaterDatabase

/// Reads the fixture that scripts/generate-fixture.ts writes through the
/// TypeScript buildDatabase — the same builder that produces the shipped
/// file. Regenerate it with `npm run test:swift -w swift` (pretest) if missing.
final class StationDatabaseTests: XCTestCase {
  static let url = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()
    .appendingPathComponent("fixture.tcdb")

  func open() throws -> StationDatabase {
    try StationDatabase(contentsOf: Self.url)
  }

  func testOpensAMappedFileAndReadsTheVersion() throws {
    let db = try open()
    XCTAssertEqual(db.version, "0.0.0-fixture")
    XCTAssertEqual(db.count, 7)
  }

  func testRejectsBytesWithoutTheFileIdentifier() throws {
    XCTAssertThrowsError(try StationDatabase(data: Data("not a database".utf8))) {
      XCTAssert($0 is InvalidStationDatabase)
    }
    XCTAssertThrowsError(try StationDatabase(data: Data())) {
      XCTAssert($0 is InvalidStationDatabase)
    }
  }

  func testReadsTheFixturesFormatVersion() throws {
    // The fixture comes from the TypeScript builder, so this also keeps the two constants equal.
    XCTAssertEqual(Int(try open().root.formatVersion), StationDatabase.formatVersion)
    let data = try Data(contentsOf: Self.url)
    XCTAssertEqual(StationDatabase.formatVersion(of: data), StationDatabase.formatVersion)
  }

  func testRefusesANewerFormatVersion() throws {
    func file(formatVersion: Int) -> Data {
      var fbb = FlatBufferBuilder()
      let root = Slackwater_Root.startRoot(&fbb)
      Slackwater_Root.add(formatVersion: UInt16(formatVersion), &fbb)
      Slackwater_Root.finish(&fbb, end: Slackwater_Root.endRoot(&fbb, start: root))
      return fbb.data
    }
    // 0 is a file written before the field existed.
    for version in [0, StationDatabase.formatVersion] {
      XCTAssertNoThrow(try StationDatabase(data: file(formatVersion: version)))
      XCTAssertNoThrow(try StationDatabase(verifying: file(formatVersion: version)))
    }
    let newer = StationDatabase.formatVersion + 1
    XCTAssertThrowsError(try StationDatabase(data: file(formatVersion: newer))) {
      XCTAssertEqual(($0 as? UnsupportedStationDatabase)?.formatVersion, newer)
    }
    XCTAssertThrowsError(try StationDatabase(verifying: file(formatVersion: newer))) {
      XCTAssertEqual(($0 as? UnsupportedStationDatabase)?.formatVersion, newer)
    }
    // A newer file this verifier refuses still reports its version: here the
    // root table survives at the head and the string it points to is cut off.
    func cut(formatVersion: Int) -> Data {
      var fbb = FlatBufferBuilder()
      let tag = fbb.create(string: "a release tag long enough to cut")
      let root = Slackwater_Root.startRoot(&fbb)
      Slackwater_Root.add(version: tag, &fbb)
      Slackwater_Root.add(formatVersion: UInt16(formatVersion), &fbb)
      Slackwater_Root.finish(&fbb, end: Slackwater_Root.endRoot(&fbb, start: root))
      return Data(fbb.data.dropLast(16))
    }
    XCTAssertThrowsError(try StationDatabase(verifying: cut(formatVersion: StationDatabase.formatVersion))) {
      XCTAssert($0 is InvalidStationDatabase)
    }
    XCTAssertThrowsError(try StationDatabase(verifying: cut(formatVersion: newer))) {
      XCTAssertEqual(($0 as? UnsupportedStationDatabase)?.formatVersion, newer)
    }
  }

  func testIteratesIdentityInIdOrder() throws {
    let db = try open()
    XCTAssertEqual(
      db.map(\.id),
      [
        "test/current", "test/reference", "test/subordinate", "test/subordinate-fixed",
        "test/zfit-bounded", "test/zfit-online", "test/zfit-unknown",
      ])
    XCTAssertEqual(
      db.map(\.name),
      [
        "A current", "Reference", "Subordinate", "Subordinate with fixed offsets",
        "A bounded gate", "An online gate", "An unknown-tier gate",
      ])

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
    XCTAssertEqual(reference.epoch?.start, "2007-01-01")
    XCTAssertEqual(reference.datumEpoch?.start, "2020-01-01")
    XCTAssertEqual(reference.datumEpoch?.end, "2021-12-31")
    XCTAssertEqual(try open().station(id: "test/subordinate")?.datumEpoch, reference.datumEpoch)
    XCTAssertNil(try open().station(id: "test/current")?.datumEpoch)
    XCTAssertEqual(reference.datumFrame, .gauge)
    XCTAssertEqual(try open().station(id: "test/subordinate")?.datumFrame, .gauge)
    XCTAssertNil(try open().station(id: "test/current")?.datumFrame)
    XCTAssertEqual(reference.datumCoverage?.months, 24)
    XCTAssertEqual(reference.datumCoverage?.observedHours, 17520)
    XCTAssertEqual(reference.datumCoverage?.inferredHours, 24)
    XCTAssertEqual(try open().station(id: "test/subordinate")?.datumCoverage, reference.datumCoverage)
    XCTAssertNil(try open().station(id: "test/current")?.datumCoverage)

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

  func testReadsAFittedGatesChsFit() throws {
    let db = try open()
    let evidence = "fit-2026-10-22-8f85912-r2"
    XCTAssertNil(db.station(id: "test/current")?.current?.chsFit)

    let bounded = try XCTUnwrap(db.station(id: "test/zfit-bounded")?.current?.chsFit)
    XCTAssertEqual(
      bounded,
      ChsFit(
        tier: .bounded, days: 210, slackBoundMinutes: 40, provisionalSlackMinutes: 45,
        miss: nil, missContext: nil, evidence: evidence))

    let online = try XCTUnwrap(db.station(id: "test/zfit-online")?.current?.chsFit)
    XCTAssertEqual(online.tier, .online)
    XCTAssertNil(online.days)
    XCTAssertEqual(online.miss?.clause, "slack_median")
    XCTAssertNil(online.miss?.value)
    XCTAssertEqual(online.miss?.nearBar, true)
    XCTAssertEqual(online.missContext, "rapids")
  }

  func testReadsMinorCurrentConstantsAndMeasuredZeros() throws {
    let current = try XCTUnwrap(open().station(id: "test/current")?.current)
    let minor = try XCTUnwrap(current.minorConstituents)
    XCTAssertEqual(minor.map(\.name), ["Q1", "K1"])
    XCTAssertEqual(minor[0].amplitude, 0.001, accuracy: 1e-8)
    XCTAssertEqual(minor[0].phase, 12.3, accuracy: 1e-5)
    XCTAssertEqual(minor[1].amplitude, 0)
    XCTAssertEqual(minor[1].phase, 45.6, accuracy: 1e-5)
    XCTAssertEqual(current.minorMeanFlow, 0)
    XCTAssertEqual(current.azimuth, 0)

    let scalar = try XCTUnwrap(open().station(id: "test/zfit-bounded")?.current)
    XCTAssertNil(scalar.minorConstituents)
    XCTAssertNil(scalar.minorMeanFlow)
    XCTAssertNil(scalar.azimuth)
  }

  func testReadsAFileWrittenBeforeMinorFieldsExisted() throws {
    let url = Self.url.deletingLastPathComponent()
      .appendingPathComponent("../../../database/test/fixtures/pre-minor-current.tcdb")
    let db = try StationDatabase(contentsOf: url)
    let current = try XCTUnwrap(db.station(id: "test/current")?.current)
    XCTAssertEqual(try XCTUnwrap(current.meanFlow), 0.4, accuracy: 1e-6)
    XCTAssertNil(current.minorConstituents)
    XCTAssertNil(current.minorMeanFlow)
    XCTAssertNil(current.azimuth)
  }

  func testReadsAnUnknownChsFitTierAsOnlineWithoutMeasuredNumbers() throws {
    let fit = try XCTUnwrap(open().station(id: "test/zfit-unknown")?.current?.chsFit)
    XCTAssertEqual(fit.tier, .online)
    XCTAssertNil(fit.days)
    XCTAssertNil(fit.slackBoundMinutes)
    XCTAssertEqual(fit.evidence, "fit-2026-10-22-8f85912-r2")
  }

  func testLooksUpStableRoutesWithoutGeneratedTypes() throws {
    let db = try open()
    XCTAssertEqual(
      db.stationRoute(kind: .tide, slug: "reference"),
      StationRoute(
        slug: "reference", stationIDs: ["test/reference"],
        formerPaths: ["old-reference"]))
    XCTAssertNil(db.stationRoute(kind: .current, slug: "missing"))
    XCTAssertEqual(db.stationRoutes(kind: .current).map(\.slug), ["a-current"])
    XCTAssertEqual(db.stationRoute(kind: .current, slug: "a-current")?.formerPaths, [])
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

  func testVerifyingOpenAcceptsTheFixture() throws {
    let db = try StationDatabase(verifyingContentsOf: Self.url)
    XCTAssertEqual(db.count, 7)
    XCTAssertEqual(db.station(id: "test/reference")?.constituents.count, 2)
  }

  func testVerifyingOpenRejectsATruncatedFile() throws {
    let data = try Data(contentsOf: Self.url)
    for length in [8, 64, data.count / 4, data.count / 2, data.count * 3 / 4] {
      let prefix = Data(data.prefix(length))
      // The header check refuses a prefix that cuts off the root table and
      // lets through one that keeps it, without trapping either way.
      if length == 8 {
        XCTAssertThrowsError(try StationDatabase(data: prefix)) { XCTAssert($0 is InvalidStationDatabase) }
      } else {
        XCTAssertNoThrow(try StationDatabase(data: prefix), "\(length) bytes")
      }
      XCTAssertThrowsError(try StationDatabase(verifying: prefix), "\(length) bytes") {
        XCTAssert($0 is InvalidStationDatabase)
      }
    }
  }

  func testHeaderCheckRefusesAVtableOffsetThatOverflows() throws {
    // Root at 8, vtable back-offset Int32.min: past Int on a 32-bit watch.
    let bytes = Data([8, 0, 0, 0] + Array("TCDB".utf8) + [0, 0, 0, 0x80])
    XCTAssertNil(StationDatabase.formatVersion(of: bytes))
    XCTAssertThrowsError(try StationDatabase(verifying: bytes)) { XCTAssert($0 is InvalidStationDatabase) }
  }

  func testVerifyingOpenRejectsRandomBytesBehindAValidHeader() throws {
    // A fixed-seed generator, so a failure reproduces.
    var state: UInt64 = 0x9E37_79B9_7F4A_7C15
    func next() -> UInt8 {
      state = state &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
      return UInt8(truncatingIfNeeded: state >> 56)
    }
    for length in [16, 256, 4096, 65536] {
      for _ in 0..<25 {
        var bytes = (0..<length).map { _ in next() }
        bytes.replaceSubrange(4..<8, with: Array("TCDB".utf8))
        XCTAssertThrowsError(try StationDatabase(verifying: Data(bytes)), "\(length) bytes")
      }
    }
  }

  func testVerifyingOpenRejectsANameIndexPastItsTable() throws {
    let data = try Data(contentsOf: Self.url)
    let station = try XCTUnwrap(StationDatabase(data: data).station(id: "test/reference"))
    // The reader keeps the Data's storage, so the vector's address locates it in the file.
    let vector = try XCTUnwrap(
      station.raw.withUnsafePointerToConstituents { Int(bitPattern: $0.baseAddress) })
    let base = data.withUnsafeBytes { Int(bitPattern: $0.baseAddress) }
    var bytes = [UInt8](data)
    // The first constituent's ushort name index, little-endian.
    bytes[vector - base] = 0xFF
    bytes[vector - base + 1] = 0xFF
    XCTAssertNoThrow(try StationDatabase(data: Data(bytes)))
    XCTAssertThrowsError(try StationDatabase(verifying: Data(bytes))) {
      XCTAssert($0 is InvalidStationDatabase)
    }
  }

  /// The fixture with one byte inside the first occurrence of `text` set to 0xFF.
  func fixtureCorrupting(_ text: String) throws -> Data {
    var bytes = [UInt8](try Data(contentsOf: Self.url))
    let needle = Array(text.utf8)
    let start = try XCTUnwrap(
      (0...(bytes.count - needle.count)).first { bytes[$0..<($0 + needle.count)].elementsEqual(needle) },
      "\(text) is not in the fixture")
    bytes[start + 1] = 0xFF
    return Data(bytes)
  }

  // The verifier checks a string's range and terminator, not its encoding, and
  // the generated required-string accessors force-unwrap the nil that results.
  func testVerifyingOpenRejectsAStationIdThatIsNotUTF8() throws {
    let data = try fixtureCorrupting("test/zfit-online")
    XCTAssertNoThrow(try StationDatabase(data: data))
    XCTAssertThrowsError(try StationDatabase(verifying: data)) {
      XCTAssert($0 is InvalidStationDatabase)
    }
  }

  // An optional string reads as nil instead, which would drop a notice silently.
  func testVerifyingOpenRejectsAnAttributionThatIsNotUTF8() throws {
    let data = try fixtureCorrupting(Station.projectCredit)
    let db = try StationDatabase(data: data)
    XCTAssertNil(db.station(id: "test/reference")?.raw.attribution)
    XCTAssertThrowsError(try StationDatabase(verifying: data)) {
      XCTAssert($0 is InvalidStationDatabase)
    }
  }

  func testVerifyingOpenRejectsARouteSlugThatIsNotUTF8() throws {
    let data = try fixtureCorrupting("old-reference")
    XCTAssertNoThrow(try StationDatabase(data: data))
    XCTAssertThrowsError(try StationDatabase(verifying: data))
  }

  // A uint count past Int32.max would trap Int() on a watch, where Int is 32 bits.
  func testVerifyingOpenRejectsADatumCoverageCountPastInt32() throws {
    // The fixture's reference, rebuilt with a count no other field holds, so its bytes are unique.
    var inputs = try open().map(StationInput.init)
    let index = try XCTUnwrap(inputs.firstIndex { $0.id == "test/reference" })
    let marker = 0x7A5C_3E1D
    inputs[index].datumCoverage?.months = marker
    var bytes = [UInt8](try StationDatabase.build(inputs))
    let needle = withUnsafeBytes(of: UInt32(marker).littleEndian, Array.init)
    let position = try XCTUnwrap(
      (0...(bytes.count - 4)).first { bytes[$0..<($0 + 4)].elementsEqual(needle) })
    bytes.replaceSubrange(position..<(position + 4), with: [0xFF, 0xFF, 0xFF, 0xFF])
    let data = Data(bytes)

    XCTAssertThrowsError(try StationDatabase(verifying: data)) {
      XCTAssert($0 is InvalidStationDatabase)
    }
    // The plain reader keeps a count that fits Int and reads one that doesn't as no coverage.
    let coverage = try StationDatabase(data: data).station(id: "test/reference")?.datumCoverage
    if Int.bitWidth == 64 {
      XCTAssertEqual(coverage?.months, Int(UInt32.max))
      XCTAssertEqual(coverage?.observedHours, 17520)
    } else {
      XCTAssertNil(coverage)
    }
  }

  func testVerifiesTheShippedDatabase() throws {
    guard let path = ProcessInfo.processInfo.environment["SLACKWATER_TCDB"] else {
      throw XCTSkip("Set SLACKWATER_TCDB to a database file to run")
    }
    let data = try Data(contentsOf: URL(fileURLWithPath: path), options: .mappedIfSafe)
    let start = Date()
    let db = try StationDatabase(verifying: data)
    let seconds = Date().timeIntervalSince(start)
    print(
      "Verified \(data.count) bytes, \(db.count) stations, in \(String(format: "%.3f", seconds)) s")
    XCTAssertGreaterThan(db.count, 1000)
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
