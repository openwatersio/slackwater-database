# Rijkswaterstaat astronomical tides

This audit evaluates Rijkswaterstaat (RWS) astronomical water levels and calculated high/low-water events for issue [#152](https://github.com/openwatersio/tide-database/issues/152). It covers source suitability and representation only; there is no importer or RWS data artifact yet.

## Decision

Use the RWS astronomical series as a bounded sampled-prediction artifact, separate from harmonic station records.

This route preserves the provider's heights, native vertical reference, missing values, and event classification. It also keeps source-copy error separate from any interpolation performed by a consumer. Do not fit harmonics unless a consumer demonstrates that the sampled format cannot meet its offline requirement.

Implementation is blocked on a format contract for sampled predictions. The current database schema and consumers support harmonics and subordinate-station offsets, not time-bounded samples or published event streams.

## Reuse terms

The [RWS Waterdata documentation](https://rijkswaterstaatdata.nl/waterdata/) states that WaterWebservices content is covered by the Creative Commons Zero declaration unless a component names a copyright exception. No exception was present in the selected catalog rows or observation responses during this audit.

The selected API content is therefore suitable for commercial offline redistribution under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Recheck the documentation and selected responses for endpoint-specific exceptions when an import is prepared. Retain the RWS name, source URL, request parameters, retrieval date, and checksums as provenance even though CC0 does not require attribution.

The service also documents fair-use throttling, no uptime guarantee, and a limit of 160,000 observations per request. An importer must use bounded requests and must not replace a valid artifact after a partial or failed retrieval.

## Catalog snapshot

Retrieved from the current `ddapi20` service on **2026-09-21**:

```text
POST https://ddapi20-waterwebservices.rijkswaterstaat.nl/METADATASERVICES/OphalenCatalogus
Content-Type: application/json

{"CatalogusFilter":{"Compartimenten":true,"Grootheden":true,"Eenheden":true,"Hoedanigheden":true,"ProcesTypes":true,"Groeperingen":true}}
```

Snapshot identity:

| Property | Value |
| --- | ---: |
| Bytes | 2,376,937 |
| SHA-256 | `38ad1bc2a3e3eb490ed4fc38883e982b309f21beb66a5fb9f52f94f6b48dffe5` |
| Metadata rows | 344 |
| Locations | 2,499 |
| Metadata/location links | 30,533 |

The response was kept outside Git. Repeat the request and join `AquoMetadataLijst`, `LocatieLijst`, and `AquoMetadataLocatieLijst` through their message IDs to reproduce the counts below.

### Tide-eligible locations

Only rows with `Grootheid.Code = WATHTE` and `ProcesType = astronomisch` are eligible for continuous tide heights. Calculated extrema must be selected as a complete datum-specific grouping.

| Series | Datum | Catalog metadata ID | Locations |
| --- | --- | ---: | ---: |
| 10-minute height | MSL | 313 | 13 |
| Calculated extrema (`GETETBRKDMSL2`) | MSL | 315 | 13 |
| 10-minute height | NAP | 317 | 101 |
| Calculated extrema (`GETETBRKD2`) | NAP | 321 | 101 |

There are 114 locations with astronomical heights and 114 with calculated extrema. The sets are not identical: 112 have both.

- Height only: `maasmond.stroommeetpaal`, `zeelandbrug.noord`
- Extrema only: `oostmahorn`, `zoutkamp`

The earlier “about 825 locations” estimate does not describe the current astronomical-tide catalog. The complete catalog contains 2,499 water-management locations, but only 114 currently expose continuous astronomical heights. These include offshore platforms; publication still needs a geographic eligibility check rather than assigning every record to the Netherlands from the provider name alone.

## Data semantics

The audit queried `ameland.nes` (NAP) and `europlatform` (MSL) for 2026-07-01 through 2026-07-02.

### Heights

A height request selects the quantity and process explicitly:

```json
{
  "Locatie": { "Code": "ameland.nes" },
  "AquoPlusWaarnemingMetadata": {
    "AquoMetadata": {
      "Grootheid": { "Code": "WATHTE" },
      "ProcesType": "astronomisch"
    }
  },
  "Periode": {
    "Begindatumtijd": "2026-07-01T00:00:00+01:00",
    "Einddatumtijd": "2026-07-02T00:00:00+01:00"
  }
}
```

Observed semantics:

- Locations use ETRS89 latitude/longitude (EPSG:4258). RWS says this is equivalent to WGS84 for display, but provenance should retain EPSG:4258.
- Heights are integer centimeters relative to the row's explicit `NAP` or `MSL` qualification. Do not relabel either as LAT or chart datum.
- The series cadence is 10 minutes. Both requested endpoints are included: a one-day request returned 145 samples, so chunk joins must deduplicate their shared boundary.
- Responses serialize timestamps at fixed `+01:00`, including July. Convert the explicit ISO 8601 offset to UTC; do not reinterpret the wall time with `Europe/Amsterdam` daylight-saving rules.
- Each value includes `Kwaliteitswaardecode`, `Statuswaarde`, `OpdrachtgevendeInstantie`, `Bemonsteringshoogte`, and `Referentievlak`. Preserve these fields or a lossless normalized equivalent. RWS documents quality code `99` as a gap.
- The sampled NAP and MSL responses used quality code `00`, status `Ongecontroleerd`, and commissioning organization `RIKZMON_WAT`. Other responses can use different values.

### High/low-water events

Request `GETETBRKD2` for NAP or `GETETBRKDMSL2` for MSL. Each grouping returns two channels with identical timestamps:

- a dimensionless `GETETTPE` channel whose alphanumeric value is `hoogwater` or `laagwater`;
- a `WATHTE` height channel in centimeters relative to the grouping's datum.

Keep the channels paired by timestamp. A caller must not request or interpret one channel in isolation.

The [RWS tide documentation](https://www.rijkswaterstaat.nl/water/waterdata/getij) describes double low water at Hoek van Holland and double high water at Den Helder. The 2026 event samples for `hoekvanholland` and `denhelder.marsdiep` alternated ordinary high/low classifications, but that does not justify a four-events-per-day assumption. Preserve every published event in order and allow repeated classifications or nonstandard daily counts.

### Observed date bounds

Bounded probes for `ameland.nes` returned data on 1990-01-01 and 2027-12-31, and HTTP 204 on 2028-01-01. This proves that station's availability at the two successful dates and its current future cutoff; it does not establish 1990 as the lower bound for every station.

Before publication, inventory start and end availability per eligible location. A bundled artifact must publish its actual supported interval, refresh before the end date, and define consumer behavior outside the interval.

## TICON overlap

The committed TICON data contains 254 Netherlands records, including 179 whose source identifier ends in `rws` or `rws_hist`. A nearest-neighbor audit compared all 114 RWS height locations with those 254 records using haversine distance:

| Nearest TICON distance | RWS locations |
| --- | ---: |
| At most 100 m | 71 |
| At most 500 m | 86 |
| At most 1 km | 92 |

These are proximity counts, not 92 proven identity matches. Names and coordinates change, nearby gauges can be distinct, and the current RWS codes differ from historical provider identifiers embedded in TICON.

Source-selection rule:

1. Establish identity with a provider identifier crosswalk or location history plus coordinates; never match by display name alone.
2. Preserve both provenance chains. Do not overwrite TICON harmonics with RWS samples.
3. Within a bundled RWS interval, prefer the direct RWS sample only when the consumer supports its native datum and sampled format.
4. Outside that interval, the TICON harmonic record remains independent data, not an automatic continuation of the RWS series.

## Representation options

### 1. Bounded sampled artifact: selected

Store the 10-minute heights as an interval-bounded series with station identity, start/end instants, cadence, native datum, unit, missing/quality information, and provenance. Store published extrema as timestamp/type/height tuples rather than deriving or forcing a daily pattern.

At two bytes per centimeter height, 114 stations over two complete years require approximately **23,983,776 bytes (24.0 MB, 22.9 MiB)** for heights alone:

```text
114 stations × 2 years × 365.25 days × 144 samples/day × 2 bytes
```

This excludes validity data, events, indexes, metadata, and container overhead, and precedes compression. For scale, one sampled day was 44,017 bytes as API JSON; projecting that response shape directly would be about 3.66 GB for two years, so raw response JSON is not a shipping format.

Benefits: exact provider values, explicit fidelity, preservation of double extrema, and no model-fitting error. Costs: a fixed horizon, release refreshes, and a new schema/consumer contract.

### 2. Derived harmonic fit: fallback only

Fitting could reuse the current station format and produce predictions outside a downloaded horizon. It would create a derived product, however, and may not reproduce RWS's constituent definitions, phase convention, nodal treatment, shallow-water behavior, or published extrema.

The current catalog and official documentation reviewed here expose predictions produced by harmonic analysis but no reusable harmonic-constant export with the metadata needed by the existing prediction engine. Confirm that absence with RWS before implementing a sampled format. If a harmonic export is still required, fit through `packages/harmonic-analysis`, preserve the RWS prediction chain of custody, and validate against an excluded interval before shipping.

### 3. Online API access: rejected

Online access does not satisfy the offline requirement and inherits the provider's fair-use limits and lack of uptime guarantee.

## Follow-up contract

The next milestone should define one sampled-prediction contract before building an importer. At minimum it must specify:

- implicit cadence versus per-sample timestamps;
- UTC normalization from the explicit fixed offset;
- NAP/MSL datum identity and centimeter-to-meter conversion;
- missing and quality encoding;
- event timestamp/type/height pairing;
- station crosswalk and precedence relative to TICON;
- inclusive/exclusive interval rules and chunk deduplication;
- artifact version, retrieval metadata, checksum, refresh deadline, and out-of-range behavior.

Skipped for this audit: an importer, committed source snapshot, harmonic fit, database changes, and consumer changes. Add them only after the sampled format contract is accepted.
