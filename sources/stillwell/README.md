# Fits from Stillwell

The importer fits harmonic constants to observed water levels in [Stillwell](https://github.com/openwatersio/stillwell), the Open Waters observation store, verifies each fit on a year it didn't see, and writes one record per gauge to `data/<source>/<source id>.json`. It runs the same pipeline for every source; what differs between sources is data in [profiles.ts](profiles.ts). It is step 6 of [docs/plans/stillwell-constituents.md](../../docs/plans/stillwell-constituents.md), run first on SMHI and PEGELONLINE.

```sh
STILLWELL_CACHE=/path/to/cache npm run import -w sources/stillwell -- smhi
npm run import -w sources/stillwell -- pegelonline pegelonline/9640015 --shard 1/3
```

A run takes a source, optionally the Stillwell series to fit, and `--shard <i>/<n>` to split a source across processes. Each fit holds about 650 MB and takes one to five minutes, so run at most a few shards at once. PEGELONLINE's one-minute files take about 2 MB a year per gauge; point `STILLWELL_CACHE` at a disk with room.

## Pipeline

For each Stillwell series of the source:

1. **Final values.** A source that finalizes (SMHI) gives its verified values, plus preliminary ones from before the station's `source_qc_start`. A source that never marks values final (PEGELONLINE) gives its measured values (flags 0 and 2) from before its settle cutoff: the start of last year, so a year counts once it ended at least twelve months before the run. PEGELONLINE revised raw values it still labels unchecked months after measuring them (Stillwell erratum `pegelonline-cuxhaven-2025-revised`), and Stillwell doesn't publish a revision window yet ([stillwell#526](https://github.com/openwatersio/stillwell/issues/526)). Suspect and bad values never enter a fit. Every kept erratum of the source has a decision in its profile, and a new one stops the import.
2. **Held-out year.** The source's last whole year of final values, or the gauge's own last year with half its hours of them. The fit never reads it.
3. **Screen.** A one-year fit of the window's last year predicts the mean range, MHW − MLW. A gauge under the quality evaluation's 2 cm tidal range gate isn't fitted, so river gauges with no tide cost nothing.
4. **Fit.** Up to 19 years before the held-out year, at least 183 days. Instantaneous values on the hour, robust (iteratively reweighted) least squares with IHO nodal corrections at each sample's time, through `@slackwater/engine`'s `fit()`. Candidates are Foreman's 69 in his order, then the names of NOAA's 37 and TICON's 50 he lacks, each kept by the Rayleigh criterion against every stronger one kept before it and by SNR ≥ 2 (`selectConstituents`). Foreman's H1 and H2 are left out until the engine's catalog defines them.
5. **Sa and Ssa** are fitted over the whole window and each year on its own. They publish only where the whole window's amplitude is at least twice the standard error of the yearly mean, as the plan's Constituent selection sets out. The record keeps the yearly spread either way.
6. **Verification** with `verifyFit` ([packages/harmonic-analysis/verify-fit.ts](../../packages/harmonic-analysis/verify-fit.ts)): fit diagnostics, then the tidal-band residual on the held-out year for the fit and every TICON record of the gauge.
7. **Datums** from every measured value over the fit's window and the held-out year, reduced as TICON's are (`reduceTiconDatums`): observed means over whole years where twelve continuous months allow, with HAT and LAT from the harmonic prediction.

## Same gauge

Stillwell links series of one gauge in `same_as` by IDs, names, positions and matching levels. A fit counts a TICON record as the same gauge only where Stillwell compared the fitted series with the record's GESLA series by their hourly levels (`stations/matches.parquet`) and found them within 1 cm RMS at no lag, Stillwell's own bound. Then the TICON record was analyzed from the same levels. Those records are the ones scored on the held-out year, decided against in the quality evaluation, and merged with in `npm run merge` (the `stillwell` evidence in [packages/stations/merges.ts](../../packages/stations/merges.ts)). A link Stillwell didn't compare, or whose levels differ, waits for review in `report:merges`.

## Records

Records are `<source>/<source id>` as in Stillwell, such as `smhi/2130`, with the source id encoded as Stillwell encodes it in paths. Names and positions are Stillwell's, the agency's own; PEGELONLINE's capitals become title case. `published_harmonics` is false.

The license is the more restrictive of Stillwell's own (CC BY 4.0, Open Waters) and the station's. SMHI is CC BY 4.0 and PEGELONLINE DL-DE-Zero-2.0, so both sources' fits are CC BY 4.0. A Stillwell license without a mapping in [record.ts](record.ts), or terms that bar commercial use, stop the import. `sources/<source>/metadata.yaml` credits the agency and Stillwell, and marks the source not authoritative: the constants are our analysis, not the agency's.

`source.stillwell` holds the fit's provenance, described in [schemas/station.schema.json](../../schemas/station.schema.json): the year file versions, epochs, errata and decisions read, how values counted as final, the fit's window, engine version and every candidate's verdict, each constituent's intervals and SNR, the yearly scatter and the Sa and Ssa decision, the held-out scores with a digest of each TICON record's constants, and Stillwell's level comparison for every TICON link. The database doesn't carry it.

## Limitations

- PEGELONLINE's settle cutoff is this project's rule, not a measured window.
- Most PEGELONLINE links to TICON's WSV records have no level comparison in Stillwell, so those fits don't replace or merge with TICON's records until Stillwell compares them.
- Sources that publish filtered or averaged hourly values aren't profiled: the engine has no filter-gain correction yet.
- A fit doesn't run the plan's clock, datum-step or stationarity checks before fitting; Stillwell's own checks and the held-out score stand in for them.
