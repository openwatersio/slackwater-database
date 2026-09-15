## NOAA Tide Station Data Overview

This database fetches tide station metadata from NOAA CO-OPS and converts it into a local, normalized dataset. It classifies stations by prediction method, stores harmonic constituents or prediction offsets as appropriate, and records available tidal datums for reference.

The goal is to mirror how NOAA operationally produces tide predictions, not just what data exists in their metadata.

### Reference stations

Reference stations use **harmonic constituents** to generate tide predictions. These stations:

- Have a full harmonic solution derived from long water-level records
- Support predictions in multiple datums (MLLW, MSL, MTL, etc., when available)
- Can produce both continuous predictions and high/low events

For these stations, the script downloads harmonic constituents and datum values directly from NOAA.

### Subordinate stations

Subordinate stations do not use harmonics for predictions. Instead, their tides are derived from a nearby reference station using **prediction offsets**.

For subordinate stations:

- High and low tide times are shifted by a fixed number of minutes
- Tide heights are adjusted using either additive or ratio-based offsets
- Predictions are based on extreme events only, with linear interpolation between them
- NOAA serves predictions **only in MLLW** and **only as high/low events**

Some subordinate stations still list harmonic constituents in NOAA metadata; these are retained for historical and analytical purposes but are not used operationally.

### Datums

NOAA’s predictions are produced by offsetting tidal predictions from MSL (mean sea level), so that the requested datum corresponds to zero.

- Reference stations can return predictions in any supported datums
- Subordinate stations return predictions in **MLLW only**, even if other datums are listed

Unlike TICON stations, datum values here are **published by NOAA** (computed on the National Tidal Datum Epoch), not derived by this library, and `chart_datum` is set directly to `MLLW` (`STND` for non-tidal stations) rather than going through the country-based selection. See [docs/datums.md](../../docs/datums.md) for the library-wide datum overview.

#### LAT and HAT

NOAA publishes LAT and HAT for most, but not all, of its reference stations. For the
remainder, [`packages/stations/backfill-lat-hat.ts`](../../packages/stations/backfill-lat-hat.ts) synthesizes the
two from the station's own harmonic constituents over the pinned `DATUM_EPOCH` — the same
method [`packages/datums/datum.ts`](../../packages/datums/datum.ts) already uses for TICON and IOC — and shifts
the result onto NOAA's scale by the station's published MSL. 58 stations are filled this way. Every other datum in those
records stays exactly as NOAA published it, so the `datums` object is mixed: observed means,
synthesized extremes. That is why `datums_source` is left absent on NOAA stations rather
than set to `harmonic` — one per-station value cannot describe both halves honestly.

Two kinds of station are deliberately left without LAT/HAT. Three (`8519024`, `8764311`,
`9450623`) publish no MSL, so there is no frame to put a constituent-space result onto. Eight
more carry **Sa and Ssa at zero amplitude** — NOAA ships its 37-name constituent list with
zeros where it did not resolve a term, and 237 of its 1,253 harmonic references have no
seasonal term at all. LAT and HAT are the bounds of a full 19-year envelope, and a set with no
season cannot describe one: the scan still runs and still returns two confident numbers, but
the envelope is narrowed by whatever the season contributes. A narrowed envelope presented as
"the lowest this station ever gets" is worse than no answer, so those stations are skipped.

[`packages/stations/check-lat-hat.ts`](../../packages/stations/check-lat-hat.ts) cross-checks the method against the
references that publish LAT/HAT already. Over a 200-station sample the median disagreement is
**0.5 cm (LAT) and 0.6 cm (HAT)** — the harmonics essentially _are_ the definition of these
two datums. The outliers are river stations, Longview on the Columbia and Threemile Slough in
the Delta, where NOAA's observed datums carry freshwater discharge no harmonic set reproduces.

#### Subordinate stations and datums

Subordinate station files carry no `datums` key; the `stations` export resolves them from each
subordinate's reference station at load time, **unreduced**. Those values describe the
reference's water, not the subordinate's. A caller that wants a subordinate's own floor and
ceiling should apply `offsets.height` to the reference's LAT/HAT at the same point it applies
the offsets to the predicted extremes — the reduction is exact for both offset kinds, but the
result is the floor of a prediction rather than a hydrographic datum, and does not belong in a
`datums` object. See [docs/datums.md](../../docs/datums.md) for why.
