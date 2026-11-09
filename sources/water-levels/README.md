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

Each fit holds out the year after its TICON record ends and is fit over the 19 years before that year, one nodal cycle. Neither set of constants has seen the held-out year, so the comparison is fair to both, and the fit covers the same period as TICON's record. A gauge with less than half of that year to score, such as an old gauge TICON covers to its last reading, holds out its last calendar year or the one before, which TICON's constants may have been fitted on. Each gauge's window follows its TICON record, so the fits don't share one pinned epoch.

## Fitting and scoring

The fit takes the TICON record's constituent names, with `fitHarmonics`, as the TICON importer's GESLA re-fits do. Both the fit and the TICON record's constants then predict the held-out year. Each is scored by `tidalResidual`: the RMS of observed minus predicted after a Godin filter (24, 24 and 25-hour running means) takes out weather and the datum, leaving the diurnal and faster band where those constituents' errors show. `source.held_out` records the year, the hours scored, both scores, and a digest of the TICON constants scored. A gauge with fewer than half its held-out hours, or too short a fit window to analyze, gets no record.

The scores are compared in the quality evaluation, not here. The fit wins its TICON record unless it scores worse by more than a constituent error of `AMPLITUDE_TOLERANCE` (3 mm) would add to the residual's variance (A²/2); the loser is a duplicate of the record the gauge keeps. A fit no worse wins because it comes from the agency's own series and can be refitted. Against the gauge's other records, the fit ranks as its TICON record's relay. The score can't see the long-period constituents (SA, SSA, MM and the rest), which the filter removes, so a fit keeps its TICON record's, and the [seasonal contamination](../../docs/quality-evaluation.md#seasonal-contamination) check applies to it as to a TICON record. When the TICON record's constants have changed since they were scored, the digest no longer matches, the scores decide nothing, and the fit's quality issues say to re-run this import. Fits are scored as they are published, rounded to 1 mm and 0.01°.

## Datums

Datums are reduced over the same years, the fit and held-out years, from verified and preliminary values alike, under the rules in [docs/datums.md](../../docs/datums.md), in the series' current datum (RH 2000 for SMHI). A mean over more months outweighs the checks an agency has yet to make, and much of an older SMHI series is preliminary and may never be verified: at Uddevalla, verified values cover 12 months of the window and all values 36. `epoch` is the fit period.

## Records

Records have `published_harmonics: false`: these constants are fitted here. The source is not authoritative, since these are Open Waters' fits of the agency's data rather than its own analysis. A year file missing mid-backfill reads as a gap, so a run can see less of a series than an earlier one. A gauge the lake can't fit keeps any record it has, and so does one whose new fit spans less than its saved one, unless `FORCE_HARMONICS=1`. Removing a record is done by hand.

## Limitations

- The lake's QC marks any value unchanged for six hours suspect. At SMHI's older, centimetre-resolution gauges that drops real readings on calm Baltic days, and with them the complete months an observed datum reduction needs ([water-levels#90](https://github.com/openwatersio/water-levels/pull/90)).
- A gauge without a TICON record has no record here, because its name and position come from TICON.
- A contributor's key in `CONTRIBUTORS` is its lake source, its TICON suffix and its `data/` directory alike. One whose name is already a source here, such as DMI, needs its own directory name first.
- The importer runs by hand; no workflow refreshes `data/smhi`.
- The saved-fit guard compares fit spans only. A year file that 404s inside the span gives a thinner fit over the same span, which replaces the saved one.
