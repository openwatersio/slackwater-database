# References

Primary sources for [a global tide model with vessel observations](README.md). DOIs were checked against Crossref or DataCite, and links were fetched, in October 2026. Entries marked _unverified_ are cited from another source's reference list and were not seen directly.

## Global tide models

### FES

- **Lyard, Lefèvre, Letellier and Francis 2006**, Modelling the global ocean tides: modern insights from FES2004, _Ocean Dynamics_ 56, 394–415. DOI [10.1007/s10236-006-0086-x](https://doi.org/10.1007/s10236-006-0086-x). The T-UGOm finite-element model behind every later FES.
- **Lyard, Allain, Cancet, Carrère and Picot 2021**, FES2014 global ocean tide atlas: design and performance, _Ocean Science_ 17, 615–649. DOI [10.5194/os-17-615-2021](https://doi.org/10.5194/os-17-615-2021). Open access. The full method: SpEnOI ensemble assimilation (432 members per constituent), 600 gauges and about 12,600 altimetry points for M2, observation error 3 mm deep and 1 cm coastal, and the authors' own account of why coastal gains fall short.
- **CNES, LEGOS, NOVELTIS and CLS 2024**, FES2022 Ocean Tide product handbook (issue 2.0, 2026). DOI [10.24400/527896/a01-2024.004](https://doi.org/10.24400/527896/a01-2024.004), [handbook PDF](https://www.aviso.altimetry.fr/fileadmin/documents/data/tools/hdbk_FES2022.pdf). About 11 million elements down to 500 m, GEBCO 2020 plus regional bathymetry, 13,489 altimetry points and 295 gauges, 16 assimilated constituents and 18 from the model alone. The journal paper is in preparation.
- **AVISO license**, [PDF](https://www.aviso.altimetry.fr/fileadmin/documents/data/License_Aviso.pdf). Heights for any use with attribution; no redistribution of unmodified data through public platforms without CNES authorization; currents non-commercial.
- **Carrère et al. 2022**, A new barotropic tide model for global ocean: FES2022, OSTST. [Slides](https://ostst.aviso.altimetry.fr/fileadmin/user_upload/OSTST2022/Presentations/TID2022-A_new_barotropic_tide_model_for_global_ocean__FES2022.pdf).

### TPXO and inverse models

- **Egbert, Bennett and Foreman 1994**, TOPEX/POSEIDON tides estimated using a global inverse model, _JGR_ 99(C12), 24821–24852. DOI [10.1029/94JC01894](https://doi.org/10.1029/94JC01894). The representer-based generalized inverse of the shallow-water equations.
- **Egbert and Erofeeva 2002**, Efficient inverse modeling of barotropic ocean tides, _JTECH_ 19, 183–204. DOI [10.1175/1520-0426(2002)019<0183:EIMOBO>2.0.CO;2](<https://doi.org/10.1175/1520-0426(2002)019%3C0183:EIMOBO%3E2.0.CO;2>). OTIS, the reduced-basis inverse behind TPXO.
- **TPXO products and registration**, [tpxo.net](https://www.tpxo.net/tpxo-products-and-registration). Non-commercial only; commercial use only through the exclusive licensee.
- **Taguchi, Stammer and Zahel 2014**, Inferring deep ocean tidal energy dissipation from the global high-resolution data-assimilative HAMTIDE model, _JGR Oceans_ 119, 4573–4592. DOI [10.1002/2013JC009766](https://doi.org/10.1002/2013JC009766).

### Empirical models and altimetry

- **Hart-Davis, Piccioni, Dettmering, Schwatke, Passaro and Seitz 2021**, EOT20: a global ocean tide model from multi-mission satellite altimetry, _ESSD_ 13, 3869–3884. DOI [10.5194/essd-13-3869-2021](https://doi.org/10.5194/essd-13-3869-2021); data DOI [10.17882/79489](https://doi.org/10.17882/79489), CC BY 4.0. Residual analysis against FES2014 on a 1/8° grid, coastal altimetry to within 3–7 km; the only fully open global model to build on.
- **Ray 2025**, Documentation for Goddard Ocean Tide Solution GOT5, NASA/TM-20250002085. [PDF](https://ntrs.nasa.gov/api/citations/20250002085/downloads/GOT5-TechMemo.pdf). Deep, shelf and coastal RMS per constituent for FES2014, EOT20 and GOT5 (Tables 4–6); notes GOT was never meant for near-coastal use.
- **Birol et al. 2017**, Coastal applications from nadir altimetry: example of the X-TRACK regional products, _Advances in Space Research_ 59, 936–953. DOI [10.1016/j.asr.2016.11.005](https://doi.org/10.1016/j.asr.2016.11.005).
- **Cancet et al. 2018**, Arctide2017, a high-resolution regional tidal model in the Arctic Ocean, _Advances in Space Research_. DOI [10.1016/j.asr.2018.01.007](https://doi.org/10.1016/j.asr.2018.01.007). A regional T-UGOm model with local bathymetry and gauges.
- **Ray and Zaron 2016**, M2 internal tides and their observed wavenumber spectra from satellite altimetry, _JPO_ 46, 3–22. DOI [10.1175/jpo-d-15-0065.1](https://doi.org/10.1175/jpo-d-15-0065.1). Non-stationary internal tides set a floor on altimetric constants.

### Gauge data

- **Piccioni, Dettmering, Bosch and Seitz 2019**, TICON: TIdal CONstants based on GESLA sea-level records from globally located tide gauges, _Geoscience Data Journal_ 6, 97–104. DOI [10.1002/gdj3.72](https://doi.org/10.1002/gdj3.72).
- **Hart-Davis, Dettmering and Seitz 2025**, TICON-4. [Dataset](https://www.seanoe.org/data/00980/109129/), DOI [10.17882/109129](https://doi.org/10.17882/109129). The TICON source in this database.
- **Haigh et al. 2022**, GESLA Version 3, _Geoscience Data Journal_ 10, 293–314. DOI [10.1002/gdj3.174](https://doi.org/10.1002/gdj3.174).

## Accuracy assessments

- **Stammer et al. 2014**, Accuracy assessment of global barotropic ocean tide models, _Reviews of Geophysics_ 52, 243–282. DOI [10.1002/2014RG000450](https://doi.org/10.1002/2014RG000450), [open copy](https://archimer.ifremer.fr/doc/00838/94992/). About 0.9, 5.0 and 6.5 cm RSS over eight constituents for deep, shelf and coastal water.
- **Ray, Egbert and Erofeeva 2011**, Tide predictions in shelf and coastal waters: status and prospects, in _Coastal Altimetry_, Springer, 191–216. DOI [10.1007/978-3-642-12796-0_8](https://doi.org/10.1007/978-3-642-12796-0_8), [preprint](https://ntrs.nasa.gov/citations/20080023345). Why coastal tides are hard: short scales, bathymetry, compound tides, aliasing, and the difficulty of merging local models.
- **Gregg, Penna, Jones and Morales Maqueda 2024**, Accuracy assessment of recent global ocean tide models in coastal waters of the European North West Shelf, _Ocean Modelling_ 192, 102448. DOI [10.1016/j.ocemod.2024.102448](https://doi.org/10.1016/j.ocemod.2024.102448), [open copy](https://eprints.ncl.ac.uk/301968). 24.5 cm RSS for the best model at 137 independent coastline sites; every model is worse at gauges it did not assimilate.
- **Fu, Wang, Peng, Feng, Khaki and Mi 2025**, Accurate extraction of ocean tidal constituents from coastal satellite altimeter records, _Frontiers in Marine Science_ 12. DOI [10.3389/fmars.2025.1592765](https://doi.org/10.3389/fmars.2025.1592765). FES2022, FES2014, EOT20 and DTU16 within 0.5 cm of each other near the coast.
- **Xu et al. 2024**, A comparison of global and regional ocean tide models with tide gauges in the East Asian marginal seas, _Journal of Sea Research_ 201, 102527. DOI [10.1016/j.seares.2024.102527](https://doi.org/10.1016/j.seares.2024.102527).
- **Zaron and Elipot 2021**, An assessment of global ocean barotropic tide models using geodetic mission altimetry and surface drifters, _JPO_ 51, 63–82. DOI [10.1175/jpo-d-20-0089.1](https://doi.org/10.1175/jpo-d-20-0089.1). Validation against data the atlases did not assimilate.

## Hydrodynamic tide and surge models

- **Muis, Verlaan, Winsemius, Aerts and Ward 2016**, A global reanalysis of storm surges and extreme sea levels, _Nature Communications_ 7, 11969. DOI [10.1038/ncomms11969](https://doi.org/10.1038/ncomms11969). GTSM on Delft3D FM, with tides taken from FES2012.
- **Muis et al. 2020**, A high-resolution global dataset of extreme sea levels, tides, and storm surges, _Frontiers in Marine Science_ 7, 263. DOI [10.3389/fmars.2020.00263](https://doi.org/10.3389/fmars.2020.00263).
- **Wang, Verlaan, Irazoqui Apecechea and Lin 2021**, Computation-efficient parameter estimation for a high-resolution global tide and surge model, _JGR Oceans_ 126, e2020JC016917. DOI [10.1029/2020JC016917](https://doi.org/10.1029/2020JC016917).
- **Wang, Verlaan, Veenstra and Lin 2022**, Data-assimilation-based parameter estimation of bathymetry and bottom friction coefficient to improve coastal accuracy in a global tide model, _Ocean Science_ 18, 881–904. DOI [10.5194/os-18-881-2022](https://doi.org/10.5194/os-18-881-2022). Calibration cut gauge RSS from 19.2 to 12.7 cm at about 76,800 core hours, still well behind FES2014 offshore.
- **Kernkamp, Van Dam, Stelling and de Goede 2011**, Efficient scheme for the shallow water equations on unstructured grids with application to the Continental Shelf, _Ocean Dynamics_ 61, 1175–1188. DOI [10.1007/s10236-011-0423-6](https://doi.org/10.1007/s10236-011-0423-6).
- **Pringle, Wirasaet, Roberts and Westerink 2021**, Global storm tide modeling with ADCIRC v55: unstructured mesh design and performance, _GMD_ 14, 1125–1145. DOI [10.5194/gmd-14-1125-2021](https://doi.org/10.5194/gmd-14-1125-2021). Mesh sizing from tidal wavelength, bathymetry gradient and coastline.

## Physics

- **Farrell 1972**, Deformation of the Earth by surface loads, _Reviews of Geophysics_ 10, 761–797. DOI [10.1029/RG010i003p00761](https://doi.org/10.1029/RG010i003p00761).
- **Ray 1998**, Ocean self-attraction and loading in numerical tidal models, _Marine Geodesy_ 21, 181–192. DOI [10.1080/01490419809388134](https://doi.org/10.1080/01490419809388134).
- **Egbert and Ray 2000**, Significant dissipation of tidal energy in the deep ocean inferred from satellite altimeter data, _Nature_ 405, 775–778. DOI [10.1038/35015531](https://doi.org/10.1038/35015531).
- **Egbert and Ray 2001**, Estimates of M2 tidal energy dissipation from TOPEX/Poseidon altimeter data, _JGR Oceans_ 106, 22475–22502. DOI [10.1029/2000JC000699](https://doi.org/10.1029/2000JC000699).
- **Jayne and St. Laurent 2001**, Parameterizing tidal dissipation over rough topography, _GRL_ 28, 811–814. DOI [10.1029/2000GL012044](https://doi.org/10.1029/2000GL012044).
- **Arbic, Garner, Hallberg and Simmons 2004**, The accuracy of surface elevations in forward global barotropic and baroclinic tide models, _Deep-Sea Research II_ 51, 3069–3101. DOI [10.1016/j.dsr2.2004.09.014](https://doi.org/10.1016/j.dsr2.2004.09.014).

## Data assimilation

- **Bennett 1992**, _Inverse Methods in Physical Oceanography_, Cambridge University Press. DOI [10.1017/CBO9780511600807](https://doi.org/10.1017/CBO9780511600807).
- **Egbert and Bennett 1996**, Data assimilation methods for ocean tides, in _Modern Approaches to Data Assimilation in Ocean Modeling_, Elsevier Oceanography Series 61, 147–179.
- **Evensen 1994**, Sequential data assimilation with a nonlinear quasi-geostrophic model using Monte Carlo methods to forecast error statistics, _JGR Oceans_ 99(C5), 10143–10162. DOI [10.1029/94JC00572](https://doi.org/10.1029/94JC00572).
- **Evensen 2003**, The Ensemble Kalman Filter: theoretical formulation and practical implementation, _Ocean Dynamics_ 53, 343–367. DOI [10.1007/s10236-003-0036-9](https://doi.org/10.1007/s10236-003-0036-9).

## Harmonic analysis

- **Doodson 1921**, The harmonic development of the tide-generating potential, _Proc. Royal Society A_ 100, 305–329. DOI [10.1098/rspa.1921.0088](https://doi.org/10.1098/rspa.1921.0088).
- **Schureman 1958**, _Manual of Harmonic Analysis and Prediction of Tides_, USC&GS Special Publication 98. [PDF](https://tidesandcurrents.noaa.gov/publications/SpecialPubNo98.pdf). Nodal factors and the inference used for 15- and 29-day records.
- **Godin 1972**, _The Analysis of Tides_, University of Toronto Press. No online copy.
- **Munk and Cartwright 1966**, Tidal spectroscopy and prediction, _Phil. Trans. R. Soc. A_ 259, 533–581. DOI [10.1098/rsta.1966.0024](https://doi.org/10.1098/rsta.1966.0024). The response method: admittance is smooth in frequency, which justifies inferring unresolved constituents and fitting band-wise ratios against a reference.
- **Cartwright and Edden 1973**, Corrected tables of tidal harmonics, _Geophysical Journal_ 33, 253–264. DOI [10.1111/j.1365-246X.1973.tb03420.x](https://doi.org/10.1111/j.1365-246X.1973.tb03420.x).
- **Foreman 1977, revised 2004**, _Manual for Tidal Heights Analysis and Prediction_, Pacific Marine Science Report 77-10. [PDF mirror](https://ccrm.vims.edu/yinglong/TMP/heights2004.pdf).
- **Pawlowicz, Beardsley and Lentz 2002**, Classical tidal harmonic analysis including error estimates in MATLAB using T_TIDE, _Computers & Geosciences_ 28, 929–937. DOI [10.1016/S0098-3004(02)00013-4](<https://doi.org/10.1016/S0098-3004(02)00013-4>).
- **Leffler and Jay 2009**, Enhancing tidal harmonic analysis: robust (hybrid L1/L2) solutions, _Continental Shelf Research_ 29, 78–88. DOI [10.1016/j.csr.2008.04.011](https://doi.org/10.1016/j.csr.2008.04.011). Robust fitting that resists surge and outliers.
- **Foreman, Cherniawsky and Ballantyne 2009**, Versatile harmonic tidal analysis: improvements and applications, _JTECH_ 26, 806–817. DOI [10.1175/2008JTECHO615.1](https://doi.org/10.1175/2008JTECHO615.1). Nodal correction and inference inside the least-squares matrix, and irregularly sampled data.
- **Codiga 2011**, _Unified Tidal Analysis and Prediction Using the UTide Matlab Functions_, GSO Technical Report 2011-01. [PDF](https://www.po.gso.uri.edu/codiga/utide/2011Codiga-UTide-Report.pdf). Gappy, irregular records and Monte Carlo uncertainty; ported to Python.
- **Matte, Jay and Zaron 2013**, Adaptation of classical tidal harmonic analysis to nonstationary tides, with application to river tides, _JTECH_ 30, 569–589. DOI [10.1175/JTECH-D-12-00016.1](https://doi.org/10.1175/JTECH-D-12-00016.1).
- **Jay and Flinchem 1999**, A comparison of methods for analysis of tidal records containing multi-scale non-tidal background energy, _Continental Shelf Research_ 19, 1695–1732. DOI [10.1016/S0278-4343(99)00036-9](<https://doi.org/10.1016/S0278-4343(99)00036-9>).
- **Pugh and Woodworth 2014**, _Sea-Level Science_, Cambridge University Press. DOI [10.1017/CBO9781139235778](https://doi.org/10.1017/CBO9781139235778).
- **IOC 2006**, _Manual on Sea Level Measurement and Interpretation_, Vol. IV, IOC Manuals and Guides 14. [Record](https://repository.oceanbestpractices.org/handle/11329/213); [series index](https://www.psmsl.org/train_and_info/training/manuals/).

## Short records

- **Parker 2007**, _Tidal Analysis and Prediction_, NOAA Special Publication NOS CO-OPS 3. [PDF](https://tidesandcurrents.noaa.gov/publications/Tidal_Analysis_and_Predictions.pdf). Synodic periods (M2/N2 27.6 d, K1/P1 182.6 d), what 15 days resolve, inference from nearby stations (§3.3, §4.2), and how a 2–3 day surge spreads across a 15-day analysis (§4.1).
- **Filmer, Woodworth, Williams and Claessens 2025**, Analysis of the uncertainties in tidal constants obtained from short tide gauge records and their value for tidal studies, _Continental Shelf Research_ 295, 105565. DOI [10.1016/j.csr.2025.105565](https://doi.org/10.1016/j.csr.2025.105565), [open copy](https://nora.nerc.ac.uk/id/eprint/540316/). 35-day records with inference: typically ≤ 4.5 cm, worst 9.3 cm (K1). Inference ratios from a nearby gauge beat equilibrium ratios, and FES2022 can supply them.
- **Pan, Xu and Wei 2024**, Improved tidal estimates from short water level records via the modified harmonic analysis model, _Ocean Modelling_ 189, 102372. DOI [10.1016/j.ocemod.2024.102372](https://doi.org/10.1016/j.ocemod.2024.102372). Abstract not read.
- **Munk and Hasselmann 1964**, Super-resolution of tides, _Studies on Oceanography_, 339–344. _Unverified_, cited by Parker 2007. High signal-to-noise records resolve finer than the Rayleigh criterion.
- **Foreman and Henry 1989**, The harmonic analysis of tidal model time series, _Advances in Water Resources_ 12, 109–120. DOI [10.1016/0309-1708(89)90017-1](<https://doi.org/10.1016/0309-1708(89)90017-1>).
- **Zetler and Munk 1975**, The optimum wiggliness of tidal admittances, _Journal of Marine Research_ 33 (supplement), 1–13. _Unverified_, cited by Parker 2007.

## Datums from short series

- **NOAA CO-OPS 2003**, _Computational Techniques for Tidal Datums Handbook_, Special Publication NOS CO-OPS 2. [PDF](https://tidesandcurrents.noaa.gov/publications/Computational_Techniques_for_Tidal_Datums_handbook.pdf). Standard and modified-range-ratio methods by simultaneous comparison with a control station; tide-by-tide analysis for under a month (§4.3), with a worked 5-day example.
- **Swanson 1974**, _Variability of Tidal Datums and Accuracy in Determining Datums from Short Series of Observations_, NOAA Technical Report NOS 64. [PDF](https://www.tidesandcurrents.noaa.gov/publications/NOAA_TechReport_NOS_64_Variability_of_Tidal_Datums.pdf). Datum accuracy against series length by coast.
- **Bodnar 1981**, _Estimating Accuracies of Tidal Datums from Short Term Observations_, NOAA Technical Report NOS 83. [Record](https://repository.library.noaa.gov/view/noaa/14690).
- **Michalski, Huang and Hovis 2014**, _Error Analysis Procedures Used by NOS to Compute Estimated Error Bounds for Tidal Datums in the Arctic Ocean_, NOAA Technical Report NOS CO-OPS 070. [PDF](https://www.tidesandcurrents.noaa.gov/publications/NOAA_Technical_Report_NOS_COOPS_070.pdf). Without a control station: 11.5 cm at 1 month, 4.0 cm at 12 months.
- **NOAA CO-OPS**, Tidal Analysis Datums Calculator FAQs. [PDF](https://access.co-ops.nos.noaa.gov/datumcalc/docs/FAQs.pdf). Choosing a control station of similar tide type in the same water body, gaps, and storm effects on short records.
- **Marmer 1951**, _Tidal Datum Planes_, USC&GS Special Publication 135. [Scan](https://www.govinfo.gov/content/pkg/CZIC-qc809-e2-m37-1951/html/CZIC-qc809-e2-m37-1951.htm).
- **NOAA CO-OPS 2001**, _Tidal Datums and Their Applications_, Special Publication NOS CO-OPS 1. [PDF](https://tidesandcurrents.noaa.gov/publications/tidal_datums_and_their_applications.pdf).
- **NOAA CO-OPS**, Tide and water level requirements for short-term tide stations and hydrographic surveys. [Record](https://repository.library.noaa.gov/view/noaa/70294). Discrete tide zoning and short-term stations for survey reduction.
- **Forrester 1983**, _Canadian Tidal Manual_, Department of Fisheries and Oceans. [Scanned chapters](https://psmsl.org/train_and_info/training/reading/canadian_manual.php). Secondary ports and short-record analysis.

## Interpolating tides and datums

- **Hess, Schmalz, Zervas and Collier 1999, revised 2004**, _Tidal Constituent and Residual Interpolation (TCARI)_, NOAA Technical Report NOS CS 4. [Record](https://repository.library.noaa.gov/view/noaa/1689). Interpolates constituents, residuals and datums between gauges over the water domain.
- **Hess 2002**, Spatial interpolation of tidal data in irregularly-shaped coastal regions by numerical solution of Laplace's equation, _Estuarine, Coastal and Shelf Science_ 54, 175–192. DOI [10.1006/ecss.2001.0838](https://doi.org/10.1006/ecss.2001.0838).
- **Hess 2003**, Water level simulation in bays by spatial interpolation of tidal constituents, residual water levels, and datums, _Continental Shelf Research_ 23, 395–414. DOI [10.1016/S0278-4343(03)00005-0](<https://doi.org/10.1016/S0278-4343(03)00005-0>).
- **Shi, Hess and Myers 2013**, Spatial interpolation of tidal data using a multiple-order harmonic equation for unstructured grids, _International Journal of Geosciences_ 4. DOI [10.4236/ijg.2013.410140](https://doi.org/10.4236/ijg.2013.410140).
- **Xu 2017**, A note on interpreting tidal harmonic constants, _Ocean Dynamics_ 68, 15–24. DOI [10.1007/s10236-017-1122-8](https://doi.org/10.1007/s10236-017-1122-8). Interpolate complex constants, not amplitude and phase separately.
- **Spargo, Hess and Myers 2006**, Tidal datum modeling in support of NOAA's Vertical Datum Transformation Tool, _Estuarine and Coastal Modeling (2005)_, ASCE. DOI [10.1061/40876(209)30](<https://doi.org/10.1061/40876(209)30>). Interpolation, harmonic constants and hydrodynamic models compared as ways to build datum fields.
- **Parker, Milbert and Hess 2003**, Integrating bathymetry, topography, and shoreline, and the importance of vertical datums, _OCEANS 2003_. DOI [10.1109/OCEANS.2003.178410](https://doi.org/10.1109/OCEANS.2003.178410).
- **NOAA 2012**, _VDatum Manual_ v1.01. [PDF](https://www.vdatum.noaa.gov/download/publications/Manual_2012.06.26.pdf). A hydrodynamic model calibrated to observed datums, with TCARI-interpolated corrections.
- **NOAA 2014**, _Estimation of Vertical Uncertainties in VDatum_. [PDF](https://vdatum.noaa.gov/download/publications/Estimation_of_Vertical_Uncertainties_in_VDatum_20141222.pdf).
- **Wu, Myers et al. 2019**, Modeling tidal datums and spatially varying uncertainty in the Texas and western Louisiana coastal waters, _JMSE_ 7, 44. DOI [10.3390/jmse7020044](https://doi.org/10.3390/jmse7020044). ADCIRC tides plus interpolated model-minus-gauge errors: the remove-restore pattern for option 2.
- **Tang, Myers, Shi et al. 2018**, Tidal datums with spatially varying uncertainty in north-east Gulf of Mexico for VDatum application, _JMSE_ 6, 114. DOI [10.3390/jmse6040114](https://doi.org/10.3390/jmse6040114).

## Crowdsourced bathymetry and tide

- **IHO 2022**, B-12 _Guidance to Crowdsourced Bathymetry_, Edition 3.0.0. [PDF](https://iho.int/uploads/user/pubs/bathy/B_12_CSB-Guidance_Document-Edition_3.0.0_Final.pdf). Submit uncorrected depths with timestamps and offsets; vertical reference and reduction metadata.
- **NCEI 2025**, _Guidance for Submitting CSB Data to the IHO DCDB_, v2.0. [PDF](https://www.ncei.noaa.gov/sites/default/files/2025-07/Guidance%20for%20Submitting%20CSB%20Data%20to%20the%20IHODCDB_v2.0%20%283%29.pdf). Timestamps must be valid ISO 8601 in the past; nothing on clock accuracy.
- **CSB schema index**, UNH CCOM. [Index](https://csbtools.ccom.unh.edu/assets/schemas/schema_index.html).
- **Klemm and Krabiel 2023**, From Crowd to Chart, U.S. Hydro. [PDF](https://raw.githubusercontent.com/anthonyklemm/Crowdsourced_Bathy_Processing/main/Klemm_CSB_USHYDRO23.pdf). NOAA OCS processing: zoned tides, then vessel offsets against BlueTopo.
- **Klemm 2025**, Crowdsourced Bathymetry Data Processing and Quality Assessment, IHO CSB Workshop. [Slides](https://csbtools.ccom.unh.edu/assets/presentations/P3_Klemm_ProcessingQA.pdf).
- **Calder, Dijkstra, Hoy, Himschoot and Schofield 2020**, A design for a trusted community bathymetry system, _Marine Geodesy_ 43, 327–358. DOI [10.1080/01490419.2020.1718255](https://doi.org/10.1080/01490419.2020.1718255). Transducer offsets auto-calibrated to about 1 dm with post-processed GNSS.
- **Calder 2021**, Estimating observer and data reputation in mariner-volunteered bathymetry, _International Hydrographic Review_, 77–96. [Record](https://scholars.unh.edu/ccom/1546).
- **Muthusamy, Church, Rondeau, Bilodeau and Breton 2025**, Crowd-sourced bathymetry vertical uncertainty calculation per sounding, _Abstracts of the ICA_ 10, 209. DOI [10.5194/ica-abs-10-209-2025](https://doi.org/10.5194/ica-abs-10-209-2025). Uncertainty of nearest-station tide reduction, growing with range and with shorter records.
- **Ibekwute 2025**, _Estimating the vertical offsets of a crowd-sourced bathymetry system using Kalman Filter solution_, University of New Brunswick. [Record](https://unbscholar.lib.unb.ca/items/27c36371-d148-4f84-b5e5-fff1270d4bc4). Offsets off by more than a meter from prior estimates.
- **Thornton 2011**, TeamSurv: Surveying with the Crowd, _Hydro International_. [Article](https://www.hydro-international.com/content/article/teamsurv-surveying-with-the-crowd). Interpolated predictions plus observed residuals.
- **Yang, Li, Han, Lu and Wang 2015**, Corrections for tidal residuals due to insufficient representation using a single station in shallow water multibeam bathymetric data, _Marine Geodesy_ 38, 299–313. DOI [10.1080/01490419.2015.1034388](https://doi.org/10.1080/01490419.2015.1034388). Residual tide estimated from overlapping survey lines: the closest prior art to estimating tide from soundings.
- **Hoy and Calder 2019**, The viability of crowdsourced bathymetry for authoritative use, U.S. Hydro. [Record](https://scholars.unh.edu/ccom/1739).

## Water levels from GNSS and low-cost sensors

- **Foster, Carter and Merrifield 2009**, Ship-based measurements of sea surface topography, _GRL_ 36, L11605. DOI [10.1029/2009GL038324](https://doi.org/10.1029/2009GL038324), [author copy](https://ftp.soest.hawaii.edu/gscarter/publications/fosteretal2009.pdf). Geodetic GNSS needs a waterline gauge, because draft changes by tens of centimeters.
- **Rice and Riley 2011**, Measuring the water level datum relative to the ellipsoid during hydrographic survey, U.S. Hydro. [PDF](https://www.nauticalcharts.noaa.gov/learn/docs/ellipsoidally-referenced-surveys/rice-riley-measuring-water-level-datum-relative-ers.pdf).
- **Mills and Dodd 2012**, Separation models for ellipsoidally referenced hydrographic surveys, FIG Working Week. [Slides](https://fig.net/resources/proceedings/fig_proceedings/fig2012/ppt/ts08d/TS08D_dodd_mills_5704_ppt.pdf).
- **Larson, Löfgren and Haas 2013**, Coastal sea level measurements using a single geodetic GPS receiver, _Advances in Space Research_ 51, 1301–1310. DOI [10.1016/j.asr.2012.04.017](https://doi.org/10.1016/j.asr.2012.04.017).
- **Larson, Ray and Williams 2017**, A 10-year comparison of water levels measured with a geodetic GPS receiver versus a conventional tide gauge, _JTECH_ 34, 295–307. DOI [10.1175/JTECH-D-16-0101.1](https://doi.org/10.1175/JTECH-D-16-0101.1). About 12 cm RMS per retrieval, yet tidal constants within 1 cm of the gauge for most constituents.
- **Larson and Williams 2023**, Water level measurements using reflected GNSS signals, _International Hydrographic Review_ 29(2), 66–76. DOI [10.58440/ihr-29-2-a30](https://doi.org/10.58440/ihr-29-2-a30).
- **Karegar, Kusche, Geremia-Nievinski and Larson 2022**, Raspberry Pi Reflector (RPR): a low-cost water-level monitoring system based on GNSS interferometric reflectometry, _Water Resources Research_ 58. DOI [10.1029/2021WR031713](https://doi.org/10.1029/2021WR031713).
- **Fagundes et al. 2021**, An open-source low-cost sensor for SNR-based GNSS reflectometry, _GPS Solutions_ 25. DOI [10.1007/s10291-021-01087-1](https://doi.org/10.1007/s10291-021-01087-1).
- **Pytharouli, Chaikalis and Stiros 2018**, Uncertainty and bias in electronic tide-gauge records: evidence from collocated sensors, _Measurement_ 125, 496–508. DOI [10.1016/j.measurement.2018.05.012](https://doi.org/10.1016/j.measurement.2018.05.012). Only 9% of harbor sensors met the PSMSL 1 cm criterion; disputed in part by Aarup et al., DOI [10.1016/j.measurement.2018.12.007](https://doi.org/10.1016/j.measurement.2018.12.007).

## Signal K

- **Signal K specification**, [environment](https://github.com/SignalK/specification/blob/master/schemas/groups/environment.json) and [navigation](https://github.com/SignalK/specification/blob/master/schemas/groups/navigation.json) schemas. `environment.depth.belowTransducer`, `surfaceToTransducer` and `belowSurface`; `navigation.state` (`anchored`, `moored`) and `navigation.anchor.currentRadius`.

## Software

| Repository                                                  | What it offers                                           | License                |
| ----------------------------------------------------------- | -------------------------------------------------------- | ---------------------- |
| [pyTMD/pyTMD](https://github.com/pyTMD/pyTMD)               | Tide model prediction in Python, including load tides    | MIT                    |
| [CNES/aviso-fes](https://github.com/CNES/aviso-fes)         | PyFES, the official FES2022 prediction code              | BSD-3                  |
| [T-UGOm](https://sirocco.obs-mip.fr/ocean-models/t-ugo/)    | The FES hydrodynamic model; download behind registration | Not stated             |
| [adcirc/adcirc](https://github.com/adcirc/adcirc)           | Unstructured-mesh tide and surge model                   | LGPL-3.0               |
| [schism-dev/schism](https://github.com/schism-dev/schism)   | Unstructured-mesh ocean model                            | Apache-2.0             |
| [Deltares/Delft3D](https://github.com/Deltares/Delft3D)     | D-Flow FM, the engine behind GTSM                        | AGPL-3.0 / GPL-3.0 mix |
| [wesleybowman/UTide](https://github.com/wesleybowman/UTide) | UTide in Python                                          | MIT                    |
| [rray/perth5](https://codeberg.org/rray/perth5)             | GOT5 prediction code                                     | Not checked            |
