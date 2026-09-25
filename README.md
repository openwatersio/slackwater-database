# Neaps Tide and Current Station Database

> A public database of tide and current stations

This database includes station identity, structured location, stable web routes, and harmonic data from sources around the world. Tide constants can be used with a harmonic calculator like [Neaps](https://github.com/openwatersio/neaps) to create astronomical predictions.

## Sources

- ✅ [**NOAA**](sources/noaa/README.md): National Oceanic and Atmospheric Administration
  ~3400 stations, mostly in the United States and its territories. Updated monthly via [NOAA's API](https://api.tidesandcurrents.noaa.gov/mdapi/prod/).

- ✅ [**TICON-4**](sources/ticon/README.md): TIdal CONstants based on GESLA-4 sea-level records
  ~4200+ global stations - ([#16](https://github.com/openwatersio/tide-database/pull/16))

If you know of other public sources of harmonic constituents, please [open an issue](https://github.com/openwatersio/tide-database/issues/new) to discuss adding them.

## Usage

The database is available as an NPM package, as a tide-only [XTide-compatible TCD file](./packages/tcd/), and as a unified [FlatBuffers file](./docs/database-format.md) of tide and current stations.

### XTide / OpenCPN / TCD-compatible software

A pre-built [TCD file](./packages/tcd/README.md) compatible with XTide, OpenCPN, and any software that reads the libtcd format. [See the TCD package for usage instructions.](./packages/tcd/README.md)

### FlatBuffers file

Each release attaches `neaps-<date>.tcdb`, the whole database as one [FlatBuffers](https://flatbuffers.dev) file built from [`schemas/database.fbs`](./schemas/database.fbs). It is the same file the NPM package reads; native apps can bundle and memory-map it, generating a reader in their language from the schema. [See the format documentation.](./docs/database-format.md)

### JavaScript / TypeScript

```sh
$ npm install @neaps/tide-database
```

The module exports every tide and current station in the database, along with stable web routes and geographic, bounding box, and full-text search. [See the package README for the full API.](./packages/database/README.md)

### Swift

```swift
.package(url: "https://github.com/openwatersio/tide-database.git", from: "0.9.20260921")
```

`NeapsTideDatabase` reads a memory-mapped `.tcdb` in place: scan station identity, look up a station by id, read its constituents, without decoding the rest of the file. [See the package README for the full API.](./packages/swift/README.md)

## Data Format

Tide harmonics come from the JSON files in [`data/`](./data), NOAA current data is imported during generation, and curated identity and routing inputs live in [`metadata/`](./metadata). The generated FlatBuffers file is the release source consumed by every runtime. Each tide station file includes basic station information, like location and name, and harmonics or subordinate station offsets. The format is defined by the schema in [schemas/station.schema.json](schemas/station.schema.json), which includes more detailed descriptions of each field. All data is validated against this schema automatically on each change.

## Station Types

Stations can either be _reference_ or _subordinate_, defined in the station's `type` field.

### Reference station

Reference stations have defined harmonic constituents. They should have an array of `harmonic_constituents`. These are usually stations that have a long selection of real water level observations.

### Subordinate station

Subordinate stations are locations that have very similar tides to a reference station. Usually these are geographically close to another reference station.

Subordinate stations have four kinds of offsets, two to correct for water level, and two for the time of high and low tide. They use an `offsets` object to define these items, along with the name of the reference station they are based on.

## Repository Layout

This repo is an npm workspace. Station data lives in [`data/`](./data), and everything that reads or writes it is a workspace package:

- [`packages/database`](./packages/database) — the published [`@neaps/tide-database`](https://www.npmjs.com/package/@neaps/tide-database) npm module
- [`packages/swift`](./packages/swift) — `NeapsTideDatabase`, the Swift reader for `.tcdb`, published from the [root `Package.swift`](./Package.swift)
- [`packages/tcd`](./packages/tcd) — TCD harmonics files for XTide-compatible software
- [`packages/datums`](./packages/datums) — tidal datum computation and sea-region classification
- [`packages/harmonic-analysis`](./packages/harmonic-analysis) — GESLA parsing and database policies around `@neaps/harmonics` QR fitting; broad minimum-norm SVD fits remain local
- [`packages/stations`](./packages/stations) — station file I/O, quality filtering, geocoding, the unified catalogue (curated inputs in [`metadata/`](./metadata)), and maintenance scripts (including `evaluate-quality`, which writes [`quality.json`](./quality.json))
- [`sources/*`](./sources) — one package per data source (NOAA, TICON), each with an `npm run import`

## Maintenance

A GitHub Action runs monthly on the 1st of each month to automatically update NOAA tide station data. The workflow:

- Fetches the latest station list and harmonic constituents from NOAA's API
- Updates existing station files with new data
- Adds any newly discovered reference stations
- Creates a pull request if changes are detected

You can also manually trigger the workflow from the Actions tab in GitHub.

To manually update NOAA stations:

```bash
$ npm run import -w sources/noaa
```

This will scan all existing NOAA station files, fetch any new stations from NOAA's API, and update harmonic constituents for all stations.

## Versioning

Releases of this database use [Semantic Versioning](https://semver.org/), with these added semantics:

- Major version changes indicate breaking changes to the data structure or APIs. However, as long as the version is "0.x", breaking changes may occur without a major version bump.
- Minor version changes indicate backward-compatible additions to the data structure or APIs, such as new fields.
- Patch version changes indicate updates to station data, and will always be the current date. For example, "0.1.20260101".

## Releasing

Releases are created by [running the Publish action](https://github.com/openwatersio/tide-database/actions/workflows/publish.yml) on GitHub Actions. This action will use the major and minor `version` defined in `packages/database/package.json`, and set the patch version to the current date.

## License

- All code in this repository is licensed under the [MIT License](./LICENSE).
- The `license` field of each station's JSON file specifies the license for that station, and the `source` field names where the station came from.
- Unless otherwise noted, all other data is licensed under the [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/) license.
- A few stations are CC BY-NC 4.0, carried from sources that do not permit commercial use. They are marked `"commercial_use": false` and can be filtered out.

### Attribution

Most stations here are CC BY, which obliges anyone redistributing them to credit the original source — not only this project. That applies to downstream software bundling this database too.

Every station carries the notice it needs as `attribution`, already assembled, so the rule for a consumer is one sentence: **display the station's `attribution`.** Nothing downstream needs its own table of sources, or its own reading of what a licence requires.

```typescript
import { stationsById } from "@neaps/tide-database";

console.log(stationsById.get("ticon/newlyn-new-gbr-bodc")?.attribution);
// Neaps tide database (https://github.com/openwatersio/tide-database). Source:
// Hart-Davis, M., Dettmering, D., Seitz, F. (2025), TICON-4: TIdal CONstants
// based on GESLA-4 sea-level records, SEANOE, https://doi.org/10.17882/109129.
// Licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Modified:
// see https://github.com/openwatersio/tide-database#modifications-to-source-data
```

The Swift package exposes the same string as `station.attribution`.

Under a CC licence that string carries all three things [CC BY 4.0 section 3(a)(1)](https://creativecommons.org/licenses/by/4.0/) asks a redistributor to pass on: who created the material, the licence and its URI, and an indication that it was modified. A station whose licence imposes no notice, such as a public-domain NOAA record, gets the project credit alone. The licence comes from the station rather than its source, because it varies within one source — the TICON stations relayed from CMEMS are CC BY-NC while the rest are CC BY — so `attribution` names the licence that actually applies to the station in hand. `license` still carries the same terms as structured fields if you need to filter on them.

The sources and what each one asks for:

- **Kartverket / Norwegian Mapping Authority, Hydrographic Service** — credit required under CC BY 4.0.
- **TICON-4** — Hart-Davis, Michael; Dettmering, Denise; Seitz, Florian (2025). _TICON-4: TIdal CONstants based on GESLA-4 sea-level records._ SEANOE. https://doi.org/10.17882/109129. Credit required.
- **NOAA CO-OPS** — a United States government work in the public domain. Attribution is not required, but is appreciated, so the project credit stands alone.
- **Canadian Hydrographic Service** — names the agency operating a current station whose record was authored in this repository under MIT (see [metadata/PROVENANCE.md](./metadata/PROVENANCE.md)). No data is redistributed from CHS, so no credit is owed to it.

The credit is written into the database file itself, so every reader gets it without keeping a table of sources. Adding a source means adding it to `packages/database/src/attribution.ts`, the one place the strings live; a source in the database with no entry there fails the build.

### Modifications to source data

Station records are not verbatim copies of their sources, and CC BY requires that this is stated. Station names are normalized, and country, region, continent and timezone are geocoded from the station position.

For TICON-4 stations:

- Harmonic constituents are carried through as published, except for the German `wsv` and Dutch `rws` gauges, whose GESLA-4 records are timestamped in local legal time but labeled UTC. Those are re-fit from the water levels so their phases are UTC-referenced like every other station, and a station that cannot be re-fit is dropped rather than published with wrong phases. See [#96](https://github.com/openwatersio/tide-database/issues/96) and [#98](https://github.com/openwatersio/tide-database/issues/98).
- Datums are computed here from GESLA-4 water levels, since TICON does not publish them. See [sources/ticon/README.md](./sources/ticon/README.md) for the method and its uncertainties.

For Kartverket stations, published harmonic phases are converted from UTC+1 to UTC and centimetres are converted to metres. The original responses and comparison results are pinned under [sources/kartverket](./sources/kartverket/README.md).
