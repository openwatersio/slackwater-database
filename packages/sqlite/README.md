# Neaps Tide Database - TideBase (SQLite)

This package generates a [TideBase](./spec.md) file — an SQLite database containing all stations from the Neaps Tide Database with harmonic constituents, tidal datums, subordinate station offsets, and precomputed equilibrium arguments and node factors for tide prediction.

TideBase is a modern, portable, and queryable database containing everything needed for tide prediction in an SQLite database.

## Usage

Download the latest `*.tidebase` file from [GitHub Releases](https://github.com/openwatersio/tide-database/releases) and query it with any SQLite client:

```sh
sqlite3 neaps*.tidebase
```

### Find a station

```sql
SELECT station_id, name, latitude, longitude
FROM stations
WHERE station_id = 'noaa/9414290';
```

### Find nearby stations

```sql
SELECT station_id, name, latitude, longitude
FROM stations
WHERE latitude BETWEEN 37.5 AND 38.0
  AND longitude BETWEEN -122.6 AND -122.2
ORDER BY name;
```

### Get prediction data for a station and year

```sql
SELECT sc.constituent, c.speed, sc.amplitude, sc.phase,
  ea.value AS eq_argument, nf.value AS node_factor
FROM station_constituents sc
JOIN stations s ON s.id = sc.station_id
JOIN constituents c ON c.name = sc.constituent
LEFT JOIN equilibrium_arguments ea
  ON ea.constituent = sc.constituent AND ea.year = 2026
LEFT JOIN node_factors nf
  ON nf.constituent = sc.constituent AND nf.year = 2026
WHERE s.station_id = 'noaa/9414290'
ORDER BY c.speed;
```

See [examples/](./examples/) for more queries. See [spec.md](./spec.md) for the full specification.

## Contributing

Build the database:

```sh
npm run build
```

### Testing

The test suite validates that the built database correctly preserves all station data from the source JSON files, and that all example queries execute successfully.

```sh
npm test
```

## References

- [TideBase Specification](./spec.md)
- [@neaps/tide-predictor](https://github.com/openwatersio/neaps/tree/main/packages/tide-predictor)
