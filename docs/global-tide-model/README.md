# A global tide model with vessel observations

This is a review of what it would take to build a global tide model in the style of FES2022, extended with water levels observed by recreational vessels at rest, and of the data we have to do it with. The bibliography is in [references.md](references.md). Nothing here is built yet.

The immediate user is the [crowd-depth global grid](https://github.com/openwatersio/crowd-depth/issues/153), which must reduce every sounding to chart datum before it publishes. Its [plan](https://github.com/openwatersio/crowd-depth/blob/main/docs/plans/global-grid/README.md#tide) reduces soundings with NOAA tide zones in US waters, with a prediction from the nearest station in this database (within 50 km) on other coasts, and with FES2022 offshore. TCARI is listed as a later improvement.

## Why it matters

Tide is the largest error left in the grid once vessel offsets are removed. In crowd-depth's [vessel calibration spike](https://github.com/openwatersio/crowd-depth/blob/main/docs/plans/global-grid/vessel-calibration.md), subtracting the hourly level at the nearer of two Chesapeake gauges, with no zone offsets, cut the spread of per-transit offsets from 0.31 to 0.23 m (median over 132 vessels) and from 0.67 to 0.47 m at the 90th percentile. That spike concluded that tide reduction has to come before calibration.

The nearest-station method has three limits:

- **Distance.** The tide changes between stations, especially in estuaries, behind islands and in channels. A station 50 km away can be off by tens of percent in range and by an hour or more in phase. Muthusamy et al. (2025) show that the error of assigning each sounding to its nearest station grows with tidal range.
- **Coverage.** About 8,300 stations cover the world's coasts unevenly. Much of the Pacific, Africa, South America and Southeast Asia has none within 50 km.
- **No feedback.** Crowd data never improves the tide it is reduced with.

## What a FES-class model is

FES2022 (Lyard et al. 2021 for the FES2014 method; the FES2022 handbook for the current release) has three parts:

1. **A hydrodynamic model.** T-UGOm solves the barotropic shallow-water equations on an unstructured finite-element mesh, forced by the tide-generating potential. The mesh has about 11 million elements, from 30 km offshore down to 4 km at the coast and 500 m locally. The physics has to include self-attraction and loading (Farrell 1972; Ray 1998), drag from internal-tide generation over rough topography (Egbert and Ray 2000; Jayne and St. Laurent 2001), bottom friction, and nonlinear compound tides and overtides in shallow water. Bathymetry is the most important input: FES2022 credits much of its coastal gain to better bathymetry and a more realistic reference depth (2 m instead of 10 m).
2. **Data assimilation.** Spectral Ensemble Optimal Interpolation (SpEnOI) builds error covariances from an ensemble of model runs with perturbed friction, wave drag and bathymetry. It then blends the model with 13,489 altimetry points and 295 tide gauges for 16 constituents. Another 18 constituents come from the model without assimilation. TPXO does the same job with a representer-based generalized inverse (Egbert et al. 1994; Egbert and Erofeeva 2002; Bennett 1992).
3. **A product.** The product is a grid of complex amplitudes per constituent (1/30° for FES2022), read by a prediction library (PyFES, pyTMD).

Empirical models (EOT20, GOT5) take another route. They adjust a hydrodynamic prior such as FES2014 by harmonic analysis of altimetry residuals, with no dynamics of their own.

### Where the error is

Every good model is accurate in the deep ocean and weak at the coast:

| Region      | M2 RMS vs gauges (FES2014 / EOT20 / GOT5.5) | Source                    |
| ----------- | ------------------------------------------- | ------------------------- |
| Deep (151)  | 0.30 / 0.48 / 0.31 cm                       | Ray 2025, GOT5 Tables 4–6 |
| Shelf (195) | 3.47 / 3.18 / 2.83 cm                       | Ray 2025                  |
| Coast (261) | 7.64 / 7.04 / 6.71 cm                       | Ray 2025                  |

Stammer et al. (2014) give about 0.9, 5.0 and 6.5 cm RSS over eight constituents for deep, shelf and coastal water. Those coastal figures are flattering, because the models assimilated many of the gauges they are tested against. At 137 independent coastline sites on the northwest European shelf, the best model (FES2014b) misfit by 24.5 cm RSS (Gregg et al. 2024). Against coastal altimetry within 100 km of shore, FES2022, FES2014, EOT20 and DTU16 all land within 0.5 cm of each other at about 11.3 cm RSS (Fu et al. 2025). More modeling effort is not buying clear coastal gains.

The literature gives four reasons for this (Ray, Egbert and Erofeeva 2011; Lyard et al. 2021):

- Shallow-water tides vary over short distances, so they need kilometer-scale meshes and accurate bathymetry, and both are scarce near the coast.
- Altimetry is unusable within about 3–7 km of land and in estuaries and fjords, and its sampling aliases constituents. Gauges are the only dense coastal observations, and there are few of them.
- Compound tides and overtides (M4, MS4, M6) matter in shallow water and are hard to model.
- Local and national models are rarely merged into global ones, for licensing and political reasons.

The bottleneck is coastal observations, which is exactly what vessels could add.

### Cost

A pure-physics global model is far from a practical starting point. Calibrating GTSM's bathymetry and friction by region cut its tide-gauge RSS from 19.2 to 12.7 cm. That took about 76,800 CPU core hours, and the result was still several times worse than FES2014 in the deep ocean (Wang et al. 2022). FES is the product of decades of work at LEGOS, CNES and their partners, and T-UGOm has no confirmed open license.

### Licenses

| Product         | Terms                                                                                                                                                                                                                                        |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FES2022 heights | Free registration; any use including commercial, with attribution and DOI. Redistributing the unmodified data through a public portal or API needs CNES authorization; value-added products are not restricted. Currents are non-commercial. |
| TPXO            | Non-commercial only; commercial use only through the exclusive licensee. Unusable for an open product.                                                                                                                                       |
| EOT20           | CC BY 4.0. Built on FES2014, so it shares FES's coastal limits.                                                                                                                                                                              |
| TICON-4         | CC BY 4.0, though some upstream gauges restrict commercial use (already tracked per station in this database).                                                                                                                               |
| PyFES, pyTMD    | BSD-3, MIT.                                                                                                                                                                                                                                  |

## Vessels at rest as tide gauges

### The observation

A vessel at anchor or on a mooring sits over a fixed patch of seabed. Its sounder reads

```
depth_below_transducer(t) = b − k + η(t) + ε(t)
```

where `b` is the seabed depth below some datum at that spot, `k` is the transducer depth below the waterline, `η(t)` is the water level above the datum (tide plus non-tidal residual), and `ε(t)` is noise. `b` and `k` are unknown constants. The variation of the depth over time is therefore the variation of the water level. Amplitudes and phases come straight out of it, but the mean level does not.

The mean level can come from a survey. Where `b` is known from BlueTopo or S-102, `mean(depth) − b + k` is the mean water level above the survey's datum, which is a datum transfer. That needs `k`, the vessel offset that crowd-depth's calibration solves against the same surveys, and that calibration needs tide-reduced soundings first. The circularity points to solving tide and vessel offset together: a vessel at rest over surveyed seabed constrains both.

The CSB literature always runs the other way: it takes the tide from predictions or zones and solves for the vessel offset (IHO B-12; Klemm and Krabiel 2023; Calder et al. 2020; Ibekwute 2025). **We found no published work that uses a moored or anchored vessel's sounder as a tide gauge, or that estimates tides from crowdsourced soundings.** The nearest analogues are:

- Yang et al. (2015), who estimate residual tide from depth discrepancies between overlapping multibeam lines.
- TeamSurv (Thornton 2011), which reduced crowd soundings with interpolated predictions and observed residuals.
- GNSS reflectometry (Larson et al. 2017), whose individual retrievals are noisy (about 12 cm RMS) but whose tidal constants agree with a collocated gauge to under 1 cm for most constituents. That is the averaging argument a crowd method depends on.

### What a record of a given length can give

| Record                        | What can be estimated                                                                                           | Expected accuracy                                                                 | Source                                      |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------- |
| One tide (6–13 h)             | Tide-by-tide time and height differences of high and low water against a control station                        | Worse than 4 cm in datum for a 5-day record                                       | NOAA CO-OPS 2003, §4.3                      |
| A day or two                  | Amplitude ratio and phase lag per tidal band (semidiurnal, diurnal) against a reference, by the response method | Not quantified in the literature for vessels                                      | Munk and Cartwright 1966; Parker 2007, §4.2 |
| 15 days                       | M2, S2, K1, O1 and overtides; N2 and P1 must be inferred from a nearby long record                              | M2 can be biased by unresolved N2                                                 | Parker 2007, §3.3                           |
| 29–35 days                    | Most major constituents, with inference ratios from a nearby gauge or from FES2022                              | Typically ≤ 4.5 cm per constituent, worst 9.3 cm (K1)                             | Filmer et al. 2025                          |
| 1–12 months against a control | Tidal datums                                                                                                    | Without a control: 11.5 cm at 1 month, 4.0 cm at 12 months. A control does better | Michalski et al. 2014; Swanson 1974         |

A single overnight anchorage is a tide-by-tide comparison, not a harmonic analysis. What it can give is a subordinate-station style offset (time difference, range ratio) against a reference station. That is the established NOAA method for short-term gauges, and it is the form this database already stores for subordinate stations. Many visits to the same anchorage by many vessels, on different days and at different phases of the spring–neap cycle, add up toward the longer records in the table. Boats left with their electronics on at a berth give longer records: 59% of the Open Waters hours at rest are in stays of 3 days or more, and 14% in stays of 15 days or more, long enough to separate the main constituents ([at-rest-data.md](at-rest-data.md#by-length)).

Interpolate constituents as complex numbers, never amplitude and phase separately (Xu 2017). Fit with a robust estimator (Leffler and Jay 2009), because a short record is dominated by whatever surge or wind setup happened that day (Parker 2007, §4.1).

### Error sources

None of these are quantified in the literature for this use.

- **Swing.** A boat at anchor swings through a circle tens of meters across. Over a slope `s`, a swing radius `r` changes depth by up to `r·s`. Swing follows the tidal stream, so the error has tidal periods and aliases straight into the constituents. The swing has to be modeled from position, or samples masked to a narrow footprint.
- **Non-tidal residual.** Surge, wind setup, pressure and river flow cannot be separated from the tide in a single short record. Comparing against a reference station's observed levels removes the part they share. Comparing against a prediction leaves all of it in the offset.
- **Sounder resolution.** NMEA depth sentences commonly carry 0.1 m. Averaging at 1 Hz helps only if waves dither the reading across steps.
- **Sound speed.** A sounder assuming 1,500 m/s scales every depth by up to about 3%, so a fitted range ratio can be biased by up to about 3%. Mean-level differences are biased by up to 3% of the depth.
- **Draft.** Fuel, water and crew change `k` slowly over a stay. That shows up as drift, which a linear trend term can absorb.
- **Drying and grounding.** A boat that takes the ground at low water clips the low tide.
- **Clocks.** CSB timestamps usually come from GNSS but nothing guarantees it (DCDB guidance v2.0).
- **GNSS height.** Consumer GNSS vertical error is meter-scale, so position altitude cannot stand in for the sounder.

### Where the data is

What crowd-depth collects today decides what is possible:

- **The plugin records every sounding at the sounder's rate, including at rest.** But when an antenna-to-transducer offset is configured, it drops any sounding it cannot move to the transducer position, and with no heading sensor course over ground only stands in above about 1 kn ([`correctForSensorPosition`](https://github.com/openwatersio/crowd-depth/blob/main/packages/signalk-plugin/src/streams/transforms.ts)). A boat at anchor without a heading sensor submits nothing. A gauge does not need the horizontal correction, so at-rest soundings could be kept with the antenna position and a flag.
- **The plugin does not record `navigation.state`.** Signal K defines `anchored` and `moored` states and a `navigation.anchor` group with the anchor position and current radius, but they are set by the user or by other plugins, not detected. Rest has to be detected from position and speed.
- **NOAA CSB CSVs are simplified with Douglas-Peucker before publishing** ([noaa-archive.md](https://github.com/openwatersio/crowd-depth/blob/main/docs/plans/global-grid/noaa-archive.md#quirks)), but NOAA's copy of one Open Waters vessel's 60 submissions holds every sounding of the raw files, and allowing 12-hour gaps between samples adds only 3.4% to a local subset's hours at rest ([at-rest-data.md](at-rest-data.md#does-noaas-simplification-remove-at-rest-time)). What the simplification does to tracks denser than one sounding a minute is not measured. Open Waters also keeps every plugin submission unsimplified in its own R2 bucket.
- **The grid's flatline QC rejects runs of one depth held over 1 km of GPS wander.** That catches a moored boat in tideless water, and the backlog proposes marking such runs for review instead. At a tidal site the depth is not constant, so the check is not triggered.
- **The plugin once recorded the predicted tide beside each sounding.** [crowd-depth#149](https://github.com/openwatersio/crowd-depth/pull/149) added `environment.tide.heightNow` from the Signal K tides provider, and was closed. A gauge method should compare against its own reference prediction rather than a value the boat computed.

### What the data holds

[at-rest-data.md](at-rest-data.md) measures this. Across 18 of the 20 Open Waters vessels and 140 vessels in a NOAA subset, there are 3,064 at-rest episodes of an hour or more, totaling 77,000 hours at 714 and 618 sites. If the subset is typical, the whole NOAA archive holds on the order of two million hours. There is no tide station within 50 km for 37% of the Open Waters hours, which come from cruising boats around the world, and for 13% of the NOAA hours, which are mostly in US waters.

The tide is in the data. Where the nearest tide reference station's predicted range is 2 m or more, depth at rest follows the station's predicted tide with a median gain near 1 and a lag of 5 to 10 minutes in both sources. How cleanly it follows depends on the vessel: 5 of 7 Open Waters vessels and 12 of 26 NOAA vessels have a median tide R² above 0.9. In the NOAA subset, six vessels with residuals over 0.5 m, two of them cruise ships with sounders off by several meters, account for half the fits. Vessel quality has to be scored before an offset is trusted. As the range falls, fewer vessels track the tide well, and below 0.5 m none do, as for any gauge over a short record.

## Options

Three levels of ambition, smallest first:

1. **Crowd-derived subordinate stations.** Detect at-rest episodes, compare each with a nearby reference station (its observed levels where they exist, as NOAA does, else its prediction), and fit time and height offsets. Pool repeated visits to the same spot. Publish the results in this database as subordinate stations, with their own source, license and quality evaluation, and with an uncertainty that shrinks with total observed time. This uses the existing schema and prediction engine. The least-squares solver in [packages/harmonic-analysis](../../packages/harmonic-analysis/index.ts) can be reused, but it fits constituents to records of a year or more, so fitting offsets to short records is new code. It helps wherever boats anchor, which is where crowd soundings are densest. A site is also a record of where particular boats stay. The plugin's consent text lets anyone publish and build products from the data ([crowd-depth#140](https://github.com/openwatersio/crowd-depth/issues/140)), but a published site should still pool several vessels, or several visits, rather than expose one boat's mooring.
2. **A correction surface over a background model.** Take FES2022 (or EOT20, if a fully open base matters more than accuracy) as the background. Compute residuals between the background and every station and vessel-derived site, per constituent, as complex numbers. Interpolate the residuals along the coast with an uncertainty that grows with distance, either by solving Laplace's equation over the water domain as TCARI does (Hess 2002, 2003) or by optimal interpolation. Add them back to the background. This is the remove-restore pattern NOAA uses for VDatum, a hydrodynamic model plus TCARI-interpolated gauge errors (Spargo et al. 2006; Wu et al. 2019; Tang et al. 2018). It gives a tide and an uncertainty everywhere, which crowd-depth's per-sounding uncertainty needs. It is a value-added product under the AVISO license, which should be confirmed with AVISO before publishing.
3. **An own hydrodynamic model with assimilation.** This is only worth considering if option 2 shows the background itself is the limit, and it is a multi-year research program. One feedback is worth noting: the crowd-depth grid is itself bathymetry in exactly the shallow water where tide models lack it.

Option 1 then option 2 is the practical path. Option 1 also answers the feasibility questions below with real data before option 2 is designed.

## Validation

Models score better at the gauges they assimilated (Gregg et al. 2024), so validation has to hold gauges out:

- Hold out a random set of NOAA and TICON stations and score the correction surface against them, before and after vessel data, as RSS over eight constituents and as error in predicted high and low water.
- Score vessel-derived offsets where a NOAA station or subordinate station sits within a few hundred meters of an anchorage.
- Hold out one vessel at a time, and check that each derived offset's stated uncertainty covers its actual error.
- Downstream, measure the per-transit spread of crowd-depth's vessel offsets after tide reduction, which is the number that matters to the grid.

## Open questions

- How much at-rest data the plugin loses for vessels without a heading sensor since v1.3.0.
- Whether vessel-derived gains and lags differ from the nearest station by more than their uncertainty, which is the offset option 1 would publish.
- How large swing errors are over sloping seabed. Footprints are small (median 4–13 m), but swing was not separated from the residual.
- Whether to change the plugin to keep at-rest soundings without heading, and to record `navigation.state` and `navigation.anchor.currentRadius` when present.
- How many vessels or visits a site needs before its offset is published, for privacy as well as accuracy.
- AVISO's confirmation that a correction surface built on FES2022 can be published openly.
- Whether to attempt the datum transfer through surveyed seabed, which couples this work to crowd-depth's vessel calibration.
