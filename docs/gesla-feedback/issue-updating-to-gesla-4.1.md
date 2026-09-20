Title: Updating to GESLA 4.1

GESLA released version 4.1 in July 2026 ([downloads](https://gesla787883612.wordpress.com/downloads/)). Our TICON import carries several workarounds for problems in specific GESLA 4.0 sources, so before adopting 4.1 data anywhere in the pipeline we compared the two versions record by record. This issue records what changed, what still needs a workaround, and what an update involves. [`stations.csv`](https://github.com/openwatersio/tide-database/blob/937f5c1fbf04df60b67d0776d0f99e43ec8a69e5/docs/gesla-feedback/stations.csv) lists the 142 WSV and 56 RWS records we import with their 4.1 record ID, test status, and evidence. It is also written to be readable by the GESLA team, since most of the findings are feedback for them.

TICON-4 is fitted to GESLA 4.0, so nothing changes in the import until a TICON release follows 4.1 or we fit constituents from 4.1 levels ourselves. Evidence and scripts are in [`docs/gesla-feedback/`](https://github.com/openwatersio/tide-database/blob/937f5c1fbf04df60b67d0776d0f99e43ec8a69e5/docs/gesla-feedback).

## Summary

| 4.0 issue | Our workaround | Status in 4.1 |
| --- | --- | --- |
| WSV records stamped in German legal time but labelled `TIME ZONE HOURS 0` (#96) | `LOCAL_TIME_SOURCES.wsv` re-fits constituents from raw levels in Europe/Berlin | Fixed, but the values are now hourly means stamped at the start of the hour, so every WSV gauge reads 30 minutes early |
| RWS records converted with a fixed 1 h offset, so summer timestamps are 1 h ahead of UTC (#98) | `LOCAL_TIME_SOURCES.rws` re-fits in Europe/Amsterdam and re-adds the hour | Fixed |
| Datum jumps inside a record flagged usable (#93, #40) | Seasonal-contamination gate; observed datums use the most recent 19 years only | Unchanged |
| `DATUM INFORMATION Unspecified` on 1,301 records | Datums derived in the gauge frame | Unchanged (1,304) |
| Download is an iCloud share | Zip mirrored to R2 in `download-gesla.ts` | ERDDAP API added, but it holds 6,129 of 6,682 records |
| CMEMS, CV, UZ consultancy restriction (#52) | `NON_COMMERCIAL_SOURCES` | Licence page unchanged; already raised with the maintainers |
| UHSLC fast-delivery and research-quality records at the same gauge differ by about 2 h (#98) | Dedup keeps one | Not tested |

Also new in 4.1: every RWS record ID changed, and 21 RWS records have no 4.1 counterpart.

## Method

For each record, take two windows in one year (10 January to 10 March and 10 June to 10 August), keep samples with the use flag set, and fit a mean, a trend, and seven constituents (M2, S2, N2, K1, O1, K2, M4) to each version by least squares, with time measured from the same UTC origin. Equilibrium arguments and nodal corrections cancel between the two fits, so the phase difference divided by the constituent speed is the timestamp shift between versions. The same fit against a nearby gauge from a different contributor gives the absolute error. The script is [`evidence/tidefit.py`](https://github.com/openwatersio/tide-database/blob/937f5c1fbf04df60b67d0776d0f99e43ec8a69e5/docs/gesla-feedback/evidence/tidefit.py) and it resolves shifts to a few minutes. Cross-correlating 48-hour windows of hourly data cannot separate adjacent hours, which is why the half-hour error below is invisible to that approach.

4.1 data came from the [ERDDAP API](https://uhslc.soest.hawaii.edu/erddap/tabledap/global_hourly_gesla.html) where the record exists there, and otherwise from single files extracted from the 4.1 zip by HTTP range request.

## WSV: fixed, with a new half-hour error

In 2022 the correct conversion from German legal time is 1 h in winter and 2 h in summer. The change between 4.0 and 4.1 is 1.49 h and 2.49 h.

| Test | Records | Result |
| --- | ---: | --- |
| 4.0 vs 4.1 API | 59 | 56 at +1.49 h winter, +2.49 h summer. One at +1.0 / +2.0 (Baltic, M2 1 mm). Two irregular: Bake Z (Baltic, M2 1 mm) and Tönning summer (barrage operations) |
| 4.0 vs 4.1 zip | 9 | Brake, Brokdorf, Elsfleth Ohrt, Farge, Glückstadt at +1.49 / +2.49. Four Baltic gauges have no measurable tide |
| 4.1 WSV vs 4.1 neighbour within 3 km | 22 pairs, 44 seasons | Median −0.49 h; 40 of 44 between −0.4 and −0.6 h. Neighbours are CMEMS, BfG, and UHSLC gauges that agree with each other |
| 4.0 WSV vs 4.0 neighbour | same pairs | +1.00 h winter, +2.00 h summer |
| M2 amplitude 4.0 to 4.1 | 56 | Ratio 0.989 to 0.990 everywhere. A one-hour boxcar attenuates M2 by 0.9894 |

The 4.1 WSV files contain hourly means (values like 3.9343 where 4.0 has 3.7900), identical in the zip and the API. A mean over 00:00 to 01:00 stamped 00:00 is half an hour early. Stamping it at 00:30, or documenting an end-of-interval convention, removes the error. Any other sub-hourly contributor averaged the same way will carry the same bias.

Evidence: [`wsv_old_vs_new.json`](https://github.com/openwatersio/tide-database/blob/937f5c1fbf04df60b67d0776d0f99e43ec8a69e5/docs/gesla-feedback/evidence/wsv_old_vs_new.json), [`wsv_zip_old_vs_new.json`](https://github.com/openwatersio/tide-database/blob/937f5c1fbf04df60b67d0776d0f99e43ec8a69e5/docs/gesla-feedback/evidence/wsv_zip_old_vs_new.json), [`wsv_vs_neighbors.json`](https://github.com/openwatersio/tide-database/blob/937f5c1fbf04df60b67d0776d0f99e43ec8a69e5/docs/gesla-feedback/evidence/wsv_vs_neighbors.json).

## RWS: fixed

| Test | Records | Result |
| --- | ---: | --- |
| 4.0 vs 4.1 API | 38 matchable long records | 0.00 h winter, +1.00 h summer at every one |
| 4.1 RWS vs 4.1 CMEMS at the same site | Cadzand, Hoek van Holland, Vlissingen, Den Helder, Harlingen | 0.00 h in both seasons, M2 amplitudes identical to the millimetre |
| Cadzand ten-minute values, 2022 | 2 × 48 h | 288 of 288 identical after the seasonal shift |

The `rws_hist` records keep their IDs and were already on UTC. Evidence: [`rws_old_vs_new.json`](https://github.com/openwatersio/tide-database/blob/937f5c1fbf04df60b67d0776d0f99e43ec8a69e5/docs/gesla-feedback/evidence/rws_old_vs_new.json).

## RWS record identity

All 120 RWS IDs from 4.0 are gone. 278 new IDs use a three-letter site code instead of the Rijkswaterstaat code (`cadzand-cadzd-nld-rws` becomes `cadzand_2-cad-nld-rws`) and some carry new names (`west_terschelling` to `terschelling_west`, `den_helder` to `den_helder_marsdiep`, `oudeschild` to `texel_oudeschild`, `vuren` to `dalem`). Pairs of a long record plus a short 2024 to 2025 record are merged into one. [`evidence/rws_mapping.json`](https://github.com/openwatersio/tide-database/blob/937f5c1fbf04df60b67d0776d0f99e43ec8a69e5/docs/gesla-feedback/evidence/rws_mapping.json) maps each 4.0 record to candidates within 1 km. 21 have none, including K13a (1978 to 2022), Euro platform (1982 to 2023), North Cormorant (1990 to 2023), F3, A12, D15, J6, L9, F16, and Hoorn Q1. A published old-to-new ID table with each release would save downstream users this reconstruction.

## Datum jumps flagged usable

Cape d'Or (`cape_dor-240-can-meds`): all 2,376 values from 1965 average 26.61 m; every later year averages 5.8 to 6.1 m. Every sample has QC flag 1 (correct) and use flag 1 in both versions. TICON fitted through the step and produced a 2.08 m annual constituent and an astronomical range 50% above the CHS value (#93).

Mazatlan flotador (`mazatlan_flotador-16-mex-unam`): monthly means run 2.34, 2.34, 1.48, −0.08, 0.32, 0.36, 0.15, 2.29 m from April to November 2021, then hold near 2.3 m. No samples are flagged out.

Both headers say "Possible datum and quality control issues", which a person can read but software cannot act on. Setting QC flag 3 on the affected span, or splitting the record at the jump, would let consumers drop it.

## Metadata and access

| Field | 4.0 | 4.1 |
| --- | ---: | ---: |
| Records | 6,474 | 6,682 |
| Records kept with the same ID | | 6,354 |
| Kept records with a later end date | | 1,710 |
| `DATUM INFORMATION Unspecified` | 1,301 | 1,304 (all 142 WSV, all 939 UHSLC) |
| `COORDINATE SYSTEM Unspecified` | 5,027 | 5,188 |
| Records in the ERDDAP API | | 6,129 |

New records: 278 RWS, 47 BOM, 3 ISPRA. Dropped: 120 RWS. One record (`wewak-56070-png-bom`) is labelled `TIME ZONE HOURS 1`.

The API is missing 207 CMEMS, 83 WSV, 64 SMHI, 75 UHSLC, 23 MEDS, 19 BOM, 17 NOAA, 14 FMI, and 51 other records. For WSV, PegelOnline publishes each gauge zero relative to NHN, so the missing datum information is recoverable. The zip is only reachable through an iCloud share; the share resolves to a URL that honours range requests, which is how single records were extracted here, but that path is undocumented. No checksums or changelog are published, and the [assembly page](https://gesla787883612.wordpress.com/assembly/) still describes 4.0.

## What updating involves

- [ ] Wait for a TICON release built on 4.1, or decide to fit constituents from 4.1 levels ourselves (#124 and #138 already fit from observations)
- [ ] Point `download-gesla.ts` at 4.1 (mirror the zip, or read from ERDDAP with a zip fallback for the 553 missing records)
- [ ] Replace the WSV `Europe/Berlin` reinterpretation with a fixed +30 min shift, and re-check against neighbours
- [ ] Drop the RWS `Europe/Amsterdam` re-fit
- [ ] Migrate RWS station IDs using [`rws_mapping.json`](https://github.com/openwatersio/tide-database/blob/937f5c1fbf04df60b67d0776d0f99e43ec8a69e5/docs/gesla-feedback/evidence/rws_mapping.json); decide what to do with the 21 records that have no counterpart
- [ ] Re-check `gaugeKey()` against the new RWS ID structure
- [ ] Keep the seasonal-contamination gate; add a datum-jump check on the raw levels so Cape d'Or and Mazatlan are caught at import rather than by neighbour comparison
- [ ] Regenerate datums with the extended records (1,710 records gained data)
- [ ] Test the UHSLC fast-delivery vs research-quality 2 h discrepancy in 4.1
