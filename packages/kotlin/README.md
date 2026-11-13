# SlackwaterDatabase for Kotlin

Kotlin/JVM reader for the station database file (`.tcdb`, [FlatBuffers](https://flatbuffers.dev), [`schemas/database.fbs`](../../schemas/database.fbs)). Open a memory-mapped file, iterate station identity, look up a station by id, and read tide or current data while touching only the bytes each read needs. It has no Android framework dependency.

## Usage

```kotlin
import io.openwaters.slackwater.database.*

val db = StationDatabase.open(file) // memory-mapped

// Identity scan: id, name, coordinates. Reads only the head pages of the
// file because the builder groups station tables there.
val nearest = db.minBy { distanceTo(it.latitude, it.longitude) }

// Lookup by id: binary search inside the buffer, no scan.
val station = db.station("noaa/9447130")

// Prediction data, decoded only when you read it.
val m2 = station?.constituents?.firstOrNull { it.name == "M2" }
val datums = station?.datums // {MLLW=2.419, MSL=4.443, ...}
val shift = station?.chartDatumShift // datums[MSL] - datums[chartDatum]

// How low and high a prediction can go, in metres above the chart datum.
// Reduced through the offsets for a subordinate.
val range = station?.astronomicalBounds // AstronomicalBounds(lat=-0.619, hat=3.681)

// The notice to show wherever the station's data appears.
val notice = station?.attribution
val current = db.station("noaa/PUG1515")?.current
val minor = current?.minorConstituents // names, amplitudes in knots, Greenwich phases
val crossAxisMean = current?.minorMeanFlow // knots; null means unknown
val axis = current?.azimuth // degrees true; zero is a known northward axis
val commercialUse = station?.license?.commercialUse

// Stable links: binary lookup by slug, including former paths in the result.
val route = db.stationRoute(StationRouteKind.TIDE, "friday-harbor")
```

`StationDatabase` is a `List<Station>` in id order, and two reads of the same record from one database are equal. `Station` exposes typed identity, quality, source, license, tide, and current values; epochs are `java.time.LocalDate`. The generated FlatBuffers accessors are internal to the library.

A database and its stations can be read from any thread. The database reads the buffer you give it in place, so its bytes must not change while the database is in use. Each property decodes on access and nothing is cached, so keep a value you use repeatedly in a local.

A subordinate tide station's record holds no constituents or datums of its own, only the offsets that correct its reference's. Reading `constituents`, `datums`, `chartDatumShift`, or `astronomicalBounds` on one resolves the reference for you, so both station types answer the same questions. A subordinate current station is not resolved: look up `current.offsets.reference` and predict from that station's constituents and `current.meanFlow`, corrected by the offsets.

`station.disclaimers` is free text from the station's source record: caveats such as a gauge that dries out at low water, notes on how its datums were derived, and for some sources a credit that `attribution` already carries. Read it when deciding what to tell a user about a station.

Get the database file from the [latest release](https://github.com/openwatersio/slackwater-database/releases) and bundle it with your app, or fetch it at runtime.

### Opening the file

`StationDatabase.open(file)` maps a file, and `StationDatabase(buffer)` reads any `ByteBuffer`, such as a download held in memory. To map a database bundled as an Android asset, store it uncompressed (`androidResources { noCompress += "tcdb" }`) and map the asset's range of the APK:

```kotlin
val db = context.assets.openFd("stations.tcdb").use { fd ->
    FileInputStream(fd.fileDescriptor).channel.use { channel ->
        StationDatabase.open(channel, fd.startOffset, fd.length)
    }
}
```

The mapping stays valid after the channel closes.

Opening checks the file identifier and format version, and nothing else. Bytes without the identifier or root table throw `InvalidStationDatabaseException`, and a file in a newer format than this reader knows throws `UnsupportedStationDatabaseException`; upgrade the reader to open it.

## Attribution

Most stations are CC BY, so showing them carries an obligation to the original source, not only to this project. `station.attribution` is that notice, assembled in the database file itself, so this library keeps no table of sources and neither does your app.

**Display `station.attribution`.** That is the whole of the rule. The [Swift reader's README](../swift/README.md#attribution) shows a complete notice and explains what it carries. To make a decision in code rather than show a string, read `station.license` for `type`, `url`, and `commercialUse`.

## Use from source

Builds use JDK 17, the Kotlin plugin version pinned in [`build.gradle.kts`](build.gradle.kts) and the checked-in Gradle wrapper. The library targets JVM 8 bytecode and uses `java.time.LocalDate`; Android consumers require `minSdk = 26` because [java.time was added in API 26](https://developer.android.com/reference/java/time/LocalDate). Its runtime dependencies are the FlatBuffers Java runtime and the Kotlin standard library at the plugin's version, so consuming builds need Kotlin 2.3 or later.

This is a source distribution, resolved through a Gradle composite build; it is not published to Maven Central. Check out the repository at a reviewed full commit SHA and keep that SHA in your application's dependency setup. Pick a commit from a [release](https://github.com/openwatersio/slackwater-database/releases) so the reader matches the database file you bundle:

```sh
git clone https://github.com/openwatersio/slackwater-database.git vendor/slackwater-database
git -C vendor/slackwater-database checkout --detach <full-reviewed-commit-sha>
```

In your application's `settings.gradle.kts`:

```kotlin
includeBuild("vendor/slackwater-database/packages/kotlin")
```

In its `build.gradle.kts`:

```kotlin
dependencies {
    implementation("io.openwaters:slackwater-database:0.1.0")
}
```

See [smoke](smoke) for a complete separate consumer.

## Development

The FlatBuffers accessors in `src/main/kotlin/generated/` are committed, generated by `flatc` from `schemas/database.fbs`, so a composite build needs no `flatc`. After a schema change, regenerate and commit:

```sh
npm run generate -w kotlin
```

The `flatc` version is pinned in [`.mise.toml`](../../.mise.toml). Its matching Java runtime was never published to Maven Central, so the library depends on the newest published one; [`generate`](generate) explains why that pair is compatible. Check the two when bumping `flatc`. CI fails when the generated code drifts from the schema.

Tests read a fixture written through the TypeScript `buildDatabase`, the same builder that produces the shipped file, by the [script the Swift tests use](../swift/scripts/generate-fixture.ts). From the repo root:

```sh
npm install
npm run test:kotlin -w kotlin
```

Set `SLACKWATER_TCDB` to the absolute path of a database file, such as the `packages/database/src/generated/slackwater.tcdb` the pretest builds, to also check the reader against the real database.
