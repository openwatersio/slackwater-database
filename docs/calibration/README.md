# Calibration

The fitter is calibrated on gauges where the answer is known: an agency fits its own gauge and publishes the constants. We fit the same gauge from its [Stillwell](https://github.com/openwatersio/stillwell) record, over the agency's own analysis period and with the agency's own constituent list, and compare constituent by constituent. Agreement within our fit's 95% confidence intervals shows the fitter, the nodal corrections and the phase convention are right ([plan](../plans/stillwell-constituents.md#calibration)).

Run it again whenever the fitter changes, and commit what it writes. `npm test` fails when the installed `@slackwater/engine` isn't the build the report was fitted with:

```sh
npm run refresh:calibration -w packages/harmonic-analysis
```

It reads Stillwell into `tmp/stillwell/` and writes [calibration.json](calibration.json), with the engine build it fitted with (where npm resolved it from), digests of the code and of each gauge's agency constants, and one [verification report](../plans/stillwell-constituents.md#5-verification) per gauge, and the results below. A gauge that can't be fitted stops the refresh and leaves both files as they were. `npm test` fails when the installed engine, the code in `CODE` ([calibration-inputs.ts](../../packages/harmonic-analysis/calibration-inputs.ts)), the pinned gauges or the agency constants in `data/` no longer match the report. It doesn't see the TICON records scored for the TICON column, or Stillwell's data, which a refresh reads afresh. Both files are written once built, so only a crash between the two writes could leave them out of step.

## Gauges

- **Kartverket**: the 24 gauges whose constants come from Kartverket's 2006–2020 or 2010–2020 analyses (`KARTVERKET` in [calibration-inputs.ts](../../packages/harmonic-analysis/calibration-inputs.ts), checked against `data/kartverket` by `npm test`), fitted from `kartverket/<code>` over the period in `data/kartverket/<code>.json`. Kartverket analyzes with UTide, so we fit with Foreman's nodal corrections at the gauge's latitude, evaluated at each sample, and take SA_KV from a fit over 1991–2020. Kartverket runs its 10-minute values through a zero-phase low-pass filter first, a 4th-order Butterworth with a 2.98-hour cutoff, so our amplitudes and their intervals are scaled by that filter's gain before they are compared (`kartverketGain`). These are joint fits, so a year with under two thirds of its hours is read as it is, as in Kartverket's own fit, and calibration.json lists it under the gauge's `fit.shortYears`. Kartverket doesn't document the filter: its order and cutoff are estimated from these same constants above 4.5 cycles a day, so agreement in those bands shows the filter is consistent with them, not an independent check.
- **NOAA CO-OPS**: 20 reference stations, fitted from `coops/<id>` and compared with `data/noaa/<id>.json`. The stations are pinned (`NOAA` in [calibration-inputs.ts](../../packages/harmonic-analysis/calibration-inputs.ts)); each refresh reads their analysis years from the comment on their constants in NOAA's harmonic constituents API, and stops on a comment it can't read. The comment and the years read from it are stored with each gauge in calibration.json. NOAA fits one year at a time with Schureman's nodal corrections, the argument taken at January 1 and f and u at July 2, and publishes the vector average of the years (Parker 2007, pp. 41 and 94). We do the same, over each year with two thirds of its hours, and take the long-period constituents each comment names from the longer span it gives. Where a comment names a constituent without saying which years it used, as when it counts fewer years than its span, that constituent is left out of the comparison, and calibration.json gives the reason. The monthly NOAA import opens its PR as a draft. A separate job then runs the refresh, pushes the report to that PR and marks it ready; if the refresh fails, the job comments on the PR, which stays a draft, and the station data still arrives for review.

Each agency's constants are scored on observations with the nodal corrections the predictors offer closest to its own: Schureman's for NOAA, IHO's for Kartverket. Constituents above the eighth-diurnal band are left out of our fits, which the plan's [sampling rule](../plans/stillwell-constituents.md#1-series) sets for hourly values: they sit close to the hourly limit of twelve cycles a day.

## Reading the results

- **Compared**: constituents both fits have. **Without an interval**: those our fit gave no interval for. Nothing shows they agree, so `npm test` fails on them too.
- **Outside**: constituents whose difference in amplitude or phase exceeds our 95% interval, widened in quadrature by half the last digit the agency publishes, with the long-period ones (slower than 5°/h) in brackets. Both fits take the agency's method to the gauge's record, ours from Stillwell's hourly values where Kartverket reads 10-minute values. They differ only where the data each read or the method differs, and `npm test` fails on any comparison outside.
- **Outside and over 1 mm apart**: the constituents outside whose amplitudes also differ by more than 1 mm.
- **Largest ratio**: the constituent furthest outside, as its difference over the widened interval's half-width.
- **Held-out year**: the source's last whole year of final values after the fit's period, scored as the [verification report](../../packages/harmonic-analysis/verify-fit.ts) describes. "none" when the fit's period reaches it.
- **Fit RMS** and **Agency RMS**: tidal-band residual RMS on the held-out year, after a Godin filter.
- **Fit vs agency** and **Fit vs TICON**: the fit's verdict against each, beyond the measurement error; "seen" marks a record whose analysis covered the held-out year. TICON's column includes this database's re-fits of TICON's gauges.
- **Curve RMS**: our predicted curve against one from the agency's constants over the held-out year, with the mean difference removed.

## Credits

Kartverket's constants: © Kartverket / Norwegian Mapping Authority, Hydrographic Service, https://www.kartverket.no, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The differences here are derived from them. NOAA's constants and CO-OPS observations are public domain. Observations are read from Stillwell, which credits each station's source.

## Results

<!-- calibration results -->

Gauges fitted: 44 of 44.

| Source      | Compared | Without an interval | Outside our 95% interval | Long-period | Outside and over 1 mm apart | Median ratio outside |
| ----------- | -------: | ------------------: | -----------------------: | ----------: | --------------------------: | -------------------: |
| Kartverket  |     1320 |                   0 |                11 (0.8%) |           0 |                           0 |                 1.13 |
| NOAA CO-OPS |      698 |                   0 |                17 (2.4%) |           0 |                           4 |                 1.07 |
| All         |     2018 |                   0 |                28 (1.4%) |           0 |                           4 |                 1.12 |

### Kartverket

| Gauge          | Fitted                   | Compared | Outside (long-period) | Largest ratio | Held-out year | Fit RMS (mm) | Agency RMS (mm) | Fit vs agency | Fit vs TICON                                        | Curve RMS (mm) |
| -------------- | ------------------------ | -------: | --------------------: | ------------- | ------------: | -----------: | --------------: | ------------- | --------------------------------------------------- | -------------: |
| kartverket/AES | 2006-01-01 to 2020-12-31 |       56 |                 0 (0) | M2 0.5        |          2024 |         53.7 |            53.7 | tie           | tie (seen), better (seen)                           |            1.7 |
| kartverket/ANX | 2006-01-01 to 2020-12-31 |       58 |                 0 (0) | M8 0.9        |          2024 |         34.4 |            34.4 | tie           | better (seen), better, better (seen), better (seen) |            2.7 |
| kartverket/BGO | 2006-01-01 to 2020-12-31 |       55 |                 0 (0) | M3 0.4        |          2024 |         40.7 |            40.7 | tie           | better (seen), better (seen)                        |            1.9 |
| kartverket/BOO | 2006-01-01 to 2020-12-31 |       57 |                 0 (0) | 2MK6 0.9      |          2024 |         56.4 |            56.4 | tie           | better (seen), better (seen)                        |            1.5 |
| kartverket/HAR | 2006-01-01 to 2020-12-31 |       60 |                 0 (0) | SO3 0.5       |          2024 |         33.9 |            34.0 | tie           | better (seen), better (seen)                        |            1.6 |
| kartverket/HEI | 2006-01-01 to 2020-12-31 |       55 |                 0 (0) | 2MK5 0.8      |          2024 |         45.3 |            45.3 | worse         | better (seen), better (seen)                        |            1.9 |
| kartverket/HFT | 2006-01-01 to 2020-12-31 |       60 |                10 (0) | OQ2_KV 1.4    |          2024 |         38.7 |            38.8 | tie           | better (seen), better (seen)                        |            2.7 |
| kartverket/HRO | 2006-01-01 to 2020-12-31 |       48 |                 0 (0) | MSK6 0.4      |          2024 |         68.7 |            68.6 | worse         | tie (seen), tie (seen)                              |            1.9 |
| kartverket/HVG | 2006-01-01 to 2020-12-31 |       62 |                 0 (0) | M6 0.6        |          2024 |         35.8 |            35.8 | tie           | better (seen), better (seen), better, better (seen) |            2.0 |
| kartverket/KAB | 2006-01-01 to 2020-12-31 |       59 |                 0 (0) | 2MK6 0.5      |          2024 |         61.0 |            61.0 | tie           | better (seen), better (seen)                        |            1.9 |
| kartverket/KSU | 2006-01-01 to 2020-12-31 |       56 |                 0 (0) | M8 0.9        |          2024 |         45.6 |            45.6 | tie           | better (seen), better (seen)                        |            1.9 |
| kartverket/MAY | 2006-01-01 to 2020-12-31 |       56 |                 0 (0) | M8 0.8        |          2024 |         46.4 |            46.3 | tie           | tie (seen), better, better (seen), tie (seen)       |            2.2 |
| kartverket/MSU | 2010-10-20 to 2020-12-31 |       55 |                 0 (0) | 3MK7 0.6      |          2024 |         42.6 |            42.5 | worse         | tie (seen), better (seen)                           |            8.4 |
| kartverket/NVK | 2006-01-01 to 2020-12-31 |       58 |                 0 (0) | M2 0.4        |          2024 |         64.3 |            64.4 | tie           | better (seen), better (seen)                        |            2.0 |
| kartverket/NYA | 2006-01-01 to 2020-12-31 |       57 |                 0 (0) | MSK6 0.9      |          2024 |         24.3 |            24.3 | tie           | better (seen), better (seen), better (seen), better |            2.0 |
| kartverket/OSC | 2006-01-01 to 2020-12-31 |       48 |                 0 (0) | 2MK5 0.4      |          2024 |         76.3 |            76.3 | tie           | better (seen), tie (seen)                           |            2.0 |
| kartverket/OSL | 2006-12-20 to 2020-12-31 |       45 |                 0 (0) | Ssa 0.6       |          2024 |         80.8 |            80.7 | worse         | better (seen), better (seen)                        |           10.1 |
| kartverket/RVK | 2006-01-01 to 2020-12-31 |       56 |                 0 (0) | M6 0.9        |          2024 |         49.1 |            49.1 | tie           | better (seen), better, better (seen), better (seen) |            1.8 |
| kartverket/SVG | 2006-01-01 to 2020-12-31 |       52 |                 1 (0) | M8 1.0        |          2024 |         46.8 |            47.0 | better        | better (seen), better (seen)                        |            2.8 |
| kartverket/TOS | 2006-01-01 to 2020-12-31 |       59 |                 0 (0) | M8 0.9        |          2024 |         36.8 |            36.8 | tie           | better (seen), better (seen)                        |            2.2 |
| kartverket/TRD | 2006-01-01 to 2020-12-31 |       57 |                 0 (0) | 2MK6 0.8      |          2024 |         50.0 |            50.1 | tie           | better (seen), better (seen)                        |            1.8 |
| kartverket/TRG | 2006-01-01 to 2020-12-31 |       45 |                 0 (0) | 2SM6 0.6      |          2024 |         58.4 |            58.4 | tie           | better (seen), better, better (seen), tie (seen)    |            1.8 |
| kartverket/VAW | 2006-01-01 to 2020-12-31 |       60 |                 0 (0) | M6 0.8        |          2024 |         41.7 |            41.7 | tie           | better (seen), better, better (seen), better (seen) |            2.2 |
| kartverket/VIK | 2006-01-01 to 2020-12-31 |       46 |                 0 (0) | M8 0.9        |          2024 |         70.4 |            70.4 | tie           | tie (seen), tie (seen)                              |            1.8 |

### NOAA CO-OPS

| Gauge         | Fitted                   | Compared | Outside (long-period) | Largest ratio | Held-out year | Fit RMS (mm) | Agency RMS (mm) | Fit vs agency | Fit vs TICON                                 | Curve RMS (mm) |
| ------------- | ------------------------ | -------: | --------------------: | ------------- | ------------: | -----------: | --------------: | ------------- | -------------------------------------------- | -------------: |
| coops/1612340 | 2014-01-01 to 2018-12-31 |       28 |                 1 (0) | M6 1.1        |          2025 |         23.6 |            23.6 | tie           | better (seen), better (seen), better, better |            5.5 |
| coops/1820000 | 2014-01-01 to 2018-12-31 |       27 |                 1 (0) | 2MK3 1.1      |          2025 |         26.2 |            26.3 | tie           | better (seen), better, better (seen)         |           15.6 |
| coops/8443970 | 2015-01-01 to 2019-12-31 |       34 |                 3 (0) | S1 1.6        |          2025 |         64.3 |            64.1 | tie           | tie (seen), better, tie                      |            4.7 |
| coops/8452660 | 2007-01-01 to 2012-12-31 |       35 |                 0 (0) | M3 0.8        |          2025 |         57.7 |            57.7 | tie           | tie (seen), tie (seen), tie                  |            2.3 |
| coops/8518750 | 2018-01-01 to 2022-12-31 |       32 |                 1 (0) | M8 1.1        |          2025 |         75.9 |            75.9 | tie           | better, better (seen)                        |            2.0 |
| coops/8545240 | 2016-01-01 to 2020-12-31 |       35 |                 0 (0) | 2MK3 0.4      |          2025 |        117.5 |           117.6 | better        | worse (seen)                                 |            2.7 |
| coops/8574680 | 2017-01-01 to 2021-12-31 |       31 |                 1 (0) | S6 1.2        |          2025 |         78.0 |            78.0 | tie           | tie (seen)                                   |            8.6 |
| coops/8638610 | 2015-01-01 to 2019-12-31 |       32 |                 0 (0) | MS4 0.9       |          2025 |         45.4 |            45.6 | better        | tie (seen)                                   |           20.4 |
| coops/8665530 | 2017-01-01 to 2021-12-31 |       32 |                 1 (0) | M8 1.1        |          2025 |         63.7 |            63.6 | tie           | worse (seen), worse (seen), better, worse    |           10.6 |
| coops/8723214 | 2019-01-01 to 2023-12-31 |       34 |                 0 (0) | S6 0.9        |          2025 |         19.6 |            19.6 | tie           | tie (seen), tie (seen), tie                  |            1.0 |
| coops/8724580 | 2018-01-01 to 2022-12-31 |       29 |                 2 (0) | 2MK3 1.1      |          2025 |         20.9 |            20.9 | tie           | better (seen), better (seen), better         |           12.0 |
| coops/8729840 | 2018-01-01 to 2022-12-31 |       28 |                 1 (0) | S4 1.1        |          2025 |         31.1 |            31.0 | tie           | better (seen), better (seen), better         |           10.1 |
| coops/8761724 | 2021-01-01 to 2025-12-31 |       27 |                 2 (0) | K2 1.1        |          none |              |                 |               |                                              |                |
| coops/8771450 | 2021-01-01 to 2025-12-31 |       30 |                 0 (0) | M6 0.8        |          none |              |                 |               |                                              |                |
| coops/9410170 | 2017-01-01 to 2021-12-31 |       32 |                 0 (0) | T2 0.9        |          2025 |         23.4 |            23.5 | tie           | better (seen), better (seen), better         |            1.5 |
| coops/9435380 | 2007-01-01 to 2012-12-31 |       34 |                 2 (0) | M2 1.2        |          2025 |         35.8 |            36.0 | better        | better (seen), better (seen), better         |            1.6 |
| coops/9449880 | 2011-01-01 to 2016-12-31 |       37 |                 0 (0) | MS4 1.0       |          2025 |         57.9 |            57.6 | worse         | better (seen)                                |            2.9 |
| coops/9455920 | 2012-01-01 to 2016-12-31 |      100 |                 1 (0) | SIGMA1 3.0    |          2025 |        179.7 |           175.7 | worse         | better (seen)                                |           42.4 |
| coops/9462620 | 2020-01-01 to 2024-12-31 |       34 |                 1 (0) | R2 1.0        |          2025 |         39.0 |            39.1 | tie           | better (seen), better, better, better (seen) |            1.0 |
| coops/9751639 | 2007-01-01 to 2012-12-31 |       27 |                 0 (0) | MU2 1.0       |          2025 |         17.5 |            17.4 | tie           | tie, tie (seen)                              |            2.9 |

### Constituents most often outside the interval

| Constituent | Outside | Median ratio |
| ----------- | ------: | -----------: |
| M8          | 3 of 36 |         1.13 |
| 2MK3        | 2 of 18 |         1.07 |
| R2          | 2 of 42 |         1.04 |
| M2          | 2 of 44 |         1.14 |
| SIGMA1      |  1 of 1 |         3.05 |
| S6          | 1 of 12 |         1.16 |
| gamma2      | 1 of 19 |         1.37 |
| OQ2_KV      | 1 of 19 |         1.42 |
| S1          | 1 of 20 |         1.56 |
| MKS2        | 1 of 21 |         1.08 |
| alpha2      | 1 of 24 |         1.16 |
| mu2         | 1 of 24 |         1.13 |
| nu2         | 1 of 24 |         1.12 |
| S4          | 1 of 40 |         1.05 |
| OO1         | 1 of 41 |         1.04 |
| M6          | 1 of 42 |         1.06 |
| 2N2         | 1 of 43 |         1.26 |
| K1          | 1 of 43 |         1.30 |
| L2          | 1 of 43 |         1.34 |
| M4          | 1 of 43 |         1.02 |
