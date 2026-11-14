# Japan Coast Guard source

The Japan Coast Guard Hydrographic and Oceanographic Department (JHOD) publishes harmonic constants for 20 of the 89 gauges on its [real-time tide map](https://www1.kaiho.mlit.go.jp/TIDE/gauge/index_eng.php). Each of those 20 gauge pages links a complete table of 60 constituents. JMA gauges on the same map are separate instruments; this source imports only pages with JHOD harmonic tables.

## Import and update

```sh
npm run import -w sources/jhod
npm run validate -w sources/jhod
npm run stations
```

The import is offline. `fixtures/manifest.json` pins each response's URL, retrieval time and SHA-256; the map, all 89 gauge pages, 20 harmonic pages, explanation and terms are committed verbatim. Missing or changed responses fail before any station data is written. Each refresh request has a 30-second timeout. A successful refresh removes previously manifested HTML pages absent from the new manifest. File replacement is sequential; if disk I/O interrupts it, restore the pinned fixtures from Git before retrying. To retrieve a new snapshot, run `npm run refresh:jhod -w sources/jhod`, review the source diff, then regenerate the station files. A new or withdrawn gauge needs review of the inventory and its matches in `ticon-originators.json`.

Import and refresh each lock their output directory through a sibling `<directory>.lock` directory. A concurrent writer fails before changing that output. Normal completion or an error releases the lock; after a process crash, remove a remaining lock only after confirming no import or refresh is running. Pruning only considers records or snapshot files present in the inventory that passed the withdrawal check.

Refresh and import refuse to lose an existing gauge. After confirming a withdrawal, pass `--withdraw=NNNN` for each reviewed station ID, alongside `--refresh` when fetching new pages. Prediction validation requires the snapshot and imported station sets to match and compares the imported constituents and datums against the publisher's hourly heights.

## Conventions

- Amplitudes are published to 0.01 cm and stored to 0.0001 m. Zero amplitude is retained; blank or non-numeric amplitudes fail the import.
- JHOD defines phase as the lag after the constituent's virtual body crosses the local meridian in its [explanation](https://www1.kaiho.mlit.go.jp/TIDE/harmonic/kaisetsu.html). Greenwich lag is `G = κ − species × longitude_east`, wrapped to 0–360°. Species is the constituent catalogue's coefficient of lunar time. Long-period terms have species zero, so their phases do not shift. This is a local-meridian conversion, rather than a fixed nine-hour shift from JST.
- Every name must match both the catalogue name or an explicit alias and its published speed within 0.00001°/h. Greek letters are spelled out. JHOD's `M1` at 14.4920521°/h maps to `M1C`; the catalogue's `M1` has a different frequency. `OQ2` maps to the ordinary catalogue `OQ2`, not Kartverket's distinct `OQ2_KV`.
- Positions use the map's decimal coordinates, which are more precise than the gauge page's whole arcminutes. Converted phases keep 11 decimal places to carry those coordinates through the conversion; stored digits are not an accuracy claim.
- JHOD's `Z0` is MSL above its depth datum, DL, which its explanation defines from the four principal constituent amplitudes. The records use Japan's `NLLW` label, with `NLLW = 0` and the publisher's `MSL = Z0`. Other tidal datums are derived over the database's pinned 2007–2025 epoch and shifted by Z0. The published rounded Z0 takes precedence over recomputing a zero from the four amplitudes.
- `epoch` records the span of the ordinary constituents' analysis. Sa/Ssa have a separately parsed period retained in the source snapshot: Kamaishi uses 2013–2019 for ordinary terms and 2014–2019 for seasonal terms; Oita uses 2011–2013 and 2015–2020 respectively. Izuhara's seasonal analysis covers 2011–2017 and 2019, omitting 2018. The database's single epoch field cannot describe these separate periods or gaps.

## Gauge matching

`ticon-originators.json` is the reviewed crosswalk between JODC's Coast Guard `HD` codes and JHOD's four-digit tide-map IDs. All 20 match TICON Coast Guard station names and locations: 19 are within 110 m, and Izuhara is 671 m away. M2 amplitudes differ by at most 2.4 cm and Greenwich phases by at most 4.1°. Those comparisons support the gauge identities; they are not a reason to overwrite either source's constants.

The same crosswalk applies when pinned UHSLC metadata explicitly names Japan Oceanographic Data Center and an `HD` originator number. It matches the research-quality relays of Miyakejima (HD10), Nakanoshima (HD28), Naze (HD22) and Nishinoomote (HD21). The existing provenance and quality rules prefer the operator's published constants and preserve relay records and former URLs on the same station. JMA's `MA` codes and port-authority gauges do not match this crosswalk. Yokohama's separate JMA gauge is about 1.7 km from the Coast Guard gauge.

## Prediction comparison

`npm run validate -w sources/jhod` compares all 480 published hourly heights for 20 October 2026 JST against the imported constituents, with the published Z0 added. These are harmonic predictions, not observations. RMSE ranges from 0.0040 to 0.0240 m; the largest absolute difference is 0.0425 m, at Hiroshima. The validation uses project regression limits of 0.03 m RMSE and 0.05 m maximum error; these are not publisher-specified uncertainty bounds.

For comparison, Sasebo's RMSE is 0.5301 m with unconverted phases, 0.0471 m with a nine-hour JST shift, and 0.0117 m with the local-meridian conversion. Residual centimetre differences remain; the comparison does not establish year-round accuracy or agreement of high/low-water times. In particular, one day cannot independently validate long-period phases. Derived datums have not been compared with publisher datum values.

## Attribution and source decision

[JHOD's terms](https://www1.kaiho.mlit.go.jp/copyright.html), pinned as `fixtures/terms.html`, follow Japan's Government Standard Terms of Use 2.0. They permit copying, adaptation and commercial use with source attribution and an editing notice, and prohibit presenting edited material as the government's own work. The credit and editing notice in `metadata.yaml` travel with each station. Logos and mascots have separate terms and are not included.

The terms also reproduce Article 25 of the Hydrographic Services Act, requiring permission to publish material similar to Coast Guard charts, aeronautical charts, sailing directions or light lists. The source decision for this importer is that redistributing harmonic-constant records is outside those listed publication categories; tide tables are not on that list. This records the project's reading of the published terms.

The TCD export labels these terms `Japan GSTU 2.0` and retains JHOD's source credit and editing notice in the station notes.
