# Japan Meteorological Agency

JMA publishes [60-constituent tables for 70 tide stations](https://www.data.jma.go.jp/gmd/kaiyou/db/tide/suisan/station2026.php). The snapshot targets the 2026 tables; `YEAR` in `jma.ts` controls the fetch target, and changing it is a reviewed source update.

## Import and update

Run `npm run import -w sources/jma` offline, `npm run validate -w sources/jma`, then `npm run stations`. To retrieve new responses, run `npm run refresh:jma -w sources/jma` and review the fixture diff before importing. The manifest records retrieval time, exact URLs and SHA-256 hashes. Import verifies every response before writing data. Refresh stages and validates pages before replacing the pinned files. Replacement is sequential; restore fixtures from Git after interrupted disk writes. Import also replaces records sequentially; rerun import after a disk-write failure before using the data. Both operations lock their output directory; remove a stale lock only after confirming no writer is running. Missing gauges fail until an explicit reviewed `--withdraw=XX` is provided. The reviewed names and crosswalk also require updating for a changed inventory.

## Harmonics and datums

The constants pages explicitly state that phase lags reference the local meridian. Greenwich lag is `G = κ − species × longitude_east`, wrapped to 0–360°. Species comes from the engine constituent catalogue. Use the constants page's longitude in degrees, minutes and seconds for this conversion, rather than the station list's rounded minutes. Latitude comes from the station list at whole-minute precision. Amplitudes published to 0.01 cm become metres to four decimals; phases retain 11 decimals to carry the arcsecond conversion. These digits describe source precision, not measurement accuracy. Zero amplitudes remain measured values.

Constituents resolve by name and speed using JHOD's existing resolver; JMA's `M1` at 14.4920521°/h is `M1C`. Every page must contain exactly 60 distinct constituents. The database epoch is the short-period analysis span. Pinned pages preserve separate long-period spans and omitted years, which the database's single epoch field cannot represent.

JMA describes its tide-table zero as average spring low water, approximately chart zero. Its published MSL offset differs from the four-amplitude NLLW approximation by 0–0.098 m across the 70 stations (largest at Minamidaito). At Wakkanai the offset is 18.0 cm versus 16.75 cm from the amplitudes. Records therefore store datums in the **MSL = 0 frame**, retain the **published tide-table zero as `CD = −z0`**, and use **CD as their height reference**. NLLW remains a separately derived value. Other tidal datums are derived over the pinned epoch. Regeneration preserves the published CD. These derived datums have not been validated against official datum values.

The raw JMA latitude remains the station list's whole-minute value. Curated positions at 69 stations use the reviewed TICON JMA MA-code gauge coordinates, preserving their finer location rather than placing maps at rounded minutes. Both coordinate sets remain in the committed source records, and the station file records the curated position. Ofunato keeps the published JMA position: its station also retains a historical fast-delivery location over 6 km away, so a station-wide coordinate correction would exceed the existing 5 km correction bound. This does not establish survey accuracy; the constants page's longitude is used independently for phase conversion.

## Gauge matching

`ticon-originators.json` records the reviewed JMA MA-code to JMA station-code crosswalk. All 70 names and positions match TICON's JODC JMA gauges within about 1.1 km, consistent with the rounded inventory coordinates. M2 amplitudes differ by at most 3.72 cm and Greenwich phases by at most 3.26°, supporting these identities without requiring the two analyses to agree exactly. `names.json` records their romanized names; Chichijima replaces TICON's opaque MA58 name and Miyakejima includes the Tsubota gauge name. Matching uses these reviewed identities through the existing provenance and quality rules, rather than merging on proximity alone. The operator's published constants take precedence; TICON records and existing URLs remain attached to the gauge. UHSLC also declares the two-character JMA gauge codes (for example WN and AS); those match only when its metadata names JMA or JODC and the code is in the reviewed inventory. Coast Guard HD codes remain separate. Unknown MA codes do not match.

## Prediction comparison

Four stations (Wakkanai, Tokyo, Naha and Nagoya) each have seven days of hourly predictions pinned for January, April, July and October 2026: 2,688 comparisons in JST. All 70 imported constituent sets, raw coordinates, epochs and published zero offsets are checked against the pinned snapshot. These are published harmonic predictions, not observations. RMSE ranges from 0.0042 to 0.0146 m and maximum absolute difference reaches 0.0334 m at Nagoya in October. The source regression limits are 0.03 m RMSE and 0.065 m maximum absolute error, chosen for this project's measured comparison, not publisher uncertainty bounds. Residual differences remain; these checks do not establish year-round accuracy, high/low-water timing accuracy or official datum agreement.

## Attribution and license

[JMA's terms](https://www.jma.go.jp/jma/kishou/info/coment.html) apply [Public Data License 1.0](https://www.digital.go.jp/resources/open_data/public_data_license_v1.0). Section 1 permits copying, adaptation and commercial use; section 1.7(3) explicitly permits use under CC BY 4.0. Both pages are pinned. The records use that CC BY 4.0 option.

JMA's example attribution is “出典：気象庁ホームページ（当該ページのURL）”. Edited content also needs a separate notice identifying the editing party, and must not appear to be unmodified government material. `metadata.yaml` supplies the English source credit, source URL, PDL link and editing notice, which travel in each station's attribution. Only tide data and supporting textual evidence are included; no logos or mascots are imported.

JMA’s terms also identify restrictions under the Meteorological Service Act, including articles 17 and 23. CC BY permission for these published constants does not waive independently applicable requirements for operating a forecast or warning service.

The source credit also carries the TICON-4 citation for the curated gauge coordinates. The record-level `source.url` identifies each JMA constants page.
