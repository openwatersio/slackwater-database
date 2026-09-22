# Tidal datums

Every reference station stores:

- **`datums`** — map of named vertical levels (MSL, MLLW, LAT, …) in the station's native gauge frame

- **`chart_datum`** — which datum is the vertical zero for this station's
  predictions. Predicted heights only line up with a national tide service when
  both use the same chart datum, and each country charts to its own (see
  [Chart datum by country](#chart-datum-by-country)).
- **`datums_source`** — how the datums were derived: `observed` (reduced from
  water-level measurements) or `harmonic` (synthesized from the station's
  constituents).
- **`epoch`** — the period the underlying data actually came from.

Subordinate stations carry no datums of their own in the source data, but the
quality-filtered `stations` export from `@neaps/tide-database` copies datums and
constituents from each subordinate's reference station at load time.

Those copied datums describe the **reference's** water, and this library
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
when observations are available; the astronomical/amplitude datums always come
from the harmonic side, since observed extremes include storm surge. Datums
specific to one country (LLWLT, TLT, NLLW, ALLW) are pruned from stations that
don't use them (`pruneDatums` in `packages/stations/station.ts`), so a UK station never
carries a stray TLT.

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

The observed (mean) datums use each station's own record window (the most
recent ≤19 years of data); the per-station `epoch` field records the period the
data actually came from.

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
standard datums — `MHW > MSL > MLW ≥ LAT`, `HAT ≥ MHHW`, `MHW ≥ MLLW`, MTL
between MHW and MLW — as fatal errors, with the diurnal pairs (MHHW/MHW,
MLW/MLLW) as warnings since they converge at weakly diurnal stations.

The extra chart datums get bounded/relational **warnings only**: the low-water
cluster (LAT / ISLW / LLWLT / TLT / MLWS) has no station-independent total
order — the ISLW-family datums fall below LAT at ~3% of stations by design, and
the Admiralty MLWS can sit above MLW in diurnal regimes where the formula's
semidiurnal-only view underestimates the range.
