import Foundation
import XCTest

@testable import NeapsTideDatabase

final class AttributionTests: XCTestCase {
  func testEveryStationCarriesACredit() throws {
    let db = try TideDatabase(contentsOf: TideDatabaseTests.url)
    for station in db {
      XCTAssert(station.attribution.hasPrefix(Station.projectCredit))
    }
  }

  // The fixture's source requires no credit of its own, so the project line
  // stands alone.
  func testASourceRequiringNoCreditGetsTheProjectLineAlone() throws {
    let db = try TideDatabase(contentsOf: TideDatabaseTests.url)
    XCTAssertEqual(db.station(id: "test/reference")?.attribution, Station.projectCredit)
  }

  // Opt-in like testOpensTheShippedDatabase: the credit a CC BY source
  // requires is only in the real database.
  func testAppendsTheCreditACCBYSourceRequires() throws {
    guard let path = ProcessInfo.processInfo.environment["NEAPS_TCDB"] else {
      throw XCTSkip("Set NEAPS_TCDB to a database file to run")
    }
    let db = try TideDatabase(contentsOf: URL(fileURLWithPath: path))
    let credit = try XCTUnwrap(db.station(id: "ticon/newlyn-new-gbr-bodc")?.attribution)
    XCTAssert(credit.hasPrefix("\(Station.projectCredit). "))
    XCTAssert(credit.contains("Hart-Davis"))
    XCTAssert(credit.contains("https://doi.org/10.17882/109129"))
  }
}
