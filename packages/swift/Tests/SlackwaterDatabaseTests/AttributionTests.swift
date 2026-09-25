import Foundation
import XCTest

@testable import SlackwaterDatabase

final class AttributionTests: XCTestCase {
  func testEveryStationCarriesACredit() throws {
    let db = try StationDatabase(contentsOf: StationDatabaseTests.url)
    for station in db {
      XCTAssert(station.attribution.hasPrefix(Station.projectCredit))
    }
  }

  // The fixture's source requires no credit of its own, so the project line
  // stands alone.
  func testASourceRequiringNoCreditGetsTheProjectLineAlone() throws {
    let db = try StationDatabase(contentsOf: StationDatabaseTests.url)
    XCTAssertEqual(db.station(id: "test/reference")?.attribution, Station.projectCredit)
  }

  // Opt-in like testOpensTheShippedDatabase: a CC BY station only exists in
  // the real database. Checks the whole notice a redistributor must pass on.
  func testACCBYStationGetsACompleteNotice() throws {
    guard let path = ProcessInfo.processInfo.environment["SLACKWATER_TCDB"] else {
      throw XCTSkip("Set SLACKWATER_TCDB to a database file to run")
    }
    let db = try StationDatabase(contentsOf: URL(fileURLWithPath: path))
    let notice = try XCTUnwrap(db.station(id: "ticon/newlyn-new-gbr-bodc")?.attribution)
    XCTAssert(notice.hasPrefix("\(Station.projectCredit). "))
    XCTAssert(notice.contains("Hart-Davis"))
    XCTAssert(notice.contains("https://doi.org/10.17882/109129"))
    XCTAssert(notice.contains("Licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)"))
    XCTAssert(notice.contains("Modified: see"))

    // Licence varies inside TICON, so the notice has to follow the station.
    let nc = try XCTUnwrap(db.station(id: "ticon/newlyn-new-gbr-cmems")?.attribution)
    XCTAssert(nc.contains("Licensed CC BY-NC 4.0"))
  }
}
