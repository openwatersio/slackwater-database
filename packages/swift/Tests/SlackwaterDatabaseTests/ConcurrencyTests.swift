import Foundation
import XCTest

import SlackwaterDatabase

final class ConcurrencyTests: XCTestCase {
  @MainActor
  func testSharesMappedAndInMemoryReadersAcrossTasks() async throws {
    let url = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent().appendingPathComponent("fixture.tcdb")
    for db in [try StationDatabase(contentsOf: url), try StationDatabase(data: Data(contentsOf: url))] {
      let subordinate = try XCTUnwrap(db.station(id: "test/subordinate"))
      let results = await withTaskGroup(of: [Station].self) { group in
        for _ in 0..<32 {
          group.addTask {
            XCTAssertEqual(db.map(\.id), [
              "test/current", "test/reference", "test/subordinate", "test/subordinate-fixed",
              "test/zfit-bounded", "test/zfit-online", "test/zfit-unknown",
            ])
            XCTAssertEqual(db.stationRoute(kind: .tide, slug: "reference")?.stationIDs, ["test/reference"])
            XCTAssertEqual(db.stationRoutes(kind: .current).map(\.slug), ["a-current"])
            XCTAssertEqual(subordinate.constituents.map(\.name), ["M2", "S2"])
            XCTAssertEqual(subordinate.datums["MSL"] ?? .nan, 4.443, accuracy: 1e-6)
            XCTAssertEqual(subordinate.astronomicalBounds?.hat ?? .nan, (6.1 - 2.419) * 1.1, accuracy: 1e-5)
            return Array(db)
          }
        }
        var results: [[Station]] = []
        for await stations in group { results.append(stations) }
        return results
      }
      XCTAssertEqual(results.count, 32)
      for stations in results {
        XCTAssertEqual(stations[1].name, "Reference")
        XCTAssertEqual(stations[0].current?.floodDirection, 90)
      }
      requireSendable(db)
      requireSendable(subordinate)
      requireSendable(subordinate.kind)
      requireSendable(subordinate.type)
      requireSendable(subordinate.source)
      requireSendable(subordinate.license)
      requireSendable(subordinate.tideOffsets)
      requireSendable(subordinate.constituents)
      requireSendable(subordinate.astronomicalBounds)
      requireSendable(db[0].current)
      requireSendable(db.stationRoutes(kind: .tide))
      requireSendable(StationRouteKind.tide)
    }
  }
}

private func requireSendable<T: Sendable>(_: T) {}
