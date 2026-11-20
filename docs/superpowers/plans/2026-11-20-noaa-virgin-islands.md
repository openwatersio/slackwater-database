# NOAA Virgin Islands mapping

**Goal:** Resolve the 26 researched NOAA records to Q11703/VI in the isolated country diagnostic, retaining source spelling and evidence. Research: https://github.com/openwatersio/c5y-n8r/issues/148.

**Approach:** Keep contextual normalization in the consumer. Match the exact stored country, NOAA source name and one of the 26 researched station IDs before looking up United States Virgin Islands. Retain per-station benchmark and API URLs, retrieval times and hashes in a compact evidence file. Context-free and unknown-provider/station inputs remain unresolved. The production geocoder originally has the VI code before choosing the legacy display name; preserving that ISO identity is preferable to a station-ID table for production. This table is diagnostic-only. A worldwide library alias would erase the geographic distinction; importer/data changes would prematurely activate the production migration.

**Scope:** The Node report mapping and grouping, diagnostic tests and its documentation. No production importer, source record, country binary or root dependency changes. The report groups by original input, interpreted value and namespace so mixed provider contexts cannot inherit a neighbor's mapping. Raw input totals stay distinct from comparison groups.

- [x] Add a failing contextual lookup and report regression covering all 26 station IDs and unknown/missing/wrong provider context.
- [x] Implement the bounded mapping and preserve evidence alongside original input in reports.
- [x] Run the standalone diagnostic checks, formatter, root checks as applicable and regenerate coverage.
- [x] Run Open Waters review, fix confirmed findings, update PR419 and link the implementation from issue148.
