# Neaps Tide Database

> A public database of tide harmonics

This database includes harmonic constituents for tide prediction from various sources around the world. These constants can be used with a tide harmonic calculator like [Neaps](https://github.com/openwatersio/neaps) to create astronomical tide predictions.

## Sources

- ✅ [**NOAA**](data/noaa/README.md): National Oceanic and Atmospheric Administration
  ~3400 stations, mostly in the United States and its territories. Updated monthly via [NOAA's API](https://api.tidesandcurrents.noaa.gov/mdapi/prod/).

- ✅ [**TICON-4**](data/ticon/README.md): TIdal CONstants based on GESLA-4 sea-level records
  ~4200+ global stations - ([#16](https://github.com/openwatersio/tide-database/pull/16))

If you know of other public sources of harmonic constituents, please [open an issue](https://github.com/openwatersio/tide-database/issues/new) to discuss adding them.

## Usage

The database is available as an NPM package, as an [XTide-compatible TCD file](./packages/tcd/), and as a single [FlatBuffers file](./docs/database-format.md).

### XTide / OpenCPN / TCD-compatible software

A pre-built [TCD file](./packages/tcd/README.md) compatible with XTide, OpenCPN, and any software that reads the libtcd format. [See the TCD package for usage instructions.](./packages/tcd/README.md)

### FlatBuffers file

Each release attaches `neaps-<date>.neaps`, the whole database as one [FlatBuffers](https://flatbuffers.dev) file built from [`schemas/tide-database.fbs`](./schemas/tide-database.fbs). It is the same file the NPM package reads; native apps can bundle and memory-map it, generating a reader in their language from the schema. [See the format documentation.](./docs/database-format.md)

### JavaScript / TypeScript

Install the package:

```sh
$ npm install @neaps/tide-database
```

The package exports an array of all tide stations in the database:

```typescript
import { stations } from "@neaps/tide-database";

// Stations is an array of all the files in `data/`
console.log("Total stations:", stations.length);
console.log(stations[0]);
```

#### Searching for stations

##### Geographic search

You can search for stations by proximity using the `near` and `nearest` functions:

```typescript
import { near, nearest } from "@neaps/tide-database";

// Find all stations within 10 km of a lat/lon. Returns an array of [station, distanceinKm] tuples.
const nearbyStations = near({
  lon: -122,
  lat: 37,
  maxDistance: 10,
  maxResults: 50,
});
console.log("Nearby stations:", nearbyStations.length);

// Find the nearest station to a lat/lon
const [nearestStation, distance] = nearest({ longitude: -75.5, latitude: 22 });
console.log("Nearest station:", nearestStation.name, "is", distance, "km away");
```

Both functions take the following parameters:

- `latitude` or `lat`: Latitude in decimal degrees.
- `longitude`, `lon`, or `lng`: Longitude in decimal degrees.
- `filter`: A function that takes a station and returns `true` to include it in results, or `false` to exclude it.
- `maxDistance`: Maximum distance in kilometers to search for stations (default: `50` km).

`near` also takes:

- `maxResults`: Maximum number of results to return (default: `10`).

##### Bounding box search

You can find all stations within a geographic bounding box using the `bbox` function:

```typescript
import { bbox } from "@neaps/tide-database";

// Find stations in the Boston area
const stations = bbox(-71.5, 42, -70.5, 42.8);
console.log("Stations in bounds:", stations.length);

// With a filter
const referenceOnly = bbox(
  -72,
  41,
  -70,
  43,
  (station) => station.type === "reference",
);
```

Parameters:

- `minLon`: Minimum longitude (west edge of the bounding box).
- `minLat`: Minimum latitude (south edge of the bounding box).
- `maxLon`: Maximum longitude (east edge of the bounding box).
- `maxLat`: Maximum latitude (north edge of the bounding box).
- `filter`: Optional function that takes a station and returns `true` to include it in results, or `false` to exclude it.

##### Full-text search

You can search for stations by name, region, country, or continent using the `search` function. It supports fuzzy matching and prefix search:

```typescript
import { search } from "@neaps/tide-database";

// Search for stations by name with fuzzy matching
const results = search("Boston");
console.log("Found:", results.length, "stations");
console.log(results[0].name);

// Search with a filter function
const usStations = search("harbor", {
  filter: (station) => station.country === "United States",
  maxResults: 10,
});
console.log("US harbor stations:", usStations);

// Combine multiple filters
const referenceStations = search("island", {
  filter: (station) =>
    station.type === "reference" && station.continent === "Americas",
  maxResults: 20,
});
console.log("Reference stations:", referenceStations);
```

The `search` function takes the following parameters:

- `query` (required): Search string. Supports fuzzy matching and prefix search.
- `options` (optional):
  - `filter`: Function that takes a station and returns `true` to include it in results, or `false` to exclude it.
  - `maxResults`: Maximum number of results to return (default: `20`).

## Data Format

Each tide station is defined in a single JSON file in the [`data/`](./data) directory that includes basic station information, like location and name, and harmonics or subordinate station offsets. The format is defined by the schema in [../schemas/station.schema.json](schemas/station.schema.json), which includes more detailed descriptions of each field. All data is validated against this schema automatically on each change.

## Station Types

Stations can either be _reference_ or _subordinate_, defined in the station's `type` field.

### Reference station

Reference stations have defined harmonic constituents. They should have an array of `harmonic_constituents`. These are usually stations that have a long selection of real water level observations.

### Subordinate station

Subordinate stations are locations that have very similar tides to a reference station. Usually these are geographically close to another reference station.

Subordinate stations have four kinds of offsets, two to correct for water level, and two for the time of high and low tide. They use an `offsets` object to define these items, along with the name of the reference station they are based on.

## Maintenance

A GitHub Action runs monthly on the 1st of each month to automatically update NOAA tide station data. The workflow:

- Fetches the latest station list and harmonic constituents from NOAA's API
- Updates existing station files with new data
- Adds any newly discovered reference stations
- Creates a pull request if changes are detected

You can also manually trigger the workflow from the Actions tab in GitHub.

To manually update NOAA stations:

```bash
$ tools/update-noaa-stations.ts
```

This will scan all existing NOAA station files, fetch any new stations from NOAA's API, and update harmonic constituents for all stations.

## Versioning

Releases of this database use [Semantic Versioning](https://semver.org/), with these added semantics:

- Major version changes indicate breaking changes to the data structure or APIs. However, as long as the version is "0.x", breaking changes may occur without a major version bump.
- Minor version changes indicate backward-compatible additions to the data structure or APIs, such as new fields.
- Patch version changes indicate updates to station data, and will always be the current date. For example, "0.1.20260101".

## Releasing

Releases are created by [running the Publish action](https://github.com/openwatersio/tide-database/actions/workflows/publish.yml) on GitHub Actions. This action will use the major and minor `version` defined in `package.json`, and set the patch version to the current date.

## License

- All code in this repository is licensed under the [MIT License](./LICENSE).
- The `license` field of each station's JSON file specifies the license for that station.
- Unless otherwise noted, All other data is licensed under the [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/) license.

If using this project, please attribute it as:

> Tide harmonic constituents from the Neaps tide database (https://github.com/openwatersio/tide-database)
