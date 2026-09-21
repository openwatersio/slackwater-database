/// Station credit lines. A port of packages/database/src/attribution.ts; the
/// two tables must not drift. That package's test/attribution.test.ts is what
/// checks the table covers every source actually in the database, which this
/// package cannot do from a three-station fixture.
public enum Attribution {
  /// The project half of every credit. A station's full credit opens with this,
  /// then appends whatever further credit its own source requires.
  public static let projectCredit =
    "Neaps tide database (https://github.com/openwatersio/tide-database)"

  /// Keyed by `source.name`; `nil` means the source requires no credit of its
  /// own. Sources that add nothing are listed anyway so that a new source is a
  /// decision rather than an omission.
  ///
  /// A credit names the creator, never the licence: licence varies per station
  /// within one source (TICON stations relayed from CMEMS are CC BY-NC while
  /// the rest are CC BY), so it belongs on `raw.license` where it is exact.
  static let sourceCredits: [String: String?] = [
    "TICON-4":
      "Source: Hart-Davis, M., Dettmering, D., Seitz, F. (2025), TICON-4: TIdal CONstants based on GESLA-4 sea-level records, SEANOE, https://doi.org/10.17882/109129",
    // Public domain: credit is welcome, so not imposed on consumers.
    "US National Oceanic and Atmospheric Administration": nil,
    // Names the operating agency of a record authored in the database
    // repository under MIT, not a licensor of redistributed data.
    "Canadian Hydrographic Service": nil,
  ]

  /// Whether a source name has a credit decision recorded.
  public static func isKnownSource(_ sourceName: String) -> Bool {
    sourceCredits.index(forKey: sourceName) != nil
  }

  /// Build a source's credit line. An unrecognized source falls back to the
  /// project credit rather than trapping, so an app pinned to an older library
  /// still renders a newer database.
  public static func forSource(_ sourceName: String?) -> String {
    guard let sourceName, let credit = sourceCredits[sourceName] ?? nil
    else { return projectCredit }
    return "\(projectCredit). \(credit)"
  }
}
