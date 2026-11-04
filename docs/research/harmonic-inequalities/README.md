# Harmonic representation of inequalities

The harmonic representation of inequalities (HRoI, German _Harmonische Darstellung der Ungleichheiten_, HDdU) is the method the German Federal Maritime and Hydrographic Agency (BSH) uses for every official German North Sea tide prediction. This note collects the primary sources, describes the method precisely enough to implement, records what BSH publishes and under which terms, and evaluates where the method and BSH's data can serve this project, including the Rijkswaterstaat (RWS) work in [sources/rws](../../../sources/rws/README.md).

Measurements here were taken on 2026-11-03 against the database built from commit 3f4af9725.

## Sources

The repository keeps only the CC BY paper and the BSH data samples. The other documents remain under their publishers' copyright, so each citation links to where to get it.

| File                                                                                           | Citation                                                                                                                                                                                                                                                                                                                                                            | What it gives us                                                                                                                                                                                  | Terms                                                                                                        |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Not committed                                                                                  | Müller-Navarra, S. H. (2013). _Gezeitenvorausberechnungen mit der Harmonischen Darstellung der Ungleichheiten / On tidal predictions by means of harmonic representation of inequalities._ Berichte des BSH 50. ISSN 0946-6010. [Landing page](https://www.bsh.de/DE/PUBLIKATIONEN/_Anlagen/Downloads/Meer_und_Umwelt/Berichte-des-BSH/Berichte-des-BSH_50_en.html) | The full computation, steps a–g, with the Cuxhaven 1991–2009 worked example. German text followed by the English translation in one PDF.                                                          | © BSH, all rights reserved                                                                                   |
| [boesch-mueller-navarra-2019-ocean-science.pdf](boesch-mueller-navarra-2019-ocean-science.pdf) | Boesch, A. and Müller-Navarra, S. (2019). Reassessment of long-period constituents for tidal predictions along the German North Sea coast and its tidally influenced rivers. _Ocean Sci._ 15, 1363–1379. [doi:10.5194/os-15-1363-2019](https://doi.org/10.5194/os-15-1363-2019)                                                                                     | The 39-constituent list BSH has used since the 2020 tide tables, the 137-gauge table with BSH gauge numbers and data periods, residuals against observations, and an HRoI vs harmonic comparison. | CC BY 4.0                                                                                                    |
| Not committed                                                                                  | Horn, W. (1960). Some recent approaches to tidal problems. _Int. Hydrogr. Rev._ 37(2), 65–84. [UNB archive](https://journals.lib.unb.ca/index.php/ihr/article/download/26543/1882519303/1882519538)                                                                                                                                                                 | The method's original publication in English and why BSH abandoned harmonic prediction for the German Bight.                                                                                      | IHR open archive                                                                                             |
| Not committed                                                                                  | Goffinet, P. (2018). Neue Bewertung der harmonischen Analyse im Vergleich zur Darstellung der Ungleichheiten am Beispiel der Deutschen Bucht. _Hydrographische Nachrichten_ 110. [doi:10.23784/HN110-05](https://www.dhyg.de/images/fachbeitraege/DOI_10.23784_HN110_05.pdf)                                                                                        | A 685-constituent harmonic analysis per tidal species matching HRoI to within a minute and a few centimetres at Cuxhaven, Borkum, Helgoland and St. Pauli.                                        | © DHyG                                                                                                       |
| Not committed                                                                                  | Pansch, E. (1988). _Harmonische Analyse von Gezeiten- und Gezeitenstrombeobachtungen im Deutschen Hydrographischen Institut._ DHI Wiss.-Techn. Berichte 1988-1. [BSH library record 178014](https://digitale-bibliothek.bsh.bund.de/viewer/metadata/178014/1/)                                                                                                      | The DHI harmonic method HRoI is compared against (scanned, 33 pages, 27 MB).                                                                                                                      | © BSH                                                                                                        |
| Not committed                                                                                  | BSH (2026). _Entgeltverzeichnis für digitale Daten_, Stand 01/26. [Landing page](https://www.bsh.de/DE/Das_BSH/Gebuehren_Preise/Gebuehren_und_Preise/_Anlagen/Downloads/Entgeltverzeichnis-digitale-Daten.html)                                                                                                                                                     | The terms that govern BSH's digital tide data, Anlage 2 and Anlage 4.                                                                                                                             | public                                                                                                       |
| [bsh-data-samples/](bsh-data-samples/)                                                         | BSH tide predictions for Cuxhaven, Steubenhöft (506P), 2026, from [gezeiten.bsh.de](https://gezeiten.bsh.de)                                                                                                                                                                                                                                                        | The full HW/LW file and the header and first rows of the 10-minute curve file, converted from Latin-1 to UTF-8.                                                                                   | Datenquelle: Gezeitenvorausberechnungen 2026 ©, Bundesamt für Seeschifffahrt und Hydrographie, Hamburg, 2026 |

Cited but not saved:

- Müller-Navarra, S. H. (2009). Zur automatischen Scheitelpunktbestimmung gemessener Tidekurven in der Deutschen Bucht. _Hydrologie und Wasserbewirtschaftung_ 53(6), 380–388. The BSH library lists it ([record 171652](https://digitale-bibliothek.bsh.bund.de/viewer/metadata/171652/1/)) but refuses the PDF with "Serving this content is restricted due to access conditions". It defines the lunar transit numbering and BSH's rule for picking the time of a high or low water from an observed curve, which matters for the event comparisons below.
- Horn, W. (1948). Über die Darstellung der Gezeiten als Funktion der Zeit. _Dt. Hydrogr. Z._ 1, 124–140. [doi:10.1007/BF02226142](https://doi.org/10.1007/BF02226142), paywalled.
- Pansch, E. (1989). New harmonic tidal constants for some German North Sea stations. _Dt. Hydrogr. Z._ 42, 27–39, paywalled.
- Goffinet, P. (2000), appendix E, which lists the 43-constituent set BSH used from 1970 to 2019 (cited by Boesch and Müller-Navarra, table 2).
- [hatyan](https://pypi.org/project/hatyan/), the Deltares/RWS harmonic analysis package, version 2.14.0, GPL-3.0. Its extreme detection is summarized under [Rijkswaterstaat](#rijkswaterstaat).

## The method

HRoI is the non-harmonic method of Lubbock (1831) put into analytic form. It does not model the water level. It models how far each high and low water departs from its mean time and mean height, and it writes those departures as sums of long-period harmonics.

Each high and low water is tied to a lunar transit at Greenwich. Transit number `nt = 0` is the upper transit on 1949-12-31 at 21:08 UTC; a lower transit carries the number of the upper transit before it. Each event also gets an index `k`:

| k   | event                              |
| --- | ---------------------------------- |
| 1   | high water after the upper transit |
| 2   | low water after the upper transit  |
| 3   | high water after the lower transit |
| 4   | low water after the lower transit  |

That gives eight series per gauge: the lunitidal interval (event time minus mean transit time) and the height, for each `k`. Each series is fitted by least squares as

```
y(nt) = a0 + Σ_l [ a_l cos(ω_l nt) + a_{l+L} sin(ω_l nt) ]
```

where `ω_l` are long-period angular speeds in degrees per transit number. `a0` is the mean interval (MHWI, MLWI) or mean height (MHW, MLW); the rest are the inequalities. Prediction evaluates the same sum for future transit numbers and adds the interval to the mean transit time.

The steps in Bericht 50:

1. Compute true lunar transit times at Greenwich, upper and lower. BSH uses Meeus (1998) with Chapront-Touzé and Chapront (1991) lunar terms; minute accuracy is enough.
2. Build the mean-moon grid. The mean lunar day is 24.8412031 h (half day 12.4206012 h, "lunar hour" 1.0350501 h). Anchor it to transit 0, then shift it by the mean of true minus mean transit times over 1801–2049, about +24.23 min, so `a0` reads directly as MHWI.
3. Assign 19 years of observed high and low waters to `(nt, k)`. This is unambiguous in calm weather; storms shifting events by hours need correction.
4. Clip each of the eight series at 3σ. At Cuxhaven this removes 0.1 % of times and 1.5 % of heights.
5. Choose the angular speeds. Every one is an integer combination of the rates of `s`, `h`, `p` and `N'`; table 2 of the 2019 paper lists the 39 in use since 2020, from the nodal 0.0548° tn⁻¹ through MSf at 25.236° tn⁻¹ (rank 1), Mf (rank 2), Mm (rank 3) up to the eighth synodic month at 100.944° tn⁻¹.
6. Solve the eight least-squares problems, by SVD.
7. Synthesize. BSH recommends refitting each year on the 19 years just past, because rivers change; after channel deepening it may take the constant terms from recent years and drop the slowest terms.

Full curves use the same idea on a fixed grid: 96 fits, one per quarter lunar hour (15.5258 min) after each upper transit, starting 1/8 lunar hour after MHWI. BSH's published 10-minute curves are labelled "HDdU (HW/NW) mit mittlerer beob. Tidenkurve", meaning HRoI vertices with a mean observed tide curve fitted between them.

Why BSH uses it. In the German Bight and its rivers the tide is strongly non-sinusoidal. Horn (1960) argued the shallow-water constituents needed would make the harmonic method impractical there; BSH stopped publishing harmonic constants for German gauges in 1966, saying the tidal conditions on the German flat coasts are "by no means constant" (Bericht 50, p. 8). In the 2019 comparison over 2016, HRoI timing residuals were σ = 9.0 min at Cuxhaven and 10.3 min at Hamburg St. Pauli; a 69-constituent harmonic fit gave 12.9 and 15.1 min. Heights were within a few centimetres of each other. Goffinet (2018) showed a 685-constituent harmonic analysis closes that gap.

Limits. HRoI predicts events, not a continuous curve, unless the 96-fit variant or a fitted mean curve is used. It needs semi-diurnal tides with one high and one low water per half lunar day; it has no notion of a double low water. It needs about 19 years of event observations; shorter records must drop constituents (2019 paper, fig. 6) or borrow from a similar gauge. Its coefficients are per gauge and are not published.

## What BSH publishes

[gezeiten.bsh.de](https://gezeiten.bsh.de) serves, without authentication:

- `https://gezeiten.bsh.de/data/tides_overview.json`, a list of 172 places with BSH number, name, position and group: 142 gauges, 26 interpolated places, 4 Baltic gauges.
- `https://gezeiten.bsh.de/data/DE_<bshnr padded to 5 with _>_tides.json`, per place: tidal base values (MHW, MLW, MHWI, MLWI, spring and neap values, PNP and chart datum relative to NHN), and every predicted HW and LW for the current and next year with time, height in cm, spring/neap phase.
- Text files from `https://filebox.bsh.de/index.php/s/SbJ3z5NBkpOZloY/download?path=/vb_hwnw/deu<year>&files=DE__<bshnr><year>.txt` (HW/LW, with transit number and `k` per event) and `path=/vb_kurv/...` (10-minute curve). Headers name the method, the 19-year analysis window (Cuxhaven 2026: analysis year 2023, 19 years, 39 constituents), the height reference and the timezone. Times are in MEZ (UTC+1) all year.

Only the current and next year are online; 2020–2025 return 404. Of the 98 places checked, 79 have a curve and heights, 17 have heights but no curve, and 2 have times only. Interpolated places have no curve.

Terms. Anlage 4 of the Entgeltverzeichnis: use of BSH's digital tide data is free of charge, "Dies schließt die kommerzielle Nutzung und Veröffentlichung mit ein", and needs no written consent. A calendar year's data may be published on the internet only from 1 August of the year before. Whoever edits the data for publication is responsible for its correctness. Where Anlage 4 is silent, the AGB in Anlage 2 apply; those require the credit "Datenquelle: Datensatzbezeichnung ©, Bundesamt für Seeschifffahrt und Hydrographie, Ort, Jahr" and say the data "dürfen in keinem Fall für Navigationszwecke verwendet werden". BSH's tidal information service (Andreas Boesch) answered our questions by email on 2026-11-02 and 2026-11-03:

- Constants we derive from BSH data, and predictions made from them, are our product, published at our risk, and must not name BSH as the source of the predictions.
- BSH recommends training our own analysis on WSV water level observations rather than on its predictions. If we train on its predictions anyway, we must not acknowledge the underlying BSH data at all.
- BSH does not release its HRoI constants or other raw results of its tidal analysis; it publishes only final predictions.
- Harmonic analysis does poorly at many German North Sea gauges, because the Wadden Sea, shallow water and long tidal rivers make the tide curve far from sinusoidal.

The validator below uses BSH's tables only to measure our predictions; nothing BSH publishes ships in the database.

## How our German stations compare with BSH

Every German tide station we ship comes from TICON, fitted from WSV, CMEMS or UHSLC gauge records. The [`sources/bsh`](../../../sources/bsh/README.md) validator takes each BSH place, finds our nearest accepted reference station within 2 km, predicts 2026 extremes with `@slackwater/engine`, and matches each BSH event to our nearest same-type extreme within 3 h. Only the scatter of the height differences is compared, because BSH reports heights on PNP and our stations use their own datum. Results for all 96 matched places are in its [validation.json](../../../sources/bsh/validation.json).

Event counts agree at 93 of the 96 places (1410 or 1411 per year). We predict 14 extra events at Elmshorn on the Krückau and 6 at Herbrum, at the tidal limits, and 18 fewer at Kiel-Holtenau in the Baltic, where the tide is too small for its turning points to mean much. Times differ everywhere:

| Region                 | Examples (ours − BSH, mean ± σ, min)                                                          |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| Open coast and islands | Helgoland −4.5 ± 8.7, List −4.6 ± 8.5, Wilhelmshaven −3.6 ± 9.1, Cuxhaven −5.8 ± 11.8         |
| Lower rivers           | Brunsbüttel −12.4 ± 17.0, Emden −10.6 ± 14.8, Bremerhaven −2.5 ± 11.0                         |
| Upper rivers           | St. Pauli −22.1 ± 20.2, Geesthacht −34.2 ± 33.5, Papenburg −23.6 ± 38.7, Herbrum −37.2 ± 49.2 |

Across all 96 the median σ is 15.8 min, the median bias −12.4 min, and the median height σ 0.14 m. Our predictions run early at all 96 places, and most of it is at low water (the per-type scatter here is from a one-off run): Helgoland HW +0.3 ± 6.5 vs LW −9.3 ± 8.0 min; St. Pauli HW −8.4 ± 14.8 vs LW −35.7 ± 15.0 min.

Two one-off measurements, with no script committed, rule out one explanation. This is not a difference in how an event time is read off a flat extreme. BSH's own event times sit at the middle of the ±1 cm plateau of its own curve (−0.5 min on average at Cuxhaven), and taking the plateau midpoint of our curve instead of its exact extreme moves our bias by under a minute at all four gauges tested.

Against observations. [obs.mjs](measurements/obs.mjs) compares both predictions with 31 days of 1-minute Pegelonline levels (2026-10-03 to 2026-11-03, fetched on 2026-11-03), taking the observed event time as the midpoint of the ±2 cm plateau of a 15-minute running mean:

| Gauge             | HW BSH − obs | HW ours − obs | LW BSH − obs | LW ours − obs |
| ----------------- | ------------ | ------------- | ------------ | ------------- |
| Helgoland         | +1.3 ± 11.1  | +0.2 ± 13.1   | +4.1 ± 11.1  | −3.0 ± 12.7   |
| Cuxhaven          | +2.4 ± 16.2  | −3.0 ± 20.3   | +6.2 ± 14.5  | −0.4 ± 17.7   |
| Hamburg St. Pauli | +9.9 ± 14.7  | +2.5 ± 22.8   | +18.4 ± 14.9 | −11.8 ± 21.6  |
| Emden             | +9.8 ± 22.0  | +4.6 ± 29.7   | +14.8 ± 17.3 | +3.9 ± 24.0   |

About 59 events per cell. BSH has the smaller scatter in every cell, by 1.6–8.1 minutes. The mean offsets depend on how the observed event time is defined, and BSH's rule for that (Müller-Navarra 2009) is not available to us, so this month does not show which side is better centred. One autumn month with storms is also a small sample; the scatter result is the robust one, the biases are not.

## Where we can use this

### BSH as the publisher reference for German stations

Done: [`sources/bsh`](../../../sources/bsh/README.md) compares our German stations with BSH's current-year high and low waters per gauge, against a committed baseline that fails when a gauge gets worse. It needs the network, so CI does not run it. BSH's responses stay in an uncommitted cache.

### WSV observations as a station source

Recommended, and what BSH advises. Each gauge's Pegelonline station page ("Stammdaten", for example [Helgoland](https://pegelonline.wsv.de/gast/stammdaten?pegelnr=9510070)) offers a download of raw water levels from 1 January 2000, under DL-DE→Zero-2.0 and Pegelonline's terms of use. That is long enough for a 19-year analysis and far more recent than many TICON epochs. The REST API, by contrast, keeps only about 30 days. The data are unvalidated ("Rohdaten"), so a fit has to remove spikes and gaps first. Fits should use a long shallow-water constituent list, given BSH's warning and Goffinet's result, and be scored with the BSH validator before they replace any TICON station.

Fitting to BSH's 10-minute curves instead, as `sources/rws` fits RWS's astronomical series, is possible but not advised. BSH asks that such constants not acknowledge BSH, only two years are online at a time, and the curve is not a harmonic signal.

26 interpolated BSH places and several gauges have no station of ours within 2 km. Interpolated places have no curve, so they could only become subordinate stations with offsets, and BSH's own offsets ("Gezeitenunterschiede") for about 700 places are only in the printed tables.

### HRoI inside our own pipeline

Not recommended. The database and the Swift and JS engines carry harmonic constituents, and HRoI coefficients are a different model: eight series of long-period terms per gauge, tied to computed lunar transits. Shipping it would mean a new station type in the format and a new predictor in both engines. BSH does not release its coefficients, so we would have to fit them ourselves from 19 years of high and low waters extracted from Pegelonline's raw downloads, for federal gauges only; the 2019 paper also credits HPA, LKN-SH and NLWKN for their records. Goffinet (2018) shows the harmonic method reaches the same accuracy with enough constituents, so the better route for German rivers is a longer constituent list and more recent data in our harmonic fits, checked against the BSH validator above.

Two ideas are worth borrowing without adopting the method:

- Event identity by transit number. Pairing each extreme with `(nt, k)` gives every high and low water a stable identity, so predicted and reference events can be matched without a time window and missing or extra extrema show up as empty or doubled slots. The BSH text files carry `nt` and `k` for every event.
- Epoch matters more in rivers than elsewhere. BSH refits every gauge on the 19 years before each year and treats constants as stale after dredging. Our TICON epochs for German gauges vary widely; Cuxhaven's runs from 1917 to 2025. The quality score could weight recency more heavily for stations in tidal rivers.

## Rijkswaterstaat

The RWS work fits our harmonics to RWS's published astronomical series and passes its height gates at Ameland, Hoek van Holland and Den Helder (RMS 1.6–1.9 cm). The open item in [sources/rws/README.md](../../../sources/rws/README.md) is that Hoek van Holland and Den Helder show double extrema that RWS reduces to one event per tide, and that RWS documents no rule for which one.

HRoI does not help with that directly. RWS predicts with the harmonic method (hatyan), so a harmonic fit is already the right model for reproducing it, and HRoI has no concept of a double low water: it assumes exactly one per half lunar day, which is the assumption that fails at Hoek van Holland.

What does help:

- hatyan documents a rule. `hatyan.timeseries.calc_HWLW` (2.14.0) takes a 1-minute series and keeps, as the main high and low waters, peaks found by `scipy.signal.find_peaks` with prominence at least 0.01 m, width at least 2 h, and spacing at least the M2 period divided by 1.85; of two equal values it takes the first. With `calc_HWLW345=True` it labels the extra minima at Hoek van Holland as first low water, agger and second low water (codes 3, 4, 5), and `calc_HWLW12345to12` reduces them to the lowest value within 12 hours after each high water. Its tests name Hoek van Holland's alternating aggers and Den Helder's double high waters explicitly. Whether RWS's published `GETETTPE` events come from this function has to be tested against the event feed, but if they do, it is the provider rule the README says is missing. hatyan is GPL-3.0, so we would reimplement the described rule rather than copy code.
- hatyan also numbers events (`calc_HWLWnumbering`) relative to the first Cadzand high water of 2000 (2000-01-01 09:45 +01:00) in M2 periods, corrected by each station's M2 phase. That is the RWS counterpart of BSH's transit numbering, and either gives the event diagnostic a matching key that does not depend on a time window.
- Delfzijl, Eemshaven and Nieuwe Statenzijl in the Ems-Dollard face the same shallow, distorted tide as Emden and Knock, where our predictions differ from BSH's by 11–13 minutes σ. If those Dutch gauges are added from RWS, comparing them with BSH's Ems gauges is a useful cross-border check.

## Next steps

- [x] Add a `sources/bsh` validator comparing our German stations with BSH's current-year HW/LW, reported per gauge.
- [x] Ask BSH how its data may be used (answered 2026-11-02 and 2026-11-03, above).
- [ ] Fit German gauges from Pegelonline's raw water levels since 2000, with an extended shallow-water constituent list, and score the fits against TICON with the BSH validator.
- [ ] Test hatyan's `calc_HWLW` rule against RWS's `GETETTPE` events at Hoek van Holland and Den Helder.
- [ ] Investigate why our upper-river German stations predict low water 20–40 minutes earlier than BSH and with larger scatter against observations: TICON epoch, constituent list, or both.
