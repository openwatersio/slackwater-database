# TICON-4 Tide Station Data

[TICON-4](https://www.seanoe.org/data/00980/109129/) is a global dataset of tidal harmonic constituents derived from the **GESLA-4** (Global Extreme Sea Level Analysis v.4) sea-level gauge compilation. It provides tidal characteristics for **4,264 tide stations** worldwide, with emphasis on global coverage outside the United States (which is covered by NOAA's tide database).

**Key Details:**

- **Source:** [TICON-4 @ SEANOE](https://www.seanoe.org/data/00980/109129/)
- **Manual:** [TICON Documentation](https://www.seanoe.org/data/00980/109129/data/122852.pdf)
- **License:** CC-BY-4.0 (Creative Commons Attribution 4.0)
- **Coverage:** Global tide stations with harmonic constituent analysis from GESLA-4 observations

Each station in this dataset contains harmonic constituents (amplitude and phase for tidal frequency components such as M2, K1, O1, etc.) extracted from historical sea-level records.

![](https://www.seanoe.org/data/00980/109129/illustration.jpg)

## Tidal Datums

TICON-4 does not publish tidal datums, so we derive them from the original GESLA-4 water-level measurements following the NOAA CO-OPS "first reduction" method ([Computational Techniques for Tidal Datums Handbook](https://tidesandcurrents.noaa.gov/publications/Computational_Techniques_for_Tidal_Datums_handbook.pdf)). See [docs/datums.md](../../docs/datums.md) for datum definitions, the pinned 19-year datum epoch, and how `chart_datum` is selected per country.

- The water-level record is binned to hourly heights and reduced over the most recent ≤19 years of data (a full window covers one 18.61-year lunar nodal cycle).
- **MSL, MHHW, MHW, MTL, MLW, MLLW** are the mean datums computed directly from those observations, in the gauge's native frame with real MSL = mean of hourly heights.
- **HAT, LAT, LLWLT, TLT** are astronomical extremes ([IHO definition](https://iho.int/uploads/user/pubs/standards/m-3/M-3_e3.3.0_Repertory_Aug20_2020_FINAL.pdf)) and **MHWS, MLWS, NLLW, ALLW** are amplitude-derived — all taken from the harmonic side rather than observations, since observed extremes include storm surge. They are predicted over the pinned datum epoch in the constituent frame (MSL = 0), then shifted into the observed gauge frame by adding the observed MSL.
- Country-specific datums are pruned and `chart_datum` is assigned during import per the country policy in [docs/datums.md](../../docs/datums.md).

Each station records its provenance in `datums_source`: `observed` when derived from GESLA water levels, or `harmonic` when the record was too short or sparse to reduce (< 1 year of data or < 4,000 hourly points), in which case all datums fall back to the synthetic harmonic prediction and the station's `disclaimers` note the higher uncertainty. For `observed` stations the `epoch` field is the reduced observation window; for `harmonic` fallbacks it is the TICON record period the constituents were fit from.

Cross-checked against authoritative agency datums (NOAA CO-OPS, Canada CHS), the observed datums agree to within ~0.03 m in great diurnal range, versus ~0.2 m for purely synthetic datums — which is why observations are preferred whenever the record supports them. See [#40](https://github.com/openwatersio/tide-database/issues/40) and [`packages/stations/validate-datums.ts`](../../packages/stations/validate-datums.ts).

## Regenerating

The station JSONs are generated. After changing datum logic, regenerate them (the full GESLA-4 dataset is downloaded on demand and is not committed):

```sh
FORCE_DATUMS=1 npm run import -w sources/ticon
```

Without `FORCE_DATUMS`, the importer reuses each station's cached datums and only recomputes the derived metadata (`chart_datum`, pruning, disclaimers).

## References

- [TICON-4 Dataset](https://www.seanoe.org/data/00980/109129/)
- [TICON Manual](https://www.seanoe.org/data/00980/109129/data/122852.pdf)
- [GESLA-4 Project](https://gesla787883612.wordpress.com)
