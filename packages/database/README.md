# @neaps/tide-database

> A public database of tide harmonics

Harmonic constituents, tidal datums, and station metadata for thousands of tide stations around the world. Feed the constituents to a tide harmonic calculator like [Neaps](https://github.com/openwatersio/neaps) to produce astronomical tide predictions.

Station data is curated in the [tide-database repository](https://github.com/openwatersio/tide-database), which documents [where each station comes from](https://github.com/openwatersio/tide-database#sources) and how it is quality-checked.

## Install

```sh
$ npm install @neaps/tide-database
```

## Usage

The package exports an array of all tide stations in the database:

```typescript
import { stations } from "@neaps/tide-database";

console.log("Total stations:", stations.length);
console.log(stations[0]);
```

Each station carries its identity and location eagerly. The heavy prediction fields — `harmonic_constituents`, `datums`, and `epoch` — are decoded from the database file on first access, so importing the module does not pull every station's prediction data onto the heap. [See the format documentation](./docs/database-format.md) for how that works.

### Searching for stations

#### Geographic search

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

#### Bounding box search

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

#### Full-text search

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

## Station types

Stations are either _reference_ or _subordinate_, given by the station's `type` field.

Reference stations have their own `harmonic_constituents`, usually derived from a long record of real water level observations. Subordinate stations predict from a nearby reference station's harmonics, adjusted by four `offsets` — two correcting water level and two correcting the time of high and low tide. Reading a subordinate's `harmonic_constituents` or `datums` returns its reference station's values, so both types predict the same way.

The full field-by-field description lives in [`schemas/station.schema.json`](./schemas/station.schema.json).

## The database file

The module reads a single [FlatBuffers](https://flatbuffers.dev) file built from [`schemas/database.fbs`](./schemas/database.fbs). Every release of this package also attaches that file as `neaps-<date>.tcdb`, so native apps can bundle and memory-map it and generate a reader in their own language from the schema. [See the format documentation.](./docs/database-format.md)

## License

- All code in this package is licensed under the [MIT License](./LICENSE).
- The `license` field of each station specifies the license for that station's data.
- Unless otherwise noted, all other data is licensed under the [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/) license.

If using this project, please attribute it as:

> Tide harmonic constituents from the Neaps tide database (https://github.com/openwatersio/tide-database)
