CREATE TABLE metadata (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE constituents (
  name        TEXT PRIMARY KEY,
  description TEXT,
  speed       REAL NOT NULL
) WITHOUT ROWID;

CREATE TABLE sources (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  url  TEXT NOT NULL,
  UNIQUE(name, url)
);

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

CREATE TABLE station_constituents (
  station_id  INTEGER NOT NULL REFERENCES stations(id),
  constituent TEXT NOT NULL REFERENCES constituents(name),
  amplitude   REAL NOT NULL,
  phase       REAL NOT NULL,
  PRIMARY KEY (station_id, constituent)
) WITHOUT ROWID;

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

CREATE TABLE station_datums (
  station_id INTEGER NOT NULL REFERENCES stations(id),
  datum TEXT NOT NULL,
  value      REAL NOT NULL,
  PRIMARY KEY (station_id, datum)
) WITHOUT ROWID;

CREATE TABLE equilibrium_arguments (
  constituent TEXT NOT NULL REFERENCES constituents(name),
  year        INTEGER NOT NULL,
  value       REAL NOT NULL,
  PRIMARY KEY (constituent, year)
) WITHOUT ROWID;

CREATE TABLE node_factors (
  constituent TEXT NOT NULL REFERENCES constituents(name),
  year        INTEGER NOT NULL,
  value       REAL NOT NULL,
  PRIMARY KEY (constituent, year)
) WITHOUT ROWID;
