# Bundesamt für Seeschifffahrt und Hydrographie

The Federal Maritime and Hydrographic Agency (BSH) publishes Germany's official tide tables at [gezeiten.bsh.de](https://gezeiten.bsh.de). It predicts high and low waters with its own non-harmonic method (harmonic representation of inequalities, described in [docs/research/harmonic-inequalities](../../docs/research/harmonic-inequalities/README.md)), and publishes no harmonic constants. This source imports no stations. It checks our German stations, Open Waters' fits of the WSV's PEGELONLINE series and TICON records, against BSH's tables.

## Validation

```sh
npm run build -w packages/database
npm run validate -w sources/bsh
```

The validator reads the database built from this checkout, so build it first. For each of BSH's 172 places it takes the nearest accepted reference tide station within 2 km. It skips places with no such station and places where BSH publishes no heights. It then predicts our high and low waters for the baseline year and pairs each BSH event with our nearest event of the same type within three hours. Pairing is not one to one, and BSH events with no partner drop out of the time statistics, so at the worst river gauges the scatter understates the error. Per gauge it reports:

| Column                | Meaning                                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `events`, `matched`   | BSH events in the year, and how many we paired                                                                                 |
| `predicted`           | Our events from the first to the last paired event, which shows extra or missing highs and lows on our side                    |
| `timeMean`, `timeSd`  | Our time minus BSH's, in minutes; negative means our prediction is early                                                       |
| `highMean`, `lowMean` | The mean at high and at low water separately                                                                                   |
| `timeP95`             | 95th percentile of the absolute time difference                                                                                |
| `heightSd`            | Standard deviation of the height difference in metres. BSH heights are on each gauge's own zero, so the mean is not comparable |

[validation.json](validation.json) holds the baseline: the matched station and these figures for every gauge. The validator fails when a gauge:

- loses its match, changes station, or can no longer be compared
- has a mean time bias, overall or at high or low water, that grows by more than 2 minutes in magnitude
- has time scatter that grows by more than 2 minutes, or height scatter by more than 0.02 m
- loses more than 1% of BSH's events, gains or loses more than 1% of our events relative to BSH's, or has more than 1% fewer events paired

Improvements pass, and gauges that newly gain a station are listed. After a reviewed change to German stations, run `npm run validate -w sources/bsh -- --update` and commit the new baseline. An update prints the regressions it accepts, refuses to drop a gauge from the baseline (in the same or a new year) unless given `--allow-drop`, and fails outright when BSH publishes nothing for the year.

CI does not run it, because it needs the network. Responses are cached under `tmp/bsh/<year>/` and never expire; delete that directory to download them again, knowing BSH stops serving a year once it ends. BSH publishes only the current and next year, so the baseline must move forward each year. Run the check against the old year first, while its data is still cached or online, and then `--year=2027 --update`; the new year's baseline is not compared with the old one.

## Findings

For 2026, 96 gauges match, 91 of them with Open Waters' fits of the WSV's PEGELONLINE series ([sources/water-levels](../water-levels/README.md)) and the rest with TICON records. Every one of our stations predicts earlier than BSH on average; the median bias is −12.0 minutes and the median scatter is 16.0 minutes. Coastal and island gauges are within a few minutes, such as Helgoland at −5.1 ± 8.6 minutes. Upper estuary gauges are much worse, and almost entirely at low water: St. Pauli is −21.8 ± 18.9 minutes, and Herbrum on the Ems is −39.3 ± 48.4 with low waters 77 minutes early on average. Fitting PEGELONLINE's own observations moves the median bias by under a minute, and most gauges by about one. Bremervörde moves most, from −13.6 to −6.7 minutes, and Cuxhaven from −5.8 to −10.4, where the station publishes the fit rather than UHSLC's record.

These are differences from another prediction. Against PEGELONLINE's 1-minute observations from January to June 2026 ([lake-obs.ts](../../docs/research/harmonic-inequalities/measurements/lake-obs.ts)), at seven gauges from Helgoland to Herbrum, BSH's high and low waters average from 1 minute early to 22 minutes late, and ours from 2 minutes late to 18 early, so at St. Pauli the gap splits about evenly (BSH +11.0 ± 11.0 minutes, ours −10.8 ± 18.7). BSH's scatter is smaller at every gauge checked, and by most in the upper estuaries: 25.5 minutes against our 57.5 at Herbrum, where our low waters are 59 minutes early. There the tide's low water depends on river flow, which harmonic constants, even with the shallow-water constituents M4 to M8, don't follow.

## Terms

[BSH's fee schedule](https://www.bsh.de/DE/Das_BSH/Gebuehren_Preise/Gebuehren_und_Preise/_Anlagen/Downloads/Entgeltverzeichnis-digitale-Daten.html) (Anlage 4) makes use of its tide predictions free, including commercial use and publication, with the credit line the validator prints. The validator keeps BSH's responses in the uncommitted cache, and `validation.json` records only gauge numbers, names and our comparison statistics. The research notes commit one BSH sample, Cuxhaven's 2026 tables, with this credit line beside it.
