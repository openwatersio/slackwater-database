# The FlatBuffers database file

The whole database ships as one [FlatBuffers](https://flatbuffers.dev) file, `slackwater.tcdb`, built from `schemas/database.fbs`. It is the format the JS module reads, the browser build fetches, and native apps can bundle: readers touch only the bytes they access, so an identity scan reads ids, names, and coordinates without decoding constituents, and a lookup by id reads one station's constituents without decoding anything else. JavaScript consumers explicitly call `await loadStations()`; lookups and getters on the returned instance are synchronous.

## Why a single binary file

Any platform that needs station data otherwise has to parse all of it into memory to read any of it: object literals, JSON catalogs, and Codable records all decode the whole database up front, whether the consumer is a Node process, a browser, or an iOS widget ranking nearby stations. On the JS side that parse costs ~118 MB of V8 heap and OOMs memory-constrained devices (see [signalk-tides#103](https://github.com/openwatersio/signalk-tides/issues/103)); on a phone it is hundreds of milliseconds of decode before the first read. A file that readers access in place avoids the whole class of problem:

- **Node** reads it with `readFile` into a `Buffer`, whose backing bytes are external memory, off the V8 heap.
- **Browsers** fetch it into an `ArrayBuffer`.
- **Native apps** can memory-map it; a widget touching one station faults in a few pages.

Per-record JSON decode was never the cost (4 ms for 200 records); the cost is decoding everything to read anything. FlatBuffers fixes that with zero-copy access, and one schema generates readers for TypeScript, Swift, and Kotlin.

## Schema shape

- One root table with `version`, `format_version`, a `stations` vector sorted by `id` (the FlatBuffers `key`, so lookup is a binary search inside the buffer), name tables for constituent and datum names, the shared [constituent definitions](#constituent-definitions), and separate tide/current route vectors sorted by slug.
- `Station` carries identity (id, name, kind, type, coordinates, timezone, locality, region, ISO region code, country, ISO country code, continent, context, cities, aliases), prediction data (constituents, datums, chart datum, tide/current offsets, source-reported epoch, optional mean-datum epoch), and provenance (source, license, disclaimers).
- Constituents are a struct vector: a `ushort` index into the root name table plus two `float` values — 12 bytes per constituent, contiguous, versus ~28 for a table per constituent. Float32 holds seven significant digits. Source files keep each publisher's precision, and digits beyond seven significant figures are dropped here, far below any analysis's uncertainty. Datums use the same struct-plus-name-table pattern.
- Identical `source` and `license` tables are written once and shared; repeated strings (timezones, countries, epochs) are deduplicated with shared strings.
- `Station.attribution` is the station's complete display notice — creator credit, licence and its URI, and an indication of modification — assembled when the file is built, from the station's `license` and its source's credit line, so a reader in any language displays it without keeping its own table of sources or its own reading of what a licence requires. A rebuild through the Swift writer keeps the notice it read unless the caller clears it. It is per station because licence varies within a single source, and a shared string, so the file holds one copy per distinct notice.
- A `Current` sub-table and `Kind` enum keep current stations in the same `stations` vector and id lookup. It carries directions, major and minor mean flow, minor-axis constituents, azimuth, tide references, subordinate-current offsets, magnitude notes, tide-derived rules, and each fitted CHS gate's measured tier (`chs_fit`).
- `tide_routes` and `current_routes` map stable slugs to one or more provider ids and retain former paths for redirects. Route lookup is a binary search; the full list is decoded only when requested.
- Quality evaluation (each record's `quality` block in its station file) rides along: the gate — `accepted` and `score` — is inline on `Station` so an identity scan can filter and rank from head pages, and the detail (factors, issues, reason, redundant) is a `Quality` sub-table written at the tail with the other lookup data. The file carries all stations, rejected ones included; readers apply the `accepted` filter.
- `file_identifier "TCDB"`, `file_extension "tcdb"`.

## Format version

`Root.format_version` is the format's major version, 1 today. Files from this release on store the phases of M3, S3 and M7 against Schureman's equilibrium argument, which `@slackwater/engine` uses from 1.0.0-beta.12; earlier releases store them 180° away, against the argument 1.0.0-beta.11 and earlier use, so read a file with the engine of its release. The JavaScript, Swift and Kotlin readers refuse a file whose version is newer than the one they were built for: JavaScript throws `UnsupportedStationDatabaseError`, Swift throws `UnsupportedStationDatabase`, and Kotlin throws `UnsupportedStationDatabaseException`, each carrying the file's version. Swift and JavaScript read the version with bounds checks, and Swift does it before the verifier runs, so `init(verifying:)` reports a newer file as unsupported even when this version's verifier would refuse it. Files written before the field existed read as 0 and open as version 1. A reader that knows a later version keeps opening 0 as version 1 for as long as it opens version 1.

The version goes up only for a change that an older reader would misread rather than ignore, such as storing phases under another convention. Adding a table or a field that older readers skip keeps it. The constant lives in three places: `FORMAT_VERSION` in `packages/database/src/database/format.ts`, `StationDatabase.formatVersion` in Swift and `StationDatabase.FORMAT_VERSION` in Kotlin. They change together, in the same PR as the change that needs it. The Swift and Kotlin tests read a fixture written by the TypeScript builder, which refuses to write it at any version but `FORMAT_VERSION`, and compare its version with their own constant, so a bump that the builder never writes, or that misses one reader, fails CI.

Only readers that check the version are protected: not readers released before it existed, and not one an app generates from the schema without adding the check. So a breaking change can ship only after the apps that read the file have released a reader that checks. A reader generated from the schema should refuse a `format_version` above the one it was written for. `version`, the release tag, is for display and isn't checked.

## Constituent definitions

A stored constituent is a name, an amplitude and a phase. The name stands for a line: a speed, Doodson numbers and a phase constant, and the constituents whose nodal corrections it takes. Sources don't all mean the same line by a name, so the file stores the line each name stands for, in the shape `@slackwater/engine`'s `ConstituentDefinition` takes.

- `Root.constituent_definitions` is the shared set, one definition per catalog line. It covers every name a station stores, unless the station's source defines it, and every member those definitions name, including members no station stores. The build copies each line from `@slackwater/engine`'s catalog, under the catalog's name, with every alias the catalog gives it ("MM" for "Mm").
  The shared set must hold the catalog's lines as they are. A reader released before definitions ignores it and predicts with its own catalog, so a shared line that differs from the catalog would predict differently there. A line that differs belongs to a source.
- `Source.constituent_definitions` holds a source's own definitions, which replace a shared one of the same name or alias, or add a name the catalog lacks, for that source's stations only. All of a source's stations share one vector.
- `Source.node_corrections` says whether the source's constants were analyzed with IHO's nodal correction formulas or Schureman's. Absent means IHO.

Reading the definitions doesn't change an app's predictions: the app has to pass each station's definitions and nodal formulas to the engine. A reader released before definitions, or an app that doesn't pass them, predicts a source's own definitions and Schureman's formulas wrong, at the same format version, so hold any source's until the apps pass them.

A source declares both in its `sources/<name>/metadata.yaml`, as `node_corrections` (`iho` or `schureman`) and `constituent_definitions` (a list of `{ name, speed, coefficients, members, aliases }` objects, with `speed` in degrees per hour and `coefficients` as seven integers, or null for a compound). [packages/stations/constituent-definitions.ts](../packages/stations/constituent-definitions.ts) assembles what the builder stores. The build fails on a name neither the source nor the catalog defines, and on any station whose set `@slackwater/engine` would refuse, checked the way the predictor merges it onto its own catalog.

A reader assembles a station's set from its stored names and every member they lead to, taking the source's own definition first when it defines that name or any spelling of the shared one. A subordinate's set comes from its reference, like its constituents. In JavaScript the set is `station.constituent_definitions` and the formulas are `station.node_corrections`, ready for the engine's `definitions` and `nodeCorrections` options; `stationDefinitions` and `definitionIndex` are exported for a reader built on other data. A file written before definitions has none, and readers leave every name to the predictor's own catalog. To rebuild from a read database, pass its constituents back (`db.constituents` in JavaScript, `db.constituentDefinitions` in Swift). `buildDatabase` refuses a station, read from a database, that the given constituents would give other definitions or formulas than it was read with. A filtered rebuild that leaves out a subordinate's reference stores the reference's constituents on the subordinate's own record, which then reads its own source's definitions and formulas, so it is refused when those differ; keep the reference in the file. A file written before definitions passes back an empty set, and the rebuild has none either: with no shared definitions and no source that changes predictions, the builder doesn't check names.

The builders check that every set is well formed, resolves and has no cycles, and that no two of a source's definitions replace one shared definition. They don't check a speed against its coefficients; the repo build checks each station's set with `@slackwater/engine` itself, and a downstream builder should do the same.

## Build order and locality

The finished file is laid out in two bands: every station table together at the head, and every station's lookup data together at the tail. The head band holds everything a scan needs — ids, names, coordinates, and the quality gate (`accepted` and `score` are inline scalars on the station table, not in the tail-side `Quality` detail) — so ranking all 8,000+ stations by distance and filtering to accepted ones touches only the head pages. The tail band holds what only a per-station lookup reads: constituents, datums, and the quality detail (factors, issues, reason), faulting in only when someone looks up that station. Identity is ~100 bytes per station and constituents ~1,300, so an interleaved layout would spread identity across thirteen times as many pages and an identity scan would fault in essentially the whole file.

The schema can't express this; the builder has to produce it deliberately. FlatBuffers writes buffers back to front — whatever is built first lands at the highest addresses — so `buildDatabase` (`src/database/builder.ts`) builds in two passes: first every station's constituents, datums, and quality tables (landing together at the tail), then every station table (landing together at the head). The natural refactor, one loop building each station's vectors right before its table, produces the interleaved layout — and nothing else fails when that happens. `test/database.test.ts` guards it by asserting the lowest prediction-data offset sits past the highest station-table offset.

## The reader

`loadStations()` obtains the bytes and creates an instance. Importing the package performs no database I/O or station decoding. Node reads a local file or fetches a URL, browsers fetch a URL, and Workers decode the bundled base64 or fetch a supplied URL when the loader is called. A caller can also pass a `Uint8Array` directly. The loader checks the TCDB identifier, that the root table lies inside the buffer, and the [format version](#format-version), throwing `UnsupportedStationDatabaseError` for a newer file; it is not a full structural verifier.

`src/stations.ts` creates a per-instance reader. `byId(id)` binary-searches the sorted station vector and caches successful lookups and decoded identity objects. `all` materializes the full identity array on demand; `accepted` materializes the quality-accepted subset, checking inline quality flags before decoding identity. Both collections reuse cached objects. Every call for the bundled database shares one instance; each supplied source gets independent identity, collection, route, and search-index caches.

Each station has lazy getters for constituents, datums, epoch, datum metadata, astronomical bounds, and current details. These read from the retained buffer on every access without caching prediction objects. Subordinates resolve their reference record by ID without materializing its identity; their own offsets still apply. `buildDatabase` stores what each subordinate resolved to, so one whose reference a filtered rebuild left out reads its own record instead.

Quality is stored in the file: acceptance and score are read with identity, while factors, issues, reason, redundancy, and seasonal dominance remain lazy. `qualityMap` builds the full quality map only when requested. The runtime reads existing evaluations; it does not rerun the quality analysis.

`quality.seasonal_dominant` is a label, not a rejection: water with no real tide — the Great Lakes, river reaches, Baltic bodden — stays accepted and carries the flag. It is the stable detector, and a consumer must read it rather than count the symptom. Counting days whose high sits at or below datum does not work: across six 2026 dates the count ran 58, 96, 6, 8, 10, 27, and of the 161 stations that showed it on any date, none showed it on all six.

The flag is set when the peak of the seasonal curve, SA·cos(θ − g_SA) + SSA·cos(2θ − g_SSA) at its largest over a year (with SA and SSA under any of the names the sources use, see `seasonalTerms`), exceeds the principal tide M2+S2+K1+O1 by more than 3 mm, the amplitude tolerance the quality gates use (`seasonalPeak` and `SEASONAL_DOMINANCE_RATIO` in [packages/stations/filtering.ts](../packages/stations/filtering.ts)). No published criterion sets this line, so it is this project's definition. Consumers present two bands split at 3× on the ratio of that peak to the principal tide: above it the note leads, below it joins the datum note. A new consumer should read the flag and split at the same 3× rather than invent a threshold. A labelled station can have a principal tide of zero, so the ratio can be infinite. The ratio is derived per consumer from constituents each already ships, deliberately not a database field, and it has to be this ratio: dividing by the largest single constituent, or using the larger of SA and SSA as the peak, disagrees with the flag.

The bytes come from a per-build source behind the `#slackwater.tcdb` subpath import — each default-exports a loader function:

- **Node** (`src/database/bytes.node.ts`): `readFile` into an off-heap `Buffer` when loading; supplied HTTP(S) URLs use fetch.
- **Browser** (`src/database/bytes.browser.ts`): `fetch(new URL("../generated/slackwater.tcdb", import.meta.url))`; bundlers that understand `new URL(..., import.meta.url)` copy the asset and rewrite the URL.
- **Workers** (`src/database/bytes.worker.ts`, selected by the `workerd`/`worker` export conditions): Cloudflare Workers can't construct file URLs from `import.meta.url` and disallow `fetch` during module evaluation, so the database is inlined into `dist/worker` as a base64 literal by a build-time macro and decoded only when `loadStations()` requests the bundled database. The bundle is ~4.5 MiB compressed, which needs a plan with the 10 MiB script limit — free plans (3 MiB) have never fit this database in any format. The smoke test guards the compressed size so data growth surfaces at build time rather than at a consumer's deploy.

Both bundles resolve `../generated/slackwater.tcdb` to one shared copy at `dist/generated/slackwater.tcdb`.

## Search indexes

Both indexes initialize lazily per instance: `near`/`nearest`/`bbox` use KDBush, and `search()` uses MiniSearch. For the bundled database, build-time macros supply serialized indexes generated from that exact file. For a supplied file, URL, or byte buffer, the geo index reads coordinates directly from the loaded buffer and the text index reads searchable metadata. This prevents mismatched record positions, coordinates, names, or IDs when the supplied database differs from the bundled one. Creating these indexes does not populate the station identity cache or read prediction fields; only returned results and custom-filter candidates need identity objects.

## Build pipeline

`npm run build`:

1. `generate` (`scripts/generate-database.ts`) — runs `flatc` to generate the TypeScript accessors into `src/generated/fbs/`, then builds `src/generated/slackwater.tcdb` from `data/**/*.json` (all git-ignored). A `pretest` hook runs it too. `flatc` comes from mise (`.mise.toml`).
2. `tsdown` — builds `dist/node`, `dist/browser`, and `dist/worker` (all ESM), resolving `#slackwater.tcdb` per build.
3. `copy-database` — copies the file to `dist/generated/`.
4. `tsc --noEmit` — type-checks src and the tests/tools against the schemas.
5. `smoke` (`scripts/smoke.mjs`) — imports all three built entries, checks a reference and a subordinate station resolve prediction data, and asserts the browser and worker bundles have no filesystem imports. Importing each bundle is tested with fetch and base64 decoding poisoned; the worker bundle also must not use `import.meta.url`.

Releases attach the file as `slackwater-<date>.tcdb` alongside the TCD files.

## Downstream builders

`buildDatabase(stations, { routes, credits, constituents })` is exported so downstream generators can write filtered catalogues through the same builder and read them with the same generated readers. The package exports `credits: ReadonlyMap<string, string | null>`, generated from the same `sources/<name>/metadata.yaml` entries as the bundled database. It maps each published `source.name` to its credit line, or null when it needs none. Pass it directly when rebuilding published stations; a custom source needs its own entry, and a station whose source has no entry is refused. `constituents` is required too: a definition for every name the stations store, and each source's own definitions and nodal formulas, as [constituent definitions](#constituent-definitions) describes. When rebuilding stations read from a database, pass that database's `constituents`, which holds its shared definitions and each source's own.

The Swift package has a writer with the same layout, `StationDatabase.build(_:version:routes:credits:constituentDefinitions:)` (`packages/swift/Sources/SlackwaterDatabase/StationDatabaseBuilder.swift`), so a Swift test can read a `.tcdb`, edit stations, and write a new one. `StationInput(station)` copies the fields `StationInput` carries from the station's own record, without resolving a subordinate's reference. It keeps a stored quality table and an unedited `chs_fit`'s stored tier and numbers, which the public reader masks for an unknown tier. A schema field `StationInput` does not carry is dropped on a rebuild; the Swift tests compare which fields each table stores before and after, to catch that.

`StationInput.attribution` is the stored notice. When it is nil, `build` composes the notice the way `attributionWithCredit` does and refuses a source with no `credits` entry. A given notice must start with the project credit and end with the licence's clause when `LICENSE_NAMES` names the licence, or otherwise carry no licence clause (`Licensed <name> (` or the modifications pointer). With a `credits` entry for the station's source it must also equal the notice that entry composes. Without one it must be the notice `StationInput(station)` read, with the source and licence it was read with, so a hand-written notice or a copy whose source or licence changed is refused, as `buildDatabase` refuses a source with no credit decision. The Swift constants are checked against `attribution.ts` by a test, from JSON that `packages/swift/scripts/generate-attribution.ts` writes before the Swift tests run. The writer refuses what `buildDatabase` refuses, with these differences:

- It does not match `country` against `country_code`, because that lookup table is a JS dependency.
- It refuses integer values that would overflow their field instead of truncating them, and `datum_coverage` counts above 2,147,483,647, which would not fit a 32-bit `Int` in the Swift reader.
- A licence `LICENSE_NAMES` names must have a URL, where the TypeScript builder would write `(undefined)`.
- A station keeping the notice it was read with, for the same source and licence, needs no `credits` entry; `buildDatabase` requires one for every source.
- A station that carries tide offsets must be subordinate, since the JS reader resolves offsets only for one.
- It refuses a subordinate whose tide reference is absent from the file and that has no prediction data of its own, because the JS reader resolves such a subordinate to its own record and throws when that is empty.
- It doesn't check a station's constituent definitions against the ones it was read with, because `StationInput` carries its source's definitions and node corrections but not the shared definitions it was read with; `buildDatabase` refuses a rebuild that changes them. Pass the shared set the file was read with, `StationDatabase.constituentDefinitions`.

Its output is not byte-identical to the TypeScript builder's. Datum vectors are written in name order, because a Swift dictionary has no insertion order. Read back, every field matches.

## Current vectors

`Current.minor_constituents`, `minor_mean_flow`, and `azimuth` are appended optional fields. JS exposes the same snake-case names on `station.current`; Swift and Kotlin expose `minorConstituents`, `minorMeanFlow`, and `azimuth`. Minor constituents use the root constituent-name table, including names found only on the minor axis, and their vectors live in the prediction tail alongside major constituents.

Speeds are knots, phases are Greenwich degrees, and azimuth is the major-axis bearing in degrees true. Optional scalars use FlatBuffers null defaults, so an older file reads as absent while measured zero survives. Older readers ignore the new fields. Records without minor data keep their scalar model; subordinates retain their published time and speed offsets.

Subordinate timelines use the scalar reduction and the subordinate's published bearings. A reference's minor axis must not be projected through a subordinate's time and speed ratios.

## Datum provenance

`Station.datum_epoch` is an optional appended FlatBuffers field. Older files read it as absent, and older readers ignore it. JS exposes `datum_epoch`, and Swift and Kotlin expose `datumEpoch` (Kotlin as `LocalDate`s); subordinates inherit their reference's reduction period with its datums. `epoch` retains its source-specific analysis or datum meaning and drives quality ranking; TICON uses its constituent fit period.

`Station.datum_frame` is an optional appended enum with an unknown default. JS exposes `datum_frame` (`gauge` or `constituent`), Swift exposes `datumFrame` (`StationDatumFrame.gauge` or `.constituent`), and Kotlin exposes `datumFrame` (`StationDatumFrame.GAUGE` or `CONSTITUENT`). Unknown values and older files return undefined/nil/null. The field describes the stored datum values, before subtracting `chart_datum` for predictions. Subordinates inherit their reference's frame with its unreduced datums; JS also inherits its `datums_source`. TICON supplies the frame explicitly. Other sources without reviewed frame metadata remain unspecified; consumers must not infer it from a zero MSL. The field does not establish a geodetic or cross-provider gauge-zero relationship.

`Station.datum_coverage` is an optional appended table containing the observed reduction’s month count and observed/inferred hourly-bin counts. JS exposes `datum_coverage` with `months`, `observed_hours`, and `inferred_hours`; Swift and Kotlin expose `datumCoverage` (`StationDatumCoverage`, with `observedHours`/`inferredHours`). Subordinates inherit the reference’s counts with its datums. Older files and harmonic fallbacks read as absent; absence is not evidence of zero inferred hours.

Optional JS datum getters can exist on an object while returning `undefined`. Check their values rather than using key presence to infer provenance.

## ESM only (no CJS build)

`kdbush` and `geokdbush` are ESM-only packages (no `require` export), so a CJS build can't `require()` them without a double-wrapped-default interop bug (`KDBush.from is not a function`). All first-party consumers use ESM, so the package ships **ESM only**. Modern Node still lets `require()` load the ESM entry (require-of-ESM); older CJS-only tooling would need to `import()` it.
