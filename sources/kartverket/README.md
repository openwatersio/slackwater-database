# Kartverket source

Offline importer workspace for Kartverket's published tide-station data.

Tide and water-level data © Kartverket / Norwegian Mapping Authority, Hydrographic Service, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Source: [Kartverket water-level API](https://www.kartverket.no/en/api-and-data/tides-and-water-level-data). Terms: [Kartverket terms of use](https://www.kartverket.no/en/api-and-data/terms-of-use).

## Validation status

This source is not ready for release. Its pinned comparison set contains 462 raw Kartverket responses covering all 33 stations in seven 72-hour windows between 2020 and 2040. Run the offline check with:

```sh
npm run validate -w sources/kartverket
```

All hourly height-series limits pass. The worst station RMSE is 0.010230 m against a 0.02 m limit, the worst p95 absolute error is 0.018329 m against 0.03 m, and the largest individual height error is 0.027871 m against 0.05 m. Matched extreme heights also pass, with a worst error of 0.022585 m against 0.05 m.

High and low water timing does not pass. The check reports 53 failed windows across 15 stations, with a worst time error of 30.894 minutes against the five-minute limit. Some low-amplitude stations also disagree on which turning points belong in the tide table. For example, the pinned SIE hourly series has 34 strict interior turning points in January 2030 while Kartverket's `tab` response publishes 11 events.

A separate datum check finds ten stations where Kartverket publishes LAT 0.2–0.3 m above CD. The importer retains both values as published and records them as known upstream anomalies rather than silently rewriting them.

An experimental 180-degree M3 phase reversal reduces the failed-window count from 53 to 19, but it conflicts with Kartverket's published M3 Doodson metadata and is not part of the importer. The API protocol identifies `tab` as the tide-table response but does not document its event-selection rule. The source remains blocked until those conventions are confirmed or the acceptance criteria are revised. The validator keeps the original thresholds and reports every unmatched event.
