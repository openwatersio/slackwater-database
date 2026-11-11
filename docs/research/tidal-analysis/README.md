# Tidal analysis references

The primary sources behind [the plan for fitting our own constituents](../../plans/water-levels-constituents.md): agency manuals, technical reports and peer-reviewed papers. Each entry says what we rely on it for and where in the source to find it. Page numbers are the printed ones. An entry marked _not yet read in full_ was checked only against its abstract, table of contents or the agency's own summary, and gets read before anything depends on details beyond what's listed.

[harmonic-inequalities](../harmonic-inequalities/README.md) covers HRoI and BSH's method in more depth.

## Harmonic analysis

**Parker, B. B. (2007). _Tidal Analysis and Prediction_. NOAA Special Publication NOS CO-OPS 3.** [PDF](https://tidesandcurrents.noaa.gov/publications/Tidal_Analysis_and_Predictions.pdf), public domain. NOAA's reference for its own practice.

- §3.3, pp. 84–87: the Rayleigh criterion and the record lengths that separate each pair: about 15 days for M2, S2, K1 and O1, 29 days for N2 and Q1, 6 months for K1/P1 and S2/K2, and a year for S2/T2 and K1/S1. Schureman's standard is 369 days, and 365 days is enough for least squares (p. 86).
- p. 86: comparing independent yearly analyses is "the only good way to check the quality of harmonic constants".
- §3.7.2, pp. 120–122: Sa and Ssa are mostly meteorological and steric, vary a lot from year to year, rarely improve a prediction for another year, and should be left out of a prediction used to compute a nontidal residual.
- §3.9.1, pp. 129–130: compare predicted and observed high and low waters with the same extremum-picking method on both series, or the comparison misleads.
- §4.3, from p. 159: assessing the quality of a prediction by high and low water comparison, residual spectra and the residual series.
- pp. 163–165 and 308: don't reject small constituents by an amplitude cutoff such as 0.03 ft if they reduce variance and are consistent from year to year. Don't use a build-up factor. New reference stations shouldn't feel bound to the standard 37, and NOAA uses 114 at Anchorage.
- p. 259: nonlinear terms generate compound tides at the frequencies of Mm and MSf.

**Foreman, M. G. G. (1977, revised 2004). _Manual for Tidal Heights Analysis and Prediction_. Pacific Marine Science Report 77-10, Institute of Ocean Sciences.** [PDF](https://waves-vagues.dfo-mpo.gc.ca/Library/54866.pdf), Fisheries and Oceans Canada. The IOS package, which T_TIDE and UTide follow. _Not yet read in full._

- The standard list of 45 astronomical and 24 shallow-water constituents, plus 77 optional shallow-water constituents.
- Selection by the Rayleigh criterion against constituents of larger equilibrium amplitude, taken in a fixed order.
- Inference of constituents a short record can't resolve, from a reference station's amplitude ratios and phase differences.

**Foreman, M. G. G., Cherniawsky, J. Y. and Ballantyne, V. A. (2009). Versatile harmonic tidal analysis: improvements and applications. _Journal of Atmospheric and Oceanic Technology_ 26, 806–817.** [doi:10.1175/2008JTECHO615.1](https://doi.org/10.1175/2008JTECHO615.1). _Not yet read in full._

- Nodal corrections, astronomical arguments and inference inside the least-squares matrix, so multi-year and gappy records are analyzed exactly.

**Pawlowicz, R., Beardsley, B. and Lentz, S. (2002). Classical tidal harmonic analysis including error estimates in MATLAB using T_TIDE. _Computers & Geosciences_ 28, 929–937.** [doi:10.1016/S0098-3004(02)00013-4](<https://doi.org/10.1016/S0098-3004(02)00013-4>). _Not yet read in full._

- Confidence intervals for amplitude and phase from the residual spectrum (colored noise) and the SNR they give.

**Codiga, D. L. (2011). _Unified Tidal Analysis and Prediction Using the UTide Matlab Functions_. Technical Report 2011-01, Graduate School of Oceanography, University of Rhode Island.** [PDF](https://www.po.gso.uri.edu/~codiga/utide/2011Codiga-UTide-Report.pdf).

- Robust fitting by iteratively reweighted least squares is the default, after Leffler and Jay (2009) (§II.B.1).
- Automatic constituent selection by the Rayleigh criterion, and the noise-modified Rayleigh criterion of Munk and Hasselmann (§II.D).
- Diagnostics: condition number against SNR, the largest correlation between parameters, and percent energy (§II.D).
- Reconstruction keeps constituents with SNR ≥ 2 by default (the `MinSNR` option), and common practice takes the threshold as 1 or 2 (§II.D.2).

**Deltares. HATYAN.** [Documentation](https://deltares.github.io/hatyan/modules.html) and [source](https://github.com/Deltares/hatyan). The Python successor to Rijkswaterstaat's analysis software.

- Preset constituent lists: `year` with 94 components, `halfyear` 88, `month` 21 and `springneap` 14. The `year` list includes overtides and compounds up to the twelfth-diurnal.
- Analysis year by year, with the results vector-averaged, and Schureman's nodal factors.

## Constituent lists and conventions

**IHO Tidal and Water Level Working Group (2017). _Standard List of Tidal Constituents_.** [PDF](https://iho.int/uploads/user/Services%20and%20Standards/TWCWG/MISC/TWCWG_Constituent_list.pdf). The catalog `@slackwater/engine` uses.

**IHO (2019). Resolution 1/2019.** [PDF](https://iho.int/uploads/user/Services%20and%20Standards/TWCWG/TWCWG5/TWCWG5_2020_3.2.1_EN_IHO_Reslution_1-2019_v1.0.pdf).

- Predictions should come with their metadata, including the constituent list and the dates of the series analyzed.

**IHO TWCWG (2021). _Survey on Harmonic Analysis_.** [PDF](https://iho.int/uploads/user/Services%20and%20Standards/TWCWG/MISC/TWCWG_2021_EN_Survey_Harmonic_Analysis_V1.0.pdf). _Not yet read in full._

- How member offices choose constituents, infer minor ones and treat Sa and Ssa. Most use inference to some extent.

## TICON

**Hart-Davis, M., Dettmering, D. and Seitz, F. (2025). _TICON-4: TIdal CONstants based on GESLA-4 sea-level records_. Dataset and user manual, SEANOE.** [doi:10.17882/109129](https://doi.org/10.17882/109129), CC BY 4.0.

- 50 constituents at 4,838 gauges, chosen from community requests and the constituents of global tide models, not per site (§1–2).
- A constituent is set to zero when its error exceeds its estimate for both amplitude and phase (§1).
- Table 1's MKS2, 3N2 and Sa rows don't match the constants as published, as measured against the GESLA-4 records they were fitted to ([#238](https://github.com/openwatersio/slackwater-database/issues/238#issuecomment-6019697631)).

**Hart-Davis, M. G., et al. (2026). Tide of the Time: Global tidal characteristics observed from in-situ measurements. _Ocean Science_ 22, 1681–1709.** [doi:10.5194/os-22-1681-2026](https://doi.org/10.5194/os-22-1681-2026), CC BY 4.0. _Not yet read in full._

- TICON's method and its limits. River gauges are left out of the analysis, and harmonic analysis may be insufficient there.

**Piccioni, G., Dettmering, D., Bosch, W. and Seitz, F. (2019). TICON: TIdal CONstants based on GESLA sea-level records from globally located tide gauges. _Geoscience Data Journal_ 6, 97–104.** [doi:10.1002/gdj3.72](https://doi.org/10.1002/gdj3.72). _Not yet read in full._

## Rivers and nonstationary tides

**Matte, P., Jay, D. A. and Zaron, E. D. (2013). Adaptation of classical tidal harmonic analysis to nonstationary tides, with application to river tides. _Journal of Atmospheric and Oceanic Technology_ 30, 569–589.** [doi:10.1175/JTECH-D-12-00016.1](https://doi.org/10.1175/JTECH-D-12-00016.1). _Not yet read in full._

- NS_TIDE: river discharge and tidal range as forcing in the basis functions. Why a stationary fit leaves tidal-band energy at river-influenced gauges.

## HRoI

**Müller-Navarra, S. H. (2013). _On tidal predictions by means of harmonic representation of inequalities_. Berichte des BSH 50.** [PDF](https://www.bsh.de/DE/PUBLIKATIONEN/_Anlagen/Downloads/Meer_und_Umwelt/Berichte-des-BSH/Berichte-des-BSH_50_de.pdf), in German and English.

- The method: deviations of high and low water times and heights from their means, after each lunar transit, fitted as sums of long-period partial tides.
- The generalization to heights at fixed fractions of the lunar day, which gives a curve.

**Boesch, A. and Müller-Navarra, S. (2019). Reassessment of long-period constituents for tidal predictions along the German North Sea coast and its tidally influenced rivers. _Ocean Science_ 15, 1363–1379.** [doi:10.5194/os-15-1363-2019](https://doi.org/10.5194/os-15-1363-2019), CC BY 4.0, with [a copy](../harmonic-inequalities/boesch-mueller-navarra-2019-ocean-science.pdf) in this repo.

- BSH's 39 partial tides since the 2020 tables, fitted to 19 years of high and low waters.
- Where HRoI beats harmonic predictions: strongly distorted semidiurnal tides in shallow water and rivers, such as Cuxhaven and Hamburg.
- The standard deviation of BSH's predicted minus observed high and low water times and heights per gauge.

## Verification and accuracy

**NOAA CO-OPS. _Tide Prediction Error for the United States Coastline_.** [PDF](https://tidesandcurrents.noaa.gov/pdf/Tide_Prediction_Error_for_the_United_States_Coastline.pdf), public domain.

- RMS of predicted minus observed over a year at reference stations, for high and low water times and heights and for hourly heights. Eastport in 2013: 0.11 h for high water time and 0.143 m for hourly heights. The RMS includes weather, and NOAA states there is no single standard of accuracy.

No IHO or IOC standard sets a numeric accuracy for tide predictions.

## Agencies whose predictions we compare with

| Agency           | Source                                                                                                                                                           | What it says                                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| NOAA CO-OPS      | [Harmonic constituents](https://tidesandcurrents.noaa.gov/about_harmonic_constituents.html)                                                                      | 37 standard constituents, from at least 30 days of data                                                                     |
| Rijkswaterstaat  | [Kenmerkende waarden Rijn-Maasmonding](https://open.rijkswaterstaat.nl/publish/pages/178503/11205232-007-zks-0003_v0-1-kenmerkende_waarden_rijn-maasmonding.pdf) | Its yearly constituent set, analyzed with HATYAN                                                                            |
| SHOM             | [Fiche prédiction de marée](https://refmar.shom.fr/sites/default/files/2025-01/GT-TSH_CatD_Fiche_Prediction_maree.pdf)                                           | 143 constituents, at least a year of data                                                                                   |
| SHOM             | [Marées à la carte](https://services.data.shom.fr/static/specifications/notice_marees_a_la_carte.pdf)                                                            | Predictions are sold under internal-use and commercial licenses                                                             |
| UKHO             | [Algorithmic transparency record](https://www.gov.uk/algorithmic-transparency-records/ukho-tidal-harmonic-analysis-and-prediction)                               | Harmonic analysis with TASK, checked by predicted minus observed residuals                                                  |
| Kartverket       | [Tidevannstabeller](https://www.kartverket.no/globalassets/til-sjos/nautiske-publikasjoner/tidevannstabeller-norske-kyst-svalbard.pdf)                           | Harmonic analysis, preferably of several years                                                                              |
| DMI              | [DMI Report 26-01](https://www.dmi.dk/fileadmin/Rapporter/2026/DMIRep26-01.pdf)                                                                                  | Constituents from long quality-assured series; LAT on the west coast, MSL in Kattegat and the Baltic                        |
| Marine Institute | [Tidal predictions](https://www.marine.ie/site-area/data-services/marine-forecasts/tidal-predictions)                                                            | Harmonic analysis of the national network, with some sites from a model                                                     |
| JCG              | [Harmonic constants](https://www1.kaiho.mlit.go.jp/TIDE/harmonic/constants/hc.php?s=0063)                                                                        | 60 constituents, revised every 5 years from a 10-year analysis                                                              |
| SMHI             | [Tidvatten](https://www.smhi.se/kunskapsbanken/oceanografi/vagor/tidvatten)                                                                                      | Tides of a few decimeters on the west coast and a few centimeters in the Baltic. SMHI publishes no astronomical predictions |

## Regimes

**Medvedev, I. P., Rabinovich, A. B. and Kulikov, E. A. (2016). Tides in three enclosed basins: the Baltic, Black, and Caspian seas. _Frontiers in Marine Science_ 3, 46.** [doi:10.3389/fmars.2016.00046](https://doi.org/10.3389/fmars.2016.00046), CC BY 4.0.

- Baltic tides are centimeters and mostly diurnal in the eastern gulfs, so SNR is low and few constituents are significant.
