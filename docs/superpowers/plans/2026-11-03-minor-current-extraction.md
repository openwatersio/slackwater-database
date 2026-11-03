# Minor current extraction plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task.

**Goal:** Carry NOAA minor-axis harmonics, mean flow, and azimuth through extraction, the database builder, and TypeScript/Swift readers for Slackwater's vector predictor.

**Architecture:** Preserve every published usable minor-axis constituent without an amplitude cutoff. Append optional FlatBuffers fields and keep both axes' vectors in the prediction-data region. Optional scalar fields distinguish absent values from measured zero, including when reading older databases.

**Scope:** Data follow-up to openwatersio/slackwater#434 and engine PR #502. No release dispatch, subordinate-model changes, Type-W extraction, or vector UI.

## Constraints

- Preserve station/bin identity, major-axis values, source precision, and measured zeros. Only NOAA's explicit undetermined marker is missing.
- Match engine fields: `current.minor_constituents`, `current.minor_mean_flow`, and `current.azimuth`.
- Older readers ignore appended fields; newer readers return absence for older files.
- Keep constituent name indexing correct for names appearing only on the minor axis.
- Keep minor constituents behind station identity tables so scans do not fault in prediction pages.
- Keep the cross-flow census diagnostic; a major-axis approximation threshold does not reject a two-axis model.

## Tasks

- [x] Add failing extractor tests for precision, small/zero amplitudes, mean flow, azimuth, exact depth bins, and absent/invalid metadata.
- [x] Implement extraction and update source types, schema, and validation.
- [x] Add failing catalogue and database round-trip tests, including zero versus absent scalars, minor-only names, old files, and physical layout.
- [x] Append fields to the FlatBuffers schema; update the builder, TypeScript reader and station input conversion.
- [x] Update Swift's reader and fixtures; regenerate committed accessors and verify backward compatibility.
- [x] Capture NOAA harmonic data for the existing 884 records and report major-axis differences before updating the reviewed bundle.
- [x] Measure raw/compressed bundle and database sizes and compare station identities and major-axis prediction inputs.
- [x] Run the repository check, published-URL validation, Swift suite, generation drift check, and a database-to-vector-engine smoke check using PR #502.
- [x] Run Open Waters review, verify findings, and commit the reviewed result.

## Verification

- The 884 exact-bin captures match the existing major constants, major mean flow, and azimuth. All 2,586 source records preserve their previous fields, including the 1,702 subordinate records.
- There are 21,185 usable minor pairs across 870 records. Fourteen records contain only undetermined minor pairs; their published zero mean remains zero and the engine retains its scalar fallback.
- The production TCDB is 10,328,008 bytes, or 5,103,237 bytes gzipped (2.8% growth). The worker bundle is 6,981,331 bytes gzipped, with 358,701 bytes below its 7 MiB guard.
- The full repository check with one worker passes. Follow-up checks pass all 81 NOAA source tests, 32 catalogue/routing tests, TypeScript checks, and published-path validation. All 20 Swift tests pass against fixtures and the production file; schema conformance and Swift regeneration checks pass.
- The previous reader returns identical values for all 12,396 stations. The #502 consumer comparison covers 48 NOAA samples with maximum magnitude error 0.091 knots and bearing error 3.41 degrees for samples at or above 0.75 knots; signed speeds and events are unchanged.
- Three Open Waters review rounds completed. The PR records verified fixes, dismissed findings, reviewer limits, and the deferred eager minor-array decoding on current metadata reads.
