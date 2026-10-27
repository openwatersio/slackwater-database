# DMI astronomical tides

The importer fits harmonics to the Danish Meteorological Institute's astronomical tide predictions for Denmark, Greenland and the Faroe Islands. The inputs are DMI's prediction service, not its sea-level observations or weather-driven forecasts.

## Source and license

[DMI's oceanObs service](https://www.dmi.dk/friedata/dokumentation/apis/oceanographic-observation-and-tidewater-api) separates prediction stations (`tidewaterstation`) from observing stations (`station`). Import membership, country, position, LAT and MLWS come from the prediction-station inventory. Predictions come from the service's [annual bulk archives](https://opendataapi.dmi.dk/v2/oceanObs/bulk/tidewater/), whose daily NDJSON files mix ten-minute heights and extrema.

[DMI's terms](https://www.dmi.dk/friedata/dokumentation/terms-of-use) license API and bulk data under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), including commercial redistribution and adaptation. Credit DMI, link the license and disclose changes. `metadata.yaml` supplies the credit that the database serializes into each station's attribution. Its license, terms and modifications entries document the source policy; the importer writes the per-record license fields. The root README describes the transformations.

The annual PDF reports have separate reproduction restrictions. They supply neither the predictions nor datums imported here. The source does not depend on ArcTiCA's upstream license.

Header metadata has a separate licensing basis: [DMI's website copyright policy](https://www.dmi.dk/om-hjemmesiden), under “Er der ophavsret til DMI's materialer?”, permits commercial reuse of text material under its linked CC BY terms. We apply that permission to the observation-period text and short operational notes from the station text-table headers, crediting DMI and retaining their source URLs in `provenance.json`. This does not reproduce the PDF reports or their layout.

## Units and provenance

API heights, LAT and MLWS are centimetres relative to MSL. The importer converts them to metres. API timestamps are absolute UTC instants, so Greenland and Denmark require no hardcoded local-time shift. Independent API comparisons against DMI's ZERO text exports at the same instant establish the conversion: Esbjerg -17.8 cm at 2026-12-31T23:00Z, Aasiaat -70.5 cm at 2027-01-01T02:00Z and Tórshavn 4.4 cm at 2027-01-01T00:00Z. Offline tests pin these values. The text exports' reference header can still say LAT even in the ZERO directory; it is not a reliable reference-frame discriminator.

`provenance.json` records observation-period evidence and operational caveats from DMI's 2027 text-table headers, checked October 19, 2026. A listed observation period is evidence of gauge derivation; an unknown period stays unknown, without a claim that it is model-derived. Aliased table files with matching identity, position and metadata may share an ID. Conflicting joins fail. Text-table IDs absent from the API do not add import members. Lock operation and drying-out notes are preserved in station disclaimers.

Records have `published_harmonics: false`: these constants are fitted here. The source is not marked authoritative for duplicate selection, because fitting predictions does not establish an original gauge analysis or an authority claim for every record. Source priority is explicitly 50 (confidence 0.495), a project ranking independent of TICON's provider suffixes. The prediction training period is not written as the original observation epoch. Each record's disclaimer gives the held-out horizon and says accuracy outside it has not been checked.

## Fitting and validation

The reproducible input horizon is pinned to the 2026 and 2027 archives. The common UTC span starts 2026-01-02T00:00Z and ends, exclusively, at 2027-12-31T00:00Z, avoiding partial station-local days at either outer boundary. Training ends before 2027-01-05T00:00Z; validation starts at that instant. Each station must have every ten-minute sample across both windows. Timestamps, coordinates, station IDs and duplicate samples are checked while reading the archives.

The fitter uses the engine's Greenwich equilibrium arguments and nodal corrections. It starts with major, long-period and shallow-water constituents, then ranks additional constituents using only training residuals. Frequency separation requires one relative cycle over the training span (the Rayleigh criterion; Codiga 2011, UTide). Major constituents win unresolved pairs. Two disjoint deterministic spread samples of training data are fitted by SVD. These samples lie close together in time, so their difference checks numerical sampling stability, not statistical uncertainty or accuracy in other years. Amplitudes are stored to 1 mm and phases to 0.01 degrees; fitted zero amplitudes remain recorded values below that resolution. A fitted constant offset, rounded to 1 mm, is represented as a `Zo` term when nonzero. That offset is part of the prediction in DMI's MSL frame; it does not redefine the source's zero datum.

Every held-out ten-minute prediction is compared with the rounded representation. The publication gates are the project's RWS height-representation limits:

- RMS height error at most 0.02 m;
- 95th percentile absolute height error at most 0.04 m;
- maximum absolute height error at most 0.10 m;
- RMS prediction difference between the two sampling fits at most 0.005 m.

These gates measure representation of DMI's predictions, not agreement with observed water levels. Held-out values do not select constituents or tune thresholds. Provider extrema are not used as event-time targets: small shoulders can have multiple physical extrema while DMI's printed tables select canonical high/low events.

The pinned import passes 207 of the 220 inventory stations: 112 in Denmark, 84 in Greenland and 11 in the Faroes. Thirteen Greenland fits exceed the height limits and are excluded. Across accepted fits, the largest held-out RMS is 0.01971 m and the largest absolute error is 0.05624 m. Catalogue quality and duplicate selection run afterward: 186 DMI records pass those gates, 20 yield to another record and one fails the constituent check. These counts describe this snapshot, not independent observation accuracy or validity beyond the checked horizon.

The existing quality/source scoring selects DMI over six CMEMS relays with upstream quality-control warnings: Brøns, Ferring, Havneby, Hvide Sande Kyst, Thyborøn Kyst and Thorsminde Kyst. This is a catalogue preference for the validated astronomical representation, not an observation-accuracy comparison. Better-scored observational records still win elsewhere; license permissions do not override scientific quality. Every accepted source fit remains CC BY in `allStations`, `stationsById` and searches with `includeAll: true`, including DMI records omitted from the default accepted subset as duplicates.

Some same-name records beyond the 500 m proximity threshold remain co-published, including Aarhus/Århus and Skagen/Skagen Havn. Similar names and tides alone do not establish a shared gauge identity. The import preserves them pending a provenance match rather than widening the global deduplication radius. A match shares one station file, whose comment cites it: a TICON relay that names DMI as its source (Esbjerg, and the second relays at Gedser and Hornbæk), one whose series starts the day a DMI gauge's history does (Gedser, Hornbæk), one that starts the month DMI's prediction header dates its observations from (Ittoqqortoormiit), or one whose span falls inside or overlaps those observations within a few hundred metres (Maniitsoq, Qaqortoq). Nuuk, Ilulissat, Aasiaat and Ammassalik keep separate stations, each with a comment saying why. At Nuuk and Ilulissat, quality already rejects DMI's record as a duplicate, but DMI's header dates Nuuk's observations to years before the TICON record and gives none for Ilulissat. Aasiaat's records cover the same years 2.3 km apart, and Ammassalik's TICON record ends two years before the observations DMI's Tasiilaq prediction cites. Adding records also changes nearby isolation scores: the existing [coverage policy](../../docs/quality-evaluation.md#isolation) counts different-provider records as neighbors, including ones later rejected as duplicates. This affects ranking without changing their original observations.

MSL stays at zero in the verified API frame. LAT and MLWS retain the API's values. Remaining datums are synthesized with the existing datum package over its pinned 2007–2025 epoch. HAT is omitted unless the stored fit contains a nonzero Sa or Ssa; no accepted fit in this snapshot does. The datum source is `harmonic`, describing the prediction-derived set rather than observed datum measurements. Provider and synthesized datums describe different analyses and can disagree: the usual repository checks reject invalid orderings and retain permitted spring/mean-water differences as quality notes. Chart datum follows the repository's geographic policy: MSL for Baltic stations (95 records here), LAT elsewhere (112). Provider LAT remains available in the datum set for both groups.

## Running

Use the repository's Node 24 toolchain and the `unzip` command. Offline ZIP fixture tests also require `zip`; macOS and the Ubuntu CI image provide both.

```sh
npm run import -w sources/dmi
npm run refresh:places -w packages/stations
npm run refresh:water-bodies -w packages/stations -- --extend-source=dmi
npm run stations
npm run report:merges -w packages/stations
PUBLISHED_REF=origin/main npm run check
```

Refresh spatial snapshots when extending the catalogue into new places or water bodies. Review their diffs and record input provenance in `metadata/PROVENANCE.md`; ordinary builds use the committed snapshots without downloading them.

To re-evaluate the source without writing station records:

```sh
npm run validate -w sources/dmi
npm run validate -w sources/dmi -- --station=25149 --station=2991540 --station=2988270
```

Raw downloads and dense series caches live in ignored `tmp/dmi/`. Both import and validation enforce the input identities in the committed `sources/dmi/validation.json`. Annual archive bytes must match their SHA-256. Inventory pages must use the recorded URLs, and the complete parsed inventory must match `inventorySha256`: SHA-256 of the JSON array sorted by ID, with each object's fields in this order: `id`, `name`, `country`, `latitude`, `longitude`, `lat`, `mlws`. These are all fields used by the importer. DMI's request timestamp and unused response metadata are excluded; fresh and cached responses with the same station content remain equivalent. Per-page byte hashes are still recorded for provenance and local cache integrity.

Changed archive bytes, inventory content or an unrecorded pagination URL stop the run before fitting or source replacement. Clearing the cache downloads the same pinned inputs, rather than accepting a new station snapshot. Derived caches are bound to the parsed inventory, archive checksums, parser version and UTC bounds, and each station's cached bytes are checksummed. These caches have no automatic expiry.

To update the snapshot, inspect the changed upstream inputs, reconcile their inventory with the archives and provenance, and update the committed input identities explicitly before running the importer. Review those identity changes together with the regenerated validation report and station data. There is no command-line bypass for accepting changed inputs. A future prediction horizon also requires updating the importer bounds and checks.

`sources/dmi/validation.json` records the full import's acceptance decisions, height/stability metrics and origin evidence; `tmp/dmi/validation.json` holds the latest validation-only report. The committed report uses the generator's JSON formatting and is excluded from Prettier, like `data/`. Excluded stations are explicit. Download or archive errors stop the import before publication. Empty imports and refreshes that would remove existing station IDs are refused. Source replacement is staged with rollback on a failed rename; run source regeneration without another build or importer reading the same worktree concurrently.

A process killed during source replacement leaves `.dmi-import.lock` and ignored `.dmi-stage-*` directories at the repository root, outside station-source discovery. The lock refuses another import. Confirm the importer is stopped, preserve the staged backup, and restore it to `data/dmi` if the final directory is absent before removing the lock and retrying. A download killed between its two renames can leave a file without its manifest; remove that incomplete pair before retrying. These failures require deliberate recovery rather than silently accepting an incomplete snapshot.

No sampled prediction series are shipped in the database. Tests run offline using small contract examples, synthetic tides, temporary ZIPs and filesystem fixtures. Full source validation requires the real archives.

The TCD export omits constituent names whose amplitudes are zero in every exported reference station without changing predictions. This snapshot uses 156 nonzero terms, below libtcd's 255-term limit; the compiler rejects an export that exceeds it. The database keeps those measured zero values. Docker tests compare DMI predictions from all three regions through XTide, including both LAT and Baltic MSL height references.
