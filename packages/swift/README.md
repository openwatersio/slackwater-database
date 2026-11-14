# SlackwaterDatabase

Swift reader and writer for the station database file (`.tcdb`, [FlatBuffers](https://flatbuffers.dev), [`schemas/database.fbs`](../../schemas/database.fbs)). Open a memory-mapped file, iterate station identity, look up a station by id, and read tide or current data while touching only the bytes each read needs. Write a new file from stations read and edited in Swift.

## Usage

```swift
import SlackwaterDatabase

let db = try StationDatabase(contentsOf: url) // memory-mapped

// Identity scan: id, name, coordinates. Reads only the head pages of the
// file because the builder groups station tables there.
let nearest = db.min {
  distance(to: $0) < distance(to: $1)
}

// Lookup by id: binary search inside the buffer, no scan.
let station = db.station(id: "noaa/9447130")

// Prediction data, decoded only when you read it.
let m2 = station?.constituents.first { $0.name == "M2" }
let datums = station?.datums // ["MLLW": 2.419, "MSL": 4.443, ...]
let shift = station?.chartDatumShift // datums[MSL] - datums[chartDatum]

// How low and high a prediction can go, in metres above the chart datum.
// Reduced through the offsets for a subordinate.
let range = station?.astronomicalBounds // (lat: -0.619, hat: 3.681)

// The notice to show wherever the station's data appears.
let notice = station?.attribution
let current = db.station(id: "noaa/PUG1515")?.current
let minor = current?.minorConstituents // names, amplitudes in knots, Greenwich phases
let crossAxisMean = current?.minorMeanFlow // knots; nil means unknown
let axis = current?.azimuth // degrees true; zero is a known northward axis
let commercialUse = station?.license?.commercialUse

// Stable links: binary lookup by slug, including former paths in the result.
let route = db.stationRoute(kind: .tide, slug: "friday-harbor")
```

`StationDatabase` is a `RandomAccessCollection` of `Station`, in id order. `Station` exposes typed identity, quality, source, license, tide, and current values. Generated FlatBuffers accessors are not part of the public API.

The package requires Swift 6. `StationDatabase`, `Station`, and their typed metadata conform to `Sendable` and support concurrent reads. The reader retains immutable `Data`, including memory-mapped files, without exposing the FlatBuffers buffer for mutation.

A subordinate station's record holds no constituents or datums of its own, only the offsets that correct its reference's. Reading `constituents`, `datums`, `chartDatumShift`, `astronomicalBounds`, `constituentDefinitions`, or `nodeCorrections` on one resolves the reference for you, so both station types answer the same questions.

`station.constituentDefinitions` is the line behind each constituent name the station stores, and behind every member a compound names, as `Station.ConstituentDefinition` values that map field for field to the engine's `ConstituentDefinition`. A source can define a name its own way, such as a different phase constant, and its stations read that definition in place of the shared one. `station.nodeCorrections` is the nodal correction formulas the source's constants were analyzed with, `.iho` or `.schureman`. Pass both to the engine (its `definitions` and node-correction options) so predictions match the analysis. `constituentDefinitions` is nil for a file written before definitions, which leaves every name to the engine's own catalog.

### Bytes you didn't ship

`init(data:)` and `init(contentsOf:)` check only the file identifier, the root table's bounds and the format version, throwing `InvalidStationDatabase` when the identifier is missing or the root table is cut off, so opening a bundled file pages in only its head. A truncated or corrupt file opened that way can trap the process on a later read. For a download or any other file you didn't ship, open it with `StationDatabase(verifying:)` or `StationDatabase(verifyingContentsOf:)`. They run the FlatBuffers verifier over the whole buffer, check every constituent, definition and datum name index against its table and that a definition's coefficients number seven, and check that every string is UTF-8, so a file they accept does not trap on a read; one they refuse throws `InvalidStationDatabase`. Every initializer throws `UnsupportedStationDatabase` for a file in a newer format than this package reads; upgrade the package to open it. They do not check that stations are in id order, that routes name stations in the file, or that references resolve. A file wrong in those ways gives nil or wrong results, not a trap. Verifying reads every page once, so do it once, when the file arrives. `init(verifyingContentsOf:)` memory-maps the file, and reads after verifying go to the file, so it must not change while the database is open. If you can't promise that, read it into `Data` and use `init(verifying:)`.

A `datumCoverage` count is a `uint`, which can overflow `Int` on a 32-bit watch. The verifying open refuses a count above `Int32.max`, and the plain reader returns nil coverage for a count that doesn't fit `Int`.

## Writing a database

`StationDatabase.build` writes a `.tcdb` with the same layout as the TypeScript builder, for tests that need a database with stations renamed, removed, copied or edited:

```swift
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
let data = try StationDatabase.build(
  stations, version: db.version, routes: routes,
  constituentDefinitions: db.constituentDefinitions)
```

`constituentDefinitions: db.constituentDefinitions` keeps the shared definitions. Each source's own definitions and node corrections travel on `StationInput.source`, so they carry through as read. Every constituent a station stores, and every member a definition names, must resolve in its source's own definitions or the shared ones, without a cycle; a subordinate whose reference is in the file predicts from the reference's record, so its own constituents are not checked. Stations whose sources share a name must carry the same definitions and node corrections. The file is written at format version 2 when a source of the stations written has its own definitions or uses Schureman's corrections, and at 1 otherwise.

`StationInput(station)` keeps the station's stored `attribution`, and `build` checks a given notice. It must start with the project credit and end with the licence's clause when the licence is one `StationAttribution.licenseNames` lists (which also needs a `url`), or otherwise carry no licence clause. With a `credits` entry for the station's `source.name` it must also equal `StationAttribution.notice(credit:license:)` composed from that entry. Without one it must be the notice `StationInput(station)` read, with the `source` and `license` it was read with, so a hand-written notice or a copy whose source or licence changed is refused. After changing a copied station's `source` or `license`, set `attribution = nil` and pass `credits`, each source's credit line by `source.name` (nil when it needs none), so the notice is composed again with `StationAttribution.notice(credit:license:)`:

```swift
if var copy = stations.first(where: { $0.id == "noaa/ACT0101" }) {
  copy.id = "noaa/ACT0101-cc-by"
  copy.license = StationLicense(
    type: "cc-by-4.0", url: "https://creativecommons.org/licenses/by/4.0/", commercialUse: true)
  copy.attribution = nil
  stations.append(copy)
}
let relicensed = try StationDatabase.build(
  stations, version: db.version, routes: routes,
  credits: ["US National Oceanic and Atmospheric Administration": nil],
  constituentDefinitions: db.constituentDefinitions)
```

A station with no `attribution` whose source has no entry in `credits` is refused, as in the TypeScript builder.

Rebuild a file from an older release the same way, with every `attribution` set to nil and `credits` for every source. Releases before 1.0.0-beta.20260925 credited the project under its earlier name, so their notices fail the project-credit check; files without the field read back with a nil `attribution` already. `build` throws `StationDatabaseBuildError` for whatever `buildDatabase` refuses, with these differences:

- It does not match `country` against `countryCode`, because that table is a JavaScript dependency.
- It refuses integer values that would overflow their field (`score` above 255, minutes outside `Int32`) instead of truncating them, and `datumCoverage` counts above `Int32.max`, which the verifying open refuses.
- A licence `StationAttribution.licenseNames` lists must have a `url`.
- A station keeping the notice it was read with, for the same source and licence, needs no `credits` entry; the TypeScript builder requires one for every source.
- A station that carries `tideOffsets` must be `.subordinate`, because the TypeScript reader resolves offsets only for one. The memberwise `StationInput` init infers `type` from the offsets when you leave it out.
- It refuses a subordinate whose tide `reference` is not in the file and that holds no constituents or datums of its own, which the TypeScript reader could not predict. Current offsets and `tideReference` are not checked, so a currents file can name tide stations that live in another file.
- It doesn't check a station's constituent definitions against the shared set it was read with, which `StationInput` doesn't carry; the TypeScript builder refuses a rebuild that changes them. Pass `db.constituentDefinitions` to keep them.

Non-finite major constituents and offsets are written as given, so a consumer's own validation can be tested against them.

Get the database file from the [latest release](https://github.com/openwatersio/slackwater-database/releases) and bundle it with your app, or fetch it at runtime.

## Attribution

Most stations are CC BY, so showing them carries an obligation to the original source, not only to this project. `station.attribution` is that notice, assembled in the database file itself, so this package keeps no table of sources and neither does your app.

**Display `station.attribution`.** That is the whole of the rule.

```
Slackwater database (https://github.com/openwatersio/slackwater-database). Source:
Hart-Davis, M., Dettmering, D., Seitz, F. (2025), TICON-4: TIdal CONstants
based on GESLA-4 sea-level records, SEANOE, https://doi.org/10.17882/109129.
Licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Modified:
see https://github.com/openwatersio/slackwater-database#modifications-to-source-data
```

Under a CC licence the string carries the creator credit, the licence and its URI, and an indication that the material was modified — the three things [CC BY 4.0 section 3(a)(1)](https://creativecommons.org/licenses/by/4.0/) requires a redistributor to pass on. The licence follows the station, not its source, because it varies within one source: TICON stations relayed from CMEMS are CC BY-NC while the rest are CC BY. A station whose licence imposes no notice, such as a public-domain NOAA record, gets the project credit alone.

To make a decision in code rather than show a string, read `station.license` for `type`, `url`, and `commercialUse`.

## Adding the package

Depend on the repository by URL. The manifest sits at the repository root and points back into this directory, so no checkout, submodule, or vendored copy is needed:

```swift
.package(url: "https://github.com/openwatersio/slackwater-database.git", exact: "1.0.0-beta.20260929")
```

The package version is the database release it ships with, so a pin names both the reader and the file format it reads.

## Development

The FlatBuffers accessors in `Sources/SlackwaterDatabase/generated/` are committed, generated by `flatc` from `schemas/database.fbs`. After a schema change, regenerate and commit:

```sh
npm run generate -w swift
```

The `flatc` version is pinned in [`mise.toml`](../../mise.toml) and must match the FlatBuffers runtime version pinned in [`Package.swift`](../../Package.swift); bump them together. CI fails when the generated code drifts from the schema.

Tests read a fixture written through the TypeScript `buildDatabase` — the same builder that produces the shipped file — and `attribution.json`, the notice constants from `attribution.ts` that `StationAttribution` must match. The test script's `pretest` writes both; they are git-ignored. From the repo root:

```sh
npm install
npm run test:swift -w swift
```
