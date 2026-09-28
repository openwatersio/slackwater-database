# CHS tide station identity

Issue: #210. The database carries a record and a route for every live CHS tide station that Slackwater iOS ships, so consumers stop reading those stations from `@openwaters/station-metadata`.

## Scope

1,047 CHS tide stations hold a reserved slug in `metadata/slug-tombstones.json` (`chs-<name>` to slug) and nothing else. Each becomes an identity-only tide record: name, aliases and position, with no constituents, datums or predictions. Each keeps the id Slackwater iOS already ships, because fitted models stored on devices are keyed by it, and each gets back the slug reserved for it.

Out of scope:

- The 10 CHS tide ports in `metadata/registry.yaml`, which already have records and routes.
- `chs-point-atkinson-2`, `chs-vancouver-2` and `chs-victoria-harbour`. Each sits within 60 m of a registry port and is most likely a second gauge for the same water, which is #191's problem.
- Any IWLS station code. Provider-minted ids never enter this repository (`metadata/PROVENANCE.md`); a consumer resolves a station's IWLS code at runtime by position.

## Design

### `sources/chs`

A private workspace, `@slackwater/chs`, following `sources/kartverket`:

- `stations.json`: the committed station list, one object per station with `id`, `name`, `aliases` and `latitude`/`longitude`, sorted by id. No IWLS code, no derived context, no timezone.
- `seed.ts`: one-time conversion of Slackwater iOS's shipped `Slackwater/Resources/chs-stations.json` into `stations.json`. It keeps every station whose id is a CHS tombstone in `metadata/slug-tombstones.json` and drops the rest, which removes the 10 registry ports and the three excluded stations by the same rule. It is the only source that carries the ids already on devices. It runs once and stays in the repo as the record of where the ids came from.
- `import.ts`: refreshes `stations.json` from IWLS `/stations`. Run by hand, never in CI; the prediction probe takes about 20 minutes.
- `chs.ts`: the pure functions `import.ts` uses, so they can be tested without a network.

### Refresh

1. Fetch `/stations` and keep stations advertising the `wlp` series.
2. Probe each for one hour of predictions from yesterday and keep those that return any, with the same pacing and back-off as the app's generator. IWLS advertises `wlp` for stations it never serves.
3. Drop any station within 200 m of a CHS tide port in `metadata/registry.yaml`. That water already has a curated record.
4. Match each remaining station to an existing record: the nearest unclaimed record within 200 m, or else the unclaimed record whose name matches exactly. A matched record keeps its id; its name, aliases and position update from IWLS.
5. An unmatched station gets a new id: `chs-` plus the slug of its name, suffixed `-2`, `-3` and so on past every id already used by `stations.json`, the registry and the tombstones.
6. A record no station matched is removed. The catalogue then tombstones its slug through the existing path, so the slug is never reused.

The Sable Island name repair moves here from the app: IWLS's `officialName` for that station is bilingual, so the record's name is "Sable Island" with "sable, île de" as an alias. Its id, `chs-sable-island-sable-azle-de`, was minted from a since-repaired misspelling in the IWLS feed and stays as it is, because step 4 keeps a matched record's id whatever the name becomes.

Aliases are IWLS's `alternativeName` split on commas, lowercased, trimmed, deduplicated and without the name itself, as the app does.

### Catalogue

`load-catalogue.ts` reads `sources/chs/stations.json` and turns each record into an identity-only tide `StationInput`, the same shape `registryStations` builds: `type: reference`, empty `harmonic_constituents`, source "Canadian Hydrographic Service" with `published_harmonics: false`, and the registry's licence block. Timezone, country and derived context come from the same resolution every other station goes through. No quality record is needed; only `data/` stations carry one.

`buildSlugTable` already hands a tombstoned id its slug back when a station with that id reappears (`packages/stations/routes.ts:141-146`), so routing needs no new code. `metadata:lock` then records the 1,047 revived slugs and the shrunk tombstone table.

## Testing

- `sources/chs/test/chs.test.ts`, on synthetic fixtures with no real IWLS codes: position match, name fallback, registry-port exclusion, id minting and suffixing, removal, the Sable Island repair, and alias cleanup.
- A catalogue test: every CHS tombstone in `metadata/slug-tombstones.json` becomes a live route with exactly its reserved slug, and no CHS station is allocated a slug from the ladder.
- Add `sources/chs` to the root `npm test`. Before pushing, run root `npm test`, `npm run validate:database` and `npm run lint`.

## Output

The PR states the before and after counts: routes, tombstones, identity-only records, and the size of the database file and npm package.
