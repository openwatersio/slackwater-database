# Tidal datums

Reference stations describe their datums with:

- **`datums`** — map of named vertical levels (MSL, MLLW, LAT, …), in the native gauge frame where observations or the publisher supply a vertical offset, otherwise in the constituent frame (MSL = 0)

- **`chart_datum`** — which datum is the vertical zero for this station's
  predictions. Predicted heights only line up with a national tide service when
  both use the same chart datum, and each country charts to its own (see
  [Chart datum by country](#chart-datum-by-country)).
- **`datums_source`** — how the datums were derived: `observed` (reduced from
  water-level measurements) or `harmonic` (synthesized from the station's
  constituents).
- **`datum_frame`** — the zero of the stored datum values: `gauge` for the observation gauge zero, or `constituent` when no supported gauge offset is available. Absence means unspecified, including older database files. A measured gauge mean can equal zero, so `MSL = 0` alone does not identify the frame. Neither value identifies a geodetic datum or proves that the gauge zero stayed fixed over time.
- **`datum_coverage`** — counts of measured hourly bins and model-assisted inferred hourly bins, plus the number of months in the observed reduction. Absence means unspecified. Three-hour observations can require about two-thirds of the bins to be inferred; `observed` describes the reduction method, not a promise that every height was measured.
- **`epoch`** — the source-reported analysis or datum period. TICON stores its constituent fit period; NOAA supplies its published national datum epoch. See each source's documentation.
- **`datum_epoch`** — the mean-datum reduction period, where supplied, separate from the constituent fit. TICON supplies its selected observation period for observed means. A missing value does not imply equivalence to `epoch`.

Subordinate stations carry no datums of their own in the source data, and none
are stored for them in the database file. Both readers resolve them at load
time: reading a subordinate's `datums` or constituents through the npm package
or the Swift package gives its reference station's. Its frame, reduction period and coverage follow those inherited values. JS also inherits `datums_source` with the datums.

Those inherited datums describe the **reference's** water, and this library
deliberately does not reduce them through the subordinate's offsets. It is
tempting to — a subordinate's own floor and ceiling are what a caller usually
wants — but the result would not be a datum. NOAA's height corrections are
defined for high and low _extremes_, not for means, so there is no principled
reduction for MSL or MTL, and applying the extreme corrections to LAT/HAT alone
leaves the object internally inconsistent: a `fixed` offset of +0.42 m on a
reference whose LAT sits 0.17 m below chart datum (Manzanillo off San Juan,
Niue off Pago Pago) puts the subordinate's "LAT" a quarter-metre _above_ its own
chart datum, which the datum-ordering gate rightly rejects.

That number is still true about what the predictor produces — it is simply the
floor of a prediction, not a hydrographic datum. Both readers expose it outside
`datums`, where no datum ordering applies: `station.astronomical_bounds` in the
npm package and `station.astronomicalBounds` in the Swift package, each `{ lat,
hat }` in metres above the station's own chart datum, absent where the station
predicting for it has no LAT and HAT. For a subordinate that is the reference's
range with `offsets.height` applied, at the same point the predictor applies the
offsets to the extremes themselves. The reduction is exact for both offset
kinds: a `ratio` scales the height above chart datum, a `fixed` translates it,
and both are monotonic in the reference height, so the lowest low maps to the
lowest low.

How the values are produced differs by source:

- [JMA](../sources/jma/README.md) — stores datums relative to MSL zero, retains the published tide-table zero as CD, and uses CD as the height reference. NLLW is derived separately.
- [JHOD](../sources/jhod/README.md) — uses the published depth datum as `NLLW = 0` and published `Z0` as MSL above it. Other datums are derived from the constants and shifted by Z0. The rounded publisher value takes precedence over the four-amplitude approximation.
- [NOAA](../sources/noaa/README.md) - uses datums published by NOAA (`MLLW`, or `STND` for non-tidal stations)
- [TICON](../sources/ticon/README.md) — datums derived from
  GESLA-4 water levels.

## The datums

Computed by `packages/datums/datum.ts`:

| Datum           | Definition                                                                                                                                                                                                                       | Method                             |
| :-------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| **HAT / LAT**   | Highest/Lowest Astronomical Tide                                                                                                                                                                                                 | extremes of a harmonic prediction  |
| **MHHW**        | Mean Higher High Water                                                                                                                                                                                                           | mean of daily higher highs         |
| **MHW / MLW**   | Mean High/Low Water                                                                                                                                                                                                              | mean of all highs/lows             |
| **MSL**         | Mean Sea Level (mean of hourly heights, NOAA CO-OPS handbook §3.1)                                                                                                                                                               | mean of series                     |
| **MTL**         | Mean Tide Level, `(MHW + MLW) / 2`                                                                                                                                                                                               | derived                            |
| **MLLW**        | Mean Lower Low Water                                                                                                                                                                                                             | mean of daily lower lows           |
| **MHWS / MLWS** | Mean High/Low Water Springs, Admiralty approximation `MSL ± (H_M2 + H_S2)`                                                                                                                                                       | constituent amplitudes             |
| **NLLW / ALLW** | Indian Spring Low Water, `MSL − (H_M2 + H_S2 + H_K1 + H_O1)`; the same value under Japan's and South Korea's national labels                                                                                                     | constituent amplitudes             |
| **LLWLT**       | Lower Low Water, Large Tide (Canada): mean of the annual lowest low waters                                                                                                                                                       | harmonic prediction, annual minima |
| **TLT**         | Theoretical Lowest Tide (China), approximated as the astronomical minimum of the Vladimirsky 13-constituent subset. Not the official Vladimirsky tabular calculation — expect cm-level differences from published Chinese values | restricted harmonic prediction     |

Mean datums follow the NOAA CO-OPS "first reduction" ([Computational Techniques
for Tidal Datums Handbook](https://tidesandcurrents.noaa.gov/publications/Computational_Techniques_for_Tidal_Datums_handbook.pdf))
when observations are available; apart from JHOD's published NLLW, the astronomical/amplitude datums come
from the harmonic side, since observed extremes include storm surge. Datums
specific to one country (LLWLT, TLT, NLLW, ALLW) are pruned from stations that
don't use them (`pruneDatums` in `packages/stations/station.ts`), so a UK station never
carries a stray TLT.

Harmonic reductions use every mathematical turning point of the predicted tide, with the engine's prominence threshold set to zero, including for the restricted TLT prediction. An amplitude cutoff can remove small daily tides while retaining seasonal or monthly turns, biasing the means toward the longer-period envelope. The same complete-turn rule applies at every amplitude; a full prediction with no turning points remains invalid, while a TLT subset without turning points supplies no TLT. These model-derived reductions do not reproduce NOS's six-minute observation tabulation and analyst verification. MHW/MLW average all retained highs/lows; MHHW/MLLW average one higher high/lower low per eligible tidal day. Days can contain different numbers of turns, so the two averaging populations need not preserve their usual ordering. Seasonal terms still affect the predicted curve; removing the prominence filter removes selection by display amplitude, not the seasonal contribution itself.

## Regenerating harmonic datums

`npm run refresh:harmonic-datums -w packages/stations` recomputes derived values from committed constituents and existing vertical offsets, without downloading observations or refitting harmonics. `SHARD=i/n` selects a deterministic partition for parallel runs. Run `npm run stations` afterward to reevaluate quality and regenerate station files, then `PUBLISHED_REF=origin/main npm run check`.

The command preserves TICON's observed means, observation window and coverage; its harmonic-only records retain their recorded gauge offset or constituent frame. TICON's method notice marks complete-turn reductions, and the importer declines cached datums without that notice. DMI retains published MSL, LAT and MLWS; LINZ retains published MSL and chart zero; JHOD retains published MSL and NLLW; JMA retains MSL zero and its published CD offset. Only derived datum values and the TICON method notice change. Both the complete-turn rule and numerical changes in engine beta.7 can contribute to datum differences. Each shard validates its selected inputs before writing; synthesis or I/O failure can still leave it partially updated, so rerun failed shards and review the complete diff before committing.

NOAA records mix published means with published or synthesized LAT/HAT without per-field provenance. The offline command leaves them untouched. Recomputing an existing NOAA bound requires evidence that it was synthesized, such as the original backfill diff and confirmation that NOAA supplies no value. Matching a prediction or the presence of MHW does not establish ownership. The regular NOAA import and LAT/HAT backfill remain the maintained source-update path.

## Datum epoch

The synthetic (harmonic-prediction) datums — HAT, LAT, LLWLT, TLT, and the
amplitude-derived MHWS/MLWS/NLLW/ALLW — are computed over a **pinned epoch of 19
full calendar years** (`DATUM_EPOCH` in `packages/datums/datum.ts`, currently
2007-01-01 → 2026-01-01), following the convention of NOAA's National Tidal
Datum Epoch and the Canadian Hydrographic Service. Why this shape:

- **Pinned, not derived from the current date** — a window anchored to the run
  date shifts a little every day, wiggling HAT/LAT by centimeters between
  regenerations and mixing noise into data diffs and QA gates. A pinned epoch
  makes regeneration deterministic: the same code and inputs produce identical
  output. Moving the epoch is a deliberate, reviewable commit followed by a
  full regen, roughly once a decade.
- **19 full calendar years, not 18.61** — the window must contain one full
  lunar nodal cycle (18.61 y) or HAT/LAT miss the nodal extreme; 19 is the
  smallest whole number of calendar years that does. Whole years matter
  because a fractional window over-samples the seasons in its 0.61-year tail,
  biasing every mean, and because LLWLT averages _annual_ lowest lows — a
  partial year's minimum is drawn from fewer candidates and sits artificially
  high. 19 years is also ≈ the Metonic cycle (235 lunar months), so spring/neap
  phases distribute evenly across the seasons.

Observed mean datums use the longest continuous whole-year window of complete UTC calendar months within the most recent ≤19 years of observations. Eligible windows contain 12, 24, 36, … months; the latest wins a tie in usable length. The station's `datum_epoch` records the
actual reduction period, including inferred hours. This is a first reduction
over that period, without a control-station correction to the 19-year datum
epoch. Twelve months is this project's minimum coverage rule, not a claim of
equivalence to a national datum.

Before reducing observations, finite measurements are averaged into hourly
bins. Up to three consecutive missing bins can be reconstructed: four real
observations must bracket the gap, with no more than four hours between any
adjacent anchors. The station's harmonic model supplies the tidal shape, with a cubic fit to the observed-minus-predicted residual averages. The fit uses the first three sampling-time moments of each anchor bin, so both predictions and a changing residual use the actual sampling instants. Anchor predictions are averaged at the actual sampling instants within each hourly bin, matching the observed bin mean. An inferred bin uses its nearer real anchor's sampling profile. This also
resamples regular three-hour observations. Inferred heights never serve as
anchors, and there is no extrapolation or bridging of longer gaps. Without a
harmonic model, only already continuous hourly observations qualify. The
[NOAA handbook, §2.6](https://tidesandcurrents.noaa.gov/publications/Computational_Techniques_for_Tidal_Datums_handbook.pdf)
describes repairing supported gaps before tide tabulation; these bounds and
this interpolation are project choices, rather than a reproduction of NOAA's
six-minute processing.

MHW/MHHW share eligible high-water days, and MLW/MLLW share eligible low-water days, excluding incomplete boundary days in both predicted and observed series. A complete tidal day need not contain both a high and a low, so the high and low families can use different days within the same continuous period. MSL uses every hourly height in
the selected continuous period; MTL is derived from MHW and MLW. A station
without a supported observation window uses the whole harmonic datum family.
TICON estimates that family's gauge offset only from complete prepared months covering every calendar month of the year. It averages the available January means, February means, and so on, giving the twelve calendar-month categories equal weight. These months can be non-contiguous and come from different years, so they support a calendar-balanced offset rather than an observed high/low reduction or a single datum epoch. If any month category is missing, the fallback retains the constituent frame (MSL = 0). `datums_source` identifies the reduction method independently of `datum_frame`: both observed reductions and calendar-balanced harmonic offsets use `gauge`; unsupported harmonic offsets use `constituent`. `disclaimers` describe the fallback uncertainty.
Reconstruction cannot correct an undetected gauge datum shift or a bad
harmonic model, and stored millimetres are rounding precision, not accuracy.

## Chart datum by country

The per-country mapping follows the IHO Resolution (adopt **Lowest Astronomical
Tide (LAT)**, _or a datum as closely equivalent as is practical_, as chart
datum) and the IHO TWCWG **"List of Vertical Datums used by IHO Member States to
describe Chart Datum"** (2021):
<https://iho.int/uploads/user/Services%20and%20Standards/TWCWG/MISC/TWCWG_Vertical_Datums_v1.0.pdf>

Most maritime nations use LAT (or a close equivalent); the notable exceptions
are the low-water-datum countries and the non-tidal Baltic.

| Country / region                      | Chart datum                             | Notes                                                                                  |
| ------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------- |
| United States (+ Pacific territories) | **MLLW** (Mean Lower Low Water)         | US low-water convention                                                                |
| Canada                                | **LLWLT** (Lower Low Water, Large Tide) | mean of the annual lowest low waters                                                   |
| Japan                                 | **NLLW** (Nearly Lowest Low Water)      | ≈ Indian Spring Low Water                                                              |
| South Korea                           | **ALLW** (Approximate Lowest Low Water) | ≈ Indian Spring Low Water                                                              |
| China                                 | **TLT** (Theoretical Lowest Tide)       | theoretical depth datum                                                                |
| Brazil, Italy, Chile                  | **MLWS** (Mean Low Water Springs)       | per the IHO TWCWG list                                                                 |
| Sweden, Danish inner waters, Baltic   | **MSL** (≈ BSCD2000 / DVR90)            | non-tidal Baltic + Kattegat; see below                                                 |
| Everyone else                         | **LAT**                                 | IHO default (UK, France, Netherlands, Australia, Norway, Spain, India, New Zealand, …) |

Russia and Argentina use national low-water datums of the Vladimirsky /
low-water family; LAT is used here as the IHO-sanctioned close equivalent. If a
station lacks its country's preferred datum, selection falls back to LAT.

## Baltic split

The Baltic Sea is effectively non-tidal, so its riparian states chart to a
mean-sea-level datum (BSCD2000) rather than a low-water datum. Germany in
particular splits: **North Sea coast → LAT (Seekartennull)**, **Baltic coast →
MSL**. Administrative region can't separate them (Schleswig-Holstein touches
both seas) and neither can a longitude line (the lower Elbe reaches inland past
the longitude of the Baltic fjords). `packages/datums/sea-regions.ts` classifies stations
with a point-in-polygon test; Baltic stations use MSL.

Denmark splits the same way: inner Danish waters **including the whole
Kattegat** chart to DVR90 ≈ MSL, and the LAT regime starts in the Skagerrak.
Skagen harbor sits on the Kattegat side of the IHO Skagen–Paternoster line, so
it charts to MSL.

The geometry is the authoritative **IHO Sea Areas (S-23)** polygons from
[Marine Regions](https://marineregions.org) (Flanders Marine Institute,
CC-BY 4.0): the Baltic Sea, the Gulfs of Bothnia/Finland/Riga, and the
Kattegat, with the Skagerrak excluded. `packages/datums/fetch-sea-regions.ts` downloads
them from the VLIZ WFS, keeps each basin's outer ring only (so island gauges
classify by basin), simplifies to ~1 km, and writes the committed
`data/baltic-sea.geo.json`. Two adjustments on top:

- **Shore tolerance (~2 km)** — harbor and estuary gauges sit on or just
  inside the (simplified) coastline; the tolerance also closes seam slivers
  where basins abut (e.g. Kattegat/Baltic at Öresund). Validated against all
  325 German/Danish/Baltic-state stations: every Baltic-side gauge (including
  Lübeck up the Trave and the Stettin lagoon) classifies MSL, every
  North-Sea/Elbe/Skagerrak gauge stays LAT. Known miss: Anklam, ~30 km up the
  Peene river — accepted, since the Baltic is non-tidal there and LAT ≈ MSL to
  within centimeters.
- **Limfjord carve-out** — inner Danish waters but not an S-23 sea area, so a
  small hand-drawn box covers the central/eastern fjord; the North-Sea entrance
  (Thyborøn) stays LAT.

## Quality gates

Datum-ordering QA (`packages/stations/evaluate-quality.ts`) enforces a strict chain on the
standard datums — `MHW > MSL > MLW`, `MHW ≥ MLLW`, MTL
between MHW and MLW — as fatal errors, with the diurnal pairs (MHHW/MHW,
MLW/MLLW) as warnings since they converge at weakly diurnal stations.

The extra chart datums get bounded/relational **warnings only**: the low-water
cluster (LAT / ISLW / LLWLT / TLT / MLWS) has no station-independent total
order — the ISLW-family datums fall below LAT at ~3% of stations by design, and
the Admiralty MLWS can sit above MLW in diurnal regimes where the formula's
semidiurnal-only view underestimates the range.

LAT/MLW and HAT/MHHW comparisons allow 5 cm for observed means, including NOAA’s published means even when its mixed datum table has no `datums_source` flag: finite observed reductions include weather and can cover a different period from the harmonic bounds. Differences within that allowance warn; larger disagreements reject the model. The allowance is a project screening definition, informed by centimetre-scale masked-record mean changes and paired NOAA residuals, not a station accuracy guarantee. Harmonic means from the same prediction retain strict ordering checks.
