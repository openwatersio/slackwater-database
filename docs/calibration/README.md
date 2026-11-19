# Calibration

The fitter is calibrated on gauges where the answer is known: an agency fits its own gauge and publishes the constants. We fit the same gauge from its [Stillwell](https://github.com/openwatersio/stillwell) record, over the agency's own analysis period and with the agency's own constituent list, and compare constituent by constituent. Agreement within our fit's 95% confidence intervals shows the fitter, the nodal corrections and the phase convention are right ([plan](../plans/stillwell-constituents.md#calibration)).

Run it again whenever the fitter changes, and commit what it writes. `npm test` fails when the installed `@slackwater/engine` isn't the version the report was fitted with:

```sh
npm run refresh:calibration -w packages/harmonic-analysis
```

It reads Stillwell into `tmp/stillwell/` and writes [calibration.json](calibration.json), with the engine version it fitted with and one [verification report](../plans/stillwell-constituents.md#5-verification) per gauge, and the results below. A gauge that can't be fitted stops the refresh and leaves both files as they were.

## Gauges

- **Kartverket**: the 24 gauges whose constants come from Kartverket's 2006–2020 or 2010–2020 analyses (`KARTVERKET` in [calibrate.ts](../../packages/harmonic-analysis/calibrate.ts), checked against `data/kartverket` on every refresh), fitted from `kartverket/<code>` over the period in `data/kartverket/<code>.json`.
- **NOAA CO-OPS**: 20 reference stations, fitted from `coops/<id>` over the years the comments in NOAA's harmonic constituents API name for each (`NOAA` in [calibrate.ts](../../packages/harmonic-analysis/calibrate.ts)) and compared with `data/noaa/<id>.json`. A digest of each station's constants is pinned beside its years, so a NOAA import that changes them stops the refresh until the years are read again. NOAA vector-averages one-year analyses over those years, and takes Sa and Ssa, at some stations also Mm, Mf or Msf, from a longer span. We fit every constituent in one least-squares fit over the main years, so long-period constituents are counted apart.

## Reading the results

- **Compared**: constituents both fits have. **Without an interval**: those our fit gave no interval for, which can't be outside.
- **Outside**: constituents whose difference in amplitude or phase exceeds our 95% interval, widened in quadrature by half the last digit the agency publishes, with the long-period ones (slower than 5°/h) in brackets. Each comparison is two tests, so with honest intervals about 10% would fall outside by chance.
- **Largest ratio**: the constituent furthest outside, as its difference over the widened interval's half-width.
- **Held-out year**: the source's last whole year of final values after the fit's period, scored as the [verification report](../../packages/harmonic-analysis/verify-fit.ts) describes. "none" when the fit's period reaches it.
- **Fit RMS** and **Agency RMS**: tidal-band residual RMS on the held-out year, after a Godin filter.
- **Fit vs agency** and **Fit vs TICON**: the fit's verdict against each, beyond the measurement error; "seen" marks a record whose analysis covered the held-out year. TICON's column includes this database's re-fits of TICON's gauges.
- **Curve RMS**: our predicted curve against one from the agency's constants over the held-out year, with the mean difference removed.

## Credits

Kartverket's constants: © Kartverket / Norwegian Mapping Authority, Hydrographic Service, https://www.kartverket.no, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The differences here are derived from them. NOAA's constants and CO-OPS observations are public domain. Observations are read from Stillwell, which credits each station's source.

## Findings

From the results below. A refresh rewrites only the results, so rewrite this section when they change.

- **The main constituents agree.** M2, S2, N2 and O1 fall within our intervals at all 24 Kartverket gauges, and K1 at the 23 that have it, with amplitudes within 0.6 mm. At NOAA's 20 stations S2, N2 and K1 fall within, and M2 at 18, all four within 2.3 mm and 1.2°. The fitter, the IHO nodal corrections and the UTC phase convention are right for these.
- **NOAA's diurnal band doesn't agree.** M1 is outside our interval at all 20 NOAA stations, by a median 5.2 times its widened half-width, and O1 at 7. On the 2025 held-out year our fit scores worse than NOAA's own constants at 9 of 18 stations. In every one of them the excess is in the D1 band, while D2 matches to 0.5 mm. It is largest where the diurnal tide is strong: San Diego 29 mm against NOAA's 13 mm, South Beach 27 against 18, Friday Harbor 62 against 48 and Unalaska 29 against 20. Fitting San Diego without M1 brings our D1 residual to 20 mm, so M1 accounts for about half of it. NOAA analyzes with Schureman's nodal formulas, under which M1's factor and phase are not the engine's IHO ones, and the engine's `fit()` takes IHO's only. The engine needs to fit with Schureman's formulas, or with a definition of NOAA's M1, before NOAA's diurnal constants can be compared like with like.
- **Kartverket's shallow-water constituents mostly differ by under a millimetre.** M8, 2MS6, M6 and 2MN6 fall outside our intervals at most Kartverket gauges, mostly by a few tenths of a millimetre against intervals under 0.2 mm. A few differ by 1 to 1.7 mm: M6, 2MS6 and M8 at Stavanger and Tromsø, M8 at Harstad and Narvik, and 2MS6 at Oslo. Kartverket fits 10-minute values and we fit hourly ones, so a 10-minute fit is the next check, to tell sampling from intervals too narrow in the sixth- and eighth-diurnal bands.
- **Kartverket's own definitions differ.** S1_KV (22 of 24) and NO1 (18 of 19) fall outside, 35 of their 40 comparisons by amplitude. 2N2 is outside at 18 of 43 across both sources. Kartverket's S1 and NO1 are not on the engine's catalog lines, which [constituent definitions](../plans/stillwell-constituents.md#constituent-definitions) will carry as Kartverket's own.
- **On observations, the fit ties the agency at most gauges.** Our fit ties Kartverket's constants on 2024 at 21 of 24 gauges, beats them at Stavanger and loses at Mausund and Vardø, by 0.3 mm or less in D1 and D2. It beats or ties every TICON record at every Kartverket gauge. Anchorage, where NOAA publishes 120 constituents, is the one NOAA station where our fit beats NOAA's constants.
- **Long-period constituents** are outside at 16 comparisons: Sa and Ssa at NOAA's 11, which NOAA takes from longer spans than we fit, and SA_KV at 5 Kartverket gauges. Weather moves both from year to year.

## Results

<!-- calibration results -->

Gauges fitted: 44 of 44.

| Source      | Compared | Without an interval | Outside our 95% interval | Long-period | With amplitudes over 1 mm apart | Median ratio outside |
| ----------- | -------: | ------------------: | -----------------------: | ----------: | ------------------------------: | -------------------: |
| Kartverket  |     1325 |                   0 |              218 (16.5%) |           5 |                              58 |                 2.22 |
| NOAA CO-OPS |      745 |                   0 |               97 (13.0%) |          11 |                              63 |                 1.69 |
| All         |     2070 |                   0 |              315 (15.2%) |          16 |                             121 |                 1.98 |

### Kartverket

| Gauge          | Fitted                   | Compared | Outside (long-period) | Largest ratio | Held-out year | Fit RMS (mm) | Agency RMS (mm) | Fit vs agency | Fit vs TICON                                        | Curve RMS (mm) |
| -------------- | ------------------------ | -------: | --------------------: | ------------- | ------------: | -----------: | --------------: | ------------- | --------------------------------------------------- | -------------: |
| kartverket/AES | 2006-01-01 to 2020-12-31 |       56 |                13 (1) | 2MS6 6.4      |          2024 |         53.7 |            53.7 | tie           | better (seen), better (seen)                        |           10.5 |
| kartverket/ANX | 2006-01-01 to 2020-12-31 |       59 |                 6 (0) | M8 5.1        |          2024 |         34.4 |            34.4 | tie           | better (seen), better, better (seen), better (seen) |            6.7 |
| kartverket/BGO | 2006-01-01 to 2020-12-31 |       55 |                 7 (0) | M8 3.9        |          2024 |         40.6 |            40.7 | tie           | better (seen), better (seen)                        |            8.4 |
| kartverket/BOO | 2006-01-01 to 2020-12-31 |       57 |                 8 (0) | M8 6.0        |          2024 |         56.5 |            56.4 | tie           | better (seen), better (seen)                        |            9.6 |
| kartverket/HAR | 2006-01-01 to 2020-12-31 |       60 |                 7 (0) | M8 18.5       |          2024 |         34.0 |            34.0 | tie           | better (seen), better (seen)                        |            6.8 |
| kartverket/HEI | 2006-01-01 to 2020-12-31 |       55 |                12 (1) | 2MS6 4.5      |          2024 |         45.4 |            45.3 | tie           | better (seen), better (seen)                        |           11.5 |
| kartverket/HFT | 2006-01-01 to 2020-12-31 |       60 |                15 (0) | M8 5.1        |          2024 |         38.9 |            38.8 | tie           | better (seen), tie (seen)                           |            7.3 |
| kartverket/HRO | 2006-01-01 to 2020-12-31 |       48 |                 5 (0) | 2MS6 3.1      |          2024 |         68.6 |            68.6 | tie           | tie (seen), tie (seen)                              |            8.8 |
| kartverket/HVG | 2006-01-01 to 2020-12-31 |       62 |                10 (0) | S1_KV 4.1     |          2024 |         35.9 |            35.8 | tie           | tie (seen), better (seen), better, better (seen)    |            6.2 |
| kartverket/KAB | 2006-01-01 to 2020-12-31 |       59 |                11 (0) | M6 3.9        |          2024 |         61.1 |            61.0 | tie           | better (seen), better (seen)                        |            9.2 |
| kartverket/KSU | 2006-01-01 to 2020-12-31 |       56 |                13 (1) | M8 9.3        |          2024 |         45.6 |            45.6 | tie           | better (seen), better (seen)                        |           10.5 |
| kartverket/MAY | 2006-01-01 to 2020-12-31 |       56 |                12 (1) | 2MS6 5.3      |          2024 |         46.4 |            46.3 | tie           | tie (seen), better, better (seen), tie (seen)       |           10.4 |
| kartverket/MSU | 2010-10-20 to 2020-12-31 |       56 |                11 (0) | M8 4.5        |          2024 |         42.7 |            42.5 | worse         | tie (seen), tie (seen)                              |           10.7 |
| kartverket/NVK | 2006-01-01 to 2020-12-31 |       58 |                10 (0) | M8 9.5        |          2024 |         64.4 |            64.4 | tie           | better (seen), better (seen)                        |            8.6 |
| kartverket/NYA | 2006-01-01 to 2020-12-31 |       58 |                 8 (0) | S1_KV 5.3     |          2024 |         24.3 |            24.3 | tie           | better (seen), better (seen), better (seen), better |            6.6 |
| kartverket/OSC | 2006-01-01 to 2020-12-31 |       48 |                 6 (0) | 2MS6 3.1      |          2024 |         76.2 |            76.3 | tie           | better (seen), tie (seen)                           |           10.9 |
| kartverket/OSL | 2006-12-20 to 2020-12-31 |       46 |                 5 (0) | M8 6.7        |          2024 |         80.7 |            80.7 | tie           | better (seen), better (seen)                        |           11.3 |
| kartverket/RVK | 2006-01-01 to 2020-12-31 |       56 |                 9 (0) | M6 7.5        |          2024 |         49.2 |            49.1 | tie           | better (seen), better, better (seen), better (seen) |            9.9 |
| kartverket/SVG | 2006-01-01 to 2020-12-31 |       52 |                 8 (0) | M8 18.3       |          2024 |         46.8 |            47.0 | better        | better (seen), better (seen)                        |            7.1 |
| kartverket/TOS | 2006-01-01 to 2020-12-31 |       59 |                 9 (0) | M8 12.5       |          2024 |         36.8 |            36.8 | tie           | better (seen), better (seen)                        |            5.8 |
| kartverket/TRD | 2006-01-01 to 2020-12-31 |       57 |                11 (1) | 2MS6 4.7      |          2024 |         50.1 |            50.1 | tie           | better (seen), better (seen)                        |           10.5 |
| kartverket/TRG | 2006-01-01 to 2020-12-31 |       45 |                 4 (0) | M8 5.4        |          2024 |         58.4 |            58.4 | tie           | better (seen), better, better (seen), tie (seen)    |            5.6 |
| kartverket/VAW | 2006-01-01 to 2020-12-31 |       61 |                12 (0) | M8 5.1        |          2024 |         41.9 |            41.7 | worse         | better (seen), better, better (seen), better (seen) |            7.8 |
| kartverket/VIK | 2006-01-01 to 2020-12-31 |       46 |                 6 (0) | M8 5.6        |          2024 |         70.4 |            70.4 | tie           | tie (seen), tie (seen)                              |            9.3 |

### NOAA CO-OPS

| Gauge         | Fitted                   | Compared | Outside (long-period) | Largest ratio | Held-out year | Fit RMS (mm) | Agency RMS (mm) | Fit vs agency | Fit vs TICON                                 | Curve RMS (mm) |
| ------------- | ------------------------ | -------: | --------------------: | ------------- | ------------: | -----------: | --------------: | ------------- | -------------------------------------------- | -------------: |
| coops/1612340 | 2014-01-01 to 2018-12-31 |       31 |                 6 (0) | M1 3.1        |          2025 |         23.8 |            23.8 | tie           | better (seen), better (seen), better, better |            6.6 |
| coops/1820000 | 2014-01-01 to 2018-12-31 |       30 |                 7 (1) | SA 4.1        |          2025 |         26.5 |            26.3 | worse         | better (seen), better, better (seen)         |           15.8 |
| coops/8443970 | 2015-01-01 to 2019-12-31 |       34 |                 3 (0) | M1 1.7        |          2025 |         64.3 |            64.1 | tie           | tie (seen), better, tie                      |            8.9 |
| coops/8452660 | 2007-01-01 to 2012-12-31 |       35 |                 1 (0) | M1 4.3        |          2025 |         58.1 |            57.5 | tie           | tie (seen), tie (seen), tie                  |           11.0 |
| coops/8518750 | 2018-01-01 to 2022-12-31 |       34 |                 3 (0) | M1 4.8        |          2025 |         76.3 |            75.8 | worse         | better, better (seen)                        |            8.6 |
| coops/8545240 | 2016-01-01 to 2020-12-31 |       35 |                 2 (0) | M1 5.0        |          2025 |        117.5 |           117.7 | tie           | tie (seen)                                   |           16.9 |
| coops/8574680 | 2017-01-01 to 2021-12-31 |       33 |                 2 (0) | M1 3.3        |          2025 |         78.1 |            77.9 | tie           | tie (seen)                                   |           11.2 |
| coops/8638610 | 2015-01-01 to 2019-12-31 |       34 |                 2 (1) | M1 1.7        |          2025 |         45.4 |            45.5 | tie           | tie (seen)                                   |           20.6 |
| coops/8665530 | 2017-01-01 to 2021-12-31 |       34 |                 3 (0) | M1 9.7        |          2025 |         64.1 |            63.7 | tie           | worse (seen), worse (seen), better, worse    |           16.4 |
| coops/8723214 | 2019-01-01 to 2023-12-31 |       34 |                 3 (2) | M1 5.3        |          2025 |         19.7 |            19.6 | worse         | tie (seen), tie (seen), tie                  |           17.2 |
| coops/8724580 | 2018-01-01 to 2022-12-31 |       32 |                 3 (1) | M1 17.9       |          2025 |         22.0 |            21.1 | worse         | better (seen), better (seen), better         |           14.6 |
| coops/8729840 | 2018-01-01 to 2022-12-31 |       30 |                 3 (0) | M1 13.8       |          2025 |         33.0 |            31.2 | worse         | better (seen), better (seen), better         |           15.0 |
| coops/8761724 | 2021-01-01 to 2025-12-31 |       29 |                 4 (0) | M1 4.9        |          none |              |                 |               |                                              |                |
| coops/8771450 | 2021-01-01 to 2025-12-31 |       32 |                 2 (1) | M1 3.1        |          none |              |                 |               |                                              |                |
| coops/9410170 | 2017-01-01 to 2021-12-31 |       32 |                10 (1) | M1 55.0       |          2025 |         34.4 |            23.3 | worse         | better (seen), better (seen), better         |           29.6 |
| coops/9435380 | 2007-01-01 to 2012-12-31 |       34 |                10 (1) | M1 14.7       |          2025 |         41.0 |            35.9 | worse         | better (seen), better (seen), better         |           27.5 |
| coops/9449880 | 2011-01-01 to 2016-12-31 |       37 |                 5 (1) | M1 7.8        |          2025 |         70.4 |            59.2 | worse         | better (seen)                                |           41.0 |
| coops/9455920 | 2012-01-01 to 2016-12-31 |      120 |                19 (0) | 4MLS8 67.5    |          2025 |        179.5 |           215.1 | better        | better (seen)                                |          126.9 |
| coops/9462620 | 2020-01-01 to 2024-12-31 |       36 |                 6 (0) | M1 13.1       |          2025 |         44.3 |            38.9 | worse         | better (seen), better, better, better (seen) |           18.9 |
| coops/9751639 | 2007-01-01 to 2012-12-31 |       29 |                 3 (2) | M1 9.1        |          2025 |         17.6 |            17.8 | tie           | better, better (seen)                        |            8.9 |

### Constituents most often outside the interval

| Constituent |  Outside | Median ratio |
| ----------- | -------: | -----------: |
| M8          | 27 of 36 |         4.34 |
| S1_KV       | 22 of 24 |         2.96 |
| 2MS6        | 22 of 25 |         3.57 |
| M6          | 22 of 42 |         3.28 |
| M1          | 20 of 20 |         5.15 |
| NO1         | 18 of 19 |         2.11 |
| 2MN6        | 18 of 25 |         2.19 |
| 2N2         | 18 of 43 |         3.21 |
| R2          | 15 of 42 |         1.41 |
| 2MK6        | 14 of 25 |         1.36 |
| 2SM6        | 13 of 25 |         1.29 |
| S1          |  8 of 20 |         1.61 |
| SA          |  8 of 20 |         1.59 |
| J1          |  8 of 38 |         1.58 |
| L2          |  8 of 43 |         1.32 |
| 3MK7        |  7 of 19 |         1.22 |
| eta2        |  7 of 19 |         1.10 |
| O1          |  7 of 44 |         1.15 |
| M(KS)2      |  6 of 22 |         1.67 |
| SA_KV       |  5 of 24 |         1.07 |
