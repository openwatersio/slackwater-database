# Tide database tools

### Build and validate the unified catalogue

Station corrections and identities live in `metadata/corrections.yaml` and
`metadata/registry.yaml`. Use corrections for an existing provider record and
the registry for curated records that may not exist in an imported source.
`metadata/places.json` is the reviewed GeoNames snapshot used for deterministic
location enrichment; builds do not download mutable gazetteer data.

Slug allocations, former paths, and position audits are durable release state.
Do not edit their JSON lock files by hand. After changing source or curated
metadata, run:

```shell
rtk npm run generate
rtk npm run validate:database
rtk npm test
```

If validation reports an intentional slug, route, coastline, or position
change, inspect every id it reports, then update all locks together:

```shell
rtk npm run metadata:lock
rtk npm run validate:database
```

The updater refuses to discard a published route unless the station departed
or the old path is retained as a redirect. Country codes are mandatory;
locality and region codes may remain absent when there is no reliable value.

### Update NOAA Stations

The command `update-noaa-stations` updates all NOAA station files in the data directory with the latest harmonic constituents from the NOAA API.

```shell
tools/update-noaa-stations.ts
```

### Hawaii

The command `hawaii-converter.js` converts DAT files from the (University of Hawaii's Sea Level Center)[http://uhslc.soest.hawaii.edu/data/?fd#uh109] to a format that is readable by Xtide's Harmgen. The first argument should be the data file, the second where you want the output to be.

```shell
node hawaii-converter.js input.dat output.txt
```
