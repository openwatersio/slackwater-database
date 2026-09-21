# Rijkswaterstaat Source Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce the evidence-backed source and representation recommendation required before implementing issue #152.

**Architecture:** Keep the audit in one source-owned README. Query the live Rijkswaterstaat catalog and bounded observation samples, compare eligible coordinates with committed TICON records, then document the evidence and one recommended offline representation without adding importer code or generated data.

**Tech Stack:** Rijkswaterstaat WaterWebservices JSON API, `curl`, `jq`, Node.js standard library, Markdown, Prettier

**Spec:** `docs/superpowers/specs/2026-09-21-rws-source-audit-design.md`

## Global Constraints

- Create only `sources/rws/README.md` for the audit deliverable.
- Select only `WATHTE` records whose process type is `astronomisch`.
- Use `GETETBRKD2` and `GETETBRKDMSL2` only as paired high/low event groupings.
- Keep NAP and MSL values distinct and retain centimeters as the source unit.
- Treat coordinate proximity as overlap evidence, never as an automatic identity match.
- Do not add an importer, schema, generated data, consumer changes, full catalog snapshot, dependency, or load test.

---

### Task 1: Write the Rijkswaterstaat source audit

**Files:**

- Create: `sources/rws/README.md`

**Interfaces:**

- Consumes: live WaterWebservices responses and committed `data/ticon/*.json` station records
- Produces: the source decision record for the later importer and format work in issue #152

- [ ] **Step 1: Fetch and identify the catalog snapshot**

Run this from the repository root, keeping the volatile response outside Git:

```bash
curl -sS -X POST \
  https://ddapi20-waterwebservices.rijkswaterstaat.nl/METADATASERVICES/OphalenCatalogus \
  -H 'Content-Type: application/json' \
  --data '{"CatalogusFilter":{"Compartimenten":true,"Grootheden":true,"Eenheden":true,"Hoedanigheden":true,"ProcesTypes":true,"Groeperingen":true}}' \
  -o /tmp/rws-catalog.json
shasum -a 256 /tmp/rws-catalog.json
```

Record the retrieval date, request body, byte size, and SHA-256 in the README. The 2026-09-21 cross-check is 2,499 total locations, 344 metadata rows, and 30,533 metadata/location links.

- [ ] **Step 2: Derive tide-eligible coverage from catalog joins**

Join `AquoMetadataLijst`, `LocatieLijst`, and `AquoMetadataLocatieLijst` through their message IDs. Record these 2026-09-21 cross-checks:

- continuous astronomical heights: 114 locations;
- calculated extrema: 114 locations;
- both forms: 112 locations;
- NAP: 101 height locations and 101 extrema locations;
- MSL: 13 height locations and 13 extrema locations;
- height only: `maasmond.stroommeetpaal`, `zeelandbrug.noord`;
- extrema only: `oostmahorn`, `zoutkamp`.

Trace the earlier “about 825” claim to a named current product or record it as unsubstantiated. Compare it with both the current tide-eligible catalog and the public Waterinfo astronomical-tide map.

- [ ] **Step 3: Verify response semantics with bounded samples**

Query one NAP station (`ameland.nes`) and one MSL station (`europlatform`) for a single day using `WATHTE` plus `ProcesType: astronomisch`, then query the matching datum-specific grouping. Record:

- coordinates are ETRS89 latitude/longitude (EPSG:4258);
- height is returned in centimeters relative to the series-level `AquoMetadata.Hoedanigheid.Code` (`NAP` or `MSL`), not per-value `WaarnemingMetadata.Referentievlak`;
- ordinary heights have a 10-minute cadence and both request endpoints are included;
- timestamps are serialized at fixed `+01:00`, including when the request uses `Z`, so conversion must use the explicit response offset rather than `Europe/Amsterdam` daylight-saving rules;
- every value carries quality code, status, commissioning organization, sampling height, and reference-plane metadata; report whether those values vary across complete station-years before designing per-sample overrides;
- grouped extrema return separate type and height channels paired by timestamp;
- quality code `99` denotes a gap.

Probe `1990-01-01`, `2027-12-31`, and `2028-01-01` for `ameland.nes`. State that this sample has data through 2027-12-31 but not 2028-01-01, and do not generalize its lower bound to every station.

- [ ] **Step 4: Audit TICON overlap without name-only matching**

Read committed TICON records whose country is `Netherlands`. Compute the nearest TICON station for each of the 114 eligible RWS height locations with a haversine distance, then inspect provider suffixes and coordinates for ambiguous cases.

Record the reproducible proximity evidence:

- 254 Netherlands TICON records;
- 179 with `rws` or `rws_hist` provider suffixes;
- 71 RWS locations within 100 m of a TICON record;
- 86 within 500 m;
- 92 within 1 km.

Recommend preserving both provenances and choosing the future RWS record only after stable-identifier or coordinate evidence confirms identity. Never merge by display name alone.

- [ ] **Step 5: Compare representations and make one recommendation**

Measure and document three routes:

1. A separate bounded sampled artifact preserves provider heights, datums, missing values, and unusual extrema exactly.
2. Fitted harmonics reuse the current station schema and the existing `sources/ticon` re-fit path, but lose exact source-copy fidelity and require a held-out validation interval.
3. Online API access fails the offline requirement and inherits a service with no uptime guarantee.

Measure raw and delta-encoded gzip sizes on complete station-years. Fit `ameland.nes`, `hoekvanholland`, and `denhelder.marsdiep` through `packages/harmonic-analysis`, train on January–June 2026, and validate on July–December. Use the repository's existing TCD thresholds as the gate: at least 95% of events matched by type within 60 minutes, mean event-time error below 5 minutes, maximum below 15 minutes, and height RMS below 10 cm. Select the sampled artifact only if the fit misses the gate, and record the measured reason for the decision.

For a sampled result, require a refresh before the supported end date and defined out-of-range behavior. Note that the current database schema and consumers do not support sampled predictions, so implementation remains blocked on a separate format contract.

State that no current reusable harmonic-constant export was found in the catalog or official documentation; provider confirmation remains worthwhile before implementation.

- [ ] **Step 6: Record license evidence and limitations**

Link the official Waterdata page and quote its meaning without reproducing long text: WaterWebservices content is under CC0 unless a component states an exception. Conclude that the selected API responses permit commercial offline redistribution, subject to rechecking for endpoint-specific exceptions at import time. Preserve Rijkswaterstaat attribution and provenance voluntarily.

Also record fair-use limits, the 160,000-observation request cap, lack of uptime guarantee, fixed coverage horizon, native vertical references, and the need to preserve double extrema at Hoek van Holland and Den Helder.

- [ ] **Step 7: Verify and commit the audit**

Run:

```bash
npx prettier --check sources/rws/README.md
git diff --check
git diff -- sources/rws/README.md
```

Expected: Prettier and whitespace checks pass; the README contains every spec deliverable and does not imply that proximity alone proves station identity.

Commit:

```bash
git add sources/rws/README.md
git commit -m "docs: audit Rijkswaterstaat tide data"
```
