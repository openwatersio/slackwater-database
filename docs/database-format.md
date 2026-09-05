# The FlatBuffers database file

The whole database ships as one FlatBuffers file, `stations.neaps`, built from `schemas/tide-database.fbs`. It is the format the JS module reads, the browser build fetches, and native apps can bundle: readers touch only the bytes they access, so an identity scan reads ids, names, and coordinates without decoding constituents, and a lookup by id reads one station's constituents without decoding anything else. The public API is unchanged and synchronous.

## Why a single binary file

Keeping station data off the V8 heap matters: parsing every station into live JS objects costs ~118 MB of heap and OOMs memory-constrained devices (see [signalk-tides#103](https://github.com/openwatersio/signalk-tides/issues/103)). Anything bundled into JavaScript — object literals, JSON strings, base64 — lands on the heap. A file does not:

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
- `file_identifier "NEAP"`, `file_extension "neaps"`.

## Build order and locality

The one thing the schema cannot express: FlatBuffers writes back to front, and a naive per-station loop interleaves ~100 bytes of identity with ~1,300 bytes of constituents, so an identity scan over a mapped file faults in every page anyway. `buildDatabase` (`src/database/builder.ts`) writes every station's constituents and datums vectors first, so they land together at the tail of the file, then every station table, so they land together at the head. `test/database.test.ts` asserts the lowest prediction-data offset is past the highest station-table offset, because this regresses silently if someone tidies the loop.

## The reader

`src/stations.ts` opens the buffer once, materializes identity fields into plain objects (`allStations`), and attaches lazy getters for `harmonic_constituents`, `datums`, and `epoch` that decode one station's data from the buffer on access. Subordinate stations resolve their reference station's harmonics and datums; their own offsets still apply. No caching — a persistent cache on module-level objects would pull the data back onto the heap.

The bytes come from a per-build source behind the `#database-bytes` subpath import:

- **Node** (`src/database/bytes.node.ts`): `readFileSync` into an off-heap `Buffer`.
- **Browser** (`src/database/bytes.browser.ts`): `fetch(new URL("../generated/stations.neaps", import.meta.url))`; bundlers that understand `new URL(..., import.meta.url)` copy the asset and rewrite the URL.

Both bundles resolve `../generated/stations.neaps` to one shared copy at `dist/generated/stations.neaps`.

## Search indexes

`near`/`nearest`/`bbox` use a bundled KDBush geo index (~66 KB, eager); `search()` builds a MiniSearch text index lazily on first call. Both are generated at build time from the raw data, sorted by id so index positions match the buffer's stations vector.

## Build pipeline

`npm run build`:

1. `generate` (`scripts/generate-database.ts`) — runs `flatc` to generate the TypeScript accessors into `src/generated/fbs/`, then builds `src/generated/stations.neaps` from `data/**/*.json` (all git-ignored). A `pretest` hook runs it too. `flatc` comes from mise (`.mise.toml`).
2. `tsdown` — builds `dist/node` and `dist/browser` (both ESM), resolving `#database-bytes` per build.
3. `copy-database` — copies the file to `dist/generated/`.
4. `tsc --noEmit` — type-checks src and the tests/tools against the schemas.
5. `smoke` (`scripts/smoke.mjs`) — imports both built entries, checks a reference and a subordinate station resolve prediction data, and asserts the browser bundle has no `node:fs`.

Releases attach the file as `neaps-<date>.neaps` alongside the TCD files.

## Downstream builders

`buildDatabase(stations)` is exported so downstream generators can write filtered catalogs of their own through the same builder and read them with the same generated readers — including current stations via `kind` and `current`.

## ESM only (no CJS build)

`kdbush` and `geokdbush` are ESM-only packages (no `require` export), so a CJS build can't `require()` them without a double-wrapped-default interop bug (`KDBush.from is not a function`). All first-party consumers use ESM, so the package ships **ESM only**. Modern Node still lets `require()` load the ESM entry (require-of-ESM); older CJS-only tooling would need to `import()` it.
