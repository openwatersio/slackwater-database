# Water-levels lake fits

The importer fits harmonic constants and reduces datums from agencies' own observations in the Open Waters [water-levels lake](https://github.com/openwatersio/water-levels), and writes them as each agency's records: `data/smhi/<series>.json` for SMHI. These records sit beside TICON-4's records of the same gauges, and the [quality evaluation](../../docs/quality-evaluation.md#duplicates) chooses which one each gauge publishes. An agency joins `CONTRIBUTORS` ([lake.ts](lake.ts)) once its lake series are fully backfilled, in the order of the lake's [TICON replacement inventory](https://github.com/openwatersio/water-levels/blob/main/docs/ticon-replacement.md), and `sources/<agency>/metadata.yaml` declares its credit. SMHI is the first.

```sh
npm run import -w sources/ticon        # first: the gauges and their names come from TICON
npm run import -w sources/water-levels
```

## Gauges

The gauges are the agency's TICON records. The lake lists GESLA's record of each under the TICON record's name (`gesla/<id>`), and that record's `preferred` names the agency's series, such as `smhi/2130`. A gauge whose GESLA record the lake prefers to the agency's own series, or prefers another agency's series for, has no record here. A record takes its TICON record's name and position, and names it in `source.gauge`, which is how the quality evaluation knows the two describe one gauge.

## Reading

[`readLakeSamples`](../../packages/harmonic-analysis/lake.ts) (`@slackwater/harmonic-analysis/lake`) reads a series' year files with DuckDB, puts every datum epoch in the current datum with its `to_current`, and by default keeps only values the agency has verified: flag good, not preliminary, interpolated, suspect or bad. The importer reads preliminary values too, for fits and datums: SMHI has not checked its data before July 2019 and won't, and the lake gives those years the same flag as data awaiting a check (water-levels is separating the two). Files are cached in `tmp/water-levels/` and revalidated against the lake on every read, since R2's ETag is the file's MD5. Only the public lake is read. The lake corrects the clock errors the TICON importer fixes from GESLA (`LOCAL_TIME_SOURCES`, `EARLY_GAUGES`), so this importer applies neither.

## Epoch

Each fit holds out the year that starts the day after its TICON record's last day and is fit over the 19 years before that year, one nodal cycle. Neither the fit nor TICON's record of the gauge has seen the held-out year, so the comparison is fair to both, and the fit covers the same period as TICON's record. Another TICON record of the gauge can run later, and then it has seen part of that year. A gauge with less than half of that year to score, such as an old gauge TICON covers to its last reading, holds out its last calendar year or the one before. TICON's constants were fitted on that year, which favours them. Each gauge's window follows its TICON record, so the fits don't share one pinned epoch.

## Fitting and scoring

The fit takes the TICON record's constituent names, with `fitHarmonics`, as the TICON importer's GESLA re-fits do. The fit and every TICON record the lake files under the same series, such as SMHI's, CMEMS's and UHSLC's copies of the gauge, then predict the held-out year. Each is scored by `tidalResidual`: the RMS of observed minus predicted after a Godin filter (24, 24 and 25-hour running means) takes out weather and the datum, leaving the diurnal and faster band where those constituents' errors show. `source.held_out` records the year, the hours scored, the fit's score, and for each TICON record its score, the standard error of the difference and a digest of the constants scored. The standard error comes from 30-day blocks of the year, which weather leaves roughly independent. A gauge with fewer than half its held-out hours, or too short a fit window to analyze, gets no record.

The scores are compared in the quality evaluation, not here. A fit loses only to a TICON record it scores worse than by more than a constituent error of `AMPLITUDE_TOLERANCE` (3 mm) would add to the residual's variance (A²/2) and more than twice the standard error, and then it is a duplicate of the best such record. Otherwise every TICON record of the gauge is a duplicate of the fit, which comes from the agency's own series and can be refitted. A record the lake files more than 10 km from the gauge isn't compared. Against the gauge's other records, the fit ranks as its TICON record's relay. The score can't see the long-period constituents (SA, SSA, MM and the rest), which the filter removes, so a fit keeps its TICON record's, or another TICON record's of the gauge where `MISFILED_RECORDS` lists its own (Uddevalla's is Arkö's data), or the fit's own where the lake files no other that is licensed for commercial use, and the [seasonal contamination](../../docs/quality-evaluation.md#seasonal-contamination) check applies to it as to a TICON record. When the TICON record's constants have changed since they were scored, the digest no longer matches, the scores decide nothing, and the fit's quality issues say to re-run this import. Fits are scored as they are published, rounded to 1 mm and 0.01°.

## Datums

Datums are reduced over the same years, the fit and held-out years, from verified and preliminary values alike, under the rules in [docs/datums.md](../../docs/datums.md), in the series' current datum (RH 2000 for SMHI). A mean over more months outweighs the checks an agency has yet to make, and much of an older SMHI series is preliminary and may never be verified: at Uddevalla, verified values cover 12 months of the window and all values 36. `epoch` is the fit period.

## Records

Records have `published_harmonics: false`: these constants are fitted here. The source is not authoritative, since these are Open Waters' fits of the agency's data rather than its own analysis. A year file missing mid-backfill reads as a gap, so a run can see less of a series than an earlier one. A gauge the lake can't fit keeps any record it has, and so does one whose new fit has fewer samples than its saved one (`source.fit_hours`), unless `FORCE_HARMONICS=1`. Removing a record is done by hand.

## Limitations

- The lake's QC marks any value unchanged for six hours suspect. At SMHI's older, centimetre-resolution gauges that drops real readings on calm Baltic days, and with them the complete months an observed datum reduction needs ([water-levels#90](https://github.com/openwatersio/water-levels/pull/90)).
- A gauge without a TICON record has no record here, because its name and position come from TICON.
- A contributor's key in `CONTRIBUTORS` is its lake source, its TICON suffix and its `data/` directory alike. One whose name is already a source here, such as DMI, needs its own directory name first.
- The importer runs by hand; no workflow refreshes `data/smhi`.
- The saved-fit guard compares sample counts, so a fit with legitimately fewer samples, after the lake re-flags values or TICON's record moves, needs `FORCE_HARMONICS=1`. A first import has no saved fit to compare, so a year file missing then gives a thinner fit; the lake's per-series manifest (water-levels#92) would let the importer check.
