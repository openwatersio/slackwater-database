# TideBase Specification

**Version 1.0 (Draft)**

## Abstract

TideBase is an open specification for storing tidal harmonic data in [SQLite](https://www.sqlite.org/) databases. A single TideBase file contains everything needed for tide prediction: station metadata, harmonic constituents, tidal datums, subordinate station offsets, and precomputed astronomical parameters. TideBase is designed as a modern, portable, and queryable successor to the [Tidal Constituent Database (TCD)](https://flaterco.com/xtide/files.html) format.

TideBase files use the extension **`.tidebase`**.

## Definitions

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in [RFC 2119](https://www.ietf.org/rfc/rfc2119.txt).

## Database

A TideBase file MUST be a valid SQLite database of [version 3](https://www.sqlite.org/formatchng.html) or higher. Only core SQLite features are used. A TideBase file SHALL NOT require any SQLite extensions.

### Charset

All text values in a TideBase database MUST be encoded as UTF-8.

### Units

All height and amplitude values MUST be in **meters**. All speed values MUST be in **degrees per solar hour**. All phase and equilibrium argument values MUST be in **degrees** (0-360) relative to UTC. All time offsets MUST be in **minutes**.

## Database Specification

### `metadata`

#### Schema

```sql
CREATE TABLE metadata (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;
```

#### Content

The `metadata` table MUST contain the following rows:

| Key                 | Value                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------- |
| `generator`         | The name and/or URL of the software that generated the file.                          |
| `generated_at`      | ISO 8601 timestamp of when the file was generated.                                    |
| `station_count`     | Total number of stations in the `stations` table, as a string.                        |
| `constituent_count` | Total number of constituents in the `constituents` table, as a string.                |
| `start_year`        | First year covered by `equilibrium_arguments` and `node_factors` tables, as a string. |
| `end_year`          | Last year covered by `equilibrium_arguments` and `node_factors` tables, as a string.  |

Producers MAY include additional metadata keys. Consumers SHOULD ignore keys they do not recognize.

### `constituents`

The `constituents` table defines tidal harmonic constituents (M2, S2, K1, O1, etc.) used by stations in the database.

#### Schema

```sql
CREATE TABLE constituents (
  name        TEXT PRIMARY KEY,
  description TEXT,
  speed       REAL NOT NULL
) WITHOUT ROWID;
```

#### Content

Each row defines a single tidal constituent.

- `name` -- The canonical short name of the constituent (e.g. `M2`, `S2`, `K1`). Primary key, referenced by `station_constituents`, `equilibrium_arguments`, and `node_factors`.
- `description` -- OPTIONAL human-readable description of the constituent.
- `speed` -- Angular speed in degrees per solar hour.

The table MUST contain at least the principal tidal constituents (M2, S2, N2, K2, K1, O1, P1, Q1). It SHOULD contain all constituents referenced by any station in the database.

### `sources`

The `sources` table identifies the organizations or services that provided station data.

#### Schema

```sql
CREATE TABLE sources (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  url  TEXT NOT NULL,
  UNIQUE(name, url)
);
```

#### Content

- `id` -- Unique integer identifier. Referenced by `stations.source_id`.
- `name` -- Name of the data source (e.g. `NOAA`, `CMEMS`).
- `url` -- URL for the data source.

### `stations`

The `stations` table contains one row per tide station.

#### Schema

```sql
CREATE TABLE stations (
  id                     INTEGER PRIMARY KEY,
  station_id             TEXT NOT NULL UNIQUE,
  name                   TEXT NOT NULL,
  type                   TEXT NOT NULL CHECK (type IN ('reference', 'subordinate')),
  latitude               REAL NOT NULL,
  longitude              REAL NOT NULL,
  continent              TEXT NOT NULL,
  country                TEXT NOT NULL,
  region                 TEXT,
  timezone               TEXT NOT NULL,
  disclaimers            TEXT,
  source_id              INTEGER NOT NULL REFERENCES sources(id),
  source_station_id      TEXT NOT NULL,
  license                TEXT NOT NULL,
  commercial_use INTEGER NOT NULL DEFAULT 0,
  license_url            TEXT NOT NULL,
  license_notes          TEXT,
  epoch_start            TEXT,
  epoch_end              TEXT
);

CREATE INDEX idx_stations_type ON stations(type);
CREATE INDEX idx_stations_country ON stations(country);
CREATE INDEX idx_stations_continent ON stations(continent);
```

#### Content

- `id` -- Auto-incrementing integer primary key. Used as foreign key in all related tables.
- `station_id` -- Unique text identifier in the format `source/id` (e.g. `noaa/9414290`). Consumers SHOULD use this field for lookups and display.
- `name` -- Human-readable station name.
- `type` -- MUST be one of `reference` or `subordinate`. Reference stations have harmonic constituents in `station_constituents`. Subordinate stations have offsets in `station_offsets`.
- `latitude` -- Station latitude in decimal degrees (WGS 84). Positive is north.
- `longitude` -- Station longitude in decimal degrees (WGS 84). Positive is east.
- `continent` -- Continent where the station is located.
- `country` -- ISO 3166-1 alpha-2 country code.
- `region` -- OPTIONAL sub-national region or state.
- `timezone` -- IANA timezone name (e.g. `America/Los_Angeles`).
- `disclaimers` -- OPTIONAL text disclaimers about data quality or usage.
- `source_id` -- Foreign key to `sources.id`.
- `source_station_id` -- The station identifier as used by the original data source.
- `license` -- SPDX license identifier or description (e.g. `Public Domain`, `CC-BY-4.0`).
- `commercial_use` -- `1` if the data MAY be used commercially, `0` otherwise.
- `license_url` -- URL to the full license text.
- `license_notes` -- OPTIONAL additional licensing information.
- `epoch_start` -- OPTIONAL start date of the harmonic analysis epoch, as `YYYY-MM-DD`.
- `epoch_end` -- OPTIONAL end date of the harmonic analysis epoch, as `YYYY-MM-DD`.

### `station_constituents`

The `station_constituents` table stores the harmonic constants for reference stations.

#### Schema

```sql
CREATE TABLE station_constituents (
  station_id  INTEGER NOT NULL REFERENCES stations(id),
  constituent TEXT NOT NULL REFERENCES constituents(name),
  amplitude   REAL NOT NULL,
  phase       REAL NOT NULL,
  PRIMARY KEY (station_id, constituent)
) WITHOUT ROWID;
```

#### Content

- `station_id` -- Foreign key to `stations.id`. The referenced station MUST have `type = 'reference'`.
- `constituent` -- Foreign key to `constituents.name`.
- `amplitude` -- Amplitude in meters.
- `phase` -- Phase lag (epoch) in degrees, in the range [0, 360).

Each reference station SHOULD have at least the principal constituents (M2, S2, K1, O1).

### `station_offsets`

The `station_offsets` table stores prediction offsets for subordinate stations relative to a reference station.

#### Schema

```sql
CREATE TABLE station_offsets (
  station_id   INTEGER PRIMARY KEY REFERENCES stations(id),
  reference_id INTEGER NOT NULL REFERENCES stations(id),
  height_type  TEXT NOT NULL CHECK (height_type IN ('ratio', 'fixed')),
  height_high  REAL NOT NULL,
  height_low   REAL NOT NULL,
  time_high    INTEGER NOT NULL,
  time_low     INTEGER NOT NULL
);

CREATE INDEX idx_station_offsets_reference ON station_offsets(reference_id);
```

#### Content

- `station_id` -- Foreign key to `stations.id`. The referenced station MUST have `type = 'subordinate'`.
- `reference_id` -- Foreign key to `stations.id`. The referenced station MUST have `type = 'reference'`.
- `height_type` -- MUST be `ratio` (multiply reference heights) or `fixed` (add to reference heights in meters).
- `height_high` -- Height adjustment for high tides. If `height_type` is `ratio`, this is a dimensionless multiplier. If `fixed`, this is in meters.
- `height_low` -- Height adjustment for low tides (same units as `height_high`).
- `time_high` -- Time offset for high tides, in minutes. Positive values shift later.
- `time_low` -- Time offset for low tides, in minutes. Positive values shift later.

### `station_datums`

The `station_datums` table stores tidal datum values for stations.

#### Schema

```sql
CREATE TABLE station_datums (
  station_id INTEGER NOT NULL REFERENCES stations(id),
  datum TEXT NOT NULL,
  value      REAL NOT NULL,
  PRIMARY KEY (station_id, datum)
) WITHOUT ROWID;
```

#### Content

- `station_id` -- Foreign key to `stations.id`.
- `datum` -- Datum identifier. Common values include `MHHW`, `MHW`, `MTL`, `MSL`, `MLW`, `MLLW`, `LAT`, `HAT`.
- `value` -- Datum height in meters, relative to the station's chart datum.

### `equilibrium_arguments`

The `equilibrium_arguments` table stores precomputed equilibrium arguments (V₀ + u) for each constituent at the start of each year. These values enable tide prediction without an astronomy library.

#### Schema

```sql
CREATE TABLE equilibrium_arguments (
  constituent TEXT NOT NULL REFERENCES constituents(name),
  year        INTEGER NOT NULL,
  value       REAL NOT NULL,
  PRIMARY KEY (constituent, year)
) WITHOUT ROWID;
```

#### Content

- `constituent` -- Foreign key to `constituents.name`.
- `year` -- Calendar year.
- `value` -- Equilibrium argument in degrees (0-360), computed at 00:00 UTC on January 1 of the given year.

The year range MUST span at least `start_year` through `end_year` as declared in `metadata`. Equilibrium arguments MAY be absent for constituents that lack a computable astronomical formula.

### `node_factors`

The `node_factors` table stores precomputed node factors (f) for each constituent at the middle of each year.

#### Schema

```sql
CREATE TABLE node_factors (
  constituent TEXT NOT NULL REFERENCES constituents(name),
  year        INTEGER NOT NULL,
  value       REAL NOT NULL,
  PRIMARY KEY (constituent, year)
) WITHOUT ROWID;
```

#### Content

- `constituent` -- Foreign key to `constituents.name`.
- `year` -- Calendar year.
- `value` -- Node factor (dimensionless multiplier), computed at 00:00 UTC on July 1 of the given year.

The year range MUST match `equilibrium_arguments`. Node factors MAY be absent for constituents that lack a computable astronomical formula. A node factor of `1.0` indicates no correction.

## Tide Prediction

A consumer can compute tide predictions from a TideBase file using the standard harmonic method:

$$h(t) = Z_0 + \sum_i f_i \cdot H_i \cdot \cos(\omega_i \cdot t + V_{0_i} + u_i - \kappa_i)$$

Where for each constituent $i$:

- $Z_0$ is the mean sea level (the `MSL` datum from `station_datums`, or 0)
- $f_i$ is the node factor from `node_factors` for the prediction year
- $H_i$ is the amplitude from `station_constituents`
- $\omega_i$ is the speed from `constituents` (converted to radians/hour)
- $t$ is hours elapsed since 00:00 UTC January 1 of the prediction year
- $V_{0_i} + u_i$ is the equilibrium argument from `equilibrium_arguments`
- $\kappa_i$ is the phase from `station_constituents`

For subordinate stations, first compute predictions at the reference station, then apply the time and height offsets from `station_offsets`.

## Future Considerations

The following features are being considered for future versions of this specification:

- **Tidal current data** -- velocity constituents for current prediction stations
- **Datum conversions** -- relationships between vertical datums at each station
- **Confidence intervals** -- uncertainty estimates for harmonic constants

## License

This specification is released under [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/).
