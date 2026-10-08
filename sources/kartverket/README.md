# Kartverket source

Offline importer workspace for Kartverket's published tide-station data.

Tide and water-level data © Kartverket / Norwegian Mapping Authority, Hydrographic Service, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Source: [Kartverket water-level API](https://www.kartverket.no/en/api-and-data/tides-and-water-level-data). Terms: [Kartverket terms of use](https://www.kartverket.no/en/api-and-data/terms-of-use).

## Coverage

All 33 of Kartverket's public harmonic stations are in `data/kartverket/` and ship in every release since `0.9.20260923`. Kartverket's coastal tide zones are not imported yet; #251 tracks them.

## Validation

The pinned comparison set holds 462 raw Kartverket responses: all 33 stations, in seven 72-hour windows each between 2020 and 2040. Run the offline check with:

```sh
npm run validate -w sources/kartverket
```

CI does not run it, and it exits 1 while any window fails, so read the per-station report rather than the exit code.

Heights pass every limit. The worst station RMSE is 0.010230 m against a 0.02 m limit, the worst p95 absolute error is 0.018329 m against 0.03 m, and the largest individual height error is 0.027871 m against 0.05 m. Matched extreme heights also pass, with a worst error of 0.022585 m against 0.05 m.

High and low water times miss the five-minute limit in 51 windows across 15 stations, worst 30.894 minutes at VIK in July 2040. All 15 are among the 16 stations with the smallest M2 amplitude, from 0.033 m at SIE to 0.530 m at KAZ, on the south and west coasts; every station with a larger M2 passes. Turns in a small tide are flat, so a small difference in height moves the time of an extreme a long way. The smallest-range stations also disagree with Kartverket on which turning points count: the pinned SIE hourly series has 34 strict interior turning points in January 2030, while Kartverket's `tab` response publishes 11 events. The API protocol calls `tab` the tide-table response but does not document how it selects events.

When #163 measured it, a 180-degree M3 phase reversal cut the failed windows from 53 to 19. It contradicts Kartverket's published M3 Doodson metadata, so the importer does not apply it. The validator keeps the original thresholds and reports every unmatched event.

## Datums

Ten stations publish LAT 0.2–0.3 m above CD. The importer keeps both values as published and records them as known upstream anomalies.
