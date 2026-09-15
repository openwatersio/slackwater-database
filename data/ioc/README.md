# IOC SLSMF Tide Station Data

The [IOC Sea Level Station Monitoring Facility](https://www.ioc-sealevelmonitoring.org/) (SLSMF, run by the Flanders Marine Institute for UNESCO/IOC) relays ~1,600 real-time tide gauges worldwide. It publishes **relative sea level only** — no harmonic constituents and no vertical datum — so this is the database's first _derived_ source: the constituents are fit by this project from SLSMF's quality-controlled observations (`published_harmonics: false`).

**Key Details:**

- **Source:** [SLSMF](https://www.ioc-sealevelmonitoring.org/) via the [v2 research API](https://api.ioc-sealevelmonitoring.org/v2/doc) (API key required)
- **Citation:** Flanders Marine Institute (VLIZ); Intergovernmental Oceanographic Commission (IOC) (2026): Sea level station monitoring facility. https://doi.org/10.14284/482
- **License:** [IOC data policy](https://www.ioc-sealevelmonitoring.org/disclaimer.php) — non-commercial use only; commercial users should contact the data originator, recorded per station in `source.operator`. VLIZ confirmed by email (September 2026) that redistributing derived constituents with this citation is acceptable.
- **Coverage:** only gauges that are still reporting and sit more than 3 km from every station in the other sources, so this fills gaps (Chile, Taiwan, Indonesia, Greece, island gauges) rather than duplicating them. See [#124](https://github.com/openwatersio/tide-database/issues/124).

## Harmonic constituents

The research endpoint returns observations with SLSMF's automatic QC applied: days flagged for low completeness, low distinctness, or a datum shift, and samples flagged out-of-range, spike, or flat-line, are nulled upstream and dropped here. The remaining record is binned to hourly means and the standard TICON-4 constituent set (50 constituents) is fit by least squares with [`tools/harmonic-analysis.ts`](../../tools/harmonic-analysis.ts) — the same fitter used to re-analyze mislabeled TICON sources. Records shorter than one year are skipped.

## Tidal datums

Datums follow the TICON-4 approach (see [data/ticon/README.md](../ticon/README.md) and [docs/datums.md](../../docs/datums.md)): mean datums reduced directly from the observations, astronomical and amplitude-derived datums from the harmonic side shifted into the observed MSL frame. They are in **the gauge's own relative frame** — SLSMF holds no vertical datum information — which every station's `disclaimers` notes. Good for timing and range; weak for chart-datum heights.

## Regenerating

```sh
IOC_API_KEY=… node tools/import-ioc.ts
```

Register at https://www.ioc-sealevelmonitoring.org/api.php and request the "gauges API" group. Responses are cached under `tmp/IOC/` (not committed). Without `FORCE=1`, stations already in this directory keep their cached fit and only the metadata is recomputed. The default record is the last 6 years (a station-year is a ~40 MB response); set `IOC_FROM=2007` for the full datum epoch.
