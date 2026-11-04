# German tide gauges from the harmonic representation of inequalities

Replace the TICON-derived German North Sea stations with our own predictions. We fit the harmonic representation of inequalities (HRoI), the method BSH uses, to WSV water level observations from the water-level lake, and score the results against BSH's official tables.

## Why

- Our German stations are all TICON fits. The `sources/bsh` validator ([#391](https://github.com/openwatersio/slackwater-database/pull/391)) finds every one of the 96 matched gauges predicting earlier than BSH. The median bias is −12 minutes, and at upper-river low waters it reaches −75 minutes.
- The lake's evaluation ([water-levels docs/hroi-evaluation.md](https://github.com/openwatersio/water-levels/blob/main/docs/hroi-evaluation.md)) shows that HRoI reproduces BSH's predictions and that harmonics can't. Fitted to one year of BSH predictions and scored on the next at 15 gauges:
  - HRoI is within 5.4–6.9 minutes and 2.9–5.3 cm RMS.
  - An 89-term harmonic fit is within 8–38 minutes and 11–23 cm, and it is worst in the rivers.
  - On eight years of Dutch observations, HRoI times high and low waters better than our harmonic fit, and slightly better than RWS's own prediction.
- HRoI gives exactly one high and one low water per half lunar day. That is the event-selection rule the RWS work ([#152](https://github.com/openwatersio/slackwater-database/issues/152)) has been missing.

## Constraints from BSH

From BSH's emails of 2026-11-02 and 2026-11-03 (recorded in the research notes in #391):

- Train on WSV water level observations, not on BSH's predictions. If we trained on BSH's predictions, we would have to omit any acknowledgement of BSH, and BSH recommends against it. **This plan trains on observations only.**
- Predictions from our own fits are our product, published at our risk, and must never name BSH as their source.
- BSH does not release its HRoI constants.

So BSH's tables are only a yardstick, used through the validator, and nothing from BSH ships. The source is WSV's PEGELONLINE data under DL-DE→Zero-2.0, which needs no attribution, although we can credit WSV anyway. The source is therefore named `pegelonline`, matching the lake's source ID, and not `bsh`.

## Decisions to make first

1. **Source name and credit.** Use `sources/pegelonline` with a WSV credit, not `bsh`. BSH must not appear as the source of the predictions.
2. **Curve between extremes.** HRoI predicts events. The lake's single mean curve is 5–10 cm off at Husum, Büsum and Papenburg, and the harmonic curve is as good or better between extremes. Proposal: keep harmonic constituents on each station for the curve, and warp them in time and height to pass through the HRoI extremes. Alternatives are mean curves by tidal range or by event index, as BSH appears to use, or the lake's single mean curve.
3. **Transits.** The lake computes true Greenwich transits with astronomy-engine. The JS and Swift engines would then each need a lunar ephemeris accurate to seconds. Fitting against a uniform mean-transit grid instead would need no ephemeris, provided the long-period terms absorb the difference between mean and true transits. Measure both in phase 2 before choosing.
4. **Old readers.** A station without constituents would break app versions that predate HRoI. Every HRoI station keeps a harmonic constituent set: a fresh harmonic fit to the same observations, or the existing TICON record. Readers without HRoI support then fall back to it, and so does the TCD export for OpenCPN and XTide.
5. **Scope.** North Sea and tidal-river gauges only. The four Baltic gauges in BSH's group 3 stay harmonic. Their tide is too small and weather-driven for one high and one low water per half day to be meaningful; Kiel-Holtenau is already the one gauge where our event count differs from BSH's by 18.

## Phases

### 1. Observation history in the lake (water-levels)

- [ ] Backfill PEGELONLINE history from the station pages' "Download Wasserstände (Rohdaten) ab dem 1.1.2000". The API keeps only 31 days. The "Water levels harmonic fitting" session is collecting this data now, so check its result before starting.
- [ ] Record each gauge's interval, gaps and datum changes across 2000–2026. Raw data are unchecked: flag spikes, flat lines and datum jumps in `src/qc.ts`.
- [ ] Extract observed high and low waters into `extremes/pegelonline/<station>/<year>.parquet`. PEGELONLINE publishes none, so we need our own rule: smoothing plus a turning-point search. Document the rule. BSH's rule (Müller-Navarra 2009) isn't available to us. Keep every observed turning point, including double highs and lows ([#152](https://github.com/openwatersio/slackwater-database/issues/152) shows they are real and must not be forced to a fixed count).
- [ ] Select HRoI training events as a separate, documented step: one high and one low per half lunar day, assigned to transits by HRoI's `assign`. Record per gauge and year what share of half days had extra turning points that the selection dropped. Exclude a gauge from HRoI when that share exceeds a threshold fixed before the evaluation, because forcing its events would bias the fit.
- [ ] Inventory: which of BSH's 142 gauges are WSV gauges on PEGELONLINE. Hamburg's HPA gauges and state-run gauges may not be. Record which years each has and the TICON record it matches, by PEGELONLINE number. TICON's WSV IDs embed that number, for example `helgolandbinnenhafen-9510070`.

### 2. Evaluation gate (water-levels)

Extend `docs/hroi-evaluation.md` with German observations. At the same 15 gauges, and at all of them once the setup is settled:

- [ ] Fit HRoI to observed extremes over 19 years (2005–2023 where available), and over 9 years where the record is shorter. Score on observed 2024 and 2025 extremes and on BSH's 2026 and 2027 tables.
- [ ] Compare four predictors on the same held-out data: HRoI with true transits, HRoI with mean transits, a harmonic fit with shallow-water terms to the same observations, and the current TICON station.
- [ ] Compare the curve options from decision 2 on held-out 1-minute levels.
- [ ] **Gate**, written into the evaluation doc before any candidate is scored:
  - Against held-out observations, HRoI must beat both TICON and the harmonic fit on event-time RMS (minutes) and on event-height RMS (cm), each by more than that gauge's own spread between its 2024 and 2025 scores, so a win is larger than year-to-year noise.
  - Against BSH's tables, HRoI must pass the `sources/bsh` validator relative to the gauge's current TICON baseline in `validation.json`, using the validator's existing tolerances: no regression in any metric, and a smaller `|timeMean|` and `timeSd`.

Done when the evaluation has numbers for every candidate gauge and settles decisions 2 and 3.

### 3. Engine support (slackwater: `@slackwater/engine` and SlackwaterKit)

- [ ] Move the HRoI implementation from water-levels into `@slackwater/engine`, so there is one implementation. It is about 470 lines: `src/hroi/index.ts` (`estimateIntervals`, `assign`, `measure`, `fit`, `predict`, `meanCurve`, `curveAt`, `canonicalExtremes`), `src/hroi/constituents.ts` (set 3) and `src/hroi/transits.ts`, with `test/hroi.test.ts` and its Cuxhaven fixture. The engine is the home for both fitting and prediction, because it already has the harmonic `fit.ts`, depends on `ml-matrix`, and has an `astronomy/` module. For transits, use that module if it finds the moon's Greenwich transits to within a few seconds, and add `astronomy-engine` otherwise. Do this before phase 2 grows the code, so the evaluation builds on the engine's version.
  - The fixture is BSH's own Cuxhaven 2026 predictions, kept only as test reference data, with BSH's credit line beside it. Docs and comments that ship with the engine describe HRoI as a published method (Horn 1960; Boesch and Müller-Navarra 2019) and never name BSH as the source of our predictions.
  - The move leaves decisions 2 and 3 open: `meanCurve` and `curveAt` come along unchanged.
  - Afterwards, in a separate water-levels PR, delete `src/hroi/` and import the published engine in `scripts/evaluate-bsh.ts` and `scripts/evaluate-rws.ts`.
- [ ] An HRoI model type: the partial-tide set (BSH's 39-tide set 3, referenced by ID), mean lunitidal intervals, four event series of interval and height coefficients, and the curve data from decision 2. That is about 650 floats per gauge.
- [ ] Prediction in JS and Swift: transits (decision 3), events per transit, and a timeline from the chosen curve. `useStation` picks HRoI extremes when the station has a model, and harmonics otherwise.
- [ ] Shared golden fixtures through `fixtures/generate`, so JS and Swift agree to the second and the millimetre, and both pass the test cases moved from water-levels.
- [ ] `sources/pegelonline` calls the engine's `fit`. The fitting runs on the tide-database side, as lake plan decision 7 requires, but the code lives in the engine.

### 4. Database format (slackwater-database)

- [ ] `schemas/database.fbs`: an optional HRoI table on `Station`, kept in the tail band with the other prediction data, plus `schemas/station.schema.json`, the builder, the reader, and the regenerated Swift reader.
- [ ] `docs/database-format.md`: document the new table, and confirm that older readers ignore the field.
- [ ] `packages/tcd`: export the fallback constituents and skip the HRoI model.
- [ ] Datums: reduce MHW, MLW, MHWS, MLWS and the neap values from the observed extremes, not from the fit, over a stated 19-year window. Count only years where at least 90% of half lunar days have a selected high and low, and record the coverage in `DatumCoverage`. Only that reduction is `DatumsSource.Observed`; a gauge without enough complete years keeps its current datums. Take offsets to chart datum (SKN) and NHN from PEGELONLINE or the lake's `datums`. `docs/datums.md` gets an HRoI section.

### 5. Source (slackwater-database)

- [ ] `sources/pegelonline`: read each gauge's observed extremes and levels from the lake (`https://water-levels.openwaters.io/`, Parquet). Fit HRoI and the fallback constituents, gate each gauge on its held-out year, and write `data/pegelonline/<id>.json`.
- [ ] Pin the inputs: `refresh:pegelonline` writes a manifest of the lake files used, with their checksums, and the import reads only what the manifest names. Build the output in a staging directory and replace `data/pegelonline` only when every manifest gauge parsed and the gauge count has not dropped, unless a flag accepts the drop, so a lake revision or partial download can't silently change or erase stations.
- [ ] `metadata.yaml`: the WSV credit, DL-DE→Zero-2.0, and `authoritative: false`. Add a README with the method, the gate and the measured results.
- [ ] Join existing station identities by PEGELONLINE number through a reviewed crosswalk, as JMA's `ticon-originators.json` does, not by proximity. Keep the TICON records attached.
- [ ] Rank the new record first where it passes the gate. This needs code: `scoreSource` in `packages/stations/evaluate-quality.ts` ranks non-authoritative records by their TICON source suffix, so a `pegelonline/<number>` record falls to the default priority of 50, below TICON's `wsv` records at 20. Add an explicit rule for `pegelonline/`, as `dmi/` has, and a test that the Pegelonline record becomes primary at a merged gauge such as Cuxhaven.
- [ ] Run `npm run stations` and review the merges with `report:merges`.
- [ ] Rebaseline the `sources/bsh` validator and record the improvement per gauge.

### 6. Release order

1. Release the engine and SlackwaterKit with HRoI support.
2. Update the apps to that engine.
3. Publish the database with the HRoI tables. Old readers keep predicting from the fallback constituents.
4. Each year, refit on the latest 19 years, as BSH does, because rivers change after dredging.

## Open questions

- Should this source cover the Dutch gauges too? HRoI beat both our harmonic fit and RWS's own prediction there, and would settle [#152](https://github.com/openwatersio/slackwater-database/issues/152). The lake already has RWS's observed extremes.
- Which consumers need HRoI at launch? Do the iOS app, the Android app, signalk-tides and the API all take the engine release, or does any of them stay on the fallback?
- Should the gate also require agreement with BSH, or is beating TICON against observations enough?
