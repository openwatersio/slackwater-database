# Packaging Stillwell's fitted constituents

slackwater-database ships TICON-4's harmonic constants for most of its stations, with datums reduced from GESLA-4. Both carry errors we keep finding: local time labeled as UTC, records filed under the wrong gauge, swapped constituent definitions, and Sa and Ssa fitted to river flow. Both also lag their originators by a year or more. [Stillwell](https://github.com/openwatersio/stillwell) holds originator records for most of TICON's contributors, in UTC, flagged, with datum epochs and per-station licenses, and fits harmonic constants from them. This plan covers slackwater-database's side: reading those fits, deciding which ship, and packaging them in the database.

## The split

Stillwell's [decision 7](https://github.com/openwatersio/stillwell/blob/main/docs/plans/plan.md#decisions) divides the work:

- **Stillwell fits and measures.** It decides which values a fit reads, runs the fit, scores it on a held-out year and publishes every fit with its measurements, including fits nobody would ship. It sets no threshold for publishing and doesn't round. [Harmonic fits](https://github.com/openwatersio/stillwell/blob/main/docs/fits.md) describes the method and its references: what a fit reads, the window, the least-squares fit with nodal corrections in the design matrix, robust weights, the candidate list in [`src/fit/candidates.ts`](https://github.com/openwatersio/stillwell/blob/main/src/fit/candidates.ts), the Rayleigh and SNR rules, Sa and Ssa, the yearly scatter, the nodal correction family and the held-out scores. The work is Stillwell's [phase 6](https://github.com/openwatersio/stillwell/blob/main/docs/plans/plan.md#phase-6-fits-from-the-store) and its HRoI track.
- **slackwater-database decides what ships.** It reads the fit files and no observations, and keeps its own gates on range and quality, the gate against TICON on the held-out scores, merges, IDs and links, the license vocabulary, the choice of chart datum, constituent definitions in the database format, and the TCD export.

Where Stillwell or [`@slackwater/engine`](https://github.com/openwatersio/slackwater) falls short, the fix goes there, as an issue or a pull request with the evidence, and slackwater-database waits for it or works on other gauges meanwhile. A workaround here comes only when the upstream project can't fix it, and it names the issue that explains why.

## What the database reads

Two files per source in Stillwell's public store, defined in [`src/store/files.ts`](https://github.com/openwatersio/stillwell/blob/main/src/store/files.ts) and described in the [files reference](https://openwatersio.github.io/stillwell/docs/reference/files/). They join on `id` and `version`.

- **`fits/<source>.parquet`**, one row per station Stillwell tried to fit. It holds the window (`since`, `until`, `hours`, `years`), the mean level `z0_m`, the nodal correction family (`node_corrections`), the fitting engine and version (`engine`), the held-out year and its scores (`held_out`, `held_out_rms_m`, `variance_explained`, the band RMS and the high and low water differences), `mean_range_m`, which values counted as final, and the year files read (`inputs`). A station Stillwell couldn't fit has a row with a `reason` and no constants. The importer reads `fitted` and `reason`, and never infers a missing fit from a missing row.
- **`constituents/<source>.parquet`**, one row per fitted station and candidate. It holds the constituent's `name`, `doodson` numbers and `speed`, whether it was `kept` and if not why, the amplitude and phase with their intervals, its `snr`, and the yearly scatter.

License, commercial use and attribution come from the station's row in `stations.parquet`, joined by `id`. A fit is under its station's terms.

The store answers 403 to a request without a project User-Agent. Every reader here sends one.

## Constituent definitions

A harmonic constant means something only with the definition it was analyzed under: its Doodson numbers, its phase constant, and its nodal correction. Prediction has to use the same one. A name alone doesn't fix it, since names take their meaning from whatever the engine's catalog says when the prediction runs, and the same name means different lines at different agencies.

So the database carries definitions ([#238](https://github.com/openwatersio/slackwater-database/issues/238), [database format](../database-format.md#constituent-definitions)):

- A shared table of definitions: for each catalog line the file uses, its speed, Doodson numbers and phase constant, and the members its nodal correction combines, with the other spellings the file uses as aliases. The build copies these from the engine's catalog.
- Each source can replace a shared definition or add a name, for its own stations only, and declares the nodal correction family its constants were analyzed with, in its `metadata.yaml`. TICON's M3, S3, T3, SGM, R3, 3L2, 2MK5 and 2MO5 sit on the engine's lines but against a different equilibrium argument (#239), and TICON-4's manual swaps MKS2 and 3N2 (#76, [slackwater#359](https://github.com/openwatersio/slackwater/issues/359)). NOAA's constants take Schureman's corrections and Kartverket's take Foreman's ([#447](https://github.com/openwatersio/slackwater-database/pull/447)).
- Phases are stored as the source published them, referred to UTC (Kartverket's also out of Terrestrial Time), against the source's own definition. TICON's eight offsets become TICON definitions, and `TICON_ARGUMENT_OFFSET` goes away. Kartverket's `SA`, `S1` and `OQ2` become Kartverket definitions under those names rather than `SA_KV`, `S1_KV` and `OQ2_KV`, so those entries can leave the engine's catalog. The `SA_KV` special case in the seasonal checks goes away, and `sources/ticon/README.md` and `sources/kartverket/README.md` describe the definitions instead.
- The engine predicts from the definitions it is given, with its catalog as the default ([slackwater#531](https://github.com/openwatersio/slackwater/pull/531)).

Stillwell's fits add these requirements:

- **The family comes from the fit row.** Stillwell fits use Schureman's corrections today, and decision 7 allows fits under another family beside them later. A record takes its family from the row's `node_corrections`, not from a constant in the importer. The family is one per fit, and the database declares it per source, so the importer refuses a source whose rows name more than one family until the format can carry it per record.
- **Lines match by Doodson numbers and speed, not by name.** Two names can share one line and differ only in their nodal correction: NO1 and M1, MO3 and 2MK3. The importer resolves each kept constituent to a definition by its `doodson` and `speed` columns, then by name among the definitions on that line, and refuses a constituent with no matching definition.
- **M1 needs its own correction.** Under Schureman, M1 takes eq. 196's correction, with Doodson numbers that include lunar perigee. The definitions in #238 can't carry that today. Until they can, a record with M1 needs a pinned engine, and Stillwell's fits with M1 don't ship. Extending the definitions to carry it is part of #238.
- **2MK3 is defined by its members** (M2, M2 and K1), which t_tide and UTide call MO3 with a different correction.

The shared table alone changes no prediction. A source with its own definitions or nodal family changes predictions for any reader or app that ignores them, and the format version can't refuse those, since no released reader checks it yet. So this lands in two steps. First the format and readers: the tables and the readers in JavaScript, Swift and Kotlin, with no source using them yet. Then, once the apps ship those readers and pass each station's definitions and nodal family to their predictions, the data: TICON's, Kartverket's and NOAA's definitions, Stillwell's fits, and everything in this repo that resolves constituents by name moved onto the definitions: `packages/tcd`, the seasonal checks in `packages/stations/filtering.ts` and `evaluate-quality.ts`, `packages/stations/lat-hat.ts` and `validate-datums.ts`, and `packages/datums` (`datum.ts` and `observations.ts`).

## Goals

- Constants at least as good as TICON's at every gauge where we publish Stillwell's fit, and better wherever the record allows, shown on a held-out year the fit hasn't seen.
- Coverage TICON lacks: originator gauges it never had, Baltic and river gauges it drops, and records that have grown since GESLA-4 was cut.
- Each published station says what it was fitted from, which constituents it has, and how well it scored. IHO Resolution 1/2019 asks for the constituent list and the analysis period with any prediction ([IHO TWCWG](https://iho.int/uploads/user/Services%20and%20Standards/TWCWG/TWCWG5/TWCWG5_2020_3.2.1_EN_IHO_Reslution_1-2019_v1.0.pdf)).
- TICON becomes a fallback, and then a comparison, as each contributor converts.

## Non-goals

- Shipping gauges with no tide to speak of. Stillwell fits them anyway, and the gates here leave them out. NOAA predicts no tides on the Great Lakes, and the 2 cm tidal range gate in [quality-evaluation.md](../quality-evaluation.md) isn't enough by itself there: seiches and seasonal swings let a lake gauge such as Cobourg clear it by millimeters.
- Replacing constants an agency publishes itself, for now. NOAA, Kartverket, JMA and the rest stay as they are, and Stillwell calibrates its fits against them. Where calibration shows a fit beats an agency's published constants on held-out observations, for instance where NOAA's analysis is decades old, replacing them becomes worth considering later.
- Reading observations. Anything that needs them, such as a residual report or a clock check, runs in Stillwell.

## What ships

One importer, `sources/stillwell`, turns fit rows into station records. A source's differences live in its `metadata.yaml` and a small profile, never in code paths.

- **Gates on the fit's measurements.** The quality evaluation's existing gates apply, read from the fit row where they can be: the tidal range gate from `mean_range_m`, and the constituent checks from the kept rows. A gate this repo adds, such as one on `variance_explained` or on the yearly scatter, is set here with its evidence, since Stillwell publishes no threshold.
- **The gate against TICON.** A fit replaces TICON at a gauge when it scores no worse on the held-out year than every TICON record of that gauge, beyond the measurement error, under the `decideHeldOut` and `scoresWorse` rules (see [Code to reuse](#code-to-reuse)). Stillwell scores this repo's records on the fit's held-out year, from a pinned `@slackwater/database` release, with a digest of the constants it scored ([stillwell#658](https://github.com/openwatersio/stillwell/pull/658)). The verdict stays here. TICON stays where a score was taken against constants that have since changed, and where the measurement error can't be measured, since an unmeasured error must not let any fit win. Where TICON's record covers the held-out year, its score stands but is marked as seen: the year favors TICON, so a fit that still wins replaces it, and one that loses doesn't. The held-out result decides between the two, not the quality score's source factor: on `main`, a record whose source isn't in `SOURCE_PRIORITY` ranks below most of TICON's relays of the same gauge. A gauge with no TICON record publishes when its fit passes the gates above.
- **Precision.** Stillwell publishes unrounded values. The importer stores amplitudes at 1 mm and phases at 0.01°, as `dmi` does, with its own `PUBLISHED_PRECISION` entry. A kept constituent that rounds to 0 mm isn't stored.
- **Disclaimers.** A gauge with large yearly scatter in M2, S2, K1 or O1 is river-influenced or changing, and gets a disclaimer. A gauge whose Sa and Ssa yearly standard error is large against the tidal range gets the seasonal label and a disclaimer.
- **Datums** come from Stillwell's fit: observed datums reduced from the same series, and HAT and LAT synthesized over the epoch this repo pins (`DATUM_EPOCH`, 2007 through 2025), as Stillwell's phase 6 plans. The fit files carry no datums yet, and the database reads no observations, so fits wait for them. Which datum is a station's chart datum, by country and by sea, stays here.
- **Names and positions** come from Stillwell's `stations.parquet`, the originator's own, rather than TICON's. That fixes the misspelled and inconsistent German and Swedish names (#344, #345) and the UHSLC gauges TICON puts in the wrong place (#374, #375) at every gauge that converts.
- **The record** keeps the Stillwell source, id and fit `version`, the window and held-out year, the nodal family, the engine that fitted it, and the held-out scores it shipped on. Re-reading that version gives the same constants.
- **IDs** match Stillwell's: `<source>/<source id>`, such as `pegelonline/9340030` and `smhi/2069`, with the source id encoded as Stillwell encodes it in file paths, so an id with a `/` can't become a directory. The quality evaluation reads a fit's source from the record, not from the text after the id's last `-`, which would match a `SOURCE_PRIORITY` key for an id such as `…-wsv`. A station's ID then names the series it was fitted from, and the link to Stillwell (#402) is the ID itself. Some source names already have data directories here, keyed by the agency's own codes: `kartverket`, `jma` and `dmi`. Fits for those sources aren't written there. If one ever ships, it needs an ID that can't collide with the existing record, and that's decided then.
- **Links** run both ways: records carry their Stillwell series ID (subordinate stations take their reference gauge's), `@slackwater/database` exposes it, and Stillwell's `tide_station` is filled from the same table (#402).
- **Merges.** A fit joins the station of the TICON records it replaces, through the gauge Stillwell links them to, not by proximity. They count as the same gauge only where Stillwell's level comparison in `stations/matches.parquet` finds their levels agree within 1 cm with no lag. Those TICON records stay in the station as duplicates and keep their old paths as redirects. `report:merges` reviews the result for every contributor that converts.
- **Licenses** come from the station's `license` and `commercial_use` in `stations.parquet`, mapped onto the database's license vocabulary, with Stillwell's own CC BY 4.0 over them. Stillwell's identifiers such as OGL v3 and Etalab 2.0 get entries in `LICENSE_NAMES` and the TCD restrictions. A license missing from `LICENSE_NAMES` drops the attribution notice silently, and one missing from the TCD restrictions throws, so the importer refuses a license that isn't in both. A source's `sources/<source>/metadata.yaml` credits the originator and Stillwell and marks the source `authoritative: false`, since the constants are Stillwell's analysis, not the agency's. Credit is one line per source today, so a fit whose inputs need more, such as UHSLC's per-contributor credits, needs a per-record credit in the schema first, and those gauges wait for it. That per-record credit is the chain of custody in #53, and it's how UHSLC gets the credit #376 asks for. A fit from a series that isn't cleared for commercial use ships as non-commercial, like the record it replaces. Where TICON's copy is cleared and the originator's isn't (UHSLC's four withheld contributors, JODC, BOM), TICON's constants stay until the originator agrees. Stillwell keeps fits from restricted series in its restricted store until the operator agrees, and this repo reads only the public store.
- **The TCD export.** Every kept name must resolve in `@slackwater/engine` and in the TCD's constituent table. libtcd holds at most 255 constituents across the whole file, and nothing counts them before the TCD compile, so `npm run validate` gains a check that fails when the union of every station's names would pass that limit. High-order compounds are also why qtVlm can't load our TCD (#106). A TCD file holds one table of node factors and equilibrium arguments per constituent, shared by every station, and `packages/tcd` computes them with the engine's IHO corrections. A source under Schureman's family exports with those IHO tables unless its constituents get entries of their own, which count against the 255. #447 decides which, for NOAA and Kartverket first.

## HRoI

HRoI predicts high and low waters directly, as corrections to their mean times and heights after each lunar transit. It is BSH's method for the German coast ([Müller-Navarra 2013](https://www.bsh.de/DE/PUBLIKATIONEN/_Anlagen/Downloads/Meer_und_Umwelt/Berichte-des-BSH/Berichte-des-BSH_50_de.pdf); [Boesch and Müller-Navarra 2019](https://doi.org/10.5194/os-15-1363-2019)). Stillwell fits it at German and Dutch gauges on the North Sea and its tidal rivers, under its [HRoI track](https://github.com/openwatersio/stillwell/blob/main/docs/plans/plan.md#hroi-track) ([stillwell#664](https://github.com/openwatersio/stillwell/pull/664)), and publishes it without a gate. Fitted to observed levels at six Dutch gauges, it had the lowest event-time error of any method, 7.5 to 9.2 minutes at Vlissingen and Bath against 10 to 13 for the harmonic fit ([hroi-evaluation.md](https://github.com/openwatersio/stillwell/blob/main/docs/hroi-evaluation.md)).

This repo's side:

- An HRoI table on a station in the database format, and support for it in `@slackwater/engine`, which moves the curve's extremes onto HRoI's events.
- A set of harmonic constants on every HRoI station, so readers that predate the table, and the TCD export, still predict.
- The gate: HRoI ships at a gauge when its held-out event-time RMS beats the harmonic fit's by more than the measurement error. BSH's tables are a comparison, never training data, under BSH's terms (#335).
- The rank of a PEGELONLINE fit against TICON's record of the gauge.
- A release order of engine, apps and then database.

## Operations

- **Monthly update.** Stillwell's Monthly job refits a gauge when a year file it read gets a new version or its record grows by a year ([stillwell#659](https://github.com/openwatersio/stillwell/pull/659)). The importer here runs monthly too, pins the fit version of each record, and opens its update as a pull request to review, as the NOAA import does.
- **Review.** `report:merges` goes with every PR that changes Stillwell-fitted data.
- **Residual report.** Stillwell's monthly residual report covers every station with constants, ours included, through `tide_station`. A finding that points to wrong constants in a TICON record comes back here.

## Code to reuse

The closed PRs that fitted inside this repo carry the decision half of this plan. Their fitting, scoring and Stillwell reader moved to Stillwell (`src/fit/`), and these pieces carry over:

| Piece                                                                                                             | Where                                                                                                   | Goes to                                                   |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| The held-out verdict: measurement-error margin, distance bound, constants digest (`decideHeldOut`, `scoresWorse`) | `packages/stations/evaluate-quality.ts` and `filtering.ts` on `claude/stillwell-importer-61ec81` (#450) | [What ships](#what-ships), the gate against TICON         |
| Merging a fit into the station of the TICON records it was scored against (`planMerges`)                          | `packages/stations/merges.ts` on the same branch                                                        | [What ships](#what-ships), merges                         |
| Mapping Stillwell's license ids onto the database's, most restrictive input first (`LICENSES`, `fitLicense`)      | `sources/stillwell/record.ts` on the same branch                                                        | [What ships](#what-ships), licenses                       |
| Building a record and its Stillwell provenance (`buildRecord`, `StillwellProvenance`), and the schema fields      | `sources/stillwell/record.ts` and `schemas/station.schema.json` on the same branch                      | The importer                                              |
| SMHI and PEGELONLINE source metadata and credit                                                                   | `sources/smhi/metadata.yaml` and `sources/pegelonline/metadata.yaml` on the same branch                 | The importer                                              |
| Names and positions from Stillwell metadata, curated German gauge names                                           | `sources/water-levels/lake.ts` and `stations/tide/de/` on `feat/wsv-lake-fits`                          | The importer                                              |
| TICON records fitted from another gauge's data (`MISFILED_RECORDS`, Uddevalla)                                    | `packages/stations/filtering.ts` on `feat/wsv-lake-fits`                                                | Quality evaluation; the data error also goes to Stillwell |

The branch's fitting, its reader of observations, its erratum decisions and its settle cutoff don't carry over: Stillwell's flags and each source's `settles_after_months` decide what a fit reads.

## Needs from upstream

From Stillwell:

- Scores of this repo's records on each fit's held-out year, with digests and what `decideHeldOut` needs to measure the error of a score difference ([stillwell#658](https://github.com/openwatersio/stillwell/pull/658)).
- Observed datums, and HAT and LAT over `DATUM_EPOCH`, on the fit rows.
- A level comparison in `stations/matches.parquet` for every linked pair. 142 linked pairs of PEGELONLINE and GESLA series have none, so those fits can't be merged with TICON's records of the gauge.
- Calibration against NOAA's ([stillwell#662](https://github.com/openwatersio/stillwell/pull/662)), Kartverket's and JCG's published constants, and against RWS's astronomical tide and BSH's tables, before a source ships here.
- `tide_station` links, filled from the same table this repo records (#402).
- The filter behind any source's hourly values and where each value is stamped in its interval, as source metadata. A one-hour mean stamped at the start of its hour is 30 minutes early, 14.5° of M2, and scales M2 by 0.989, which at Cuxhaven's 1.5 m M2 is 16 mm. Stillwell's fits don't correct for it yet, so sources with such values (UHSLC, some GESLA contributors) wait here until they do.
- An explanation for every year GESLA holds that the originator series lacks (#400): not yet backfilled, outside the originator's archive, or dropped by QC.

From `@slackwater/engine`: prediction from definitions a database gives, with each one's nodal family, M1's Schureman correction among them, and HRoI's model and prediction.

## Related issues

Parts of this plan:

| Issue                                                    | Where it goes                                                       |
| -------------------------------------------------------- | ------------------------------------------------------------------- |
| #399 Re-fit the remaining TICON contributors             | Contributors convert through Stillwell's fits, in the order of work |
| #400 Combine series year by year                         | Stillwell: why originator series lack years GESLA holds             |
| #401 Monthly report of predictions against observations  | Stillwell's residual report                                         |
| #402 Link tide stations and Stillwell series both ways   | [What ships](#what-ships), IDs and links                            |
| #403 Record which series and gauge zero datums come from | [What ships](#what-ships), datums from the fit                      |
| #404 Re-fit stations each year                           | [Operations](#operations), monthly update                           |
| #238 Let each source define its own constituents         | [Constituent definitions](#constituent-definitions)                 |
| #447 Nodal corrections per source (PR)                   | [Constituent definitions](#constituent-definitions)                 |
| #53 Full chain of custody                                | [What ships](#what-ships), licenses and credit                      |
| #106 qtVlm can't load our TCD                            | [What ships](#what-ships), the TCD export                           |
| #146 Updating to GESLA 4.1                               | Stillwell's GESLA source is 4.1 with its clock fixes                |
| #408 Fill short data gaps in datums (PR)                 | Its method moves to `@slackwater/datums` (slackwater#570)           |

Sources whose fits come through Stillwell, once it carries them under terms that allow it:

| Issue                                                           | Status here                                                                                                                                                                                            |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| #148 Expand tide-height coverage                                | Parent of the source issues below                                                                                                                                                                      |
| #138 UHSLC hourly data                                          | Waits on per-record credit, the hourly filter metadata and UHSLC's commercial terms ([stillwell#80](https://github.com/openwatersio/stillwell/issues/80))                                              |
| #124 IOC Sea Level Station Monitoring Facility                  | Restricted, so it needs IOC data in Stillwell's restricted store and VLIZ's agreement first ([Stillwell decision 8](https://github.com/openwatersio/stillwell/blob/main/docs/plans/plan.md#decisions)) |
| #324 Re-derive CMEMS stations under Copernicus Marine's licence | Copernicus Marine becomes a Stillwell source request                                                                                                                                                   |
| #152 Rijkswaterstaat tide heights                               | RWS fits and HRoI from Stillwell. RWS's own constants, if it publishes them, would still come first                                                                                                    |
| #380 Dutch gauges with no usable record                         | Ship once RWS's history back to 1990 is in Stillwell and fitted                                                                                                                                        |
| #154 Marine Institute tide heights                              | Fits from Stillwell, at gauges whose predictions are harmonic                                                                                                                                          |
| #335 BSH tide heights                                           | BSH's tables are a comparison and HRoI's reference, never training data                                                                                                                                |

TICON records with known faults, fixed at each gauge when its originator's series converts:

| Issue      | Gauge and fault                                                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| #290       | Apia's old UHSLC record runs two hours late                                                                                          |
| #289       | Settlement Point's UHSLC record points at the wrong station                                                                          |
| #355       | Koper and Andratx (CMEMS relays) publish almost no tide. Their originators aren't in Stillwell yet, so they're source requests there |
| #374, #375 | UHSLC gauges in the wrong place                                                                                                      |
| #344, #345 | Misspelled and inconsistent German and Swedish names                                                                                 |
| #376       | UHSLC isn't credited                                                                                                                 |

## Order of work

1. Constituent definitions in the database format and readers (#238), with each source's nodal family (#447), M1's correction and matching by Doodson numbers. Then the data step for TICON, Kartverket and NOAA once the apps pass definitions.
2. `sources/stillwell` on SMHI: read `fits/` and `constituents/`, the gates, precision, IDs, names, links, licenses and credit, and the schema fields for the fit's provenance, with the docs they change (`CONTRIBUTING.md`, `docs/database-format.md`, `docs/quality-evaluation.md`). SMHI's fits ship once Stillwell publishes their datums. At gauges with a TICON record, they also wait for step 3.
3. The gate against TICON and merges, from stillwell#658's scores and `stations/matches.parquet`.
4. PEGELONLINE, then the remaining contributors in the order of Stillwell's [TICON replacement inventory](https://openwatersio.github.io/stillwell/reports/ticon-inventory/), each after Stillwell calibrates its source.
5. The monthly import as a pull request.
6. HRoI in the format and the engine, then at the German and Dutch gauges.

## Open questions

- Whether a gate on `variance_explained` or the yearly scatter is needed beyond the range gate, and where it sits.
- Whether the TCD export keeps only the constituents XTide's set knows, so qtVlm can load it (#106), or keeps every constituent the database has.
- Whether slackwater#241 lands before or with the data step of the format change.
- Whether the engine moves extremes onto HRoI's events, or HRoI publishes its own event list beside the curve.
