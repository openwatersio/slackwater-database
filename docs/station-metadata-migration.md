# Station metadata migration

Station identity, structured location, currents, and published routes now come
from this database. Consumers no longer need `@openwaters/station-metadata` or
its separate build pipeline.

## Migration result

The migration was compared against `@openwaters/station-metadata@5.3.1` before
removing the temporary development dependency and parity checker.

- All present curated correction and registry fields matched, including names,
  positions, context, aliases, cities, structured location, current metadata,
  slugs, and former slugs.
- 7,351 published slug allocations remain live.
- 1,050 provider identities unavailable from the current source inputs remain
  reserved as tombstones.
- 3,557 database stations gained routes.
- Every Slackwater route backed by its installed metadata release remains
  unchanged: 2,765 tide mappings and 842 current mappings, with zero
  mismatches.

## Generated catalogue

| Measure                |        Result |
| ---------------------- | ------------: |
| Stations               |        10,935 |
| Tide stations          |         8,349 |
| Current stations       |         2,586 |
| Identity-only records  |            35 |
| Routed station records |        10,908 |
| Tide routes            |         8,349 |
| Current routes         |         2,558 |
| Former tide paths      |             3 |
| Former current paths   |             2 |
| Country-code coverage  | 10,935 (100%) |
| Region-code coverage   | 7,749 (70.9%) |
| Locality coverage      | 9,735 (89.0%) |

Country codes are required. Region codes and localities remain optional where
the source data or geocoder cannot identify a reliable value.

## Artifact size

| Artifact                                  |      Bytes | Approximate size |
| ----------------------------------------- | ---------: | ---------------: |
| Previous `stations.pack` on `origin/main` | 18,496,618 |         17.6 MiB |
| Unified `neaps.tcdb`                      |  8,761,128 |          8.4 MiB |
| Packed npm package                        | 12,120,988 |         11.6 MiB |

The unified database payload is 9,735,490 bytes (52.6%) smaller than the
previous generated station pack while including current stations and route
metadata. The 2.1 MiB committed `places.json` build snapshot is not shipped in
the npm package.

## Release safeguards

`npm run validate:database` rejects unreviewed slug, route, position,
coastline, or audit-policy changes. `npm run metadata:lock` updates the durable
locks after review, but refuses to remove a published path unless it is
tombstoned or retained as a redirect.
