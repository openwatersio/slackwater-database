# Rijkswaterstaat source audit design

## Goal

Decide whether Rijkswaterstaat astronomical tide data is suitable for commercial offline redistribution and recommend one offline representation for issue #152. This milestone produces evidence and a recommendation, not an importer or database-format change.

## Deliverable

Add `sources/rws/README.md` containing:

- current CC0 reuse evidence and the URLs that establish it;
- the exact catalog request, retrieval date, and response checksum;
- eligible astronomical-height and high/low-event location counts, separated from the full water-management catalog;
- identifiers, coordinates and CRS, units, vertical references, timestamp behavior, quality fields, and observed date bounds;
- overlap with TICON using coordinates and provider evidence rather than names alone;
- comparison of provider samples, derived harmonics, and online access;
- a single recommended offline representation, estimated artifact size, refresh requirements, limitations, and remaining blockers.

The README will include enough request detail to repeat the audit without committing the multi-megabyte live catalog response or adding a one-use audit program.

## Evaluation

Use the current `ddapi20-waterwebservices.rijkswaterstaat.nl` catalog and observation endpoints documented by Rijkswaterstaat. Select only `WATHTE` records whose process type is `astronomisch`, and use `GETETBRKD2` or `GETETBRKDMSL2` for paired extrema. Keep NAP and MSL distinct.

Compare eligible locations with committed TICON station data by distance, then inspect provider identifiers and coordinates for ambiguous matches. Report proximity counts as audit evidence, not as an automatic deduplication rule.

Estimate sampled-artifact size from the observed cadence, eligible station count, and supported future interval. Harmonic fitting is only recommended if no bounded sampled format can meet the consumer requirement; it must be described as derived and would require held-out validation in a later milestone.

## Verification

Cross-check catalog joins and sample responses for both NAP and MSL stations. Inspect ordinary and double-extrema locations. Verify fixed-offset timestamp behavior across daylight-saving dates and confirm future cutoffs with bounded requests. Format-check the documentation.

## Out of scope

No importer, schema, generated data, consumer changes, full-catalog snapshot, harmonic fit, publication, or API load test.
