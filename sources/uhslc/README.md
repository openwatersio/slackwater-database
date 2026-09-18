# UHSLC hourly sea level

The [University of Hawaii Sea Level Center](https://uhslc.soest.hawaii.edu/datainfo/) publishes hourly tide gauge observations through ERDDAP:

- [`global_hourly_rqds`](https://uhslc.soest.hawaii.edu/erddap/tabledap/global_hourly_rqds.html): Research Quality Data, assessed for variability and datum stability. One record per station version.
- [`global_hourly_fast`](https://uhslc.soest.hawaii.edu/erddap/tabledap/global_hourly_fast.html): Fast Delivery data, provisional until UHSLC replaces it with RQD. `last_rq_date` marks the boundary.
- [`global_hourly_gesla`](https://uhslc.soest.hawaii.edu/erddap/tabledap/global_hourly_gesla.html): GESLA observations with per-value use flags.

No station data is generated from UHSLC yet. See [#138](https://github.com/openwatersio/tide-database/issues/138).

## Inventory

```sh
npm run inventory -w sources/uhslc
```

The inventory compares these datasets with the stations in `data/` and `quality.json`, prints a summary, and writes one row per RQD and FD record to `tmp/uhslc-inventory.csv`. It takes about two minutes because ERDDAP only answers per-record span queries within its gateway timeout.

RQD and FD records join to TICON by UHSLC id and version (`347` + `A` is `abashiri-347a-jpn-uhslc_rq`). TICON carries no GLOSS or SSC ids, so every other comparison uses coordinates. A record is adequate when it spans at least 365 days with at least 4,000 hourly values, the same bar as the observed datum reduction.

| Category         | Meaning                                                                 |
| ---------------- | ----------------------------------------------------------------------- |
| `ticon-accepted` | Already in TICON and accepted by quality evaluation                     |
| `ticon-rejected` | Already in TICON and rejected, usually as a duplicate of its FD sibling |
| `rq-preferred`   | FD record for a gauge that has an adequate RQD record                   |
| `too-short`      | Not in TICON and not adequate                                           |
| `same-gauge`     | Not in TICON; another version or the FD record of the gauge is accepted |
| `duplicate`      | Not in TICON; an accepted station lies within 500 m                     |
| `nearby`         | Not in TICON; an accepted station lies within 10 km                     |
| `new-coverage`   | Not in TICON and no accepted station within 10 km                       |

Longitudes are normalized from 0–360 to -180–180. `reference_datum` is observation metadata, not a station `chart_datum`.

## License

UHSLC asks that data users cite the center and publishes its data without warranty. See the [UHSLC data information page](https://uhslc.soest.hawaii.edu/datainfo/). GESLA records keep their provider's license restrictions.
