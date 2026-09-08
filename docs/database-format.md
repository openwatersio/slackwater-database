# The FlatBuffers database file

The whole database ships as one [FlatBuffers](https://flatbuffers.dev) file, `neaps.tcdb`, built from `schemas/database.fbs`. It is the format the JS module reads, the browser build fetches, and native apps can bundle: readers touch only the bytes they access, so an identity scan reads ids, names, and coordinates without decoding constituents, and a lookup by id reads one station's constituents without decoding anything else. The public API is unchanged and synchronous.

## Why a single binary file

Any platform that needs station data otherwise has to parse all of it into memory to read any of it: object literals, JSON catalogs, and Codable records all decode the whole database up front, whether the consumer is a Node process, a browser, or an iOS widget ranking nearby stations. On the JS side that parse costs ~118 MB of V8 heap and OOMs memory-constrained devices (see [signalk-tides#103](https://github.com/openwatersio/signalk-tides/issues/103)); on a phone it is hundreds of milliseconds of decode before the first read. A file that readers access in place avoids the whole class of problem:

- **Node** reads it with `readFileSync` into a `Buffer`, which is external memory, off the heap.
- **Browsers** fetch it into an `ArrayBuffer`.
- **Native apps** can memory-map it; a widget touching one station faults in a few pages.

Per-record JSON decode was never the cost (4 ms for 200 records); the cost is decoding everything to read anything. FlatBuffers fixes that with zero-copy access, and one schema generates readers for TypeScript, Swift, and Kotlin.

## Schema shape

- One root table with `version`, a `stations` vector sorted by `id` (the FlatBuffers `key`, so lookup is a binary search inside the buffer), and name tables for constituent and datum names.
- `Station` carries identity (id, name, kind, type, coordinates, timezone, region, country, continent, aliases), prediction data (constituents, datums, chart datum, offsets, epoch), and provenance (source, license, disclaimers).
- Constituents are a struct vector: a `ushort` index into the root name table plus two `float` values — 12 bytes per constituent, contiguous, versus ~28 for a table per constituent. Float32 holds seven significant digits; sources publish three decimal places. Datums use the same struct-plus-name-table pattern.
- Identical `source` and `license` tables are written once and shared; repeated strings (timezones, countries, epochs) are deduplicated with shared strings.
- A `Current` sub-table and `Kind` enum give current stations a place in the same `stations` vector — one key space, one lookup. This repo ships no current data; downstream catalogs can write theirs through `buildDatabase`.
- Quality evaluation (`quality.json`) rides along: the gate — `accepted` and `score` — is inline on `Station` so an identity scan can filter and rank from head pages, and the detail (factors, issues, reason, redundant) is a `Quality` sub-table written at the tail with the other lookup data. The file carries all stations, rejected ones included; readers apply the `accepted` filter.
- `file_identifier "TCDB"`, `file_extension "tcdb"`.

## Build order and locality

The finished file is laid out in two bands: every station table together at the head, and every station's lookup data together at the tail. The head band holds everything a scan needs — ids, names, coordinates, and the quality gate (`accepted` and `score` are inline scalars on the station table, not in the tail-side `Quality` detail) — so ranking all 8,000+ stations by distance and filtering to accepted ones touches only the head pages. The tail band holds what only a per-station lookup reads: constituents, datums, and the quality detail (factors, issues, reason), faulting in only when someone looks up that station. Identity is ~100 bytes per station and constituents ~1,300, so an interleaved layout would spread identity across thirteen times as many pages and an identity scan would fault in essentially the whole file.

The schema can't express this; the builder has to produce it deliberately. FlatBuffers writes buffers back to front — whatever is built first lands at the highest addresses — so `buildDatabase` (`src/database/builder.ts`) builds in two passes: first every station's constituents, datums, and quality tables (landing together at the tail), then every station table (landing together at the head). The natural refactor, one loop building each station's vectors right before its table, produces the interleaved layout — and nothing else fails when that happens. `test/database.test.ts` guards it by asserting the lowest prediction-data offset sits past the highest station-table offset.

## The reader

`src/stations.ts` opens the buffer once, materializes identity fields into plain objects (`allStations`), and attaches lazy getters for `harmonic_constituents`, `datums`, and `epoch` that decode one station's data from the buffer on access. Subordinate stations resolve their reference station's harmonics and datums; their own offsets still apply. No caching — a persistent cache on module-level objects would pull the data back onto the heap.

The quality gate comes from the same file: `station.quality` carries `accepted` and `score` eagerly (read inline during the identity scan) with lazy getters for the detail, `qualityMap` indexes those objects by id, and the `stations` export filters `allStations` on `accepted`. The module does not bundle `quality.json`; it stays in the repo as the artifact `tools/evaluate-quality.ts` writes and the build embeds.

The bytes come from a per-build source behind the `#database-bytes` subpath import:

- **Node** (`src/database/bytes.node.ts`): `readFileSync` into an off-heap `Buffer`.
- **Browser** (`src/database/bytes.browser.ts`): `fetch(new URL("../generated/neaps.tcdb", import.meta.url))`; bundlers that understand `new URL(..., import.meta.url)` copy the asset and rewrite the URL.
- **Workers** (`src/database/bytes.worker.ts`, selected by the `workerd`/`worker` export conditions): Cloudflare Workers can't construct file URLs from `import.meta.url` and disallow `fetch` during module evaluation, so the database is inlined into `dist/worker` as a base64 literal by a build-time macro and decoded once on first use.

Both bundles resolve `../generated/neaps.tcdb` to one shared copy at `dist/generated/neaps.tcdb`.

## Search indexes

`near`/`nearest`/`bbox` use a bundled KDBush geo index (~66 KB, eager); `search()` builds a MiniSearch text index lazily on first call. Both are generated at build time from the raw data, sorted by id so index positions match the buffer's stations vector.

## Build pipeline

`npm run build`:

1. `generate` (`scripts/generate-database.ts`) — runs `flatc` to generate the TypeScript accessors into `src/generated/fbs/`, then builds `src/generated/neaps.tcdb` from `data/**/*.json` (all git-ignored). A `pretest` hook runs it too. `flatc` comes from mise (`.mise.toml`).
2. `tsdown` — builds `dist/node`, `dist/browser`, and `dist/worker` (all ESM), resolving `#database-bytes` per build.
3. `copy-database` — copies the file to `dist/generated/`.
4. `tsc --noEmit` — type-checks src and the tests/tools against the schemas.
5. `smoke` (`scripts/smoke.mjs`) — imports all three built entries, checks a reference and a subordinate station resolve prediction data, and asserts the browser and worker bundles have no `node:fs` and that the worker bundle neither fetches during module evaluation (fetch is poisoned for its import) nor uses `import.meta.url`.

Releases attach the file as `neaps-<date>.tcdb` alongside the TCD files.

## Downstream builders

`buildDatabase(stations)` is exported so downstream generators can write filtered catalogs of their own through the same builder and read them with the same generated readers — including current stations via `kind` and `current`.

## ESM only (no CJS build)

`kdbush` and `geokdbush` are ESM-only packages (no `require` export), so a CJS build can't `require()` them without a double-wrapped-default interop bug (`KDBush.from is not a function`). All first-party consumers use ESM, so the package ships **ESM only**. Modern Node still lets `require()` load the ESM entry (require-of-ESM); older CJS-only tooling would need to `import()` it.
