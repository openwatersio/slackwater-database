# Rijkswaterstaat astronomical tides

This audit evaluates Rijkswaterstaat (RWS) astronomical water levels and calculated high/low-water events for issue [#152](https://github.com/openwatersio/tide-database/issues/152). It covers source suitability and representation only; there is no importer or RWS data artifact yet.

## Decision

Use the RWS astronomical series as a bounded sampled-prediction artifact, separate from harmonic station records.

The repository already re-fits harmonics for 56 TICON records whose identifiers end in `-rws`, so derived data and the fixed RWS time offset are existing code paths rather than new risks. A held-out fit against the current RWS series kept height error below the repository's 10 cm RMS ceiling, but failed the existing event-time thresholds and produced hundreds of extra extrema at Hoek van Holland and Den Helder. The exact sampled series projects to only 3.9–4.7 MB compressed for all 114 stations, so preserving the provider's heights and published events is the lower-risk route.

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

| Property                |                                                              Value |
| ----------------------- | -----------------------------------------------------------------: |
| Bytes                   |                                                          2,376,937 |
| SHA-256                 | `38ad1bc2a3e3eb490ed4fc38883e982b309f21beb66a5fb9f52f94f6b48dffe5` |
| Metadata rows           |                                                                344 |
| Locations               |                                                              2,499 |
| Metadata/location links |                                                             30,533 |

The response was kept outside Git. Repeat the request and join `AquoMetadataLijst`, `LocatieLijst`, and `AquoMetadataLocatieLijst` through their message IDs to reproduce the counts below.

### Tide-eligible locations

Only rows with `Grootheid.Code = WATHTE` and `ProcesType = astronomisch` are eligible for continuous tide heights. Calculated extrema must be selected as a complete datum-specific grouping.

| Series                               | Datum | Catalog metadata ID | Locations |
| ------------------------------------ | ----- | ------------------: | --------: |
| 10-minute height                     | MSL   |                 313 |        13 |
| Calculated extrema (`GETETBRKDMSL2`) | MSL   |                 315 |        13 |
| 10-minute height                     | NAP   |                 317 |       101 |
| Calculated extrema (`GETETBRKD2`)    | NAP   |                 321 |       101 |

There are 114 locations with astronomical heights and 114 with calculated extrema. The sets are not identical: 112 have both.

- Height only: `maasmond.stroommeetpaal`, `zeelandbrug.noord`
- Extrema only: `oostmahorn`, `zoutkamp`

The “about 825 locations” estimate can only be traced to the uncited claim in parent issue [#148](https://github.com/openwatersio/tide-database/issues/148). It does not describe another verified current product: the current catalog exposes 114 continuous astronomical-height locations, while the public [Waterinfo astronomical-tide map](https://waterinfo.rws.nl/api/point/latestmeasurement?parameterId=astronomische-getij) returned 94 locations on 2026-09-21. The RWS data register also lists a completed 2013 [astronomical water-level series](https://maps.rijkswaterstaat.nl/dataregister/srv/api/records/usoc5hgv-f4mm-ouyo-hzeh-idijhclc1q11), but publishes neither a location count nor an associated download. Treat 825 as unsubstantiated, not as evidence of broader tide-table coverage. The complete current catalog contains 2,499 water-management locations, and the 114 eligible locations include offshore platforms; publication still needs a geographic eligibility check rather than assigning every record to the Netherlands from the provider name alone.

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
- Heights are integer centimeters relative to the series-level `AquoMetadata.Hoedanigheid.Code`, which is explicitly `NAP` or `MSL`. Per-value `WaarnemingMetadata.Referentievlak` was `NVT` and is not the datum. Do not relabel either datum as LAT or chart datum.
- The series cadence is 10 minutes. Both requested endpoints are included: a one-day request returned 145 samples, so chunk joins must deduplicate their shared boundary.
- Responses serialize timestamps at fixed `+01:00`, including July. A request using `Z` timestamps still returned `+01:00`, so this is response behavior rather than an echo of the request. Convert the explicit ISO 8601 offset to UTC; do not reinterpret the wall time with `Europe/Amsterdam` daylight-saving rules.
- Across the complete 2026 series for `ameland.nes` and `hoekvanholland` (105,122 samples), per-value metadata did not vary: quality code `00`, status `Ongecontroleerd`, commissioning organization `RIKZMON_WAT`, sampling height `-999999999` (not applicable), and reference plane `NVT`. Do not add sparse per-sample metadata overrides until a broader probe observes variation. RWS documents quality code `99` as a gap, so an importer must still recognize it and reject unexpected metadata rather than silently discard it.

### High/low-water events

Request `GETETBRKD2` for NAP or `GETETBRKDMSL2` for MSL. Each grouping returns two channels with identical timestamps:

- a dimensionless `GETETTPE` channel whose alphanumeric value is `hoogwater` or `laagwater`;
- a `WATHTE` height channel in centimeters relative to the grouping's datum.

Keep the channels paired by timestamp. A caller must not request or interpret one channel in isolation.

Do not derive events by finding turning points in the integer-centimeter samples. A direct scan of the 2026 `hoekvanholland` series found 1,846 highs and 1,716 lows, versus 1,411 published events total, with as many as 13 apparent highs in one day. One-centimeter plateaus and jitter make ordinary days fail before unusual tide shapes are considered.

The [RWS tide documentation](https://www.rijkswaterstaat.nl/water/waterdata/getij) also describes double low water at Hoek van Holland and double high water at Den Helder. The 2026 event samples for `hoekvanholland` and `denhelder.marsdiep` alternated ordinary high/low classifications, but that does not justify a four-events-per-day assumption. Preserve every published event in order and allow repeated classifications or nonstandard daily counts.

### Observed date bounds

Bounded probes for `ameland.nes` returned data on 1990-01-01 and 2027-12-31, and HTTP 204 on 2028-01-01. This proves that station's availability at the two successful dates and its current future cutoff; it does not establish 1990 as the lower bound for every station.

Before publication, inventory start and end availability per eligible location. A bundled artifact must publish its actual supported interval, refresh before the end date, and define consumer behavior outside the interval.

## TICON overlap

The committed TICON data contains 254 Netherlands records, including 179 whose source identifier ends in `rws` or `rws_hist`. A nearest-neighbor audit compared all 114 RWS height locations with those 254 records using haversine distance:

| Nearest TICON distance | RWS locations |
| ---------------------- | ------------: |
| At most 100 m          |            71 |
| At most 500 m          |            86 |
| At most 1 km           |            92 |

These are proximity counts, not 92 proven identity matches. Names and coordinates change, nearby gauges can be distinct, and the current RWS codes differ from historical provider identifiers embedded in TICON.

Source-selection rule:

1. Establish identity with a provider identifier crosswalk or location history plus coordinates; never match by display name alone.
2. Preserve both provenance chains. Do not overwrite TICON harmonics with RWS samples.
3. Within a bundled RWS interval, prefer the direct RWS sample only when the consumer supports its native datum and sampled format.
4. Outside that interval, the TICON harmonic record remains independent data, not an automatic continuation of the RWS series.

## Representation options

### 1. Bounded sampled artifact: selected

Store the 10-minute heights as an interval-bounded series with station identity, start/end instants, cadence, native datum, unit, missing/quality information, and provenance. Store published extrema as timestamp/type/height tuples rather than deriving or forcing a daily pattern.

At two bytes per sample, 114 stations over two complete years require approximately **23,983,776 bytes (24.0 MB, 22.9 MiB)** uncompressed for heights alone:

```text
114 stations × 2 years × 365.25 days × 144 samples/day × 2 bytes
```

Measured on the complete 2025 and 2026 series (105,122 samples per station), gzip level 9 produced:

| Station          | Raw `int16` |   gzip | gzip after `int16` delta encoding | Projected ×114 |
| ---------------- | ----------: | -----: | --------------------------------: | -------------: |
| `ameland.nes`    |     210,244 | 70,856 |                            34,305 |         3.9 MB |
| `hoekvanholland` |     210,244 | 74,997 |                            40,912 |         4.7 MB |

The transfer-size decision therefore turns on a roughly 4 MB compressed height payload, not the 24 MB raw allocation. Both figures exclude validity data, events, indexes, metadata, and container overhead. For scale, one sampled day was 44,017 bytes as API JSON; projecting that response shape directly would be about 3.66 GB for two years, so raw response JSON is not a shipping format.

Benefits: exact provider values, explicit fidelity, preservation of double extrema, and no model-fitting error. Costs: a fixed horizon, release refreshes, and a new schema/consumer contract.

### 2. Derived harmonic fit: measured and rejected

Fitting reuses the current station format and already runs for 56 TICON `-rws` records in `sources/ticon/import.ts`. RWS also labels its own values `other:F012`, “Astronomische waterhoogte mbv harmonische analyse,” so derivation alone is not a reason to reject this route.

The audit fitted the 49 constituents supported by `packages/harmonic-analysis` from the 50-constituent TICON RWS set. It trained on January–June 2026 and validated on July–December. Event matching used the repository's existing TCD validation gate: at least 95% of published events matched by type within 60 minutes, mean time error below 5 minutes, maximum below 15 minutes, and height RMS below 10 cm.

| Station              | Height RMS | Height max | Published/predicted events | Matched | Event mean | Event max |
| -------------------- | ---------: | ---------: | -------------------------: | ------: | ---------: | --------: |
| `ameland.nes`        |     6.2 cm |    22.3 cm |                    711/711 |     711 |    8.1 min |  32.3 min |
| `hoekvanholland`     |     9.2 cm |    33.8 cm |                    711/969 |     633 |   20.8 min |  59.8 min |
| `denhelder.marsdiep` |     7.9 cm |    32.1 cm |                    711/932 |     653 |   20.7 min |  59.3 min |

All three height fits met the RMS ceiling, but all three failed the event-time gate. The two unusual-tide stations also produced hundreds of extra extrema and fell below the 95% match requirement. A longer training interval may improve height error, but this fit does not preserve the published event stream required by #152.

The current catalog and official documentation reviewed here expose predictions produced by harmonic analysis but no reusable harmonic-constant export with the metadata needed by the existing prediction engine. Provider confirmation remains worthwhile, but the measured fit does not replace the bounded artifact.

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

Skipped for this audit: an importer, committed source snapshot, database changes, and consumer changes. Add them only after the sampled format contract is accepted.
