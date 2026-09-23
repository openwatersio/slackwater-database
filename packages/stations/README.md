# Station tooling

NOAA current extraction, validation, and its reviewed bundle live in [`sources/noaa-current`](../../sources/noaa-current). The catalogue consumes that workspace bundle directly and has no separately released current-stations dependency.

## Build and validate the unified catalogue

Station corrections and identities live in `metadata/corrections.yaml` and `metadata/registry.yaml` at the repo root. Use corrections for an existing provider record and the registry for curated records that may not exist in an imported source. `metadata/places.json` is the reviewed GeoNames snapshot used for deterministic location enrichment; builds do not download mutable gazetteer data. `metadata/water-bodies.geojson` (OpenStreetMap bays and straits) supplies a station's derived `context`, and `metadata/maritime-zones.geojson` (Marine Regions EEZs) supplies a registry record's country. Both are reviewed snapshots too; refresh them with `npm run fetch-water-bodies -w packages/stations` and `npm run fetch-maritime-zones -w packages/stations`, then review the context and country changes before committing. See `metadata/PROVENANCE.md` for sources and licenses.

Slug allocations, slug history, former paths, and position audits are durable release state. Do not edit their JSON lock files by hand. After changing source or curated metadata, run from the repo root:

```shell
npm run generate -w packages/database
npm run validate:database
npm test
```

If validation reports an intentional slug, route, coastline, or position change, inspect every id it reports, then update all locks together:

```shell
npm run metadata:lock
npm run validate:database
```

A published slug belongs to its station for good. The updater keeps every allocation it already has, and when a slug does move it writes the old one to `metadata/former-slugs.json`, which is what reaches consumers as a route's `formerPaths` and what stops the allocator ever minting that slug for other water. It refuses a route whose published path would vanish without a redirect, a tombstone for a slug that is still allocated, and a shared slug with no registry owner or two.

To move slugs on purpose — a ladder change that should reach stations already published, say — list the ids and re-ladder just those, so each keeps its old address as a redirect:

```shell
npm run metadata:lock -- ids.json   # a JSON array of station ids
npm run validate:database
```

Resetting a lock file is never the way to migrate: it forgets every published address at once, and the next allocation can hand one to a different station.

Country codes are mandatory; locality and region codes may remain absent when there is no reliable value.
