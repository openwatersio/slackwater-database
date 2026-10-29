# TICON-4 Tide Station Data

[TICON-4](https://www.seanoe.org/data/00980/109129/) is a global dataset of tidal harmonic constituents derived from the **GESLA-4** (Global Extreme Sea Level Analysis v.4) sea-level gauge compilation. It provides tidal characteristics for **4,264 tide stations** worldwide, with emphasis on global coverage outside the United States (which is covered by NOAA's tide database).

**Key Details:**

- **Source:** [TICON-4 @ SEANOE](https://www.seanoe.org/data/00980/109129/)
- **Manual:** [TICON Documentation](https://www.seanoe.org/data/00980/109129/data/122852.pdf)
- **License:** CC BY 4.0 ([Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/)), which permits redistribution, including commercially, with attribution
- **Citation:** Hart-Davis, Michael; Dettmering, Denise; Seitz, Florian (2025). _TICON-4: TIdal CONstants based on GESLA-4 sea-level records._ SEANOE. https://doi.org/10.17882/109129
- **Coverage:** Global tide stations with harmonic constituent analysis from GESLA-4 observations

Anything redistributing these stations has to carry that citation. See [Attribution](../../README.md#attribution) for the lines to use and what this project changes.

Each station in this dataset contains harmonic constituents (amplitude and phase for tidal frequency components such as M2, K1, O1, etc.) extracted from historical sea-level records.

![](https://www.seanoe.org/data/00980/109129/illustration.jpg)

## Tidal Datums

TICON-4 does not publish tidal datums, so we derive first-reduction estimates from the original GESLA-4 water-level measurements using NOAA CO-OPS datum definitions ([Computational Techniques for Tidal Datums Handbook](https://tidesandcurrents.noaa.gov/publications/Computational_Techniques_for_Tidal_Datums_handbook.pdf)). See [docs/datums.md](../../docs/datums.md) for datum definitions, the pinned 19-year datum epoch, and how `chart_datum` is selected per country.

- The water-level record is binned to hourly heights. Bounded gaps of up to three missing hours are reconstructed from the harmonic tide plus a cubic fit to four real residual anchors, matching each bin’s actual sampling-time moments. Longer or unsupported gaps remain missing. See [the preparation rules](../../docs/datums.md#datum-epoch).
- **MSL, MHHW, MHW, MTL, MLW, MLLW** use one continuous observation window: the longest whole-year window of complete UTC months in the most recent ≤19 years, with at least twelve months and the latest window winning equal-length ties. Each high-water and low-water pair shares its eligible complete tidal days; MSL is the mean of all hourly heights in that period, including inferred heights. The values remain in the gauge's native frame.
- **HAT, LAT, LLWLT, TLT** are astronomical extremes ([IHO definition](https://iho.int/uploads/user/pubs/standards/m-3/M-3_e3.3.0_Repertory_Aug20_2020_FINAL.pdf)) and **MHWS, MLWS, NLLW, ALLW** are amplitude-derived — all taken from the harmonic side rather than observations, since observed extremes include storm surge. They are predicted over the pinned datum epoch in the constituent frame (MSL = 0), then shifted into the observed gauge frame by adding the observed MSL.
- Country-specific datums are pruned and `chart_datum` is assigned during import per the country policy in [docs/datums.md](../../docs/datums.md).

UHSLC research-quality records (`uhslc_rq`) are reduced from the live [UHSLC hourly Research Quality Data](https://uhslc.soest.hawaii.edu/erddap/tabledap/global_hourly_rqds.html) instead of GESLA-4 when that record runs later than its GESLA-4 copy. It is the same record on the same station zero, so the datum frame does not change. Downloads are cached in `tmp/UHSLC/`; delete that directory to pick up newer UHSLC releases. UHSLC asks users to cite the center and publishes its data without warranty; see the [UHSLC data information page](https://uhslc.soest.hawaii.edu/datainfo/).

Each station records the frame of its stored datum values in `datum_frame`: `gauge` for an observed or calendar-balanced gauge offset, including a measured offset of zero, and `constituent` when no supported gauge offset is available. This identifies the kind of zero, not a geodetic datum or a cross-provider gauge-zero relationship. Observed reductions also store `datum_coverage` (`months`, `observed_hours`, `inferred_hours`) for the selected window. These count hourly bins, not individual sub-hour measurements. Regular three-hour records can have about two-thirds of their bins inferred; the method label does not imply fully measured hours. Harmonic fallbacks omit that coverage because they have no observed reduction period. The reduction method is recorded independently in `datums_source`: `observed` when the prepared water levels support that continuous window, or `harmonic` otherwise. The harmonic fallback estimates a gauge offset from complete prepared months covering all twelve calendar-month categories, averaging the category means with equal weight. The months can come from different years. Missing any category leaves the fallback in the constituent frame (MSL = 0); a partial-season raw mean is never used. The station's `disclaimers` identify the method and higher fallback uncertainty. The `epoch` field always describes the TICON constituent fit. The separate `datum_epoch` field describes the selected observation period for `observed` means. It is omitted for harmonic fallbacks, which can mix the pinned prediction period with a calendar-balanced observation gauge estimate from non-contiguous months; the disclaimer distinguishes an observed offset from an unsupported offset (MSL = 0). Quality ranking uses the fit period, so a gap in water-level coverage does not shorten the stated harmonic analysis.

These are first reductions over their stated periods, without a control-station correction to a national datum epoch. The twelve-month threshold is a project coverage rule. Short-gap reconstruction, hourly sampling, weather, model errors and undetected gauge datum shifts all limit accuracy. [`packages/stations/validate-datums.ts`](../../packages/stations/validate-datums.ts) compares datum differences against published NOAA values; set `GESLA_ARCHIVE` to read an existing flat-entry GESLA ZIP without extracting it. `DATUM_REPORT_PATH` writes the per-pair published residuals as JSON, including harmonic fallbacks. See [#40](https://github.com/openwatersio/slackwater-database/issues/40).

## JODC annual-file truncation

The GESLA `jodc_jcg` copies can omit real measurements after midnight on the final local date of each original annual file. In the public [Monbetsu archive](https://www.jodc.go.jp/vpage/tide/HD01.zip), all 439,828 usable GESLA samples match the original heights exactly; another 1,173 valid original samples have no GESLA timestamp. Every additional sample falls after midnight on an annual file's final date, usually December 31 but also March 31 in the final partial year. [Urakawa](https://www.jodc.go.jp/vpage/tide/HD02.zip) has the same exact agreement for 360,322 usable overlapping samples and 989 additional valid samples without GESLA timestamps on annual final dates. A further 145 original Urakawa samples correspond to excluded GESLA observations; they are a separate QC question.

All 31 `jodc_jcg` records (30 in Japan plus Syowa in Antarctica) contain at least one year with a usable local December 31 midnight followed by 23 hours with no GESLA timestamps. The original-file comparison above covers Monbetsu and Urakawa; the remaining archives have not been compared.

Under the complete-month rule, all 31 relays use the constituent frame (MSL = 0), including 11 accepted relay records. This is a model zero, not a measured gauge zero. Recovering the original final-day hours can change which observation windows and gauge offsets qualify.

This pattern points to truncation when daily source rows are expanded or annual files are assembled, rather than a physical station outage. The responsible upstream conversion code has not been identified. Other month-end day-31 observations are present. JODC's [hourly format](https://www.jodc.go.jp/data_format/sea-level-format.html) supplies all 24 heights per date in JST (UTC+9); Syowa is the documented UTC+3 exception. The 23-hour omissions exceed the reconstruction limit. The importer currently leaves them missing. Restoring them requires original-source ingestion with time, gauge-zero, overlapping-height and QC checks, rather than increasing the interpolation bound or overriding excluded observations.

## Regenerating

The station JSONs are generated. For harmonic-only datum changes, recompute from committed constituents and stored offsets without downloading observations:

```sh
npm run refresh:harmonic-datums -w packages/stations
npm run stations
```

This preserves observed means, their reduction windows and coverage. It stamps the complete-turn harmonic method notice required by the cache. A rollback can remove that notice; rolling forward then recomputes the observation reduction unless the offline command restores it.

For changes to observation reduction or refreshed raw observations, regenerate from GESLA-4 (downloaded on demand and not committed):

```sh
FORCE_DATUMS=1 npm run import -w sources/ticon
```

Legacy reductions without the current period/method notices and matching frame and coverage metadata are recomputed. Otherwise, without `FORCE_DATUMS`, the importer reuses each station's cached datums when its constituents match, and recomputes the derived metadata (`chart_datum`, pruning, disclaimers). Constituent changes also recompute the observation reduction because inferred heights depend on the model. `FORCE_DATUMS` also accepts a comma-separated list of source suffixes to recompute only those sources, for example `FORCE_DATUMS=uhslc_rq`.

Refreshing raw observations alone does not invalidate an otherwise valid datum cache. Use `FORCE_DATUMS` after replacing GESLA or refreshing UHSLC data.

The importer runs one process per core, each taking every nth station. Set `SHARDS` to change the count; `SHARDS=1` runs a single process.

## Relay provenance

Many TICON records relay a gauge this repo also imports directly. [provenance.ts](provenance.ts) names the record a relay was copied from when the relay declares it: a TICON NOAA relay carries the NOAA station number in its id, a Norwegian Hydrographic Service (`nhs`) relay carries Kartverket's gauge code, a JODC Coast Guard (`jodc_jcg`) relay carries an `HD` code matched through [JHOD's crosswalk](../jhod/ticon-originators.json), and UHSLC research-quality metadata names an originator. UHSLC records that explicitly name JODC and an `HD` code use that same crosswalk. An originator number counts only when the provider of its `Data_Source`'s current period, the first line or the first under an open-ended period heading such as `For 1997-:`, matches a provider in `UHSLC_RULES`, since UHSLC numbers have no namespace (071 is both Wellington and La Libertad). UHSLC records the Norwegian Hydrographic Service with no number, so those gauges match the Kartverket record of the same place name, read from `data/kartverket`. Quality evaluation shares a declaration across every TICON record of one gauge, so UHSLC's fast-delivery series follows its research-quality sibling.

The UHSLC metadata is pinned in [uhslc-metadata.json](uhslc-metadata.json), because UHSLC edits it in place. It holds only what matching needs (station name, position, its data source's current provider, originator number, last update) from UHSLC's public research-quality metadata. Of that, only the positions the [position corrections](#positions) copy reach the published database. Refresh it deliberately and review the diff:

```shell
npm run refresh:uhslc -w sources/ticon
```

`npm run report:merges -w packages/stations` lists the station merges this provenance, CMEMS copies, shared gauge codes and quality's duplicate and superseded links propose, and `npm run merge -w packages/stations` makes the confident ones in the station files (see [stations/README.md](../../stations/README.md)).

## Positions

A record takes TICON's position, which matches the GESLA-4 metadata TICON ships in `meta.csv`. That metadata places a few UHSLC research-quality records kilometres from their gauges, so `POSITION_CORRECTIONS` in [meta.ts](meta.ts) moves each to the position UHSLC publishes for the same series in [uhslc-metadata.json](uhslc-metadata.json). A sea-level network's own station list places each gauge there too:

| Record            | TICON's position             | Station list placing the gauge at UHSLC's position                                                                           |
| ----------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Ammassalik (297A) | 29 km east                   | [IOC sea level monitoring](https://www.ioc-sealevelmonitoring.org/station.php?code=tasw), Tasiilaq Harbour, 0.1 km away      |
| Langkawi (142A)   | 49 km north, in Thailand     | [PSMSL](https://psmsl.org/data/obtaining/stations/1676.php) 1676, Pulau Langkawi, 0.15 km away                               |
| Macaé (719A)      | 35 km east-northeast, at sea | [GLOSS](https://www.bodc.ac.uk/resources/inventories/gloss_handbook/stations/352/) 352, Porto de Macaé, at the same position |
| Alotau (069A)     | 17 km north                  | [PSMSL](https://psmsl.org/data/obtaining/stations/1607.php) 1607, Alotau, 0.4 km away                                        |

The record's timezone, its place names and quality's duplicate checks use the corrected position. Each entry also holds TICON's position, and the import stops when TICON drops the record or publishes it somewhere else, so a TICON release that changes it is reviewed rather than overwritten. A record UHSLC places elsewhere keeps TICON's position until another station list confirms UHSLC's: at Chuuk (054A), NOAA's own record of the gauge agrees with TICON. See [#371](https://github.com/openwatersio/slackwater-database/issues/371).

## Constituent names

The station files keep TICON's constituent names as published, and `@slackwater/engine` resolves each name to a definition. Most TICON names are IHO names on the IHO line. The engine's [constituent names](https://github.com/openwatersio/slackwater/blob/main/packages/engine/docs/constituent-names.md) doc covers the ones that are not, with the evidence for each. Two of them matter for the importer:

- MKS2 is the IHO MKS2 at Doodson 257.555 (29.0662415°/h).
- 3N2 is a degree-3 line at Doodson 245.555 (28.4350877°/h) with a +90° phase constant.

Table 1 of the TICON-4 manual swaps these two rows. Scored against the raw GESLA-4 records, TICON's published phases match the lines above, so `TICON_REFERENCE_SPEED` in [`packages/harmonic-analysis/index.ts`](../../packages/harmonic-analysis/index.ts) uses these speeds rather than Table 1's.

Table 1 also lists Sa as 056.554, with a solar perigee term, where the engine uses 056.555. Scored the same way, TICON's published Sa matches 056.555 at 17 of the 18 gauges tried (0.98 to 1.05, against −0.49 to −0.64 for 056.554), so it needs no conversion. The engine doc has the gauges and the commands.

Eight constituents sit on the engine's line but are phased against a different equilibrium argument: TICON's argument is the engine's plus a constant. The importer subtracts it (`TICON_ARGUMENT_OFFSET` in [`import.ts`](import.ts)), so the station files hold phases against the engine's argument. Each offset was found by scoring TICON's constituent against the raw record at its largest gauges, with the published phase shifted by 0°, +90°, −90° and 180°:

| Constituent  | TICON argument − engine argument | Gauges agreeing                                         |
| ------------ | -------------------------------- | ------------------------------------------------------- |
| M3           | 180°                             | 8 of 8 (Thevenard, Cananéia, Millport, Bristol Channel) |
| SGM (sigma1) | 180°                             | 8 of 8 (Anchorage, Keling, Port Pirie, Wyndham)         |
| T3           | 180°                             | 7 of 8                                                  |
| S3           | 180°                             | 17 of 20                                                |
| R3           | −90°                             | 7 of 8                                                  |
| 3L2          | −90°                             | 20 of 20 (Bay of Fundy, Puerto Montt, Mackay)           |
| 2MK5         | −90°                             | 8 of 8 (Anchorage, Puerto Madryn)                       |
| 2MO5         | +90°                             | 8 of 8 (Puerto Madryn, Anchorage)                       |

At its offset each scores close to +1, and at the engine's own argument close to −1 (unrelated) or −3 (anti-phase). 3L2 scores lower and more widely, −0.6 to 2.0, because it is one lunar perigee cycle (8.85 years) from L2 and hard to separate from it. Most of the gauges that disagree are river gauges such as Hedel and Gorinchem, where the constituent scores near −1 at every offset. The exception is S3 at L'Isle-aux-Grues in the St. Lawrence estuary, which scores 0.66 at 0°. S1, P1, T2, R2, S4, RHO1, 2SM2, 2MS6, 3N2 and MKS2 score best at 0° and need no conversion. The re-fit `wsv` and `rws` stations are fit against the engine's arguments, so the conversion applies only to TICON's published phases.

The importer re-fits the `wsv` and `rws` stations, whose GESLA-4 files label local time as UTC (see `LOCAL_TIME_SOURCES` in [`samples.ts`](samples.ts)), and three Hong Kong gauges whose UHSLC times are one hour early (`EARLY_GAUGES`). `fitHarmonics` skips any constituent whose engine speed differs from its reference speed, so a re-fit never stores a name on a line TICON doesn't mean by it. It also skips 3N2 when the record is shorter than one lunar perigee cycle (8.85 years), the time it takes to separate 3N2 from N2; on those records N2 keeps the signal. To re-fit these stations:

```sh
FORCE_HARMONICS=1 npm run import -w sources/ticon
```

A re-fit reads each station's whole GESLA-4 record, so it takes a while: about 90 minutes for all of them. Without `FORCE_HARMONICS` the importer reuses each saved re-fit, but re-fits a station whose saved constituents still equal TICON's published ones, as a file saved before its station joined these lists does.

UHSLC stamps its Hong Kong hourly heights one hour early: the height it labels T was measured at T + 1 h UTC. TICON-4 fitted its constants to those times, so `hong_kong-329-hkg-uhslc_fd`, `hong_kong-329a-hkg-uhslc_rq` and `hong_kong-329b-hkg-uhslc_rq` all published M2 phases near 7°, where the Hong Kong Observatory's (HKO) Quarry Bay predictions fit 36.5°. The importer adds the hour to their GESLA-4 samples and to the live UHSLC RQD samples 329b's datums are reduced from, then re-fits. See [#360](https://github.com/openwatersio/slackwater-database/issues/360).

- The UHSLC fast-delivery series (h329) at T matches the IOC `quar` gauge, which reports in UTC, at T + 58 min to 3 mm RMS in June 2019 and August 2026, against 173–182 mm at T. At exactly T + 1 h the RMS is 8–9 mm. The remaining 2 min has not been traced; a mislabeled clock moves whole hours, so the correction is one hour.
- The research-quality 329 version B matches h329 exactly (0 mm RMS over 78,803 hours, 2010–2018), and matches IOC `quar` at T + 58 min in June 2019, so it carries the same offset.
- Version A (329a, North Point, 1962–85) ends before IOC `quar` and h329 begin, so there is no overlap to compare. Its published M2 phase was 7.0°, within 0.4° of 329b's. HKO's own predictions put Kwai Chung 7 min after Quarry Bay and Waglan 5 min before it, so a one-hour real difference between North Point and Quarry Bay, both on the north shore of Hong Kong Island, is not plausible. 329a gets the same shift.

Against HKO's hourly Quarry Bay predictions for 2025–26, the published constants fit best 59–60 min late (RMS 3.9–4.4 cm); the re-fit constants fit best at 0 to −1 min (RMS 2.9–3.5 cm).

To check which line a published constituent describes, score it against the raw record with [`score-line.ts`](../../packages/harmonic-analysis/score-line.ts). It reads the GESLA-4 archive the importer downloads, and refuses the re-fit stations, whose constants are no longer TICON's:

```sh
npm run report:score-line -w packages/harmonic-analysis -- cardwell-h035012a-aus-bom 3N2 245.555 --sweep --nodal=N2
```

The engine doc explains the method and how to read the scores. [#76](https://github.com/openwatersio/slackwater-database/issues/76) collects the discrepancies between the manual's constituent definitions and the engine's.

## References

- Hart-Davis, Michael; Dettmering, Denise; Seitz, Florian (2025). _TICON-4: TIdal CONstants based on GESLA-4 sea-level records._ SEANOE. https://doi.org/10.17882/109129
- [TICON-4 Dataset](https://www.seanoe.org/data/00980/109129/)
- [TICON Manual](https://www.seanoe.org/data/00980/109129/data/122852.pdf)
- [GESLA-4 Project](https://gesla787883612.wordpress.com)
