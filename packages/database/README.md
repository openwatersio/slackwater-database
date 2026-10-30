# @slackwater/database

> A public database of tide harmonics

Harmonic constituents, tidal datums, and station metadata for thousands of tide stations around the world. Feed the constituents to a tide harmonic calculator like [Slackwater](https://github.com/openwatersio/slackwater) to produce astronomical tide predictions.

Station data is curated in the [slackwater-database repository](https://github.com/openwatersio/slackwater-database), which documents [where each station comes from](https://github.com/openwatersio/slackwater-database#sources) and how it is quality-checked.

[Browse the tide database](https://openwaters.io/tides/database/) for station coverage, data sources, and download options.

## Install

```sh
$ npm install @slackwater/database
```

## Usage

Load a database explicitly, then request individual stations or a collection:

```typescript
import { loadStations } from "@slackwater/database";

const db = await loadStations();

console.log("Total accepted stations:", db.accepted.length);
console.log(db.byId("noaa/9447130"));
```

Importing the package performs no database I/O or station decoding. `loadStations()` obtains the bundled bytes and creates a reader. Every call for the bundled database returns the same instance, so callers can load it wherever they need it.

`db.byId(id)` binary-searches the database and caches the matching station's identity. `db.all` materializes every identity, including rejected records; `db.accepted` leaves out records rejected by quality evaluation. These collections reuse identities already decoded and are cached on first access. Every search function below takes `includeAll: true` to search the full catalog instead of the accepted subset.

Prediction fields — `harmonic_constituents`, `datums`, `datums_source`, `datum_frame`, `datum_coverage`, `epoch`, and `datum_epoch` — remain getters that decode from the buffer on each access, without persistent caching. [See the format documentation](https://github.com/openwatersio/slackwater-database/blob/main/docs/database-format.md).

The loader also accepts a source:

```typescript
const local = await loadStations("./stations.tcdb"); // Node filesystem path
const file = await loadStations(new URL("file:///data/stations.tcdb")); // Node
const remote = await loadStations("https://example.com/stations.tcdb");
const supplied = await loadStations(bytes); // Uint8Array, including Node Buffer
```

Browsers accept relative or absolute fetchable URLs; Workers accept fetchable URLs and bundled bytes. Node accepts filesystem paths, file URLs, and HTTP(S) URLs. URLs download the whole file before returning a reader; individual station reads then use the in-memory buffer. In Workers, call a remote loader in a request handler or another context where fetch is allowed. Each supplied source gets its own instance and caches, so reuse the one it returns.

The geographic and text indexes initialize on first use. Bundled data uses prebuilt indexes; supplied sources build matching indexes from the loaded buffer's coordinates or searchable metadata. Neither path reads prediction data to build an index.

`db.qualityMap` lazily builds the full map of stored quality evaluations, and `db.datums` lists the datum names available in the file. `qualityFilter(station)` checks acceptance and is a direct export.

### Migrating from module-level exports

| Previous API               | Instance API                        |
| -------------------------- | ----------------------------------- |
| `stationsById.get(id)`     | `db.byId(id)`                       |
| `allStations`              | `db.all`                            |
| `stations`                 | `db.accepted`                       |
| `qualityMap`, `datums`     | `db.qualityMap`, `db.datums`        |
| Route and search functions | Methods with the same names on `db` |

Pure helpers such as `qualityFilter`, `routePath`, `positionToPoint`, attribution helpers, `credits`, and `buildDatabase` remain direct exports.

Each station has separate `locality`, `region`, and `country` display fields. `country_code` is an ISO 3166-1 alpha-2 code; `region_code`, when available, is an ISO 3166-2 subdivision code. Consumers can therefore omit country or region text when the surrounding page already supplies it.

### Stable station routes

```typescript
import { loadStations } from "@slackwater/database";

const db = await loadStations();

const route = db.stationRouteBySlug("tide", "victoria");
const station = route && db.byId(route.stationIds[0]!);
console.log(station?.locality, station?.region, station?.country_code);
```

Each route carries its canonical web `path` (`/tides/ca/bc/victoria/`: kind, lowercase ISO country code, subdivision code when the station has one, slug) and the `formerPaths` that should redirect to it.

`db.stationRouteBySlug(kind, slug)` performs a binary lookup without decoding the full route index. `db.stationRoutes(kind)` decodes that kind's complete route list on demand. Prediction fields such as constituents and datums remain lazy.

### Searching for stations

#### Geographic search

`near` returns an array of `[station, distanceInKm]` tuples, closest first:

```typescript
import { loadStations } from "@slackwater/database";

const db = await loadStations();

// Find stations within 10 km of a lat/lon
const nearbyStations = db.near({
  lon: -122,
  lat: 37,
  maxDistance: 10,
  maxResults: 50,
});
console.log("Nearby stations:", nearbyStations.length);
```

`nearest` returns a single `[station, distanceInKm]` tuple, or `null` when nothing matches:

```typescript
const result = db.nearest({ longitude: -75.5, latitude: 22 });
if (result) {
  const [station, distance] = result;
  console.log("Nearest station:", station.name, "is", distance, "km away");
}
```

Both functions take the following parameters:

- `latitude` or `lat`: Latitude in decimal degrees.
- `longitude`, `lon`, or `lng`: Longitude in decimal degrees.
- `maxDistance`: Maximum distance in kilometers to search for stations (default: unlimited).
- `filter`: A function that takes a station and returns `true` to include it in results, or `false` to exclude it.
- `includeAll`: Search the full catalog rather than quality-accepted stations only (default: `false`).

`near` also takes:

- `maxResults`: Maximum number of results to return (default: `10`).

#### Bounding box search

`bbox` takes a `[minLon, minLat, maxLon, maxLat]` tuple and returns the stations inside it:

```typescript
import { loadStations } from "@slackwater/database";

const db = await loadStations();

// Find stations in the Boston area
const bostonStations = db.bbox([-71.5, 42, -70.5, 42.8]);
console.log("Stations in bounds:", bostonStations.length);

// With a filter
const referenceOnly = db.bbox([-72, 41, -70, 43], {
  filter: (station) => station.type === "reference",
});
```

The bounds are `minLon` (west edge), `minLat` (south edge), `maxLon` (east edge), and `maxLat` (north edge), in decimal degrees. The optional second argument takes:

- `filter`: A function that takes a station and returns `true` to include it in results, or `false` to exclude it.
- `includeAll`: Search the full catalog rather than quality-accepted stations only (default: `false`).

#### Full-text search

You can search for stations by name, region, country, or continent using the `search` function. It supports fuzzy matching and prefix search:

```typescript
import { loadStations } from "@slackwater/database";

const db = await loadStations();

// Search for stations by name with fuzzy matching
const results = db.search("Boston");
console.log("Found:", results.length, "stations");
console.log(results[0].name);

// Search with a filter function
const usStations = db.search("harbor", {
  filter: (station) => station.country === "United States",
  maxResults: 10,
});
console.log("US harbor stations:", usStations);

// Combine multiple filters
const referenceStations = db.search("island", {
  filter: (station) =>
    station.type === "reference" && station.continent === "Americas",
  maxResults: 20,
});
console.log("Reference stations:", referenceStations);
```

Search is case-insensitive and folds Latin accents in both indexed fields and queries, including composed and decomposed Unicode spellings, so `Busu` finds `Büsum`. It also transliterates `æ` → `ae`, `ø` → `o`, `ß` → `ss`, `ł` → `l`, `đ` → `d`, `þ` → `th`, and `œ` → `oe`, so `Traena` finds `Træna`. Equivalent spellings produce the same matches and ranking; returned station names keep their original spelling. Marks in non-Latin scripts are preserved, and tokenization, prefix search, and fuzzy matching still apply.

The `search` function takes the following parameters:

- `query` (required): Search string. Supports fuzzy matching and prefix search.
- `options` (optional):
  - `filter`: Function that takes a station and returns `true` to include it in results, or `false` to exclude it.
  - `includeAll`: Search the full catalog rather than quality-accepted stations only (default: `false`).
  - `maxResults`: Maximum number of results to return (default: `20`).

## Station types

Stations are either _reference_ or _subordinate_, given by the station's `type` field.

Reference stations have their own `harmonic_constituents`, usually derived from a long record of real water level observations. Subordinate stations predict from a nearby reference station's harmonics, adjusted by four `offsets` — two correcting water level and two correcting the time of high and low tide. Reading a subordinate's `harmonic_constituents` or `datums` returns its reference station's values, so both types predict the same way.

`astronomical_bounds` is how low and high a prediction for the station can go — `{ lat, hat }` in metres above its chart datum — with the height offsets applied for a subordinate. It sits outside `datums` because the reduced pair is the floor and ceiling of a prediction rather than a hydrographic datum; [see the datum documentation](https://github.com/openwatersio/slackwater-database/blob/main/docs/datums.md).

The full field-by-field description lives in [`schemas/station.schema.json`](https://github.com/openwatersio/slackwater-database/blob/main/schemas/station.schema.json).

## The database file

The module reads a single [FlatBuffers](https://flatbuffers.dev) file built from [`schemas/database.fbs`](https://github.com/openwatersio/slackwater-database/blob/main/schemas/database.fbs). Every release of this package also attaches that file as `slackwater-<date>.tcdb`, so native apps can bundle and memory-map it and generate a reader in their own language from the schema. [See the format documentation.](https://github.com/openwatersio/slackwater-database/blob/main/docs/database-format.md)

## License

- All code in this package is licensed under the [MIT License](./LICENSE).
- The `license` field of each station specifies the license for that station's data, as a `type`, a `url`, and a `commercial_use` flag you can filter on.
- Unless otherwise noted, all other data is licensed under the [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/) license. Some stations are CC BY-NC 4.0 and are marked `commercial_use: false`.

## Attribution

Most stations are CC BY, so displaying or redistributing them carries an obligation to the original source, not only to this project. Every station carries the notice that satisfies it as `attribution`, already assembled.

**Display the station's `attribution`.** That is the whole of the rule. Nothing here needs its own table of sources, or its own reading of what a licence requires.

```typescript
import { loadStations } from "@slackwater/database";

const db = await loadStations();

console.log(db.byId("ticon/newlyn-new-gbr-bodc")?.attribution);
// Slackwater database (https://github.com/openwatersio/slackwater-database). Source:
// Hart-Davis, M., Dettmering, D., Seitz, F. (2025), TICON-4: TIdal CONstants
// based on GESLA-4 sea-level records, SEANOE, https://doi.org/10.17882/109129.
// Licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Modified:
// see https://github.com/openwatersio/slackwater-database#modifications-to-source-data
```

What the string contains, and why that is sufficient:

- **The creator credit.** For TICON-4 stations, the citation its authors ask for; for Kartverket, LINZ, JHOD and DMI, the publishing agency. JHOD also carries the source editing notice. A source that requires no credit, such as public-domain NOAA data, contributes nothing here.
- **The licence and its URI**, taken from the station rather than its source. Licence varies within a single source — the TICON stations relayed from CMEMS are CC BY-NC while the rest are CC BY — so the notice names the one that actually applies to the station in hand.
- **An indication that the material was modified**, pointing at [what this project changes](https://github.com/openwatersio/slackwater-database#modifications-to-source-data): derived datums, normalized names, geocoded location fields, re-fit phases for two GESLA sources and three Hong Kong gauges whose clock is one hour early, UHSLC's positions for four TICON gauges that TICON places 17 to 49 km away, and harmonics fitted from DMI predictions.

JHOD stations name the Government Standard Terms of Use 2.0 and link the publisher's terms.

Those are the three things [CC BY 4.0 section 3(a)(1)](https://creativecommons.org/licenses/by/4.0/) requires a redistributor to pass on. A station whose licence imposes no notice gets the project credit alone:

> Slackwater database (https://github.com/openwatersio/slackwater-database)

`attribution` is a display string. It is not a substitute for `license` when you need to make a decision in code — filter on `license.commercial_use` or `license.type` for that.

To rebuild a filtered database, pass the exported `credits` map to `buildDatabase`. It maps each published `source.name` to its credit line, or `null` when it requires none, using the same source metadata as the bundled database.

```js
import { buildDatabase, credits, loadStations } from "@slackwater/database";

const db = await loadStations();
const bytes = buildDatabase(
  db.accepted.filter((station) => station.country_code === "CA"),
  { credits },
);
```
