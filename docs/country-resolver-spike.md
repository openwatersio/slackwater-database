# Country resolver comparison

This diagnostic evaluates `@openwaters/c5y-n8r` against Slackwater’s source-country inputs. The separately installed public GitHub dependency is pinned to commit `e82a2a9e426ce997dbd8e467d00abdabe6e8b2a9`. Production continues using `country-code-lookup`; the diagnostic never substitutes unresolved answers or rewrites station data.

Faithful ingestion of Wikidata labels, aliases and claims is trusted for data admission, with source revisions, statement identities and qualifiers preserved in provenance. Independent certification and complete upstream references are optional quality signals, pursued asynchronously. They do not block admission of faithfully mapped upstream facts. Local aliases, territory interpretations and other project policy decisions still need explicit provenance and compatibility decisions.

## Run

Use the repository’s pinned Node/npm versions and run `npm ci`. Install the diagnostic separately, then run it:

```sh
npm ci --prefix spikes/country-resolver
npm run check --prefix spikes/country-resolver
npm run report:country-resolver -w packages/stations
```

The command writes `tmp/country-resolver.json`. An optional argument sets another output path, relative to the command’s working directory (`packages/stations` for the workspace command). Country values must be nonempty strings within the reader’s 1,024-character limit; invalid records stop the diagnostic. The report reads every source JSON record in `data/` and compares its country input with `countryByName`, using the production name-lookup function. Its Western Samoa and Cape Verde aliases apply only if those raw strings occur in the stored records; this inventory contains their normalized names instead. The new resolver receives each input unchanged, so missing aliases remain visible. Existing answers are migration baselines; disagreements require tracing provenance and deciding compatibility behavior.

Root installs and release jobs do not install or execute the spike dependency. Its tests and typecheck run only through the explicit spike check command above; CI does not run them. This keeps the production lockfile policy intact.

A normal Git install builds the compiled reader through its prepare step. A fresh Git install with scripts disabled does not contain the compiled reader. Prepared package tarballs contain that reader and support script-disabled installation; they are checked separately in [code PR 273](https://github.com/openwatersio/c5y-n8r/pull/273). The standalone lockfile pins its runtime dependencies. The explicit Git install remains outside the production registry-only lockfile gate. The package is private and unpublished on npm.

## Coverage at Slackwater revision d89b1750b

The candidate binary SHA-256 is `1c0c7baf160d640b99985c6e5c63d392eb75e2208eb8305f735790eaa8e894b2`; its evidence digest is `d0e40728d7ffd332c50577c6de4d1fc992ef76299e0b86d8960bdcc566672ab6`.

| Outcome                       | Country inputs | Source records |
| ----------------------------- | -------------: | -------------: |
| Same code, name and continent |             81 |          2,369 |
| Same code, different metadata |             45 |          6,326 |
| Unresolved                    |              3 |             33 |
| Total                         |            129 |          8,728 |

The candidate dataset resolves 126 inputs / 8,695 records. All supported codes match the production baseline, but 45 inputs differ in name or continent metadata. Every resolved input has nonempty continent metadata. All 126 resolutions use tentative code assignments because their temporal bounds are not fully known. The pinned report records `evidenceStatus: "unreviewed-spike"` and `verifiedInputs: 0`; these certification counters do not determine admission under the upstream-trust policy. Temporal uncertainty remains visible and does not imply that a faithful upstream mapping needs independent certification. The three unresolved inputs are `Virgin Islands` (26 records), `Myanmar (Burma)` (4), and `Saint Helena` (3); all have answers in the old baseline. The report preserves both the source match and target-code candidates, including applicability, tentative status and evidence. The report hashes the same bytes opened by the adapter and records their SHA-256 alongside the metadata.

The Netherlands candidate uses the Kingdom entity Q29999, which has an exact English alias and the NL assignment. The recorded alias and ISO claim are trusted as upstream statements; choosing the Kingdom's scope and qualified continent claim for Slackwater records remains a consumer interpretation decision. A country label or an old-library result alone does not establish an ISO assignment. The remaining names require review of territory scope or provider context rather than a guessed alias.

The inventory excludes additional inputs in CHS, currents, curated locations, place metadata and maritime zones. Full source-record coverage alone does not establish migration readiness. ISO-code callers in normalization, name cleanup, maritime-zone conversion and the published builder’s exact code/name consistency check also need coverage. The `CHART_DATUMS` and `COUNTRY_SPECIFIC_DATUMS` tables in `packages/stations/station.ts` also use country names as keys. For China (14 records), adopting the candidate name `People's Republic of China` would make a fresh import without a preset chart datum select the LAT default and prune TLT values. Existing records with a preset `chart_datum: "TLT"` retain that field while losing their TLT value; `normalize` and `regenerate-harmonic-datums.ts` can therefore leave an inconsistent datum reference instead of switching it to LAT. The stored Dalian record demonstrates this risk in the diagnostic test. The diagnostic conservatively marks every country-name change with `datumPolicyReview`; this is a migration warning, not an applied station-data change. The report does not simulate a production migration.

Of the 45 metadata differences, six change names and 39 change continents. For 37 inputs, the production `Americas` vocabulary becomes `North America` or `South America`; Russia changes from Asia to Europe and British Indian Ocean Territory from Asia to Africa. Published filters such as `station.continent === "Americas"` would need an explicit compatibility decision. These vocabulary and classification differences extend beyond the Curaçao case linked below.

## Adapter limits

The Node adapter loads the binary and injects the registry into the browser-safe `lookup.ts` helper. The helper calls the library’s `convert` API directly; it does not enumerate possible codes or maintain a separate country table. Missing, ambiguous, retired and deprecated sources or targets remain unresolved. Tentative undated source and target assignments remain usable, with their temporal uncertainty and upstream provenance retained in the report. Missing temporal bounds are not replaced with invented dates.

The `countryByIso` helper compares alphabetic alpha-2 and alpha-3 codes; numeric ISO callers remain outside this comparison. The diagnostic projects results into the existing caller fields. The report additionally retains selection, uncertainty, evidence status and candidate evidence. The projection is diagnostic; production activation still requires the integration and compatibility work described here. The pinned dataset retains its existing certification-status labels, independently of whether a faithful upstream fact is admissible. The summary counts tentative resolutions separately, and the corpus is selected around these Slackwater inputs; these figures do not measure general name coverage.

Timings include package loading and validated binary opening. A local candidate run took about 16 ms to open/import and 97 ms for 8,728 conversion lookups. These are single-machine measurements, not comparative performance claims.

The production builder is exported to Node, browser and worker consumers. Adopting a static Node filesystem loader there would break browser/worker use. Consumers must supply bytes appropriately before adoption; the library reader already accepts bytes.

## Review work

The expanded dataset is [candidate PR 274](https://github.com/openwatersio/c5y-n8r/pull/274), stacked on code PR 273. Its pinned artifact has 765 evidence requests marked incomplete by the certification workflow. That status and missing references can inform optional quality work; they are not admission blockers for faithful Wikidata mappings. Source-faithfulness checks, reproducible provenance and local-policy decisions remain distinct from independent factual certification.

The diagnostic uses the conversion API and package preparation in [code PR 273](https://github.com/openwatersio/c5y-n8r/pull/273).

- [136 quality follow-ups](https://github.com/openwatersio/c5y-n8r/issues/138): the existing queue includes provenance findings and spelling matches. Investigate missing references or corroboration asynchronously; a matching upstream label or alias does not require separate certification for admission.
- [Required-country coverage](https://github.com/openwatersio/c5y-n8r/issues/139), including additional consumer surfaces.
- [Turkiye display name](https://github.com/openwatersio/c5y-n8r/issues/140).
- [Curaçao continent classification](https://github.com/openwatersio/c5y-n8r/issues/141).
- [Entity-to-code API](https://github.com/openwatersio/c5y-n8r/issues/142): implemented in draft code PR 273; production adoption and compatibility decisions remain open.
- [Script-disabled package installation](https://github.com/openwatersio/c5y-n8r/issues/143): prepared tarballs are checked in draft code PR 273; the Git install uses its prepare lifecycle.
- [Recording optional quality reviews and explicit local-policy exceptions](https://github.com/openwatersio/c5y-n8r/issues/144).
- [Browser/worker binary loading](https://github.com/openwatersio/c5y-n8r/issues/145).
- [Referenced name statements](https://github.com/openwatersio/c5y-n8r/issues/146): Wikidata references attach to statements, not label/alias fields. A faithfully ingested label or alias remains admissible without a separate referenced statement.

Adoption requires faithful source mapping and reproducible provenance, compatibility coverage, explicit decisions for local territory policy and metadata behavior, a usable conversion API and distribution path, browser-safe loading, and passing production builds and consumer checks. Optional factual-quality reviews can continue asynchronously. The production migration remains separate from this diagnostic.
