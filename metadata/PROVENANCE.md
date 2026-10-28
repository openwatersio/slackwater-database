# Provenance

The reference data the database builder derives station fields from, and where each comes from. The provenance of the stations this repo owns, field by field, is in [stations/README.md](../stations/README.md#provenance).

## Place names

The database builder uses **GeoNames cities500, CC BY 4.0** to derive locality, subdivision, country, and fallback context fields when curated and provider data do not supply them. For an opaque TICON source name, the nearest place within 50 km of the resolved station position supplies the display name. This fallback can name a city section or a place across a border; a curated name takes priority.

`places.json` is a reviewed, filtered snapshot: the ten nearest GeoNames
places, and the ten nearest that are not a section of a city, within 100 km of
every station in the catalogue. `packages/stations/fetch-places.ts` builds it
(`npm run refresh:places -w packages/stations`). The committed snapshot was built
from `cities500.zip` and `admin1CodesASCII.txt` downloaded on 2026-10-20
(SHA-256 `2b80cc4a7d9a7c784ba4892f7fdc1900ffff73ab9780bc064ffe5c539a6fabac`
and `b577baa3476bbe94f0454545e517e1835401d79c5b1105c8e02cf1d4a505e8ec`).
Names are the ones GeoNames publishes, accents included. A section of a city (feature code PPLX) is flagged `section` and is excluded when deriving a context label. The committed snapshot makes generation reproducible and reviewable; updating it is an explicit source-data change rather than a side effect of building.

The snapshot is not included in the published database or npm package. Only
the derived station fields are written to TCDB. GeoNames contains no tide or
current station records:

- The rule is _don't redistribute a **provider's** station file_ — CHS's or NOAA's list of the
  things we publish records about. GeoNames publishes no tide or current stations, so nothing
  here overlaps a provider's compilation.
- A derived value is the lowest-precedence tier and is always beaten by a station
  file's curation or the provider's data.
- A same-country check prevents a nearby place across a border from supplying
  locality or subdivision data.
- Localities farther than 40 km remain empty rather than naming a misleading place.

If that trade ever stops being worth it, the exit is cheap: remove GeoNames from
the build, and optional location fields remain absent.

## Water bodies

A station with no curated or provider context takes the name of the bay or strait it sits in from **OpenStreetMap, ODbL 1.0, © OpenStreetMap contributors**. A water that repeats the station name is skipped. When no suitable water body contains the station or lies within 1 km of it, GeoNames supplies a distinct nearby place only if the provider name has no region qualifier. Without a suitable water or place, context remains absent.

`water-bodies.geojson` is a reviewed snapshot of the named `natural=bay` and `natural=strait` ways and relations that contain a station in the catalogue or lie within 1 km of one. `packages/stations/fetch-water-bodies.ts` builds it from the Overpass API. The snapshot keeps each relation's outer rings only, simplifies them, and records the English name where OpenStreetMap has one, otherwise a Latin-script local name. Marine Regions' gazetteer was the other candidate, but it has no polygons for water bodies the size of Elliott Bay or Hood Canal.

`npm run refresh:water-bodies -w packages/stations -- --extend-source=dmi`
extends the snapshot around that source's positions. It queries the same upstream
features and preserves previously reviewed coverage elsewhere. Use the command
without that argument for a complete refresh. The DMI coverage was extended from
Overpass data downloaded on 2026-10-20.

## Maritime zones

A new station takes its country from the **Marine Regions Maritime Boundaries Geodatabase, Exclusive Economic Zones, CC BY 4.0** (Flanders Marine Institute, marineregions.org) before it falls back to the nearest GeoNames place. The zone polygons end at a generalized coastline, so a station within 10 km of a zone takes that zone's country. A gauge up a harbor or inlet is the usual case. Across the Strait of Juan de Fuca the nearest place can be in the other country; the zone cannot. Once a station has a file, its directory holds the country.

`maritime-zones.geojson` is a reviewed snapshot built by `packages/stations/fetch-maritime-zones.ts`. It covers the half-degree cells within half a degree of each owned station's position and lists them as `coverage`. Each zone is clipped to those cells and simplified to about 100 m. Joint regimes and overlapping claims are left out.

Neither snapshot is included in the published database or npm package. Only the derived `context` and country fields reach the TCDB, and neither source publishes tide or current stations.

## UHSLC relay metadata

`sources/ticon/uhslc-metadata.json` pins five fields (station name, position, current data provider, originator number, last update) from the per-station metadata the University of Hawaii Sea Level Center publishes with its research-quality records, the Joint Archive for Sea Level (Caldwell, Merrifield and Thompson, 2015, NOAA NCEI, https://doi.org/10.7289/V5V40S7W). It is used only to match a TICON relay to the gauge it copies. None of it reaches the published database or npm package. `sources/ticon/fetch-uhslc-metadata.ts` refreshes it; review the diff before committing.

## CHS current results

`chs-current-validation/<tag>.json` snapshots a results release of [openwatersio/chs-current-validation](https://github.com/openwatersio/chs-current-validation) (MIT): the release's `dispositions.json`, trimmed to its `release`, `stamp`, `engine`, `scorer`, `database` and `newest` fields and each gate's `chs_fit`. A current station file's `chs_fit.evidence` names the snapshot it came from, and `npm run validate` fails when the station files cite more than one recipe stamp (a stamp change moves every gate in one PR), when a file does not cite the newest snapshot of its recipe stamp that lists its gate, or its `chs_fit` (without `evidence` and `miss_context`) differs from that gate's entry. `npm run validate:chs-fit -w packages/stations` downloads the release of each snapshot a station file cites and fails CI when the committed file differs from it or the release is gone (404); when GitHub cannot be reached it warns and passes. `packages/stations/fetch-chs-fit.ts` writes a snapshot (`npm run refresh:chs-fit -w packages/stations -- <tag>`). `npm run report:chs-fit-age -w packages/stations` warns in CI when the newest release the station files cite is more than 45 days old, when the results repository lists a newer release of the cited recipe stamp (drafts ignored, prereleases named), or when another stamp has newer results. It warns rather than fails when GitHub cannot be reached. None of it reaches the published database; only `chs_fit` does.
