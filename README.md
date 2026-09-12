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
- [`packages/tcd`](./packages/tcd) — TCD harmonics files for XTide-compatible software
- [`packages/datums`](./packages/datums) — tidal datum computation and sea-region classification
- [`packages/harmonic-analysis`](./packages/harmonic-analysis) — least-squares harmonic analysis of water level observations
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
- The `license` field of each station's JSON file specifies the license for that station.
- Unless otherwise noted, All other data is licensed under the [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/) license.

If using this project, please attribute it as:

> Tide harmonic constituents from the Neaps tide database (https://github.com/openwatersio/tide-database)
