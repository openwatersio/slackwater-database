# Kartverket source

Offline importer workspace for Kartverket's published tide-station data.

Tide and water-level data © Kartverket / Norwegian Mapping Authority, Hydrographic Service, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Source: [Kartverket water-level API](https://www.kartverket.no/en/api-and-data/tides-and-water-level-data). Terms: [Kartverket terms of use](https://www.kartverket.no/en/api-and-data/terms-of-use).

## Coverage

All 33 of Kartverket's public harmonic stations are in `data/kartverket/` and ship in every release since `0.9.20260923`. Kartverket's coastal tide zones are not imported yet; #251 tracks them.

## Import and refresh

Run `npm run import -w sources/kartverket` to rebuild station records from the pinned snapshot without network access, then run `npm run stations` to regenerate the catalogue. To fetch a new source snapshot, run `npm run refresh:fixtures -w sources/kartverket` and review the fixture changes before importing. `npm run refresh:tide-tables -w sources/kartverket` separately refreshes the prediction comparisons used by validation.

## Validation

The pinned comparison set holds 462 raw Kartverket responses: all 33 stations, in seven 72-hour windows each between 2020 and 2040. Run the offline check with:

```sh
npm run validate -w sources/kartverket
```

CI does not run it, and it exits 1 while any window fails, so read the per-station report rather than the exit code.

The validator predicts with Foreman's nodal corrections, which Kartverket's own analysis uses and [`metadata.yaml`](metadata.yaml) declares.

Heights pass every limit. The worst station RMSE is 0.006790 m at VAW against a 0.02 m limit, and the best 0.000500 m at SIE. The worst p95 absolute error is 0.010697 m at NVK against 0.03 m, and the largest individual height error is 0.013250 m at VAW against 0.05 m. Matched extreme heights also pass, with a worst error of 0.004570 m against 0.05 m. Kartverket's predictions run TT − UTC (67–69 s) behind its observations (see [Phases](#phases)), and the imported constants follow the observations, so much of what remains is that minute.

High and low water times miss the five-minute limit in 5 windows at 2 stations, worst 6.540 minutes at SOY in January 2040, and SIE publishes a different number of extremes in 4 more. All three are among the 8 stations with the smallest M2 amplitude, from 0.033 m at SIE to 0.153 m at SOY, on the south and west coasts. Turns in a small tide are flat, so a small difference in height moves the time of an extreme a long way. The smallest-range stations also disagree with Kartverket on which turning points count: the pinned SIE hourly series has 34 strict interior turning points in January 2030, while Kartverket's `tab` response publishes 11 events. The API protocol calls `tab` the tide-table response but does not document how it selects events.

Kartverket labels M3 with Doodson `CZZZZZB`, a 180° phase constant, but its predictions use Schureman's M3 argument, which has none and is the engine's. Against the engine's M3 the validator fails 9 windows; with the 180° constant it fails 53. `resolveConstituent` maps Kartverket's M3 to the engine's M3 for that reason. The validator keeps the original thresholds and reports every unmatched event.

## Phases

Kartverket publishes phases for UTC+1, and its harmonic analysis computes the astronomical arguments in Terrestrial Time while its observations and predictions are in UTC. Its phases therefore place the tide TT − UTC late: 67.18 s on average over the 2006–2020 analyses, 0.54° of M2, and 69.184 s since 2017. The importer subtracts an hour of each constituent's speed for the time zone, and the mean TT − UTC over the station's analysis period, from the leap-second table. BOH and EYD publish no period and get 69.184 s, the value for any analysis since 2017. An older analysis would make that a few seconds too much. A year of BOH's observations puts its M2 67 ± 13 s behind the published phase, which fits; EYD's record is too short to check.

Fitting Stillwell's copy of Kartverket's observations with the engine shows this. Over each station's analysis period, at the 24 stations whose analyses cover 2006–2020 or 2010–2020, the uncorrected phases sit a median 68.3 s behind the fit, the same in seconds from K1 to M6. With the correction, the median is 1.2 s. The newer stations' one- to three-year analyses agree within their wider intervals (M2 37–68 s, ±9–41 s). Independent analyses agree with the corrected phases: at ANX, UHSLC's research and fast-delivery series, CMEMS's relay and TICON's analysis, all in `data/ticon/`, put M2 within 0.03° of the corrected phase and 0.55° from the uncorrected one, and the tests check it. Kartverket's own prediction curves match the engine with the uncorrected phases to within about 6 s, so they carry the same lag.

## Datums

Ten stations publish LAT 0.2–0.3 m above CD. The importer keeps both values as published and records them as known upstream anomalies.
