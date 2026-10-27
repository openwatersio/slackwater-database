# Stations

Every published station has one file here, at `stations/<kind>/<country>/<slug>.yaml`. The file is the station's URL: `stations/tide/us/everett.yaml` publishes `/tides/us/wa/everett/`, taking the region segment from its `region` field. A file lists the provider records the station is built from, anything curated about it, and a `computed` block that `npm run stations` writes.

```yaml
name: Everett
region: US-WA
aliases: [port gardner, everett marina]
cities: [Everett, Marysville]
sources:
  - noaa/9447659
# Written by `npm run stations`. Do not edit.
computed:
  sources:
    noaa/9447659:
      position: [47.98, -122.223]
      coastline: clear
      quality:
        accepted: true
        score: 84
        factors:
          epoch: 1
          recency: 0.75
          source: 1
          quality: 1
          amplitude: 1
          coverage: 0.122
```

Evidence and explanations are YAML comments. A field exists only when code reads or validates it.

## Fields

- `sources`: the record ids the station publishes, as the database's route `station_ids`. A record belongs to exactly one station.
- `retired_sources`: records the provider no longer publishes, or that are no longer routed (a NOAA current that loses its flood or ebb direction). `npm run stations` moves a vanished record here, and back to `sources` if the provider publishes it again. A station whose every record is retired keeps its file and publishes no route, so its paths answer 404 but stay reserved for its water. More than ten records retiring in one run is more often a broken import, so `npm run stations` refuses it unless run as `STATIONS_RETIRE=1 npm run stations`.
- `redirect_from`: every path the station published and no longer uses. The database ships them as the route's `former_paths`, so consumers redirect them.
- `region`: the ISO 3166-2 code of the URL's region segment, absent when the path has none. The country is the file's directory. Every record in the station takes both, so a change in derived geography cannot move a URL. A CHS station is filed under `ca/` (Saint-Pierre under `pm/`); `npm run validate` refuses one anywhere else.
- `name`, `context`, `aliases`, `cities`, `position`: curated display fields. They apply to every record in the station, except in a station this repo owns (below), where they define the owned record.
- `position_verified: true`: the published position is right although the coastline audit puts it ashore, as for a gauge sited up a river.
- `tide_reference`: on a current station, the tide record a paired tide and current view shows beside it (see [Tide pairings](#tide-pairings)). The database publishes it as `current.tide_reference`.
- `provider`, `magnitude_note`, `derived`, `chs_fit`: a station this repo owns (below).
- `computed`: each record's position, coastline verdict and, for a provider tide record, its quality evaluation: whether it is accepted, why not, which record it duplicates, its score and the factors behind it. A change here in a pull request is a station that moved or a change in how it was judged.

## Changing a station

- **Rename or move.** `git mv` the file and add the old path to `redirect_from`. A published path never disappears and never changes hands. The one exception is a path that published the wrong gauge: `CORRECTED_PATHS` in [validate-database.ts](../packages/stations/validate-database.ts) lists each one with the record it names, and passes it only while it holds that record.
- **Same gauge, several records.** Move the record line into the station that publishes the gauge, add the absorbed station's path to `redirect_from`, and delete its file. Quality does not read station files, so each record keeps its own verdict and both can stay accepted. The station shows the record a merge names primary: an authoritative accepted record, else the best scored. Say why in a comment, citing the station documentation; matching names or nearby positions alone do not establish gauge identity, except for the CMEMS copies below.
- **New records.** `npm run stations` gives each record no station lists a station of its own, with a slug no station or redirect holds.
- **New relays of a gauge already published.** `npm run report:merges -w packages/stations` lists the stations that publish the same gauge. Confident merges join a relay that declares its originator (see [sources/ticon/provenance.ts](../sources/ticon/provenance.ts)), a relay quality marks as superseded by its operator's record, a CMEMS record within 50 m of the one record with its name, when their M2 agrees (CMEMS relays European agencies' gauges under a code cut from the place name, so nothing else says which), records sharing a TICON gauge code within 2 km whose M2 agrees, or a CHS record and the one provider station of its name within 1 km, or within 25 km when that station is a MEDS record, since MEDS numbers each gauge with the DFO station number IWLS publishes it under. The report lists the rest for review: records quality marks as duplicates by proximity alone, gauge codes shared farther apart or whose records' M2 disagree, a superseded relay quality points at a record other than its operator's, and a CHS record with two provider stations of its name, or one that is not MEDS 1 to 5 km away. No merge joins two authoritative records, or two CHS records. `npm run merge -w packages/stations` makes the confident merges, and `npm run merge -w packages/stations -- <slug>...` also merges the review groups whose surviving slugs you name. Each merged station keeps its CHS record's slug when it holds one, and otherwise the shortest slug that names its primary record, takes that record's country when its source is authoritative, keeps the curated fields of the station that held it, and keeps the comments beside every record and redirect. Check the curated fields `npm run merge` says it dropped and any country a station takes. `npm run validate` refuses a CHS station published apart from a provider record of its kind and name within 1 km, or a MEDS record of its name within 25 km, unless `SEPARATE_TWINS` in [merges.ts](../packages/stations/merges.ts) lists the pair with the reason it stays apart. No merge joins a pair it lists, and validate fails on an entry whose records share a route.

Run from the repo root after any change:

```shell
npm run stations
npm run validate
```

`npm run validate` fails when any station file is not what `npm run stations` would write. With `PUBLISHED_REF` set, it also fails when a path that ref publishes no longer resolves, or now belongs to a station that shares none of its records; CI sets it to the base branch on a pull request and to the last release before publishing:

```shell
PUBLISHED_REF=origin/main npm run validate
```

## Curation rules

`context` is whatever most usefully distinguishes this place: a water body, an island group, a region, a county, or a characteristic. It must never restate the name or consist only of a state or province abbreviation. Without one, a station takes the qualifier in its provider name, then the OpenStreetMap bay or strait it sits in, then the nearest place. A provider's state or province qualifier is skipped; without another qualifier, that station takes a mapped water or no context. When no water or distinct nearby place is known, context is absent. Curate `context` only where that answer is wrong or less useful.

`cleanName` undoes a provider's formatting and nothing more. A spelling that takes knowing the place is a `name` here, so that one station's spelling can never change another's. `npm run validate` reports the curated names the cleanup already produces, which is the list to prune when a provider catches up.

A redirect is for a path that named the _same place_: a rename qualifies, a mislabel does not, since redirecting a mislabel preserves a wrong link where a 404 is more honest (issue #6, the retired `anacortes`).

### Tide pairings

A provider current station's `tide_reference` names the nearest tide station in the same water, by any record that station publishes, and applies to every record in the current station. Say in a comment why it is the right gauge. A current with no honestly near tide station carries none: unpaired beats a wrong pairing. The rule for the gates this repo owns is under [Paired tide ports](#paired-tide-ports).

A pairing names a gauge, not a record, so the database publishes it as the record the tide station shows first. When quality later rejects the named record for its operator's record of the same gauge, as it rejected TICON's relay of Richmond for `noaa/9414863`, the pairing follows to that record and the file needs no edit.

## Stations this repo owns

A station with a `provider` holds a record this repo owns rather than corrects: the one source no provider supplies, such as `chs-victoria`. Its name is not a provider's name and its position is not a correction of a published one. CHS tidal-current gates are data like this: the fitting pipeline emits a hand-written label and no position at all. Owned ids match what chs-constituents emits ("chs-" plus the slug of the label), so a consumer can resolve straight from the id in its own output.

These are this project's own facts, not a copy of a provider's station file; [Provenance](#provenance) below records where each field comes from.

An owned station may also list provider records for the same water, as `victoria` lists the UHSLC relay: one page with the curated name and the provider's harmonics, rather than two pages a few hundred metres apart that neither holds the bare slug.

There are two bounded, hand-curated classes, told apart by kind:

- **Current gates** (`stations/current/`). A current station joins when safe transit requires timing slack: the gates on the Inside Passage route, not every interesting current.
- **Tide reference ports** (`stations/tide/`). A tide station joins when CHS itself designates it a reference port, an external rule this project did not invent. Probing the 47–51.5N, 126.5–122W box found exactly ten (chs-online design spec §6b). Positions are from CHS's public prediction-station list, matched by position and confirmed in water by the coastline audit, not the fitting pipeline that supplies the current gates. Display names are shortened where safe (the resolver keys on position, not name), contexts never restate the name, and aliases are what a local would type.

Both rules are expansion-friendly and rule-governed; neither is a cap. A consumer picks the right CHS series (currents or tides) by a station's kind.

Boundary Pass is not CHS: it is a NOAA current station, carried here because currents-vault, which curates the same gates, takes station identity from this repo.

### Paired tide ports

A fitted current gate (one with its own CHS current predictions) may carry a `tide_reference`: the owned tide port whose water a paired tide and current view shows beside it. The `tide_reference` is the _nearest_ tide reference port in the same tidal regime, chosen by position, not guessed. The two a mariner would double-check both match published secondary-reference practice: Seymour Narrows to Campbell River, and Sechelt Rapids (Skookumchuck) to Point Atkinson (Ports and Passes, Waggoner). A gate with no honestly near reference port carries none: unpaired beats a wrong pairing.

### Derived gates

A current gate CHS publishes no current station for carries a `derived` block: its slack is derived from a reference tide port's high and low water plus a fixed lag. `derived.reference` is that tide port; `high_water_lag_minutes` and `low_water_lag_minutes` are the minutes after its HW and LW that slack occurs. The pass floods on the rising tide and ebbs on the falling one, so a consumer states slack times and a flood or ebb phase, but never a speed: CHS predicts none. A derived gate carries only the reference and the two lags, and is mutually exclusive with `tide_reference`, which is a display companion where `derived` is the source of slack.

Whether an admitted gate's slack can be _predicted_ is a separate question, answered by its `chs_fit` block (below): Nakwakto is a real gate that no harmonic model fits (see openwatersio/slackwater-ios#9).

### Fitted gates

A fitted current gate carries a `chs_fit` block: the tier its year of held-out CHS predictions earns for the recipe the app fits on the device. The scores come from the [chs-current-validation releases](https://github.com/openwatersio/chs-current-validation/releases), by the rules in the [spec](https://github.com/openwatersio/slackwater-ios/issues/752#issuecomment-6339459207). Each tier carries exactly its own fields:

- `tier: final` ships plain numbers. `days` is the fitting window, 60 or 210. A 210-day gate may carry `provisional_slack_minutes`, the slack bound quoted while its 60-day fit stands in for the full model.
- `tier: bounded` ships a measured slack bound. `days` is the window and `slack_bound_minutes` is the bound, 35, 40 or 45. A 210-day gate may also carry `provisional_slack_minutes`, at least its `slack_bound_minutes`.
- `tier: online` ships the online predictions. `miss` holds the `clause` the gate fails and its `value`, or `null` when there was nothing to measure. The value is in the clause's unit: the percent of CHS extrema in the worst week where the fit's velocity had the wrong sign for `reversed_axis`, slacks over the year for `invented_slack` and `missed_slack`, minutes for `slack_worst`, `slack_median` and `extremum_timing`, and knots for `peak_speed`. `miss.near_bar: true` marks a gate that passes every bar in its newest and previous years, but not yet by the promotion margin, so the stability rule keeps it online.

A gate with no `chs_fit` and no `derived` block is unmeasured and ships online. `evidence` is the tag of the results release the values come from, and it must be the newest snapshot in `metadata/chs-current-validation/` of its recipe stamp (the hash in the tag) that lists the gate. The files cite one recipe stamp at a time: a new stamp is a new target the apps may not ship yet, and every gate is curated afresh on it, so one PR moves them all and `validate` fails on a mix. Within a stamp, tags order by fit end, then run number. CI warns when the cited release is more than 45 days old, when a newer release of the stamp exists, or when another stamp has newer results (`npm run report:chs-fit-age -w packages/stations`). `npm run validate` compares each block with that snapshot and fails on any difference, on a gate that cites an older snapshot, and on a measured gate whose file has no block. A value changes only by a PR that cites a newer results release, with its snapshot fetched by `npm run refresh:chs-fit -w packages/stations -- <tag>`. A gate a cited snapshot measured must keep its block: deleting one fails `validate`.

`chs_fit.miss_context` is a curated field on an online gate whose water explains the miss. It comes from a fixed set so the app can translate it: `rapids`, `tidal_falls` or `slow_reversal`. It is not in the snapshot, so a comment above it says it is curated.

### The rest of Canada

CHS publishes tidal currents at exactly 30 stations nationally, and twenty are here. This survey records how the gate rule decided the stations outside the Inside Passage, so the next person does not re-run it, and so nobody "discovers" a missing station and adds it back without the reason.

**Admitted:** Nakwakto Rapids, Quatsino Narrows, Masset Sound, Great Bras d'Or. Each has a published instruction to transit on slack.

**Rejected**, because a current station exists but nothing times a transit on it:

| Station               | Why                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scott Channel         | Sailing Directions: "deep and free of dangers". Tide rips on a headland rounding, not a gate. Cruisers round Cape Scott on Nahwitti Bar's slack instead.                                                                                                                                                                                                                        |
| Hiekish Narrows       | No slack caution in PAC 205, and it is the optional east branch: Tolmie Channel is the Inner Passage route. VTS only asks you to advise if transiting.                                                                                                                                                                                                                          |
| Grand Manan Channel   | ATL 106: "no dangers in the fairway". Also discontinued as a station. Head Harbour Passage nearby does run to 5 kn, but CHS predicts no current there, so there is nothing to admit.                                                                                                                                                                                            |
| Abegweit Passage      | 2.0 kn under the Confederation Bridge, across 5.5 miles of navigable width. ATL 108 gives no stream rate and no slack advice at all. The widely copied "4 knots" is Wikipedia, roughly double CHS.                                                                                                                                                                              |
| Fairview Terminal     | A container berth on Kaien Island. A temporary station feeding Prince Rupert's pilotage instrumentation: berthing data, not a passage.                                                                                                                                                                                                                                          |
| Porpoise Channel East | The near miss, and the one worth reading before re-adding it. There is a published HW-slack rule for Porpoise Harbour, and Pub 154 does say 6–7 kn, but that is an under-keel-clearance window for loaded ships at the Ridley-Lelu narrows, and this station sits east of that pinch, where CHS predicts 2.0 kn. A gate whose station is not on the gate is worse than no gate. |

## Provenance

The stations this repo owns are its own factual registry of tide and current stations, independently authored and reviewed field by field. Contributors obtain and verify each fact from charts, gazetteers, fitting output, direct observation or other documented sources, then write the station file. Provider records enter the database through their own documented import pipelines under `sources/`, not through this registry, and agreement with a provider coordinate does not replace independent authoring and review.

**Never redistribute a provider station export or include a provider-minted identifier.**

Where each field of an owned station comes from:

- `name`: a hand-written label. Renaming and re-casing a shouting provider name (`CHERRY POINT` to `Cherry Point`) is original editorial work, reviewed by a person.
- `magnitude_note`: the CHS figures or Sailing Directions the file's comment cites.
- `chs_fit`: the results release its `evidence` names. Its `miss.value` is an error statistic measured against CHS's predictions, not CHS data.
- `context`, `cities`, `aliases`: written here; not present in provider data.
- Kind (`stations/tide/` or `stations/current/`): this project's editorial classification against the membership rules above, not a field copied from a provider.
- `tide_reference` and `derived.reference`: an editorial pairing. The nearest tide reference port in the gate's tidal regime, chosen from the positions in these files and, where one exists, confirmed against published secondary-reference practice. Both sides are this repo's own ids, never a provider handle.
- `position`: independently derived and verified by a person. Current-gate positions come from the chs-constituents fitting pipeline and currents-vault pass frontmatter, cross-checked against chs-constituents/stations/salish-sea.json. Tide reference-port positions come from CHS's public prediction-station list, matched by position and confirmed in water by the coastline audit. Both are a hand-picked set of factual coordinates that agree with CHS, not a copy of a CHS station export. This is about authoring: how a person sourced a coordinate once.
- Provider id: deliberately absent. An owned record carries no provider-minted identifier, not even as a reference. A station file may also list provider records beside it (a TICON relay of the same gauge, say); those belong to an imported dataset under its own licence, not to the owned record. Whoever holds a licence to a provider's API resolves its opaque handle at runtime, and the handle never enters this repository. A consumer joins an owned station to live data by name or by position: `signalk-currents` folds the name, with `aliases` covering a provider rename, and `slackwater-web` takes the position within 3 km and lets a name mismatch warn but not gate. Both are safe only after filtering the provider's list to the series wanted: CHS publishes a current station and a tide gauge both named "Porlier Pass", and another pair named "Seymour Narrows", and the tide station Duffus Point sits at the same coordinates as the Big Bras D'Or current station. Inside a series-filtered list both keys resolve every gate uniquely.

The names, contexts and positions are this project's work, and the one field that would point into a provider's system is the one it does not ship.

`sources/chs/stations.json` is an import pipeline, not part of this registry. It lists every live CHS tide station the registry does not own, with a name, aliases and position for each; it carries no IWLS station code, constituents, datums or predictions, and a consumer resolves the IWLS code at runtime by position. Its ids are the ones Slackwater iOS ships, because devices key fitted models by them, and they stay stable across IWLS refreshes by position and then by name (see [sources/chs/README.md](../sources/chs/README.md)).

Every owned station is reviewed by a person before it lands. Release validation audits positions against the coastline and records each in the station's `computed` block, so a moved position shows in the diff. That review is what turns overlapping facts into this project's own verified work. When adding or correcting an owned station:

- Do not paste a row from a provider's station export. Obtain the name, context and position independently and write them yourself.
- Do not add a provider id. A workflow that needs the provider's handle resolves it at runtime under its own licence.
- When a station's facts come from somewhere other than the sources above, say where in a comment in its file, as Boundary Pass does.

Reference data the build derives fields from (GeoNames places, OpenStreetMap water bodies, Marine Regions maritime zones) and the pinned UHSLC relay metadata are described in [metadata/PROVENANCE.md](../metadata/PROVENANCE.md).
