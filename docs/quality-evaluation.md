# Station quality evaluation

This database collects tidal harmonic constants and datums for several thousand tide gauges from national hydrographic offices and from TICON-4, a global compilation of constants computed from relayed sea-level records. Before a gauge is published, its record is evaluated. The evaluation decides whether the record can be trusted to predict tides, how good it is compared with other records, and which record to publish when several describe the same gauge. Here, a published station is one offered for prediction; a rejected record stays in the database, flagged with its reason and still reachable at its own address, but is not offered.

## Principles

**A published station must predict tides credibly.** A reader takes the predicted times and heights of high and low water at face value, often for navigation. A record is published only if its harmonic constants can reproduce the shape of the tide and its datums are consistent with one another. A record that fails a basic physical or definitional test is rejected outright rather than published with a lower rank.

**Prefer the authoritative, longest, most recent record of a gauge.** The agency that operates a gauge and maintains its vertical datum has the best knowledge of it, so its own analysis is preferred over a relay's reanalysis of the same data. Among comparable records, one analyzed over a full 18.61-year nodal cycle beats a shorter one, and one that ends recently beats one that describes the harbor as it was decades ago.

**One gauge, one published record.** The same gauge often reaches this database several times: from its operator, as a fast-delivery and a research-quality series, or from two agencies that both relay it. Publishing all of them would show readers two answers for the same water. Duplicates are found and only the best record is published. The others stay in the database, marked as duplicates of the record that was chosen.

**Decide only on differences the data can resolve.** Harmonic constants carry an analysis error, and a comparison between two values inside that error is noise. The checks below compare amplitudes against that error, not against the digits a value is stored with. Stored constants keep each provider's published precision, which says nothing about their accuracy.

**Label what a tide table cannot describe.** Some water has a real but tiny tide on top of a large seasonal swing in level: lakes, river reaches, Baltic lagoons. Those predictions are correct, but presenting them as a tide table misleads. Such stations are published with a label rather than rejected.

## Sources

| Source                                    | Role                                                                                                                                                                                                            |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NOAA CO-OPS (United States)               | Authoritative. Reference stations with harmonic constants, and subordinate stations.                                                                                                                            |
| Toitū Te Whenua LINZ (New Zealand)        | Authoritative. Reference stations.                                                                                                                                                                              |
| Kartverket, Hydrographic Service (Norway) | Authoritative. Reference stations.                                                                                                                                                                              |
| Japan Coast Guard JHOD (Japan)            | Authoritative. Reference stations.                                                                                                                                                                              |
| Japan Meteorological Agency (Japan)       | Authoritative. Published harmonic constants; published tide-table CD reference.                                                                                                                                 |
| Danish Meteorological Institute           | Fits of astronomical predictions. No gauge-authority claim; source priority 50 (confidence 0.495), an engineering ranking independent of TICON's DMI relay priority. No original observation epoch is inferred. |
| TICON-4                                   | Relay. Constants computed from GESLA-4 sea-level records supplied by many agencies.                                                                                                                             |
| SMHI (Sweden)                             | Re-fits of TICON's records of SMHI's gauges from SMHI's series in the water-levels lake. Ranked as the TICON relays they replace.                                                                               |
| Canadian Hydrographic Service             | Station identity only. No harmonic constants, so not evaluated.                                                                                                                                                 |

TICON-4 (Hart-Davis et al., 2025) analyzes the records in GESLA-4, which collects sea-level data from national and regional agencies (Haigh et al., 2023, describes the GESLA-3 compilation that version 4 extends). Each TICON record names the agency that supplied the data, and that agency matters to several of the checks below.

## Amplitude tolerance

Two amplitudes count as different only when they differ by more than 3 mm. Harmonic analysis judges a constituent by its error estimate rather than by the digits it is printed to (Pawlowicz et al., 2002; Codiga, 2011). For a year or more of hourly data that error is about 1 mm at a quiet site and about 3 mm where wind, waves and river flow add non-tidal noise, and more for a shorter record. Only TICON publishes per-constituent errors, and they behave like formal least-squares errors, which run low when the residual is not white noise (Codiga, 2011). Every source is therefore held to the noisy-site figure. The tolerance applies wherever this document compares amplitudes.

NOAA publishes an amplitude of 0 with a phase of 0 for a constituent it did not determine. That pair means missing. Any other small or zero amplitude is a measured value below detection, and it predicts correctly.

A reference station has its own harmonic constants. A subordinate (secondary) station has none; it predicts from a reference station's constants plus time and height differences for high and low water (Parker, 2007). Where a check needs datums or constants, a subordinate is judged on its reference station's.

## Rejection checks

These checks are pass or fail. A record that fails any of them is rejected and gets a score of 0. When a record fails more than one, the first failure in the order below is its `reason`, and every failure is listed in its `issues`.

| Check                  | Rejects a record when                                        | Basis                    |
| ---------------------- | ------------------------------------------------------------ | ------------------------ |
| Position               | it sits at the (0°, 0°) placeholder                          | Engineering choice       |
| Clock error            | its source's times are off by a measured amount              | Measured on this data    |
| Datum consistency      | its datums contradict their definitions                      | NOAA and IHO definitions |
| Tidal range            | its mean range is under 2 cm                                 | Engineering choice       |
| Superseded relay       | it relays a gauge whose operator publishes its own constants | Editorial choice         |
| Essential constituents | it lacks M2, S2, K1 or O1, or a resolved P1 exceeds K1       | Equilibrium tide         |
| Seasonal contamination | its annual term is five times that of comparable neighbors   | Seasonal cycle physics   |

### Position

**What it catches.** A record that failed to geolocate upstream often defaults to latitude 0°, longitude 0°, a point in the Gulf of Guinea several hundred kilometers from any coast. Such a record would publish a tide station in the open ocean and could never be matched against the real gauge by position.

**Threshold.** Both coordinates within 0.05° of zero (about 5.6 km). This is an engineering choice. No coastline lies inside it, so it cannot reject a real gauge.

**Limitations.** It catches only that one placeholder. Swapped latitude and longitude, a dropped sign, or a coarse rounding all pass. Whether a position is in water is checked separately, against the coastline, and is not part of this evaluation.

### Clock error

**What it catches.** A source whose record times are wrong. A harmonic analysis of records stamped in the wrong time zone, or in local time that shifts with daylight saving, fits the right tide at the wrong time, and its predictions put high and low water early or late by that amount.

**Rejected** when a TICON record comes from a source listed in `CLOCK_ERROR_SOURCES`, with the measurement that put it there:

- Harris County Flood Control District (`hct`). Against the nearest NOAA or USGS gauge within 5 km, its 9 comparable records run a median 44 minutes late on M2 (23 to 71 minutes) and about 30 minutes late on K1 and O1. USGS (591 pairs) and California's Department of Water Resources (97 pairs) run within a minute by the same comparison. The other 8 Harris County records have no NOAA or USGS gauge within 5 km to compare with and are rejected with their source. Every Harris County record has a NOAA harmonic station within 15 km with about the same range.

**Basis.** A comparison against independent gauges on this data. A source is listed by hand, from evidence such as the flags described under [Disagreeing duplicates](#disagreeing-duplicates).

**Limitations.** A clock error in a single record, rather than a whole source, is caught only when it is merged with a record that has the right time, and the flag does not say which of the two is wrong.

### Datum consistency

**What it catches.** Tidal datums are averages of particular sets of heights, and their definitions fix their order (Gill & Schultz, 2001; NOAA, 2003). Mean high water (MHW) is the mean of all high waters and mean low water (MLW) the mean of all low waters, so any real tide has MHW above MLW, with mean sea level (MSL) and mean tide level (MTL) between them. Mean lower low water (MLLW) averages only the lower low of each tidal day and cannot exceed MHW. The IHO defines Lowest Astronomical Tide (LAT) as the lowest level that can be predicted under average meteorological conditions and any combination of astronomical conditions, and Highest Astronomical Tide (HAT) as the highest (IHO, S-32; IHO, M-3, Resolution 3/1919). For means from that same harmonic prediction, LAT cannot lie above MLW and HAT cannot lie below mean higher high water (MHHW). Observed means include weather and can cover a different period, so these two comparisons need an allowance. Datums that break these relations were computed from the wrong data, mislabeled, or mix vertical frames, and predictions referred to them as chart datum would be wrong by the size of the error.

**Rejected** when any of these holds:

- MHW is at or below MSL, or MSL is at or below MLW.
- MTL lies above MHW or below MLW.
- MLW lies below LAT by more than 5 cm for observed means, or by any amount for harmonic means.
- MHW lies below MLLW.
- HAT lies below MHHW by more than 5 cm for observed means, or by any amount for harmonic means.

NOAA’s published mean datums receive the observed-mean bound allowance even when `datums_source` is absent on its mixed datum tables. An explicit `harmonic` flag stays strict. Other unclassified providers stay strict until their mean-datum provenance is established.

**Noted but not rejected**, because they can fail legitimately by small amounts or by construction:

- Observed MLW/LAT or HAT/MHHW disagreements within 5 cm. This project screening allowance is informed by centimetre-scale masked-record mean changes and paired NOAA residuals. It is not an accuracy guarantee; larger differences still flag an unsuitable model or observation period.

- MHHW below MHW, or MLW below MLLW. The pairs are equal where each tidal day has one high and one low water and nearly equal where the diurnal inequality is small, so rounding can flip them by millimeters.
- Mean high and low water springs (MHWS, MLWS) inside MHW and MLW. This database computes them with the Admiralty approximation, MSL ± (M2 + S2) ([docs/datums.md](datums.md)), which ignores the diurnal constituents and underestimates the range where the diurnal tide is large.
- National low-water chart datums (Japan's NLLW, Korea's ALLW, Canada's LLWLT, China's TLT) above MLW, or more than 0.5 m below LAT. The ISLW-family datums, MSL minus the sum of the M2, S2, K1 and O1 amplitudes, fall below LAT at about 3% of stations by construction, because the four constituents never all peak together. The 0.5 m allowance is an engineering choice that tolerates this while still flagging an implausible datum.

**Limitations.** A subordinate station is judged on its reference station's datums, so one bad reference rejects all of its subordinates. A record with no datums, or missing one side of a comparison, passes that comparison. The check finds datums that contradict one another, not a whole set shifted by a constant.

### Tidal range

**What it catches.** Water whose astronomical tide is too small to predict. When the mean range (MHW − MLW) is under a couple of centimeters, the tide is at the level of measurement and analysis error, and the water level is governed by wind, air pressure, seiches and river flow. Published times of high and low water would be noise presented as fact.

**Threshold.** A mean range under 2 cm. This is an engineering choice, twice the 10 mm accuracy that GLOSS asks of a tide gauge (IOC, 2002). The IHO treats a range under about 0.30 m as negligible for charting, which calls for mean sea level as the datum rather than for rejecting the record (IHO, M-3, Resolution 3/1919).

**Limitations.** In strongly diurnal water the great diurnal range (MHHW − MLLW) is the more natural measure, though the two converge there. A subordinate is judged on its reference station's range, not on the range after its own height differences, so a subordinate with a small height ratio can pass on its reference's range. Water with a tiny tide and a large seasonal swing can clear the floor by millimeters; Cobourg, on Lake Ontario, is one example. The seasonal label below exists for such water.

### Superseded relay

**What it catches.** A second, indirect answer for a gauge whose operator already publishes one. TICON-4 reanalyzes many gauges that NOAA, Kartverket, LINZ, JHOD and JMA operate, and those agencies publish harmonic constants for the same gauges, analyzed with their own quality control and over their own chosen period (Parker, 2007). A relay is matched to its operator's record only by what it declares:

- TICON's NOAA relays carry the NOAA station number in their id, and its Norwegian Hydrographic Service relays the Kartverket station code, its JODC JMA relays an `MA` code matched through [JMA’s reviewed crosswalk](../sources/jma/ticon-originators.json), and its JODC Coast Guard relays an `HD` code matched through [JHOD's reviewed crosswalk](../sources/jhod/ticon-originators.json).
- UHSLC's station metadata names the originating agency and, for NOAA and LINZ, its station number. JODC originator `HD` codes use the same JHOD crosswalk. Metadata naming JMA or JODC can also declare the reviewed two-character JMA gauge codes. For the Norwegian Hydrographic Service it gives no number, and the gauge is matched to the Kartverket station of the same name, ignoring accents (Vardø matches Vardo).
- A TICON record that UHSLC's metadata does not cover, such as a fast-delivery series, shares what another record of its gauge (see [Same identifier](#same-identifier)) declares. A record the metadata covers speaks for itself, even when no rule accepts what it names: Bermuda's 1932–1949 series gives St. George's under UHSLC's own data source, so it declares nothing rather than taking its 2000s sibling's Ferry Reach, 0.75 km away. A gauge whose records declare two different originators stops the evaluation.

The relay is rejected when its operator's record has harmonic constants, passes every other check here, lies within 10 km, and has an M2 amplitude that does not contradict the relay's (beyond both a 10% ratio and the amplitude tolerance). Beyond 10 km the declaration is more likely wrong than the coordinates. A relay that fails either test is left to deduplication. The merge report joins a superseded relay's route to its operator's, and also joins a relay whose own id, a NOAA station number from NOAA, or a UHSLC JODC HD or JMA gauge-code declaration names a record within 2 km even when their M2 disagree, since the number says which gauge it is; such a relay stays accepted or rejected as quality decides. A relay whose M2 disagrees with its operator's record by more than one gauge analyzed twice does (see [Disagreeing duplicates](#disagreeing-duplicates)) says so in `issues`. When the operator publishes the gauge only as a subordinate station, not at all, or with a record that fails a check, the relay stands in for it. TICON's historical Rijkswaterstaat series is also rejected, because the current Rijkswaterstaat series covers the same gauges.

**Basis.** An editorial choice of this project: the operator's analysis is the primary source.

**Limitations.** A relay that declares nothing is caught only if deduplication pairs it with the operator's record, which requires the two positions to agree within the distances given below. TICON's relays of LINZ's sea-level network (source `ttw`) carry their own station codes rather than LINZ's, so a relay such as Auckland, 2.7 km from LINZ's Auckland port, stays separate.

### Essential constituents

**What it catches.** A harmonic model that cannot reproduce the shape of the tide. M2, S2, K1 and O1 are the four largest constituents of the equilibrium tide (Cartwright & Tayler, 1971) and dominate the real tide almost everywhere. They also define the form number, which classifies a tide as semidiurnal, mixed or diurnal (Defant, 1961; Pugh & Woodworth, 2014). A reference station is rejected if any of the four is missing, including NOAA's 0/0 marker for a constituent it did not determine. A small or zero amplitude with a phase is a real value below detection and passes.

It also rejects a model whose P1 amplitude exceeds K1. In the tide-generating potential, P1 is about 0.331 of K1 (Cartwright & Tayler, 1971). The ocean's response varies smoothly with frequency across a tidal band (Munk & Cartwright, 1966), and P1 and K1 are only 0.082°/h apart, so the observed ratio stays close to the equilibrium value. Harmonic analysis can infer P1 from K1 when nearby data give their relative amplitude and phase, and falls back on the equilibrium ratio otherwise (Foreman, 1977; Pawlowicz et al., 2002). Separating the two needs about 182.6 days of data, the Rayleigh criterion for that pair, though the limit depends on the signal-to-noise ratio and P1 can be determined from somewhat shorter records (Parker, 2007). TICON-4 analyzes only records of at least a year (Hart-Davis et al., 2026), so an unresolved pair is rarely the cause in this database: every TICON record with P1 above K1 spans at least 1.5 years. A resolved P1 well above K1 marks a fit whose diurnal band cannot be trusted. The ratio holds for the gravitational tide only. Radiational forcing by the sun puts energy on both frequencies, and where the diurnal tide is a few millimeters it can bring P1 level with K1: at Aladga in the Caspian Sea K1 and P1 are nearly equal, and across the Baltic the radiational S1 is about the size of P1 (Medvedev, Rabinovich & Kulikov, 2016). That explains a P1 near a small K1, not a resolved P1 well above it. A record is rejected when P1 is at least 10 mm and exceeds K1 by more than the amplitude tolerance. The 10 mm floor is an engineering choice.

**Exemptions.** Records from authoritative sources are not required to have K1: two Norwegian gauges, Solumstrand and Viker, publish none. The P1 test applies to every source alike. Five Kartverket records have P1 above K1, Viker among them with no K1 at all, and all five have P1 under 10 mm.

The one record rejected on P1 alone with K1 above 1 cm is TICON's analysis of REFMAR's Dumont d'Urville series, 1952–2024: K1 8.7 cm, P1 10.5 cm. The fault is the whole fit, not the ratio. UHSLC's analysis of the same gauge, 2008–2023, has K1 30.1 cm and P1 9.9 cm (P1/K1 0.33, the equilibrium value) and is the record published there; the REFMAR fit puts K1 at a third of that, its phases 30° to 55° away, and S1 and SA at 13 cm and 46 cm.

**Limitations.** Subordinate stations are not tested; they use their reference station's constants. The P1 test catches only the gross case, so a P1/K1 ratio of 0.8 passes, and a P1 under 10 mm is never tested. A NOAA amplitude below 0.5 mm whose phase also rounds to 0.0° cannot be told apart from the 0/0 marker.

### Seasonal contamination

**What it catches.** A harmonic fit that absorbed spurious energy into the annual constituent, SA. The seasonal cycle in sea level is driven by heating and cooling of the water column, wind, air pressure and river runoff. It varies smoothly along a coast, with typical amplitudes of a few centimeters to a few decimeters (Tsimplis & Woodworth, 1994; Pugh & Woodworth, 2014). NOAA derives SA and SSA from several years of monthly mean sea levels, and a stable estimate may need on the order of ten years (Gill & Schultz, 2001). A short, gappy or datum-shifted record pushes spurious low-frequency energy into it. An inflated SA inflates the predicted extremes, including LAT and HAT, and so the chart datum.

**Threshold.** A TICON reference station is rejected when its SA amplitude is at least 0.5 m and at least five times the median SA of nearby reference stations in the same tidal regime. Nearby means within 25 km. The same regime means similar M2 amplitudes (see Duplicates), which keeps a river-influenced station, with a large real SA on a small tide, from being compared with the open coast. The annual term is read under each provider's name for it: SA, Sa, or Kartverket's SA_KV. The 0.5 m floor, 25 km radius and factor of five are engineering choices of this project.

**Limitations.** The check is silent where no comparable neighbor exists within 25 km, which is true of most isolated gauges. Neighbors are not themselves vetted, and a single neighbor sets the median. Only the annual term is tested; a contaminated semiannual term (SSA) passes. Records from authoritative sources are never tested, though they serve as neighbors.

## Seasonal label

**What it marks.** Water whose yearly swing in level is larger than its daily tide: a Great Lakes gauge, a river reach, a Baltic lagoon. The harmonic predictions are correct, but presenting them as a tide table misleads. A whole day's predicted highs and lows can sit below the annual mean, which produces a negative "high water" above chart datum. The contamination check does not catch this water, because it compares a station only with neighbors in the same tidal regime.

**Rule.** A station is labeled when the peak of its seasonal curve exceeds its principal tide by more than the amplitude tolerance. The seasonal curve is SA·cos(θ − g_SA) + SSA·cos(2θ − g_SSA) over a year, with the phases, since the two terms peak together only at some stations. The principal tide is M2 + S2 + K1 + O1, the tide's height above mean level when spring and tropic tides coincide. Sa and Ssa are mostly meteorological, steric and river-driven rather than astronomical (NOAA CO-OPS, 2000; Tsimplis & Woodworth, 1994). Kartverket's SA_KV has the argument h − p′ rather than h, so its phase is moved by the longitude of perihelion p′, 283.4° in the 2020s (Meeus, 1998), before it is combined with Ssa. The long-period constituents (Mm, Msf, Mf) are left out of both sides. A subordinate station is measured on its reference station's constants, which are the ones it predicts from; its height differences scale the tide and the seasonal terms together, so they do not change which dominates. No published criterion sets this line. A ratio of one is the point at which the label's statement becomes true, and it is this project's definition.

**Effect.** The station is published with the label and a note giving the seasonal peak and the principal tide. The label is set whether or not the station is accepted, since it describes the water rather than the record. It is a yes-or-no label, not a number, so every consumer describes the same water the same way. A consumer that wants a stricter threshold can compute the ratio from the constants it already has.

**Limitations.** The principal tide leaves out the smaller constituents, such as N2 and K2, so it understates the tide's peak where they are large. SA is a climatological average, and any one year's seasonal swing can differ from it.

## Scoring

Every accepted record gets a score from 0 to 100. The score ranks records against each other, most importantly when choosing among duplicates of one gauge. It is a weighted sum of six factors, each between 0 and 1:

| Factor           | Weight | A record scores higher when                                    |
| ---------------- | ------ | -------------------------------------------------------------- |
| Record length    | 20     | it was analyzed over a longer period, up to a full nodal cycle |
| Recency          | 10     | its analysis period ended more recently                        |
| Source           | 20     | it comes from a more trusted agency                            |
| Provider QC flag | 15     | the provider did not flag it for quality problems              |
| Amplitudes       | 20     | its constituent amplitudes are physically plausible            |
| Isolation        | 15     | there is no other record nearby                                |

The weights are an engineering choice of this project.

**Worked example.** NOAA's Everett, Washington, gauge was analyzed over the 1983–2001 National Tidal Datum Epoch. Its record covers a full nodal cycle (1.0), ended 25 years before 2026 (0.75), comes from an authoritative source (1.0), carries no quality flag (1.0), has plausible amplitudes (1.0), and has another record 6 km away (0.12). Its score is 20 + 7.5 + 20 + 15 + 20 + 1.8 = 84.

### Record length

The score is the length of the analyzed record divided by 18.61 years, capped at 1. A record with no stated period scores 0, and so does one whose period is a placeholder (year 0000), since it says nothing about the record. The same holds for recency. A subordinate station takes its reference station's period.

**Why.** The lunar node precesses with a period of 18.61 years and modulates the lunar constituents by up to several tens of percent (Schureman, 1958). Datums averaged over less than a full cycle are biased toward the part of the cycle they sampled, which is why NOAA computes datums over a 19-year National Tidal Datum Epoch, currently 1983–2001 (Gill & Schultz, 2001; NOAA, 2003). Harmonic constants can be estimated from one year of data with nodal corrections (Foreman, 1977; Parker, 2007), but a longer record averages over more weather and resolves more constituents. The IHO asks for harmonic constants from at least one year of observations when computing LAT and HAT (IHO, M-3, Resolution 3/1919), and every accepted record with a stated period meets it. The linear scale is this project's choice.

**Limitations.** The period is the span of the record, not the data actually used, so a 19-year span that is half gaps scores the same as a complete one.

### Recency

The score falls linearly from 1 for a record ending in 2026 to 0 for one ending a century earlier. The reference year is the end of this database's own 19-year datum epoch, 2007–2025 ([docs/datums.md](datums.md)), not the current date, so scores do not drift from year to year.

**Why.** Tidal constants change over decades. Dredging, harbor works, river regulation and sea-level rise alter amplitudes and phases, in some estuaries by tens of percent (Talke & Jay, 2020), and mean sea level rises under a fixed datum. A recent record describes today's water better. The 100-year decay is an engineering choice.

**Limitations.** The same decay applies everywhere, though change is fast in some estuaries and negligible on many open coasts.

### Source

Authoritative agencies score 1. Each agency that supplies data to TICON is ranked, and the score falls with rank:

| Tier | Agencies                                                                                                                      | Score     |
| ---- | ----------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1    | UHSLC fast delivery and research quality, BODC                                                                                | 0.98–0.99 |
| 2    | national services of the US (NOAA, as relayed by TICON), Canada (MEDS), France, Australia, Japan (JMA), Sweden, Norway, Spain | 0.90–0.96 |
| 3    | regional European services, including Germany, the Netherlands, Finland, Denmark and Italy                                    | 0.71–0.80 |
| 4    | US regional networks, including USGS and state agencies                                                                       | 0.53–0.60 |
| 5    | historical and research series, other Japanese agencies, GLOSS                                                                | 0.03–0.14 |
| 6    | sources that GESLA licenses for non-commercial use only (Copernicus Marine, City of Venice, University of Zagreb)             | 0.02      |
| 7    | historical records, mostly of NOAA gauges, contributed by Stefan Talke (`da_sat`)                                             | 0.0       |

An agency not in the ranking scores about 0.5.

**Why.** National hydrographic and oceanographic services generally maintain their datums and apply consistent quality control, so their records are the safer choice when two describe the same water. The ranking is an editorial judgment, not a published standard. Placing the non-commercial sources low steers duplicate selection toward records without license restrictions.

UHSLC's two series rank equally. Its research-quality series has had UHSLC's full quality control and replaces the fast-delivery series as it becomes available, while the fast-delivery series is more recent (UHSLC, n.d.). With source equal, record length and recency decide, which matches GESLA's advice to use the longest and then the most recent record of a gauge (Haigh et al., 2023).

A TICON relay of a NOAA gauge reaches this ranking only when NOAA's record does not supersede it (see [Superseded relay](#superseded-relay)), most often because NOAA publishes no constants for the gauge, as for most Great Lakes gauges. The data are NOAA's, but the analysis is TICON's, so it ranks with the national services.

### Provider quality flag

A record scores 0 when GESLA flagged it for possible datum and quality-control problems, and 1 otherwise. The flag is GESLA's overall record quality, which TICON carries as `record_quality`: a brief, qualitative judgment made by visually inspecting each record (Haigh et al., 2023). This project trusts it rather than re-deriving it. It cannot distinguish a minor problem from a severe one.

### Amplitudes

The score starts at 1 and loses 0.25 for each implausibility, down to 0:

- N2 larger than M2 by more than the amplitude tolerance.
- K2 larger than S2 by more than the amplitude tolerance.
- Q1 larger than O1 by more than the amplitude tolerance.
- No diurnal or semidiurnal signal at all.

**Why.** Each pair is a main constituent and a smaller neighbor in frequency. Their equilibrium ratios are about N2/M2 = 0.19, K2/S2 = 0.27 and Q1/O1 = 0.19 (Cartwright & Tayler, 1971), and the smooth ocean response across a band keeps observed ratios near those values (Munk & Cartwright, 1966). A smaller constituent exceeding its parent points to a poorly resolved analysis; S2 and K2, for example, need 182.6 days of data to separate (Foreman, 1977). A pair is not compared when either value is NOAA's not-determined marker. The form number is not scored: it is below 0.25 for semidiurnal tides, up to 1.5 for mixed mainly semidiurnal, up to 3 for mixed mainly diurnal, and above 3 for diurnal tides (Courtier, 1938; NOAA CO-OPS, 2000), with no upper bound, and NOAA's own Gulf of Mexico stations exceed 25. The 0.25 penalty is an engineering choice. Subordinate stations score 1, since they predict from their reference station. The P1/K1 pair is a rejection check, not a score.

**Limitations.** These checks lower a score but never reject. They catch only the gross case where the smaller constituent exceeds its parent, and near an amphidrome for one species a pair at noise level can trip them without the analysis being wrong.

### Isolation

The score is the distance to the nearest other gauge, divided by 50 km and capped at 1. A gauge with no other gauge nearby adds more to the map than one in a dense cluster. Only records that pass every rejection check count as neighbors, and a record of the same TICON gauge (see [Same identifier](#same-identifier)) is not another gauge. The 50 km scale is an engineering choice.

**Limitations.** Two agencies' records of one gauge under different identifiers still count as neighbors, so both score near 0 here. Isolation describes the map, not the record, so it can still decide between duplicates whose other factors tie.

## Duplicates

Only records that pass every rejection check are compared. Two kinds of evidence identify a duplicate: a shared station identifier in TICON, and agreement in position and tide.

### Same identifier

TICON names each record by place, the supplying agency's station code, and country. When two TICON records share the place, the code (ignoring a letter that marks a record segment, as in 217 and 217a) and the country, they are the same gauge: a fast-delivery and a research-quality series, consecutive segments of one record, or one gauge relayed by two agencies. All such records are merged into one, however far apart their positions are, because older sources round positions to 0.1° and different providers survey different points. This rule is this project's own; TICON does not define a gauge identifier.

**Limitations.** Merging at any distance trusts the identifier over the coordinates, and the two can disagree a lot. The three Port Stanley (Falkland Islands) records from UHSLC share an identifier, but the 1964–1974 segment is placed at 52.70° S and the other two at 51.75° S, about 105 km apart. One record is kept and the others are discarded without checking which position is right or whether the old segment was at a different site. A gauge moved and kept its code is treated as one gauge. Records of one gauge whose place names differ are not matched here and fall to the position rule.

An accepted segment without its own UHSLC metadata follows a superseded sibling to the gauge’s operator, regardless of its distance from the operator or disagreement in M2. The quality result retains the disagreement as an issue. A segment with its own UHSLC metadata keeps its own declaration. Conflicting operator targets stop evaluation. This applies to every TICON gauge group with a superseded sibling, including LINZ and Kartverket matches, not just JMA.

### Position and tide

Records from all sources are compared in pairs. Whether two count as one gauge depends on how far apart they are and what kind of station each is:

| Pair                          | Within 50 m                         | 50–100 m                                                                       | 100–500 m                | Beyond 500 m |
| ----------------------------- | ----------------------------------- | ------------------------------------------------------------------------------ | ------------------------ | ------------ |
| Two reference stations        | Same gauge                          | Same gauge if M2 amplitudes are similar, or if the better one has subordinates | Same gauge if M2 similar | Different    |
| A reference and a subordinate | Same gauge                          | Same gauge                                                                     | Different                | Different    |
| Two subordinate stations      | Same gauge if they predict the same | Same gauge if they predict the same                                            | Different                | Different    |

Two subordinates predict the same when they use the same reference station and their height differences agree within 0.1 (as a ratio, or 0.1 m for fixed differences) and their time differences within 10 minutes.

**Why.** Records within 50 m are almost certainly the same gauge, or gauges too close for their tides to differ in a way that matters. Between 50 and 500 m, gauges can sit on opposite sides of a breakwater, at a harbor mouth and inside it, or at the two ends of a short channel, and their tides can differ. M2 dominates nearly every tide, so similar M2 amplitudes are a direct test that two reference stations describe the same tidal regime. Similar means within 10% of each other, or within the amplitude tolerance where M2 is too small for a ratio to mean anything. Two M2 amplitudes that are both within the tolerance of zero carry no evidence either way, so they are not similar. A reference station that has subordinates may absorb a neighbor within 100 m even when the M2 test fails, since very small M2 amplitudes make the ratio noisy. Subordinates have no constants to compare, so they get the tighter 100 m limit, and two subordinates must also predict the same tide. Many subordinates share coarse or placeholder positions: Suwarrow Island is recorded at the exact position of Hao Island, but Suwarrow's time difference is +64 minutes and Hao's is −315. All of these distances and tolerances are engineering choices of this project.

The distance between two records is the shortest between any of the positions recorded for their gauges, since the records of one TICON gauge can place it kilometers apart. When only another record's position brings two reference stations together, their M2 must also agree (see [Disagreeing duplicates](#disagreeing-duplicates)): UNAM's historical La Paz record sits at the position of UNAM's current gauge, 11.7 km from UHSLC's, and the current gauge, which runs 29 minutes from UHSLC's 1964–1983 analysis, is not absorbed into it.

**Limitations.**

- A reference and a subordinate within 100 m are merged without comparing their tides, though the subordinate's predictions, made from a different reference plus time and height differences, can differ from the nearby reference station's.
- Two reference stations within 50 m are merged whatever their M2 amplitudes.
- The M2 test compares amplitude, not phase, so two gauges with the same M2 amplitude an hour apart in timing pass as one.
- Records whose recorded positions are all more than 500 m apart are never merged by this rule, so a relay with poor coordinates stays separate unless it shares an identifier. Through a TICON gauge's other positions, a record can merge with one several kilometers from its own position: the Salina Cruz record from UNAM's historical series merges with NOAA's Salina Cruz, 17.6 km from its own coordinates.

### Disagreeing duplicates

Two merged reference stations can still disagree. When their M2 constants differ, as a vector, by more than 15% of the larger amplitude and by more than the amplitude tolerance, both records name the other in `issues` and give the difference as time. The 15% is the 95th percentile of the difference between NOAA's own M2 and TICON's reanalysis of the same gauge across 447 NOAA gauges, so a larger difference is more than one gauge analyzed twice shows. It is this project's definition, derived from those pairs.

The pair stays merged. Where the difference is the same time offset in M2, S2, K1 and O1, one record's clock is off, and publishing both would show a wrong answer beside the right one. The City of Venice record runs 46 minutes from ISPRA's and Copernicus's, which agree with each other. The Harris County Flood Control District records (`hct`) run 23 to 71 minutes behind every NOAA and USGS gauge near them, where USGS and California's records run within a minute; the [clock error](#clock-error) check rejects them. The flag does not say which record is wrong; that takes a third, independent record. Nor is an even lag proof of a clock error: a gauge moved behind a breakwater lags too. At Settlement Point, Grand Bahama, UHSLC moved its gauge in 2002 from NOAA's open-coast site into the Bootle Bay basin 2.6 km away, and its record runs about 90 minutes behind NOAA's. There the semidiurnal amplitudes are 17% lower and M4 six times larger, which a basin does and a clock cannot, so both records are right for their own water and both are published. A clock error shifts every constituent by the same minutes and leaves amplitudes and M4 alone, as at Harris County's Houston Ship Channel gauge, 0.4 km from NOAA's Lynchburg Landing.

**Limitations.** A real difference across a short distance is flagged the same way: on the Loxahatchee River, two docks 356 m apart differ by about 22 minutes, and the record not kept is lost. The record kept is still the better-ranked one, and score rewards record length, so a long analysis that ended decades ago can win over a short recent one that disagrees with it.

### Choosing the record to keep

Records are ranked by these rules, in order:

1. A record from an authoritative source beats a relay. NOAA's subordinate stations outside the United States and its territories are the exception. NOAA does not operate those gauges; it predicts them from legacy foreign tide tables as time and height differences on a US reference station, often more than 1,000 km away. Manzanillo, Mexico, is predicted from San Diego, 1,986 km away, and runs about 110 minutes from the 19-year UHSLC analysis of the gauge itself. The waters each source speaks for are listed as `jurisdiction` in its `metadata.yaml`.
2. A reference station beats a subordinate, since its constants were analyzed at the gauge.
3. A reference station that has accepted subordinate stations beats one that has none, so the subordinates keep the reference they predict from.
4. The higher score wins.
5. At an equal score, any other record beats a CMEMS record. CMEMS relays European agencies' gauges, and GESLA redistributes its data for non-commercial use only, so between otherwise equal records the other one publishes. A CMEMS record that scores higher, because its record is longer or carries no quality-control flag, still wins: Arklow's 19-year CMEMS record beats a 13-month Marine Institute one.
6. The record with the more precise position wins, as a surveyed fix is more likely than a rounded one to locate the gauge.
7. Otherwise, the record with the lower id wins.

Duplicates are resolved best record first. The best remaining record absorbs every record that duplicates it, and a record that has lost absorbs nothing, so the outcome does not depend on the order in which records are loaded. Each duplicate's `redundant` names the record published for its gauge. The order of these rules is an engineering choice of this project.

## Implementation

The evaluation is [packages/stations/evaluate-quality.ts](../packages/stations/evaluate-quality.ts). Its thresholds and helper functions are in [packages/stations/filtering.ts](../packages/stations/filtering.ts), the nodal-cycle length (`NODAL_CYCLE_DAYS` = 6798.383 days) and datum epoch (`DATUM_EPOCH`, 2007-01-01 to 2026-01-01) are in [packages/datums/datum.ts](../packages/datums/datum.ts), and each source's `authoritative` flag is in `sources/<name>/metadata.yaml`, read by [packages/stations/sources.ts](../packages/stations/sources.ts).

`npm run stations` runs the evaluation and writes each result into the station file that lists the record, under `computed.sources.<id>.quality` (see [stations/README.md](../stations/README.md)). A record whose `accepted` is false is still published at its route and in the database, with its evaluation, but a route lists accepted records first and the database's `stations` export leaves rejected ones out. `npm run report:merges -w packages/stations` reads `redundant` to propose folding duplicate stations together; a link on proximity alone waits for review. To print a summary without writing anything:

```shell
npm run report:quality -w packages/stations
```

### Stored result

| Field               | Meaning                                                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `accepted`          | Whether the record is published.                                                                                                               |
| `reason`            | `coordinates`, `timing`, `datum`, `range`, `superseded`, `constituents`, `seasonal`, or `duplicate`. Absent when accepted.                     |
| `redundant`         | For a duplicate, or a relay superseded by its operator's record, the id of the record published for its gauge.                                 |
| `seasonal_dominant` | `true` for the seasonal label.                                                                                                                 |
| `score`             | The composite score. 0 for a record rejected by a check; a duplicate keeps the score it was compared on.                                       |
| `factors`           | `epoch`, `recency`, `source`, `quality`, `amplitude`, `coverage`, each 0 to 1, rounded to three decimals.                                      |
| `issues`            | Every failed check's message, datum warnings, the seasonal-label note, amplitude findings, and M2 disagreements with a merged record, as text. |

### Order of operations

1. `loadAllStations` reads every JSON file under `data/`, sorting directories and file names, so records are processed in record-id order.
2. `checkGates` runs `checkCoordinates`, `checkTiming`, `checkDatumOrdering`, `checkTidalRange`, `checkConstituents` and `checkSeasonalContamination` on every record. `checkSuperseded` then runs on each relay, using those results for the operator's record, and takes its place after the range check. The first failure sets `reason`, and every failure's message goes into `issues`. Then `checkSeasonalDominance` and five factors are computed.
3. `scoreCoverage` runs once every record has been checked, against the records that passed.
4. `computeCompositeScore` sets the score of each record that passed the checks.
5. `countSubordinates` counts each reference's accepted subordinates. The count is not updated as duplicates are rejected.
6. `deduplicateByGauge` merges TICON records by `gaugeKey`, keeping the first record of each group in `precedence` order. The key strips the provider suffix and segment letter, and corrects Roseau's mislabeled country code.
7. `deduplicate` ranks the survivors by `precedence`, and each record still accepted absorbs the later records that `areDuplicates` matches to it.
8. `resolveRedundant` points each duplicate at the record published for its gauge.

### Constants

| Constant                              | Value                                                              | Used by                                             |
| ------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------- |
| `NULL_ISLAND_RADIUS`                  | 0.05°                                                              | Position                                            |
| `EPSILON` (in `checkDatumOrdering`)   | 0.5 m                                                              | Low chart datums below LAT                          |
| `MIN_TIDAL_RANGE`                     | 0.02 m                                                             | Tidal range                                         |
| `SUPERSEDED_SOURCES`                  | `rws_hist`                                                         | Superseded relay                                    |
| `ESSENTIAL_CONSTITUENTS`              | M2, S2, K1, O1                                                     | Essential constituents                              |
| `SEASONAL_OUTLIER_MIN_SA`             | 0.5 m                                                              | Seasonal contamination                              |
| `SEASONAL_OUTLIER_RADIUS`             | 25 km                                                              | Seasonal contamination                              |
| `SEASONAL_OUTLIER_RATIO`              | 5                                                                  | Seasonal contamination                              |
| `OBSERVED_BOUND_ALLOWANCE`            | 0.05 m                                                             | Cross-period observed means against harmonic bounds |
| `AMPLITUDE_TOLERANCE`                 | 0.003 m                                                            | Every amplitude comparison; the lake re-fit gate    |
| `RESOLVED_P1`                         | 0.01 m                                                             | Essential constituents                              |
| `MIN_AMPLITUDE_RATIO`                 | 0.9                                                                | Seasonal contamination, duplicates                  |
| `PRINCIPAL_TIDAL_CONSTITUENTS`        | M2, S2, K1, O1                                                     | Seasonal label, amplitudes                          |
| `SEASONAL_DOMINANCE_RATIO`            | 1                                                                  | Seasonal label                                      |
| `WEIGHTS`                             | 20, 10, 20, 15, 20, 15                                             | Score                                               |
| `SOURCE_PRIORITY`, `DEFAULT_PRIORITY` | 0–99 per TICON source suffix; DMI fits and unlisted sources use 50 | Source factor, as 1 − priority/99                   |
| `MIN_DEDUP_DISTANCE`                  | 50 m                                                               | Duplicates                                          |
| `FALLBACK_DEDUP_DISTANCE`             | 100 m                                                              | Duplicates                                          |
| `MAX_DEDUP_DISTANCE`                  | 500 m                                                              | Duplicates                                          |
| `MAX_OFFSET_HEIGHT_DELTA`             | 0.1                                                                | Duplicate subordinates                              |
| `MAX_OFFSET_TIME_DELTA`               | 10 min                                                             | Duplicate subordinates                              |
| `MAX_PROVENANCE_KM`                   | 10 km                                                              | Superseded relay, merge report                      |
| `CLOCK_ERROR_SOURCES`                 | `hct`                                                              | Clock error                                         |
| `jurisdiction` (in `metadata.yaml`)   | NOAA: US and its territories                                       | Choosing the record to keep                         |
| `SAME_GAUGE_M2_DIFFERENCE`            | 0.15                                                               | Disagreeing duplicates                              |

The recency reference year, `RECENCY_YEAR`, is the UTC year of `DATUM_EPOCH.end`, 2026. Distances use the haversine formula on a sphere of radius 6371 km (Sinnott, 1984). Position precision is the smaller of the decimal-place counts of latitude and longitude. The quality factor matches the text "quality control issues" in a record's `disclaimers`, which the TICON import fills from TICON's `record_quality` field.

## References

- Cartwright, D. E., & Tayler, R. J. (1971). New computations of the tide-generating potential. _Geophysical Journal of the Royal Astronomical Society_, 23(1), 45–73. https://doi.org/10.1111/j.1365-246X.1971.tb01803.x
- Codiga, D. L. (2011). _Unified Tidal Analysis and Prediction Using the UTide Matlab Functions_. Technical Report 2011-01. Graduate School of Oceanography, University of Rhode Island. https://www.po.gso.uri.edu/codiga/utide/2011Codiga-UTide-Report.pdf
- Courtier, A. (1938). _Marées_. Service Hydrographique de la Marine, Paris.
- Defant, A. (1961). _Physical Oceanography_, Volume 2. Pergamon Press.
- Foreman, M. G. G. (1977, revised 2004). _Manual for Tidal Heights Analysis and Prediction_. Pacific Marine Science Report 77-10. Institute of Ocean Sciences, Sidney, B.C.
- Gill, S. K., & Schultz, J. R. (Eds.) (2001). _Tidal Datums and Their Applications_. NOAA Special Publication NOS CO-OPS 1. https://tidesandcurrents.noaa.gov/publications/tidal_datums_and_their_applications.pdf
- Haigh, I. D., Marcos, M., Talke, S. A., Woodworth, P. L., Hunter, J. R., Hague, B. S., Arns, A., Bradshaw, E., & Thompson, P. (2023). GESLA Version 3: A major update to the global higher-frequency sea-level dataset. _Geoscience Data Journal_, 10(3), 293–314. https://doi.org/10.1002/gdj3.174
- Hart-Davis, M. G., Sulzbach, R., Talke, S. A., Haigh, I. D., Marcos, M., Woodworth, P., Ray, R., Andersen, O. B., Lyard, F., Fouchet, E., Dettmering, D., Thomas, M., & Seitz, F. (2026). Tide of the time: Global tidal characteristics observed from in-situ measurements. _Ocean Science_, 22(3), 1681–1709. https://doi.org/10.5194/os-22-1681-2026
- Hart-Davis, M., Dettmering, D., & Seitz, F. (2025). _TICON-4: TIdal CONstants based on GESLA-4 sea-level records_. SEANOE. https://doi.org/10.17882/109129
- Intergovernmental Oceanographic Commission (2002). _Manual on Sea Level Measurement and Interpretation, Volume III: Reappraisals and Recommendations as of the Year 2000_. IOC Manuals and Guides No. 14. UNESCO.
- International Hydrographic Organization. _Hydrographic Dictionary_, Publication S-32: entries for Chart Datum, Lowest Astronomical Tide and Highest Astronomical Tide. https://iho.int
- International Hydrographic Organization. _Resolutions of the International Hydrographic Organization_, Publication M-3, Resolution 3/1919, "Datums and Benchmarks". https://iho.int
- Medvedev, I. P., Rabinovich, A. B., & Kulikov, E. A. (2016). Tides in three enclosed basins: the Baltic, Black, and Caspian Seas. _Frontiers in Marine Science_, 3, 46. https://doi.org/10.3389/fmars.2016.00046
- Meeus, J. (1998). _Astronomical Algorithms_ (2nd ed.). Willmann-Bell.
- Munk, W. H., & Cartwright, D. E. (1966). Tidal spectroscopy and prediction. _Philosophical Transactions of the Royal Society of London, Series A_, 259(1105), 533–581. https://doi.org/10.1098/rsta.1966.0024
- NOAA CO-OPS (2000). _Tide and Current Glossary_. https://tidesandcurrents.noaa.gov/publications/glossary2.pdf
- NOAA (2003). _Computational Techniques for Tidal Datums Handbook_. NOAA Special Publication NOS CO-OPS 2. https://tidesandcurrents.noaa.gov/publications/Computational_Techniques_for_Tidal_Datums_handbook.pdf
- Parker, B. B. (2007). _Tidal Analysis and Prediction_. NOAA Special Publication NOS CO-OPS 3. https://tidesandcurrents.noaa.gov/publications/Tidal_Analysis_and_Predictions.pdf
- Pawlowicz, R., Beardsley, B., & Lentz, S. (2002). Classical tidal harmonic analysis including error estimates in MATLAB using T_TIDE. _Computers & Geosciences_, 28(8), 929–937. https://doi.org/10.1016/S0098-3004(02)00013-4
- Pugh, D., & Woodworth, P. (2014). _Sea-Level Science: Understanding Tides, Surges, Tsunamis and Mean Sea-Level Changes_. Cambridge University Press. https://doi.org/10.1017/CBO9781139235778
- Schureman, P. (1958). _Manual of Harmonic Analysis and Prediction of Tides_. Special Publication No. 98 (revised 1940 edition, reprinted with corrections 1958). U.S. Coast and Geodetic Survey.
- Sinnott, R. W. (1984). Virtues of the haversine. _Sky and Telescope_, 68(2), 159.
- Talke, S. A., & Jay, D. A. (2020). Changing tides: The role of natural and anthropogenic factors. _Annual Review of Marine Science_, 12, 121–151. https://doi.org/10.1146/annurev-marine-010419-010727
- Tsimplis, M. N., & Woodworth, P. L. (1994). The global distribution of the seasonal sea level cycle calculated from coastal tide gauge data. _Journal of Geophysical Research: Oceans_, 99(C8), 16031–16039. https://doi.org/10.1029/94JC01115
- University of Hawaii Sea Level Center (n.d.). _Data information_. https://uhslc.soest.hawaii.edu/datainfo/
