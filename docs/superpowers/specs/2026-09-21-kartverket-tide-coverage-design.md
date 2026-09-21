# Kartverket Tide Coverage Design

**Issue:** [openwatersio/tide-database#153](https://github.com/openwatersio/tide-database/issues/153)

**Status:** Draft for review

## Summary

Add offline Norwegian astronomical tide coverage from Kartverket in two independently useful milestones:

1. Import Kartverket's 33 published harmonic stations into the existing station database. They immediately work with the current station chooser and nearest-station flow.
2. Add Kartverket's coastal tide zones as an improvement to automatic location resolution. A containing zone selects a reference station and applies local time, height, and datum corrections before the existing nearest-station fallback.

A tide zone is not a synthetic station and does not appear as another choice in the station list. Manual station selection continues to predict that station directly. Zone corrections apply only when resolving a geographic position.

## Source and licence

Kartverket publishes the data through its [water-level API](https://www.kartverket.no/en/api-and-data/tides-and-water-level-data) under CC BY 4.0. Distributed data must credit:

> Tide and water-level data © Kartverket / Norwegian Mapping Authority, Hydrographic Service, licensed under CC BY 4.0.

The source README, package NOTICE, and exported source metadata must include that credit and links to the [source](https://www.kartverket.no/en/api-and-data/tides-and-water-level-data) and [licence terms](https://www.kartverket.no/en/api-and-data/terms-of-use).

The importer records every transformation: centimetres to metres, phase conversion from UTC+1 to UTC, constituent-name normalization, MSL-relative datum handling, polygon-ring closure, and unsupported-zone exclusion.

## Verified source inventory

The live API survey on 2026-09-21 found:

- 33 public stations with coordinates and valid harmonic constituent responses;
- 590 tide-zone polygons;
- 495 zones with a published reference station, factor, delay, MSL datum, chart datum, and a reference station among the 33 public stations;
- 41 otherwise complete zones referencing 15 station codes for which the API does not publish constituents;
- 54 zones without enough tide data to calculate locally.

The initial release publishes all 33 stations and the 495 computable zones. All 590 upstream zone records remain in the pinned source snapshot. The build emits an exclusion report identifying the other 95 by upstream ID and reason.

Twenty-eight Kartverket stations are within one kilometre of an existing TICON record. Five add distinct point coverage: Bøfjorden, Eydehavn, Kaupanger, Solumstrand, and Træna. The quality gate retains both provenance records but prefers the authoritative Kartverket record when the gauges are duplicates.

## Milestone 1: harmonic stations

### Import

Create a `sources/kartverket` workspace following the existing source-package pattern. It has two commands:

- `refresh` downloads responses into a staging directory, rejects HTTP and XML error responses, verifies the complete expected inventory, calculates SHA-256 checksums, then atomically replaces the last valid snapshot;
- `import` performs no network requests and deterministically transforms the committed snapshot into `data/kartverket/*.json` station records.

The manifest records each request URL, retrieval time, and checksum. Retrieval time is excluded from normalized output so importing the same snapshot twice produces byte-identical station JSON. A failed refresh never replaces the previous valid snapshot.

Node does not provide an XML parser. Add one direct, maintained XML dependency. Regular expressions are not suitable for parsing untrusted XML. Reject document types and entity declarations, unexpected units, incomplete station responses, duplicate station codes, and unknown data conventions.

### Station normalization

Each station uses a stable ID of `kartverket/<station-code>` and preserves Kartverket's published name, latitude, longitude, source code, observation epoch when present, and datum values.

Normalization rules:

- amplitudes: centimetres to metres;
- phases: `phaseUTC = normalize(phasePublished - speedDegreesPerHour)` because published phases use UTC+1;
- chart datum: preserve the explicit `CD` level; `LAT` is a separate datum;
- missing observation epochs: leave the epoch absent;
- source data: mark the harmonics as published and attach the Kartverket source and CC BY 4.0 licence.

Kartverket currently publishes 64 distinct constituent tuples. Mapping is keyed by published name, speed, and Extended Doodson identifier, not name alone. Exact tuples map to canonical Neaps constituent names. Unknown tuples fail import.

Most tuples already map to Neaps models. `ALP1`, `BET1`, and Kartverket's variants of `SA`, `S1`, and `OQ2` require explicit Neaps catalogue entries using their published speeds and Doodson identifiers. Provider-only lines use unity nodal correction in the first implementation. They must pass the numerical validation gate. A failure blocks release; it does not justify weakening the threshold.

### Existing consumer behavior

No database schema or Slackwater UI change is required for this milestone. The imported records are ordinary reference stations and work through the current APIs:

```text
manual station selection → selected station → harmonic prediction
automatic location       → nearest station  → harmonic prediction
```

Kartverket records participate in search, station bundles, routes, Swift access, npm distribution, and quality scoring exactly like existing reference stations. Co-located TICON records remain available for provenance but are marked redundant in favor of Kartverket.

### Milestone 1 acceptance

- A clean checkout can rebuild all 33 stations without network access.
- Repeating the import produces byte-identical normalized output.
- All station coordinates, datums, and source identifiers match the pinned responses.
- All 33 stations pass database validation and are available through JavaScript and Swift.
- TCD includes the physical Kartverket stations whose constituent names are supported by its master catalogue.
- Existing station lookup and prediction APIs do not change.
- Pinned Kartverket prediction comparisons pass the numerical thresholds below.

## Milestone 2: zone-aware location resolution

### User and application behavior

The current station-selection model remains intact. Manual selection never silently applies a zone correction.

Automatic location resolution changes from:

```text
position → nearest station → station prediction
```

to:

```text
position → containing supported zone
         → referenced station + zone corrections

no containing supported zone
         → existing nearest-station fallback
```

This prevents straight-line proximity from selecting a station connected to a different fjord, island channel, or coastal water body. Each zone defines a hydrodynamic relationship. Several zones may reference the same station with different factor, delay, and datum values.

Slackwater does not list the 495 zones as stations. A future location-based presentation may show an area label with secondary text such as "Based on Stavanger station," but no UI work is part of issue #153.

### TCDB model

Add `Root.tide_zones:[TideZone]`. A published `TideZone` contains:

- numeric Kartverket zone ID;
- published name;
- reference `Station.id`;
- height factor;
- delay in minutes;
- MSL-relative datum values, including explicit chart datum `CD`;
- upstream revision;
- observation-station code when supplied;
- bounding box;
- one closed polygon ring;
- Kartverket source and licence metadata.

Reuse the existing datum-name table and `Datum` structure. Add only the coordinate structure needed for zone vertices. The current Kartverket inventory consists of simple rings, so multipolygon and general-purpose geometry abstractions are out of scope. A future source that requires them must justify a schema revision.

Only the 495 computable zones enter TCDB. This keeps every runtime state useful: a returned zone is predictable, and `undefined`/`nil` means the location has no supported zone and should use the existing fallback. The raw snapshot and exclusion report retain the unsupported geometry for future coverage work.

### Lookup

Add explicit database APIs equivalent to:

```ts
function tideZones(): Iterable<TideZone>;
function tideZoneAt(position: { latitude: number; longitude: number }): TideZone | undefined;
```

Swift exposes the corresponding collection and coordinate lookup.

Lookup first rejects zones by bounding box, then applies a deterministic point-in-polygon test. With only 495 zones and about 5,000 total edges, a linear scan is the intended implementation. Mark that deliberate ceiling with a `ponytail:` comment; add a spatial index only if production profiling demonstrates a need.

Points on an edge count as contained. If multiple supported polygons contain the position, the lowest numeric Kartverket zone ID wins. JavaScript and Swift must use fixtures that prove identical interior, edge, overlap, and outside behavior. The lookup never chooses the nearest polygon.

### Prediction contract

The zone references the source of harmonic motion but is not represented as a subordinate point station. For zone `z`, requested datum `D`, and instant `t`:

```text
referenceMSL(t) = predict(z.referenceStation, t - z.delayMinutes, MSL)
zoneMSL(t)      = z.heightFactor × referenceMSL(t)
zoneD(t)        = zoneMSL(t) + (z.datum[MSL] - z.datum[D])
```

A positive delay therefore produces a later local tide. The local datum shift is applied after the factor. This order follows Kartverket's [API protocol](https://vannstand.kartverket.no/API%20for%20water%20level%20and%20tides%20-%20communication%20protocol_revJune2025.pdf) and differs from the current generic subordinate-station path, which applies its datum before the height ratio.

High and low events use the same transformation:

1. calculate reference extrema over a window padded by the absolute zone delay;
2. shift each event time by the zone delay;
3. multiply its MSL height by the factor;
4. apply the requested zone datum;
5. filter and sort events back into the requested interval.

Neaps receives a focused zone adapter. Generic subordinate-station semantics and existing station predictions remain unchanged.

### Export compatibility

- TCDB, JavaScript, browser/worker bundles, and Swift carry supported zones.
- TCD continues to receive the 33 physical harmonic stations.
- TCD does not receive polygon zones or fabricated representative points because its point-station model cannot encode them faithfully.
- Documentation and tests state this limitation.

### Milestone 2 acceptance

- TCDB contains exactly the supported zones from the pinned snapshot and every reference resolves to an accepted Kartverket station.
- JavaScript and Swift return the same zone for all lookup fixtures.
- A supported location uses its zone; an unsupported or outside location follows the existing nearest-station fallback.
- Manual station selection is unchanged.
- Zone height timelines and extrema pass the numerical thresholds below.
- Package metadata and NOTICE contain the required attribution.

## Validation

Ordinary builds and tests never contact Kartverket. Provider comparison responses are pinned with the source snapshot. A separate refresh-validation command may query the live service and update those fixtures after review.

Validate:

- all 33 stations and all 495 supported zones at representative timestamps across winter, summer, spring, and neap conditions;
- detailed 72-hour timelines and extrema for a smaller matrix covering positive and negative delays, minimum and maximum factors, geographic spread, year boundaries, and locations where `CD != LAT`;
- both MSL and chart-datum outputs;
- station and zone predictions across the declared accuracy interval of 2020-01-01 through 2040-12-31.

Required numerical agreement with Kartverket:

- timeline RMSE at most 0.02 m;
- 95th-percentile absolute error at most 0.03 m;
- maximum absolute error at most 0.05 m;
- high/low time error at most five minutes;
- high/low height error at most 0.05 m.

Calculations outside the declared interval remain possible but carry no Kartverket validation guarantee. A constituent-model or convention mismatch that exceeds these thresholds blocks release and requires a design correction.

## Failure behavior

Refresh and import fail without replacing valid output when they encounter:

- a network, HTTP, or Kartverket XML error response;
- an incomplete station or zone inventory;
- a checksum mismatch;
- an unsupported unit or UTC offset;
- an unknown constituent tuple;
- an invalid polygon;
- a missing reference station, factor, delay, MSL, or chart datum on a zone considered publishable;
- a dangling reference in the generated database.

The exclusion report classifies known incomplete upstream zones. A change to their count, station-code set, or reason classification is surfaced for review during refresh.

## Scope exclusions

This work does not add:

- observed water levels, storm surge, or weather corrections;
- currents or slack-water calculations;
- an offshore gridded model;
- zone polygons in station search;
- a map overlay or Slackwater UI redesign;
- multipolygon or general-purpose GIS support;
- nearest-polygon fallback;
- TCD encoding for zones.
