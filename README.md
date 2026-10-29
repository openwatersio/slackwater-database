# Slackwater Tide and Current Station Database

> A public database of tide and current stations

This database includes station identity, structured location, stable web routes, and harmonic data from sources around the world. Tide constants can be used with a harmonic calculator like [Slackwater](https://github.com/openwatersio/slackwater) to create astronomical predictions.

[Browse the tide database](https://openwaters.io/tides/database/) for station coverage, data sources, and download options.

## Sources

Tide stations:

- [**NOAA**](sources/noaa/README.md): US National Oceanic and Atmospheric Administration. Stations in the United States and its territories, updated monthly from [NOAA's API](https://api.tidesandcurrents.noaa.gov/mdapi/prod/).
- [**TICON-4**](sources/ticon/README.md): tidal constants from the GESLA-4 sea-level records, worldwide.
- [**LINZ**](sources/linz/README.md): Toitū Te Whenua Land Information New Zealand. New Zealand ports from LINZ's yearly tide-constituent release.
- [**Kartverket**](sources/kartverket/README.md): the Norwegian Mapping Authority. Its public harmonic stations in Norway and Svalbard.
- [**JHOD**](sources/jhod/README.md): Japan Coast Guard, Hydrographic and Oceanographic Department. Published harmonic constants for 20 Japanese gauges.
- [**DMI**](sources/dmi/README.md): the Danish Meteorological Institute. Harmonics fitted from its astronomical predictions for Denmark, Greenland and the Faroe Islands.
- [**CHS**](sources/chs/README.md): the Canadian Hydrographic Service. Identity and position for Canadian tide stations, with no constituents; consumers fetch predictions from CHS at runtime.

Tidal currents:

- [**NOAA currents**](sources/noaa-current/README.md): harmonic and subordinate current stations in US waters.

[Rijkswaterstaat](sources/rws/README.md) data is used only to validate the re-fitted phases of Dutch TICON gauges; no stations come from it.

If you know of other public sources of harmonic constituents, please [open an issue](https://github.com/openwatersio/slackwater-database/issues/new) to discuss adding them.

## Usage

The database is available as an NPM package, as a tide-only [XTide-compatible TCD file](./packages/tcd/), and as a unified [FlatBuffers file](./docs/database-format.md) of tide and current stations.

### XTide / OpenCPN / TCD-compatible software

A pre-built [TCD file](./packages/tcd/README.md) compatible with XTide, OpenCPN, and any software that reads the libtcd format. [See the TCD package for usage instructions.](./packages/tcd/README.md)

### FlatBuffers file

Each release attaches `slackwater-<date>.tcdb`, the whole database as one [FlatBuffers](https://flatbuffers.dev) file built from [`schemas/database.fbs`](./schemas/database.fbs). It is the same file the NPM package reads; native apps can bundle and memory-map it, generating a reader in their language from the schema. [See the format documentation.](./docs/database-format.md)

### JavaScript / TypeScript

```sh
$ npm install @slackwater/database
```

The module exports every tide and current station in the database, along with stable web routes and geographic, bounding box, and full-text search. [See the package README for the full API.](./packages/database/README.md)

### Swift

```swift
.package(url: "https://github.com/openwatersio/slackwater-database.git", exact: "1.0.0-beta.20260929")
```

`SlackwaterDatabase` reads a memory-mapped `.tcdb` in place: scan station identity, look up a station by id, read its constituents, without decoding the rest of the file. [See the package README for the full API.](./packages/swift/README.md)

## Data Format

Tide harmonics come from the JSON files in [`data/`](./data), NOAA current data is imported during generation, each published station's identity, URL and curation is a file in [`stations/`](./stations/README.md), and reviewed reference snapshots live in [`metadata/`](./metadata). The generated FlatBuffers file is the release source consumed by every runtime. Each tide station file includes basic station information, like location and name, and harmonics or subordinate station offsets. The format is defined by the schema in [schemas/station.schema.json](schemas/station.schema.json), which includes more detailed descriptions of each field. All data is validated against this schema automatically on each change.

## Station Types

Stations can either be _reference_ or _subordinate_, defined in the station's `type` field.

### Reference station

Reference stations have defined harmonic constituents. They should have an array of `harmonic_constituents`. These are usually stations that have a long selection of real water level observations.

### Subordinate station

Subordinate stations are locations that have very similar tides to a reference station. Usually these are geographically close to another reference station.

Subordinate stations have four kinds of offsets, two to correct for water level, and two for the time of high and low tide. They use an `offsets` object to define these items, along with the name of the reference station they are based on.

## Repository Layout

This repo is an npm workspace. Station data lives in [`data/`](./data), and everything that reads or writes it is a workspace package:

- [`packages/database`](./packages/database) — the published [`@slackwater/database`](https://www.npmjs.com/package/@slackwater/database) npm module
- [`packages/swift`](./packages/swift) — `SlackwaterDatabase`, the Swift reader for `.tcdb`, published from the [root `Package.swift`](./Package.swift)
- [`packages/tcd`](./packages/tcd) — TCD harmonics files for XTide-compatible software
- [`packages/datums`](./packages/datums) — tidal datum computation and sea-region classification
- [`packages/harmonic-analysis`](./packages/harmonic-analysis) — GESLA parsing and database policies around `@slackwater/engine` QR fitting; broad minimum-norm SVD fits remain local
- [`packages/stations`](./packages/stations) — station file I/O, quality filtering, geocoding, the unified catalogue, and maintenance scripts (including `npm run stations`, which writes the [station files](./stations/README.md))
- [`sources/*`](./sources) — one package per data source, most with an `npm run import`

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

Releases are created by [running the Publish action](https://github.com/openwatersio/slackwater-database/actions/workflows/publish.yml) on GitHub Actions. The action takes the `version` in `packages/database/package.json` as a floor and replaces its last segment with the current date, so the version always names the data vintage: `1.0.0-beta.0` publishes as `1.0.0-beta.<date>` under the `beta` dist-tag (and a prerelease GitHub release), and `1.0.0` publishes as `1.0.<date>` to `latest`. Release assets are named `slackwater-<date>.*` to match.

## License

- All code in this repository is licensed under the [MIT License](./LICENSE).
- The `license` field of each station's JSON file specifies the license for that station, and the `source` field names where the station came from.
- Unless otherwise noted, all other data is licensed under the [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/) license.
- A few stations are CC BY-NC 4.0, carried from sources that do not permit commercial use. They are marked `"commercial_use": false` and can be filtered out.

### Attribution

Most stations here are CC BY, which obliges anyone redistributing them to credit the original source — not only this project. That applies to downstream software bundling this database too.

Every station carries the notice it needs as `attribution`, already assembled, so the rule for a consumer is one sentence: **display the station's `attribution`.** Nothing downstream needs its own table of sources, or its own reading of what a licence requires.

```typescript
import { stationsById } from "@slackwater/database";

console.log(stationsById.get("ticon/newlyn-new-gbr-bodc")?.attribution);
// Slackwater database (https://github.com/openwatersio/slackwater-database). Source:
// Hart-Davis, M., Dettmering, D., Seitz, F. (2025), TICON-4: TIdal CONstants
// based on GESLA-4 sea-level records, SEANOE, https://doi.org/10.17882/109129.
// Licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Modified:
// see https://github.com/openwatersio/slackwater-database#modifications-to-source-data
```

The Swift package exposes the same string as `station.attribution`.

Under a CC licence that string carries all three things [CC BY 4.0 section 3(a)(1)](https://creativecommons.org/licenses/by/4.0/) asks a redistributor to pass on: who created the material, the licence and its URI, and an indication that it was modified. A station whose licence imposes no notice, such as a public-domain NOAA record, gets the project credit alone. The licence comes from the station rather than its source, because it varies within one source — the TICON stations relayed from CMEMS are CC BY-NC while the rest are CC BY — so `attribution` names the licence that actually applies to the station in hand. `license` still carries the same terms as structured fields if you need to filter on them.

The sources and what each one asks for:

- **Danish Meteorological Institute** — Danish Meteorological Institute (DMI), https://www.dmi.dk. Credit, a license link and disclosure of changes are required under [DMI's CC BY 4.0 API terms](https://www.dmi.dk/friedata/dokumentation/terms-of-use).
- **Kartverket / Norwegian Mapping Authority, Hydrographic Service** — © Kartverket / Norwegian Mapping Authority, Hydrographic Service, https://www.kartverket.no. Credit required under CC BY 4.0, and [Kartverket's terms](https://www.kartverket.no/en/api-and-data/terms-of-use) ask for it as "©Kartverket" with a link to kartverket.no.
- **Toitū Te Whenua Land Information New Zealand** — "This work is based on Toitū Te Whenua Land Information New Zealand data which are licensed by Toitū Te Whenua Land Information New Zealand for re-use under the Creative Commons Attribution 4.0 International licence." Credit required under CC BY 4.0, and [LINZ's copyright terms](https://www.linz.govt.nz/copyright) ask for that statement on adapted data, in writing, never by its logo or crest.
- **TICON-4** — Hart-Davis, Michael; Dettmering, Denise; Seitz, Florian (2025). _TICON-4: TIdal CONstants based on GESLA-4 sea-level records._ SEANOE. https://doi.org/10.17882/109129. Credit required.
- **Japan Coast Guard, Hydrographic and Oceanographic Department** — source credit and an editing notice are required by [JHOD's Government Standard Terms of Use 2.0](https://www1.kaiho.mlit.go.jp/copyright.html). The station notice identifies JHOD and states that Open Waters converted constituent names, units and phases and derived tidal datums.
- **NOAA CO-OPS** — a United States government work in the public domain. Attribution is not required, but is appreciated, so the project credit stands alone.
- **Canadian Hydrographic Service** — names the agency operating a current station whose record was authored in this repository under MIT (see [stations/README.md](./stations/README.md#provenance)). No data is redistributed from CHS, so no credit is owed to it.

The credit is written into the database file itself, so every reader gets it without keeping a table of sources. Each source declares its credit in its own `sources/<name>/metadata.yaml`, the one place the string lives; a station whose source has no `metadata.yaml` fails the build.

### Modifications to source data

Station records are not verbatim copies of their sources, and CC BY requires that this is stated. Station names are normalized, and country, region, continent and timezone are geocoded from the station position. An opaque TICON station code takes its display name from the nearest GeoNames place within 50 km; a curated name takes priority.

For TICON-4 stations:

- Harmonic constituents are carried through as published, except for the German `wsv` and Dutch `rws` gauges, whose GESLA-4 records are timestamped in local legal time but labeled UTC, and the three Hong Kong gauges `329`, `329a` and `329b`, whose UHSLC times are one hour early. Those are re-fit from the water levels, with each Hong Kong gauge's times moved one hour later, so their phases are UTC-referenced like every other station, and a station that cannot be re-fit is dropped rather than published with wrong phases. See [#96](https://github.com/openwatersio/slackwater-database/issues/96), [#98](https://github.com/openwatersio/slackwater-database/issues/98) and [#360](https://github.com/openwatersio/slackwater-database/issues/360).
- Datums use supported GESLA-4 observation windows or a labeled harmonic fallback, since TICON does not publish them. See [sources/ticon/README.md](./sources/ticon/README.md) for the method and its uncertainties.
- Four UHSLC research-quality records, Ammassalik (297A), Langkawi (142A), Macaé (719A) and Alotau (069A), take UHSLC's position for the gauge instead of TICON's, which sits 17 to 49 km away. See [sources/ticon/README.md](./sources/ticon/README.md#positions) and [#371](https://github.com/openwatersio/slackwater-database/issues/371).

For Kartverket stations, published harmonic phases are converted from UTC+1 to UTC and centimetres are converted to metres. The original responses and comparison results are pinned under [sources/kartverket](./sources/kartverket/README.md).

For LINZ stations, published harmonic phases are converted from NZST (UTC+12) to UTC, centimetres are converted to metres, five constituent names are mapped to the catalogue's spelling (such as `LDA2` to `lambda2`), and Nelson's misprinted latitude is corrected. Datums other than MSL are derived from the constituents, since LINZ publishes only the mean level. See [sources/linz](./sources/linz/README.md) for the method.

For JHOD stations, local-meridian phases are converted to Greenwich, centimetres are converted to metres, Greek constituent names are spelled out and JHOD's `M1` is mapped by frequency to `M1C`. Published MSL and depth datum are retained; other tidal datums are derived from the constituents. See [sources/jhod](./sources/jhod/README.md) for the pinned responses, gauge matches and prediction comparison.

For DMI stations, harmonics are fitted here from astronomical predictions, with Greenwich phases and heights converted from centimetres to metres. API LAT and MLWS are preserved; remaining datums are synthesized from the fitted harmonics, with HAT omitted without an annual constituent. Every accepted fit passes held-out height and sampling-stability gates. See [sources/dmi](./sources/dmi/README.md) for the source contract, provenance and validation method.
