/// Composes station notices the way the TypeScript builder does
/// (packages/database/src/attribution.ts), for stations a Swift caller builds
/// from scratch. AttributionTests holds the strings to that file.
public enum StationAttribution {
  /// The project half of every notice.
  public static let projectCredit =
    "Slackwater database (https://github.com/openwatersio/slackwater-database)"

  /// Where a redistributor is pointed to find what this project changed.
  public static let modificationsURL =
    "https://github.com/openwatersio/slackwater-database#modifications-to-source-data"

  /// Display names for the licences that oblige a redistributor to pass the
  /// licence on. A licence absent here imposes no notice.
  public static let licenseNames: [String: String] = [
    "cc-by-4.0": "CC BY 4.0",
    "cc-by-nc-4.0": "CC BY-NC 4.0",
    "Government Standard Terms of Use 2.0": "Government Standard Terms of Use 2.0",
  ]

  /// A station's complete notice: the project credit, the source's own
  /// `credit` line when it has one, and for a licence in `licenseNames` the
  /// licence, its URI, and a pointer to what was modified.
  public static func notice(credit: String?, license: StationLicense?) -> String {
    var parts = [projectCredit]
    if let credit, !credit.isEmpty { parts.append(credit) }
    if let clause = licenseClause(license) { parts.append(clause) }
    return parts.joined(separator: ". ")
  }

  /// Whether `notice` carries any licence clause this table composes: a
  /// `Licensed <name> (` for a listed licence, or the modifications pointer.
  static func carriesLicenseClause(_ notice: String) -> Bool {
    notice.contains("Modified: see \(modificationsURL)")
      || licenseNames.values.contains { notice.contains("Licensed \($0) (") }
  }

  /// The end of a notice for a licence in `licenseNames`, nil for any other.
  static func licenseClause(_ license: StationLicense?) -> String? {
    guard let license, let type = license.type, let name = licenseNames[type] else { return nil }
    return "Licensed \(name) (\(license.url ?? "")). Modified: see \(modificationsURL)"
  }
}
