import Foundation
import XCTest

@testable import NeapsTideDatabase

final class AttributionTests: XCTestCase {
  func testAppendsTheCreditACCBYSourceRequires() {
    let credit = Attribution.forSource("TICON-4")
    XCTAssert(credit.hasPrefix("\(Attribution.projectCredit). "))
    XCTAssert(credit.contains("Hart-Davis"))
    XCTAssert(credit.contains("https://doi.org/10.17882/109129"))
  }

  func testGivesASourceRequiringNoCreditTheProjectLineAlone() {
    XCTAssertEqual(
      Attribution.forSource("US National Oceanic and Atmospheric Administration"),
      Attribution.projectCredit)
    XCTAssertEqual(
      Attribution.forSource("Canadian Hydrographic Service"), Attribution.projectCredit)
    XCTAssert(Attribution.isKnownSource("Canadian Hydrographic Service"))
  }

  func testFallsBackToTheProjectLineForAnUnrecognizedSource() {
    XCTAssertEqual(Attribution.forSource("Some Future Source"), Attribution.projectCredit)
    XCTAssertEqual(Attribution.forSource(nil), Attribution.projectCredit)
    XCTAssertFalse(Attribution.isKnownSource("Some Future Source"))
  }

  func testEveryStationCarriesACredit() throws {
    let db = try TideDatabase(contentsOf: TideDatabaseTests.url)
    for station in db {
      XCTAssert(station.attribution.hasPrefix(Attribution.projectCredit))
    }
  }
}
