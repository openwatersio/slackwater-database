# Provenance

The identity registry in this package is **our own factual registry** of tide and
current stations. It is not a copy of any provider's station file. This document
records where each registry field comes from, so the claim is auditable rather
than asserted.

## Operational boundary

The registry is independently authored and reviewed, field by field. Contributors obtain
and verify station facts from charts, gazetteers, fitting output, direct observation, or
other documented sources, then write the registry record here.

> **Never redistribute a provider station export or include a provider-minted identifier.**

Provider records enter the tide database through their own documented ingestion
pipelines. They do not enter this independently authored registry. Agreement with
a provider coordinate does not replace independent authoring and human review.

## Per-field provenance

Each registry record is assembled field by field. It is not one document lifted from one
source.

| Field                                              | Origin                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                                             | **Hand-written label.** Renaming and re-casing shouting provider names (`CHERRY POINT` → `Cherry Point`) is the whole point of this package — original editorial work, reviewed by a person.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `context`, `cities`, `aliases`, curated `location` | **Hand-written here.** Not present in provider data; original.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `kind`                                             | **Our editorial classification** (`tide` / `current`), assigned by a person against the membership rules the registry writes down — not a field copied from any provider.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `tideReference` / `derived.reference`              | **Editorial pairing.** Which tide reference port's water to show beside a current gate: the _nearest_ `kind: tide` port in the gate's tidal regime, chosen from the positions in this file and, where one exists, confirmed against standard published secondary-reference practice (e.g. Seymour Narrows → Campbell River). A judgment about real water, expressed as an internal registry key on both sides — no provider handle.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `position`                                         | **Independently derived and human-verified.** Current-gate positions come from the `chs-constituents` fitting pipeline and `currents-vault` pass frontmatter, cross-checked against `chs-constituents/stations/salish-sea.json`. Tide reference-port positions come from CHS's public prediction-station list, matched by position and confirmed in water by the coastline audit. Both are audited against a coastline and reviewed by a person — a hand-picked set of factual coordinates that happen to agree with CHS, not a lifted copy of a CHS station export. This row is about **authoring** — how a person sourced a coordinate once. How a _consumer_ joins at runtime is the next row, and the two are easy to conflate.                                                                                                                                                                                                                                                                                                                   |
| provider id                                        | **Deliberately absent.** The registry carries no provider-minted identifier at all — not even as a reference. The provider's own opaque handle is resolved at runtime by whoever holds a licence to that provider's API, and it never enters this repository. A consumer joins a record here to that live data by **name or by position** — `signalk-currents` folds the name (with this registry's `aliases` covering a provider rename); `slackwater-web` takes the position within a 3 km tolerance and lets a name mismatch warn but not gate. Both are safe for the same reason, and it is not the choice of key: **filter the provider's list to the series you want first.** CHS publishes a current station _and_ a tide gauge named "Porlier Pass", and another pair named "Seymour Narrows", so an unfiltered name is ambiguous; the tide station Duffus Point sits at coordinates identical to the Big Bras D'Or current station, so an unfiltered position is worse. Inside a series-filtered list both keys resolve every gate uniquely. |

The honest summary: the _names, context, and positions_ are our work, and there is no
provider handle in the published data at all — the one field that would point _into_ a
provider's system is the one field we chose not to ship.

## Third-party place data

Everything above is about _station_ identity. The database builder also uses
**GeoNames cities500, CC BY 4.0** to derive locality, subdivision, country, and
fallback context fields when curated and provider data do not supply them.

`places.json` is a reviewed, filtered snapshot of the ten nearest GeoNames
candidates within 100 km of every station in the 2026-09-11 catalogue. It was
built from `cities500.zip` and `admin1CodesASCII.txt` downloaded on 2026-09-11
(SHA-256 `060245a4f6914e253d87a09a1344ed274c659ba736f5d445ab0c7ca4effeee1e`
and `590651498043f674accda2b7f46d21286cda0e290b02f8561c5005eee9a5448c`).
The committed snapshot makes generation reproducible and reviewable; updating
it is an explicit source-data change rather than a side effect of building.

The snapshot is not included in the published database or npm package. Only
the derived station fields are written to TCDB. GeoNames contains no tide or
current station records:

- The rule is _don't redistribute a **provider's** station file_ — CHS's or NOAA's list of the
  things we publish records about. GeoNames publishes no tide or current stations, so nothing
  here overlaps a provider's compilation.
- A derived value is the lowest-precedence tier and is always beaten by registry,
  correction, or provider data.
- A same-country check prevents a nearby place across a border from supplying
  locality or subdivision data.
- Localities farther than 40 km remain empty rather than naming a misleading place.

If that trade ever stops being worth it, the exit is cheap: remove GeoNames from
the build, and optional location fields remain absent.

### Water bodies

A station with no curated or provider context takes the name of the bay or strait it sits in from **OpenStreetMap, ODbL 1.0, © OpenStreetMap contributors**. GeoNames names the nearest place only when no water body contains the station or lies within 1 km of it.

`water-bodies.geojson` is a reviewed snapshot of the named `natural=bay` and `natural=strait` ways and relations that contain a station in the catalogue or lie within 1 km of one. `packages/stations/fetch-water-bodies.ts` builds it from the Overpass API. The snapshot keeps each relation's outer rings only, simplifies them, and records the English name where OpenStreetMap has one, otherwise a Latin-script local name. Marine Regions' gazetteer was the other candidate, but it has no polygons for water bodies the size of Elliott Bay or Hood Canal.

### Maritime zones

A registry record states no country of its own, so the builder takes it from the **Marine Regions Maritime Boundaries Geodatabase, Exclusive Economic Zones, CC BY 4.0** (Flanders Marine Institute, marineregions.org) before it falls back to the nearest GeoNames place. The zone polygons end at a generalized coastline, so a station within 10 km of a zone takes that zone's country. A gauge up a harbor or inlet is the usual case. Across the Strait of Juan de Fuca the nearest place can be in the other country; the zone cannot.

`maritime-zones.geojson` is a reviewed snapshot built by `packages/stations/fetch-maritime-zones.ts`. It covers the half-degree cells within half a degree of each registry position and lists them as `coverage`. Each zone is clipped to those cells and simplified to about 100 m. Joint regimes and overlapping claims are left out.

Neither snapshot is included in the published database or npm package. Only the derived `context` and country fields reach the TCDB, and neither source publishes tide or current stations.

## Human review

Every registry station's identity is reviewed by a person before it lands.
Release validation audits positions against the coastline and reports moved
positions through a deterministic lock diff. This review is what converts
overlapping facts into our own verified factual work — use the `source` field to
record per-station provenance that deviates from the defaults above.

## For contributors

When you add or correct a station:

- **Do not paste a row out of a provider's station export.** Obtain the name, context, and
  position independently (chart, gazetteer, the fitting pipeline, direct observation) and
  write them here yourself.
- **Do not add a provider id field.** If your workflow needs the provider's opaque handle to
  join data at runtime, resolve it there, under your own licence to that provider's API — it
  does not belong in this repository.
- If a station's facts came from somewhere other than the defaults in the table above,
  record it in that station's `source` field so the trail stays auditable.
