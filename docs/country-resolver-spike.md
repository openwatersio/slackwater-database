# Country resolver comparison

This diagnostic evaluates `@openwaters/c5y-n8r` against Slackwater’s source-country inputs. The separately installed spike dependency is pinned to commit `96f39cbedef7242eae3410de6e9afee5d1ab2710`. Production continues using `country-code-lookup`; the diagnostic never substitutes unresolved answers or rewrites station data.

## Run

Use the repository’s pinned Node/npm versions and run `npm ci`. Install the diagnostic separately, then run it:

```sh
npm ci --prefix spikes/country-resolver
npm run check --prefix spikes/country-resolver
npm run report:country-resolver -w packages/stations
```

The command writes `tmp/country-resolver.json`. An optional argument sets another output path, relative to the command’s working directory (`packages/stations` for the workspace command). The report reads every source JSON record in `data/` and compares its country input with `countryByName`, using the production name-lookup function. Its Western Samoa and Cape Verde aliases apply only if those raw strings occur in the stored records; this inventory contains their normalized names instead. The new resolver receives each input unchanged, so missing aliases remain visible. Existing answers are migration baselines, not verified facts.

Root installs and release jobs do not install or execute the spike dependency. Its tests and typecheck run only through the explicit spike check command above; CI does not run them. This keeps the production lockfile policy intact.

A normal Git install builds the compiled reader through its prepare step. A fresh script-disabled install cannot run this diagnostic because the package omits its compiled reader; [distribution is tracked separately](https://github.com/openwatersio/c5y-n8r/issues/143). Do not use a previously prepared cache as evidence that script-disabled installation works. The standalone lockfile pins its runtime dependencies. Its Git dependency still runs a prepare build when explicitly installed; this manual setup is outside the production registry-only lockfile gate. The pinned country-library commit also contains its build lockfile. The package remains private and unpublished on npm.

## Coverage at Slackwater revision d89b1750b

| Outcome                       | Country inputs | Source records |
| ----------------------------- | -------------: | -------------: |
| Same code, name and continent |              2 |            154 |
| Same code, different metadata |              2 |             20 |
| Unresolved                    |            125 |          8,554 |
| Total                         |            129 |          8,728 |

All 125 unresolved inputs have answers in the production baseline; none are unresolved on both sides. Each report case retains the baseline answer so these missing replacements remain inspectable. None are verified. The four resolved inputs are United Kingdom, Turkiye, Curaçao and Republic of the Congo. Turkiye returns `Turkey`; Curaçao returns `North America` rather than `Americas`. These differences require an explicit consumer decision backed by evidence.

The inventory excludes additional inputs in CHS, currents, curated locations, place metadata and maritime zones. Full source-record coverage alone does not establish migration readiness. ISO-code callers in normalization, name cleanup, maritime-zone conversion and the published builder’s exact code/name consistency check also need coverage. A display-name change can therefore fail a database build, not merely change its label.

## Adapter limits

The diagnostic opens the binary with Node `readFileSync`. Names and alpha-3 codes resolve to an entity ID, but the public API cannot retrieve that entity’s current alpha-2 assignment. The adapter scans the 676 possible alpha-2 codes once at startup, retains only a unique code per entity, and keeps missing or ambiguous code mappings unresolved and excludes retired, outside-date and deprecated code assignments from its reverse index. This is temporary diagnostic code; a production adapter needs the reviewed entity-to-code API.

The diagnostic projects results into the existing caller fields. The report additionally retains selection, uncertainty, evidence status and candidate evidence. This projection does not constitute a production acceptance policy. All runtime answers in the pinned dataset are explicitly unreviewed.

Timings include module import, binary opening and the alpha-2 scan. Most measured source lookups are misses. Single-machine measurements do not establish performance for a fully covered corpus.

The production builder is exported to Node, browser and worker consumers. Adopting a static Node filesystem loader there would break browser/worker use. Consumers must supply bytes appropriately before adoption; the library reader already accepts bytes.

## Review work

- [136 individual evidence reviews](https://github.com/openwatersio/c5y-n8r/issues/138): 55 explicit review findings and 81 spelling matches requiring source verification.
- [Required-country coverage](https://github.com/openwatersio/c5y-n8r/issues/139), including additional consumer surfaces.
- [Turkiye display name](https://github.com/openwatersio/c5y-n8r/issues/140).
- [Curaçao continent classification](https://github.com/openwatersio/c5y-n8r/issues/141).
- [Entity-to-code API](https://github.com/openwatersio/c5y-n8r/issues/142).
- [Script-disabled package installation](https://github.com/openwatersio/c5y-n8r/issues/143).
- [Representing completed evidence reviews](https://github.com/openwatersio/c5y-n8r/issues/144).
- [Browser/worker binary loading](https://github.com/openwatersio/c5y-n8r/issues/145).
- [Referenced name statements](https://github.com/openwatersio/c5y-n8r/issues/146): Wikidata references attach to statements, not label/alias fields.

Adoption requires verified coverage, reviewed metadata behavior, a usable conversion API and distribution path, browser-safe loading, and passing production builds and consumer checks. The production migration remains separate from this diagnostic.
