# Fitting our own constituents from Stillwell

slackwater-database ships TICON-4's harmonic constants for most of its stations, with datums reduced from GESLA-4. Both carry errors we keep finding: local time labeled as UTC, records filed under the wrong gauge, swapped constituent definitions, and Sa and Ssa fitted to river flow. Both also lag their originators by a year or more. [Stillwell](https://github.com/openwatersio/stillwell) now holds originator records for most of TICON's contributors, in UTC, flagged, with datum epochs and per-station licenses. This plan fits constants for every Stillwell gauge that supports it with one pipeline, picks constituents for each gauge on stated grounds, verifies each fit against held-out observations and against the agency's own predictions, and uses HRoI for high and low waters where it beats a harmonic fit.

Stillwell and slackwater-database split the work as the Stillwell plan sets out in its [decision 7](https://github.com/openwatersio/stillwell/blob/main/docs/plan.md#decisions). Stillwell supplies observations, QC and provenance. slackwater-database fits, reduces datums and decides what ships.

## References

[docs/research/tidal-analysis](../research/tidal-analysis/README.md) lists every primary source this plan relies on, with what each one establishes and where.

## Working upstream

This plan depends on two other Open Waters projects: Stillwell for observations, and [`@slackwater/engine`](https://github.com/openwatersio/slackwater) for fitting and prediction. Where either falls short, the fix goes there, as an issue or a pull request with the evidence (station, years, what the fit saw), and slackwater-database waits for it or works on other gauges meanwhile. A workaround here comes only when the upstream project can't fix it, such as data an originator never published, and it names the issue that explains why. Code that works around an upstream gap today moves upstream as part of this plan.

### Stillwell

slackwater-database is one of Stillwell's main consumers, and this plan is a running test of it. Findings from the checks and reports below go to it: a problem with the data becomes a Stillwell issue or erratum, and a problem with constants stays here.

What this plan needs from Stillwell, so far:

- An explanation for every year GESLA holds that the originator series lacks: not yet backfilled, outside the originator's archive, or dropped by QC. See [Older years](#1-series).
- Each source's revision window, for sources that never finalize their values, so "values the source won't revise again" is defined there, not guessed here.
- The filter behind any source's hourly values (UHSLC, some GESLA contributors), and where each value is stamped in its interval, as station or source metadata.
- Year files kept and fetchable by the version a fit recorded, so a fit can be reproduced after a year is revised.
- Observed high and low waters wherever the source has a fine enough record, picked with one documented method, as RWS's `extremes` already are.
- Agency predictions as reference data where licenses allow: NOAA CO-OPS predictions, Kartverket's API, DMI's and the Marine Institute's tables, beside the RWS and BSH predictions it holds already.
- `tide_station` links, filled from the same table slackwater-database records (#402).

### @slackwater/engine

The engine already has the IHO constituent catalog, IHO nodal corrections, shallow-water decomposition and a least-squares `fit()`. Fitting belongs there, so every consumer of the engine gets the same method and the database's constants predict exactly as they were fitted. `packages/harmonic-analysis` keeps what is specific to this database, such as reading Stillwell and GESLA, TICON's naming conventions, and scoring against TICON.

What this plan needs from the engine, so far:

- A `fit()` that handles a rank-deficient matrix instead of throwing, and takes weights, with iteratively reweighted least squares as an option. It already applies nodal factors at each sample's time and reduces the matrix in blocks, so its memory doesn't grow with the number of samples. `fitHarmonics`'s own SVD path exists because `fit()` throws on a rank-deficient matrix, and retires once it doesn't.
- Confidence intervals and SNR for each constituent's amplitude and phase.
- Constituent selection: a candidate list in priority order, the Rayleigh rule against stronger candidates, and the SNR rule. The engine's `unseparable` warning is the start of this.
- Inference of minor constituents from a reference ratio, for short records.
- A correction for a known sampling filter's gain, for sources that publish filtered hourly values.
- Prediction without Sa and Ssa, for residuals, if the engine doesn't have it.
- Constituents defined by a database rather than only its own catalog (see [Constituent definitions](#constituent-definitions)), so the provider entries can leave the catalog without a newer engine dropping them from older database files: the catalog keeps them until no supported database file needs them.
- HRoI's model, fit and prediction, and a way to put a curve's high and low waters on HRoI's events (see [HRoI](#7-hroi)).

Each lands as its own engine release, with tests against synthetic tides of known constants, before slackwater-database depends on it.

## Constituent definitions

A harmonic constant means something only with the definition it was analyzed under: its Doodson numbers, its phase constant, and its nodal correction. Prediction has to use the same one. The database stores only names today, and a name takes its meaning from whatever the engine's catalog says when the prediction runs. That breaks in three ways this plan would make worse:

- **Other sources' conventions** live in code. TICON's phase offsets (`TICON_ARGUMENT_OFFSET`), the guard against TICON lines that differ from the engine's (`TICON_REFERENCE_SPEED`), and Kartverket's variants (`SA_KV`, `S1_KV` and `OQ2_KV` in the engine's catalog, mapped again in `sources/kartverket/kartverket.ts` and special-cased in `packages/stations/filtering.ts`) are each handled by a different mechanism ([#238](https://github.com/openwatersio/slackwater-database/issues/238)).
- **Catalog changes** move constants silently. Adopting IHO's 90° convention ([slackwater#241](https://github.com/openwatersio/slackwater/issues/241)) would shift the phase of every constituent it touches, at every station fitted under the old convention, with no change to the data. Once we fit thousands of stations ourselves, that becomes our problem rather than TICON's.
- **Our own fits** use a larger candidate list than any single source, including shallow-water compounds whose definitions differ between agencies. A fit must say exactly which line it fitted.

So the database carries definitions, as [#238](https://github.com/openwatersio/slackwater-database/issues/238) proposes:

- A definitions table in the database: for each definition, its name, Doodson numbers, phase constant, and nodal correction, with compounds stored as their members, as [slackwater#242](https://github.com/openwatersio/slackwater/issues/242) proposes for the engine.
- Each source names the definitions its constants were analyzed under. A source using IHO's list as the engine has it names nothing.
- Phases stay stored against the engine's argument for each name, as `TICON_ARGUMENT_OFFSET` already converts TICON's at import. A source's definition records that conversion, so it's visible in data rather than only in import code. A definition on a different line from the catalog's, such as Kartverket's `SA_KV`, `S1_KV` and `OQ2_KV`, keeps a name of its own, so a reader that doesn't know it skips it rather than predicting it on the wrong line. Kartverket's import keeps mapping its `SA`, `S1` and `OQ2` to those names, since `SA` under the catalog's `Sa` would be 283° out of phase. TICON's published 3N2 and MKS2 are already on the engine's lines, so they keep their names. `TICON_REFERENCE_SPEED`, which guards Sa, MKS2, 3N2, 3L2, T3 and R3, and the `SA_KV` special case in the seasonal checks then go away, and `sources/ticon/README.md` and `sources/kartverket/README.md` describe the definitions instead.
- Fits from Stillwell record the definitions `fit()` used, so the catalog can change later without moving them.
- The engine predicts from the definitions it is given, with its catalog as the default.

Kept this way, the definitions table is additive: a reader that ignores it predicts as it does today. A future change that does break old readers, such as moving stored phases to another convention, needs a check that doesn't exist yet. The format's `version` is a free-text string no reader checks, and the npm prerelease base in [CONTRIBUTING.md](../../CONTRIBUTING.md) protects only npm ranges, not the `beta` tag or SwiftPM. So this work also adds a format major version that the JavaScript, Swift and Kotlin readers refuse when it's newer than they know. Readers already deployed don't have that check, so it has to ship, and reach the apps, well before the first change that needs it. Everything in this repo that resolves constituents by name moves onto the definitions too: `packages/tcd`, the seasonal checks in `packages/stations/filtering.ts` and `evaluate-quality.ts`, `packages/stations/lat-hat.ts` and `validate-datums.ts`, `packages/datums` (`datum.ts` and `observations.ts`), and the Swift and Kotlin readers. It comes before fits from Stillwell ship at scale, so none of them has to be converted afterward.

## Goals

- Constants at least as good as TICON's at every gauge where we publish our own, and better wherever the record allows, shown on a held-out year our fit hasn't seen.
- Coverage TICON lacks: originator gauges it never had, Baltic and river gauges it drops, and records that have grown since GESLA-4 was cut.
- One method for every source, with source-specific differences as data in a profile, not as code paths. The DMI importer and the RWS validator fit agency predictions rather than observations, and move onto the same engine fit and selection once it exists.
- Each published fit says what it was fitted from, which constituents it has and why, and how well it scored. IHO Resolution 1/2019 asks for the constituent list and the analysis period with any prediction ([IHO TWCWG](https://iho.int/uploads/user/Services%20and%20Standards/TWCWG/TWCWG5/TWCWG5_2020_3.2.1_EN_IHO_Reslution_1-2019_v1.0.pdf)).
- TICON becomes a fallback, and then a comparison, as each contributor converts.

## Non-goals

- Fitting gauges with no tide to speak of. NOAA predicts no tides on the Great Lakes, and the source profiles leave those gauges out. The 2 cm tidal range gate in [quality-evaluation.md](../quality-evaluation.md) isn't enough by itself: seiches and seasonal swings let a lake gauge such as Cobourg clear it by millimeters.
- Nonstationary river-tide models such as NS_TIDE ([Matte, Jay and Zaron 2013](https://doi.org/10.1175/JTECH-D-12-00016.1)). Upper-estuary gauges get a stationary fit, a stated limitation, and HRoI where it applies.
- Replacing constants an agency publishes itself, for now. NOAA, Kartverket, JMA and the rest stay as they are, and their gauges serve as calibration for this pipeline (see [Calibration](#calibration)). Where calibration shows our fit beats an agency's published constants on held-out observations, for instance where NOAA's analysis is decades old, replacing them becomes worth considering later.

## Pipeline

One importer, `sources/stillwell`, runs the same stages for every gauge. A source's differences live in a profile (see [Source profiles](#source-profiles)).

### 1. Series

- **Read** with the Stillwell reader and year manifest from the unmerged #406 (see [Code to reuse](#code-to-reuse)): every epoch put in the current datum through `to_current`, rows outside an epoch's span dropped, year versions pinned in the record so the fit can be reproduced.
- **Values a fit may use** follow one rule: values the source won't revise again. Stillwell already records this. Where `finalizes` is true, that's verified values, plus preliminary values from before `source_qc_start`. Where `finalizes` is false (PEGELONLINE, EA, CDEC, GESLA), it's measured values (flags 0 and 2) older than the source's revision window, which Stillwell publishes. Suspect and bad values (flags 3 and 4) never enter a fit. Datums read every measured value (flags 0 and 2), final or not, over the whole record including the held-out year, since a datum needs complete months more than verified ones: at Uddevalla, verified values cover 12 of the 36 months in its window.
- **Sampling.** Fit instantaneous values on the hour. Hourly sampling resolves constituents below twelve cycles a day and keeps a 19-year fit to about 166,000 rows. Candidates above eleven cycles a day, near that limit, need samples finer than hourly, so the eighth-diurnal is the highest band an hourly fit takes. Don't use hourly means. A one-hour boxcar scales a constituent by sinc(f·1 h): M2 by 0.989, M4 by 0.958 and M6 by 0.907. At Cuxhaven's 1.5 m M2 that's 16 mm, five times the 3 mm amplitude tolerance. Where a source publishes only filtered or averaged hourly values (UHSLC, some GESLA contributors), Stillwell records the filter and where each value is stamped in its interval. The fit divides each amplitude by the filter's gain at that constituent's frequency and corrects each phase for the stamp's offset. A mean stamped at the start of its hour is 30 minutes early: 14.5° of M2 and 7.5° of K1. The clock check can't see that, since TICON was fitted to the same values.
- **Older years.** Where GESLA holds years the originator series doesn't, find out why first, in Stillwell: the backfill may not have reached them, the adapter may not ask for them, QC may have dropped them, or the originator may not publish them. Only years the originator can't supply are taken from GESLA, joined at an offset measured where the two series overlap (#400), and years with no overlap stay out. An inventory of these years, per gauge and per cause, is the first piece of feedback to Stillwell. Stillwell's GESLA source is GESLA 4.1 with its clock fixes applied, which settles moving off GESLA 4.0 (#146) for the years that still come from it.

### 2. Checks before fitting

These stop a fit, or cut the series, before anything is fitted to bad data. Stillwell runs the first two over all its gauges ([stillwell#112](https://github.com/openwatersio/stillwell/issues/112)). slackwater-database runs them again on exactly the years it fits, and anything they find that Stillwell missed goes back to it as an issue.

- **Clock.** Fit M2 and K1 phase year by year, which finds errors like Apia's 1954 to 1971 record running two hours late (#290). A whole-hour jump, a 12-hour error (seen in K1), or a steady drift in phase stops the fit until Stillwell has an erratum. Each yearly fit is also compared with the gauge's neighbors and with TICON.
- **Datum steps.** Compare yearly and monthly means with neighbors. A step stops the fit unless an epoch boundary explains it.
- **Stationarity.** Measure the year-to-year scatter of M2, S2, K1 and O1 amplitude and phase. Parker calls consistency between independent yearly analyses "the only good way to check the quality of harmonic constants" ([Parker 2007](https://tidesandcurrents.noaa.gov/publications/Tidal_Analysis_and_Predictions.pdf), p. 86). Scatter well above the noise marks a river-influenced or changing gauge. Those still get a fit, with the scatter recorded in the record and a disclaimer on the station. Whether scatter should also lower the quality score is for calibration to show.

### 3. Fit

- **Method.** One least-squares fit over the whole window, up to 19 years, with each constituent's nodal factors applied at each sample's own time inside the design matrix, as Foreman, Cherniawsky and Ballantyne do ([2009](https://doi.org/10.1175/2008JTECHO615.1)) and UTide does ([Codiga 2011](https://www.po.gso.uri.edu/~codiga/utide/2011Codiga-UTide-Report.pdf)), using `@slackwater/engine`'s `fit()` and its IHO nodal corrections.
- **Weights.** Iteratively reweighted least squares, so surges and spikes the QC misses don't pull the fit. UTide makes robust fitting its default, after Leffler and Jay (2009).
- **Yearly fits.** Each calendar year is also fitted on its own, with one fixed set for every year: the constituents the Rayleigh rule keeps for 365 days of record. That is stricter than Parker, who finds 365 days enough to fit S2 and T2 or K1 and S1 by least squares (p. 86), since Rmin = 1 needs 365.24 days for both pairs; a fixed set matters more here than two small constituents. That leaves out pairs a year can't separate, such as N2 and 3N2, K1 and S1, and S2 and T2, in leap years too, so no year's set differs from another's and a split can't make a yearly phase jump. These fits give the clock and stationarity checks and the year-to-year scatter.
- **Uncertainty.** Amplitude and phase confidence intervals from the residual spectrum around each constituent (colored noise), as T_TIDE and UTide estimate them ([Pawlowicz, Beardsley and Lentz 2002](<https://doi.org/10.1016/S0098-3004(02)00013-4>)). The signal-to-noise ratio (SNR) is amplitude squared over its variance.
- **Precision.** Publish amplitudes at 1 mm and phases at 0.01° for every Stillwell fit, as `dmi` does. `PUBLISHED_PRECISION` takes one entry per data directory, so each source gets its own entry with those values. A kept constituent that rounds to 0 mm isn't published.

### 4. Constituent selection

Every gauge starts from the same candidate list and keeps what its record can resolve and what is above the noise. That replaces TICON's fixed 50, which its authors chose from community requests and the constituents of global tide models rather than for each site ([TICON-4 user manual](https://doi.org/10.17882/109129)).

Steps 1 and 6 follow Foreman (1977), and the confidence intervals in [Fit](#3-fit) follow Pawlowicz, Beardsley and Lentz (2002). Both are read in full, and these steps checked against them, before the engine work starts.

1. **Candidates, in priority order.** Foreman's 45 astronomical and 24 shallow-water constituents ([Foreman 1977](https://waves-vagues.dfo-mpo.gc.ca/Library/54866.pdf)), ordered by equilibrium amplitude, joined with NOAA's 37 and TICON's 50 so a fit can always be compared name for name.
2. **Resolution.** A candidate stays only if it is separated from every stronger candidate already kept by at least one cycle over the record (the Rayleigh criterion, Rmin = 1). This works out to M2, S2, K1 and O1 at 15 days, N2 and Q1 at 29 days, K1/P1 and S2/K2 at 6 months, and S2/T2 and K1/S1 at a year ([Parker 2007](https://tidesandcurrents.noaa.gov/publications/Tidal_Analysis_and_Predictions.pdf), §3.3). This replaces `fitHarmonics`'s separate 3N2 perigee rule, and its tests carry over as the check that the Rayleigh rule gives the same 8.85-year bound.
3. **Shallow-water expansion.** Where the fit's residual still has energy in the quarter-, sixth- and eighth-diurnal bands, the candidate list widens to RWS's yearly set of 94 (HATYAN's `year` list, [Deltares](https://deltares.github.io/hatyan/modules.html)) and Foreman's 77 optional shallow-water constituents. The same Rayleigh rule applies. NOAA fits 114 at Anchorage, and Parker says new reference stations shouldn't feel bound to the standard 37 (pp. 164–165). The trigger is a residual band ratio, set by calibration.
4. **Significance.** A constituent stays if its SNR is at least 2 over the whole fit. SNR ≥ 2 is UTide's default ([Codiga 2011](https://www.po.gso.uri.edu/~codiga/utide/2011Codiga-UTide-Report.pdf)). A constituent below it also stays if its amplitude and phase agree across the yearly fits, following Parker's advice to keep small constituents that are consistent from year to year rather than cut them by amplitude (pp. 165, 308). That second test is this plan's rule, and calibration sets what counts as agreeing. M2, S2, K1 and O1 always stay, since the quality evaluation requires them. Records under 15 days, too short to separate them, aren't fitted.
5. **Long-period terms.** Mm, Mf and Msf are astronomical and are fitted like any other constituent. In shallow water Msf is mostly an M2–S2 compound tide (Parker p. 259). Sa and Ssa are mostly weather, steric change and river flow, and vary from year to year (Parker §3.7.2, pp. 120–122). They come from the multi-year fit, never from one year, since the mean over many years is the best estimate of the seasonal cycle, and Parker advises a long series when they're included. They ship when that mean is significant: its amplitude at least twice its standard error, taken from the spread of the yearly estimates (the scatter divided by the square root of the number of years). Over a long record a real seasonal cycle clears this even when no single year matches it. One that doesn't clear it is small, so leaving it out barely moves LAT or HAT. Each yearly fit adds Sa and Ssa to its fixed set for this estimate only, since one year can't separate them from each other.

   The year-to-year scatter is the station's seasonal uncertainty: how far a given year's seasonal cycle can stray from the prediction. The record keeps it. Where it is large against the tidal range, the station gets the seasonal label and a disclaimer, and its stationarity check is read with it, since river flow and basin-scale weather that move Sa usually move the tide too. Residuals are computed without Sa and Ssa, as Parker advises, so the seasonal anomaly shows in them.

6. **Inference.** Where the Rayleigh rule drops P1 or K2 because the record can't separate them from K1 or S2 (under about 183 days), they're inferred from a neighbor's ratios ([Foreman 1977](https://waves-vagues.dfo-mpo.gc.ca/Library/54866.pdf)). Stillwell records are almost all longer than a year, so this comes last, for USGS and NOAA short-term stations.
7. **Engine check.** Every kept name must resolve in `@slackwater/engine`, at the speed the fit used. `packages/tcd` skips names it doesn't know and only lists them on stderr at the end of the build, so it fails on them instead, and so does `npm run validate`. libtcd holds at most 255 constituents across the whole file, and `packages/tcd` doesn't count them. It fails when the union of every station's names would pass that limit. High-order compounds are also why qtVlm can't load our TCD (#106), and the shallow-water expansion adds more of them, so the TCD export settles which constituents it carries before the expansion ships. What to drop from the TCD export, if that ever happens, is decided then; the database and the candidate list aren't limited by it.

### 5. Verification

Three layers, kept in the record and in a report.

- **Fit diagnostics.** SNR and confidence intervals for each constituent, the design matrix's condition number, the largest correlation between two parameters, and the year-to-year scatter.
- **Against observations.** A held-out year the fit hasn't seen, scored with the same code for our fit and every TICON copy:
  - tidal-band RMS after a Godin filter, from the unmerged #405
  - residual energy in the D1, D2, D4 and D6 bands
  - high and low water time and height RMS, with one extremum picker for both series, as Parker insists (§3.9.1, pp. 129–130)

  The held-out year is the source's last whole year of final values, the same for every gauge of the source: verified values where the source finalizes, and the last whole year older than its revision window where it doesn't. A gauge with too little of that year falls back to its own last whole year of final values. Where TICON's record covers the held-out year, its score stands but is marked as seen: the year favors TICON, so a fit that still wins replaces it, and a fit that loses doesn't.

  The constants that ship are the ones scored, fitted without the held-out year. Next year's refit takes that year in and is scored on the year after.

- **Against the agency.** Where the agency predicts from the same gauge, compare our prediction with its own over the same year. Weather is gone from this comparison, so it measures our constants against theirs directly. For each agency, compare curves where it publishes them and high and low waters where it doesn't.

| Agency           | What it publishes                                                                                                                                                                                   | How we compare                                                                                         |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| NOAA CO-OPS      | Constants (37), 6-minute predictions, high and low waters                                                                                                                                           | Constants name for name, then curves. The strongest check: NOAA fits its own gauges from the same data |
| Rijkswaterstaat  | Astronomical tide curves and extremes at 100 stations, in Stillwell                                                                                                                                 | Curves and extremes                                                                                    |
| BSH              | High and low water tables at 172 gauges, in Stillwell                                                                                                                                               | Extremes. BSH's predictions are HRoI, not harmonic                                                     |
| Kartverket       | Constants and an API, in the database already                                                                                                                                                       | Constants and curves                                                                                   |
| DMI              | 10-minute astronomical tide curves, which `sources/dmi` already imports                                                                                                                             | Curves                                                                                                 |
| Marine Institute | Curves and extremes, some from a model                                                                                                                                                              | Only at gauges with harmonic predictions                                                               |
| JMA and JCG      | Constants (60) from 10-year analyses                                                                                                                                                                | Constants                                                                                              |
| SHOM             | Predictions sold under paid licenses, internal or commercial; its portal shows 10 days free ([Marées à la carte](https://services.data.shom.fr/static/specifications/notice_marees_a_la_carte.pdf)) | After SHOM grants a license for verification                                                           |
| SMHI             | No astronomical predictions                                                                                                                                                                         | Observations only                                                                                      |

The agency comparison is a report and a regression check, not the gate. The record and the checked-in reports keep scores only, never an agency's curves, extremes or tables, so no agency's predictions are redistributed. A test checks that the report has no field that could hold them. An agency can be wrong: RWS's high waters run 8 to 16 minutes late at Vlissingen, Harlingen and Hoek van Holland against what happened ([hroi-evaluation.md](https://github.com/openwatersio/stillwell/blob/main/docs/hroi-evaluation.md)).

### 6. What ships

- **The gate.** A fit replaces TICON at a gauge when it scores no worse on the held-out year than every TICON copy, beyond the measurement error, under the `decideHeldOut` rule from the unmerged #405. Where the error can't be measured, such as a held-out year too short for two 30-day blocks, TICON stays: on the branch an unmeasured error counts as infinite, which lets any fit win, and that changes. The held-out result has to decide between the two, not the quality score's source factor: on `main`, a record whose source isn't in `SOURCE_PRIORITY` ranks at the default priority, below most of TICON's relays of the same gauge (above only the CMEMS, JODC, UNAM and a few other relays), so the fit would usually lose even after winning on the held-out year. The quality evaluation gets that rule as part of the importer. A gauge with no TICON record publishes when its fit passes the quality evaluation's existing gates.
- **Datums** come from the same series as the fit, from the values in [Series](#1-series), under [datums.md](../datums.md) and #408's gap filling. The record names the series and the datum or gauge zero they were reduced in (#403).
- **Names and positions** come from Stillwell's station metadata, the originator's own, rather than TICON's. That fixes the misspelled and inconsistent German and Swedish names (#344, #345) and the UHSLC gauges TICON puts in the wrong place (#374, #375) at every gauge that converts.
- **The record** keeps the Stillwell series and year versions, the fit and held-out windows, every constituent with its SNR, the selection steps it passed, every held-out score, and the agency comparison.
- **IDs** match Stillwell's: `<source>/<source id>`, such as `pegelonline/9340030` and `smhi/2069`, with the source id encoded as Stillwell encodes it in file paths, so an id with a `/` can't become a directory. The quality evaluation reads a fit's source from the record, not from the text after the id's last `-`, which would match a `SOURCE_PRIORITY` key for an id such as `…-wsv`. A station's ID then names the series it was fitted from, and the link to Stillwell (#402) is the ID itself. Some source names already have data directories here, keyed by the agency's own codes: `kartverket`, `jma` and `dmi`. Fits for those sources are calibration only and are never written there. If one ever ships, it needs an ID that can't collide with the existing record, and that's decided then.
- **Merges.** A fit joins the station of the TICON records it replaces, through the gauge Stillwell links them to (`same_as` from its GESLA series), not by proximity. Those TICON records stay in the station as duplicates and keep their old paths as redirects. The merge rules on `main` only know TICON ids and provenance, so this rule comes from the unmerged #405 (see [Code to reuse](#code-to-reuse)).
- **Licenses** come from the Stillwell station's `license` and `commercial_use`, mapped onto the database's license vocabulary: Stillwell's identifiers such as OGL v3 and Etalab 2.0 get entries in `LICENSE_NAMES` and the TCD restrictions. A license missing from `LICENSE_NAMES` drops the attribution notice silently, and one missing from the TCD restrictions throws, so the importer refuses a license that isn't in both. A fit that draws on more than one series, such as originator years joined with GESLA years, takes the most restrictive license of its inputs. A source's `sources/<source>/metadata.yaml` credits the originator for the observations and marks the source `authoritative: false`, since the constants are our analysis, not the agency's. Credit is one line per source today, so a fit whose inputs need more, such as UHSLC's per-contributor credits or joined GESLA years, needs a per-record credit in the schema first, and those gauges wait for it. That per-record credit is the chain of custody in #53 (originator, then each relay), and it's how UHSLC gets the credit #376 asks for. A fit from a series that isn't cleared for commercial use ships as non-commercial, like the record it replaces. Where TICON's copy is cleared and the originator's isn't (UHSLC's four withheld contributors, JODC, BOM), TICON's constants stay until the originator agrees.

### 7. HRoI

HRoI predicts high and low waters directly, as corrections to their mean times and heights after each lunar transit. It is BSH's method for the German coast ([Müller-Navarra 2013](https://www.bsh.de/DE/PUBLIKATIONEN/_Anlagen/Downloads/Meer_und_Umwelt/Berichte-des-BSH/Berichte-des-BSH_50_de.pdf); [Boesch and Müller-Navarra 2019](https://doi.org/10.5194/os-15-1363-2019)). Fitted to observed levels at six Dutch gauges, it had the lowest event-time error of any method, 7.5 to 9.2 minutes at Vlissingen and Bath against 10 to 13 for the harmonic fit ([hroi-evaluation.md](https://github.com/openwatersio/stillwell/blob/main/docs/hroi-evaluation.md)). Between extremes, the harmonic curve is as good or better.

- **Where.** Semidiurnal gauges with distorted tides and a long record of observed extremes: the German Bight and its estuaries, the Dutch coast and the Scheldt. RWS publishes observed extremes, and Stillwell holds them. For PEGELONLINE, Stillwell would pick them from the 1-minute record. About 9 years are needed to separate the main partial tides.
- **What ships.** The harmonic constants always ship and drive the curve. HRoI adds high and low water corrections, and the engine moves the curve's extremes onto them. That needs a stored HRoI block in the record (the eight partial-tide fits) and support in `@slackwater/engine`. Stillwell's `src/hroi` has the model, fit and transits to move into the engine.
- **The gate.** HRoI ships at a gauge when its held-out event-time RMS beats the harmonic fit's by more than the measurement error, on observed extremes. BSH's tables are a comparison, never training data, under BSH's terms (#335).
- **German gauges.** The plan in #392 fits German gauges from PEGELONLINE observations with HRoI, and becomes this section's first step.

## Source profiles

A profile is data: which values count as final, the native interval and any filter, the regime (which sets the candidate list and expected noise), gauges to leave out (such as CO-OPS's Great Lakes gauges), the agency comparison, and the license. Profiles for Stillwell's sources as they stand:

| Source                                 | Regime                                  | Constituents                                        | Compare with                     | Notes                                                                        |
| -------------------------------------- | --------------------------------------- | --------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------- |
| `coops`                                | Mixed; estuaries                        | Rayleigh list, expanded in estuaries                | NOAA's constants and predictions | Calibration source. Doesn't replace NOAA's constants unless it proves better |
| `rws`                                  | Shallow semidiurnal                     | Expanded (HATYAN's 94)                              | RWS's astronomical tide; HRoI    | Pre-2005 NAP epoch                                                           |
| `pegelonline`                          | Shallow semidiurnal, estuaries          | Expanded                                            | BSH tables; HRoI                 | Doesn't finalize; 1-minute values sampled on the hour                        |
| `smhi`                                 | Baltic microtidal; Kattegat semidiurnal | Rayleigh list with SNR gate; Sa and Ssa rarely kept | Observations only                | Baltic gauges near the range gate                                            |
| `kartverket`                           | Semidiurnal                             | Rayleigh list                                       | Kartverket's constants           | Calibration source                                                           |
| `refmar`                               | Semidiurnal, macrotidal                 | Expanded in the Channel                             | Observations; SHOM once licensed |                                                                              |
| `marine-institute`                     | Semidiurnal                             | Rayleigh list                                       | Marine Institute predictions     |                                                                              |
| `uhslc`                                | Global, all regimes                     | Rayleigh list                                       | Observations                     | Hourly filtered values; per-contributor licenses                             |
| `usgs`, `crms`, `cdec`, `dwr`, `sfwmd` | Tidal rivers, marshes                   | Rayleigh list; stationarity check decides           | Nearby NOAA gauge                | Many fail the range gate or the stationarity check                           |
| `jma`                                  | Mixed                                   | Rayleigh list                                       | JCG's constants                  |                                                                              |
| `ea`, `bodc`                           | Semidiurnal                             | Expanded                                            | None licensed                    | Short records so far                                                         |

## Calibration

Before the pipeline publishes anything, three sets of gauges tune and test it where the answer is known:

- **NOAA CO-OPS.** Fit 20 reference stations from their Stillwell records over NOAA's own analysis years and compare constants with NOAA's published ones. Agreement within the confidence intervals shows the fitter, nodal corrections and phase convention are right.
- **Kartverket and JCG.** The same with published constants, on other coasts and regimes.
- **RWS and PEGELONLINE.** Compare with RWS's astronomical tide and BSH's tables. This sets the shallow-water expansion trigger and checks HRoI against harmonics.

The calibration report is checked in and run again whenever the fitter changes.

## Operations

- **Running.** One GitHub Actions workflow fits every profiled source monthly from Stillwell's year manifests. It refits a gauge when its record grows by a year, its values are revised, or TICON changes (#404).
- **Residual report.** Each month, observed minus predicted at every station with a Stillwell series, fitted by us or not (#401). Tidal-band energy points to wrong constants, which stay here. A step points to a datum shift and a whole-hour lag to a clock error, which go to Stillwell.
- **Reproducibility.** A record names the Stillwell year versions it read. Re-running with those versions gives the same constants.
- **Review.** `report:merges` and the calibration report go with every PR that changes fitted data.

## Code to reuse

Earlier fits of SMHI and WSV gauges live on unmerged branches. Their station data gets regenerated by this pipeline, but these pieces carry over:

| Piece                                                                                                                                                                                                            | Where                                                                                                    | Goes to                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Reading a Stillwell series, with epochs, year manifests, version-stamped cache and the checks that refuse a partial read (`readLakeSamples`, `sourceFinalizes`)                                                  | `packages/harmonic-analysis/lake.ts` on `claude/lake-year-manifests` (0484122f5)                         | [Series](#1-series)                                                                              |
| Tidal-band residual after a Godin filter (`tidalResidual`, `tidalResiduals`)                                                                                                                                     | `packages/harmonic-analysis/index.ts` on `feat/wsv-lake-fits` (14c342925)                                | [Verification](#5-verification)                                                                  |
| Standard error of a score difference from 30-day blocks (`varianceDifferenceSE`)                                                                                                                                 | `sources/water-levels/lake.ts` on `feat/wsv-lake-fits`                                                   | [Verification](#5-verification)                                                                  |
| The held-out decision: measurement-error margin, distance bound, constants digest (`decideHeldOut`, `scoresWorse`). Its rule for records that saw the year changes to the one in [Verification](#5-verification) | `packages/stations/evaluate-quality.ts` and `filtering.ts` on `feat/wsv-lake-fits`                       | [What ships](#6-what-ships)                                                                      |
| TICON records fitted from another gauge's data (`MISFILED_RECORDS`, Uddevalla)                                                                                                                                   | `packages/stations/filtering.ts` on `feat/wsv-lake-fits`                                                 | Quality evaluation; the data error also goes to Stillwell                                        |
| Names and positions from Stillwell metadata, curated German gauge names, WSV credit                                                                                                                              | `sources/water-levels/lake.ts`, `stations/tide/de/`, `sources/wsv/metadata.yaml` on `feat/wsv-lake-fits` | The importer's PEGELONLINE profile, with the credit moved to `sources/pegelonline/metadata.yaml` |
| Merging a fit into the station of the TICON records it was scored against (`planMerges`)                                                                                                                         | `packages/stations/merges.ts` on `feat/wsv-lake-fits`                                                    | [What ships](#6-what-ships)                                                                      |
| Comparing BSH's and our extremes with observed ones (`lake-obs.ts`)                                                                                                                                              | `docs/research/harmonic-inequalities/measurements/` on `feat/wsv-lake-fits`                              | [Verification](#5-verification) and [HRoI](#7-hroi)                                              |

The `3N2` and `3L2` perigee rule (`PERIGEE_PARTNER` on the unmerged branches, `unresolvedFromN2` for 3N2 alone on `main`) isn't carried over: the Rayleigh rule in [Constituent selection](#4-constituent-selection) covers it.

## Related issues

Every open issue this plan touches, and where it goes.

Parts of this plan:

| Issue                                                          | Where it goes                                                                                                          |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| #399 Re-fit the remaining TICON contributors                   | Replaced by the [Order of work](#order-of-work): contributors convert through one pipeline, not one importer at a time |
| #400 Combine series year by year                               | [Series](#1-series), older years: find out in Stillwell why years are missing before joining GESLA's                   |
| #401 Monthly report of predictions against observations        | [Operations](#operations), residual report                                                                             |
| #402 Link tide stations and Stillwell series both ways         | [What ships](#6-what-ships), IDs that match Stillwell's                                                                |
| #403 Record which series and gauge zero datums come from       | [What ships](#6-what-ships), datums                                                                                    |
| #404 Re-fit stations each year                                 | [Operations](#operations), running                                                                                     |
| #238 Let each source define its own constituents               | [Constituent definitions](#constituent-definitions)                                                                    |
| #53 Full chain of custody                                      | [What ships](#6-what-ships), licenses and credit                                                                       |
| #106 qtVlm can't load our TCD                                  | [Constituent selection](#4-constituent-selection), engine check, and an open question                                  |
| #146 Updating to GESLA 4.1                                     | [Series](#1-series), older years                                                                                       |
| #392 Plan German tide stations from observed water levels (PR) | [HRoI](#7-hroi), its first step                                                                                        |
| #408 Fill short data gaps in datums (PR)                       | [What ships](#6-what-ships), datums                                                                                    |

Sources whose fits come through this pipeline, once Stillwell carries them under terms that allow it:

| Issue                                                           | Status here                                                                                                                                                                   |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #148 Expand tide-height coverage                                | Parent of the source issues below. Fitting open water-level records is one of its routes                                                                                      |
| #138 UHSLC hourly data                                          | The `uhslc` profile. Waits on per-record credit and UHSLC's commercial terms ([stillwell#80](https://github.com/openwatersio/stillwell/issues/80))                            |
| #124 IOC Sea Level Station Monitoring Facility                  | Restricted, so it needs IOC data in Stillwell and VLIZ's agreement first ([Stillwell decision 8](https://github.com/openwatersio/stillwell/blob/main/docs/plan.md#decisions)) |
| #324 Re-derive CMEMS stations under Copernicus Marine's licence | Copernicus Marine becomes a Stillwell source request, then a profile here                                                                                                     |
| #152 Rijkswaterstaat tide heights                               | The `rws` profile fits RWS's observations and compares with its astronomical tide. RWS's own constants, if it publishes them, would still come first                          |
| #380 Dutch gauges with no usable record                         | The `rws` fits publish them once RWS's history back to 1990 is in Stillwell                                                                                                   |
| #154 Marine Institute tide heights                              | The `marine-institute` profile fits observations and compares with the Marine Institute's predictions, at gauges whose predictions are harmonic                               |
| #335 BSH tide heights                                           | BSH's tables are a comparison and HRoI's reference, never training data                                                                                                       |

TICON records with known faults, fixed at each gauge when its originator's series converts:

| Issue      | Gauge and fault                                                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| #290       | Apia's old UHSLC record runs two hours late. The clock check catches it                                                              |
| #289       | Settlement Point's UHSLC record points at the wrong station                                                                          |
| #355       | Koper and Andratx (CMEMS relays) publish almost no tide. Their originators aren't in Stillwell yet, so they're source requests there |
| #374, #375 | UHSLC gauges in the wrong place                                                                                                      |
| #344, #345 | Misspelled and inconsistent German and Swedish names                                                                                 |
| #376       | UHSLC isn't credited                                                                                                                 |

## Order of work

1. Feedback to Stillwell: the inventory of GESLA-only years, and issues for the other needs under [Stillwell](#stillwell).
2. Constituent definitions in the database format and the engine (#238, slackwater#241 and slackwater#242), with TICON's and Kartverket's conventions moved into data, and a format major version the readers check.
3. Engine: multi-year nodal fit with weights, confidence intervals and SNR, and constituent selection in `@slackwater/engine`, with tests against synthetic tides of known constants. Then the engine check in `packages/tcd` and validation, and the move of `fitHarmonics` onto the new `fit()`.
4. Verification harness: held-out scoring, extremum picker, band energy and the agency comparisons, as one report.
5. Calibration against NOAA, Kartverket and JCG constants, and RWS and BSH predictions.
6. `sources/stillwell` importer with profiles, IDs, datums and the record's provenance, run first on SMHI and PEGELONLINE. With it: schema fields for the fit's provenance and the fitted Sa and Ssa, the license vocabulary and TCD restrictions for Stillwell's licenses, the merge rule, the held-out rule in the quality evaluation, and the docs they change (`CONTRIBUTING.md`, `docs/database-format.md`, `docs/quality-evaluation.md`).
7. Remaining contributors in the order of Stillwell's [TICON replacement inventory](https://github.com/openwatersio/stillwell/blob/main/docs/ticon-replacement.md).
8. HRoI in the engine and the database format, then at the German and Dutch gauges.
9. Monthly workflow and residual report.

## Open questions

- Whether SHOM will license its predictions for verification, and on what terms. Ask through SHOM's data service, citing that only scores are published, never SHOM's predictions.
- The shallow-water trigger and the stationarity threshold, both to be set by calibration.
- Whether the engine moves extremes onto HRoI's events, or HRoI publishes its own event list beside the curve.
- Whether definitions live per source, per station, or both, and whether slackwater#241 lands before or with the format change.
- Whether the TCD export keeps only the constituents XTide's set knows, so qtVlm can load it (#106), or keeps every constituent the database has.
