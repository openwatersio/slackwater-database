# RWS sampled-prediction prototype design

## Goal

Prototype an opt-in FlatBuffers companion file for Rijkswaterstaat astronomical heights and high/low-water events. Use real source samples to decide whether one companion file is practical before fixing the public extension, schema, or API.

The prototype is successful when it proves the data model, validates keyed reads, and produces an evidence-based raw and HTTP-compressed size projection for the supported interval. It does not publish an artifact.

## Why a companion file

The existing `neaps.tcdb` is an 8.4 MiB harmonic/current station database, and the worker bundle already has a constrained size budget. The sampled heights require roughly 24 MB raw and project to 3.9–4.7 MB after delta encoding and gzip. Adding them to `.tcdb` would still make every existing consumer pay for optional, time-bounded data that cannot use the current harmonic prediction path.

A companion file keeps `.tcdb` and its API compatible. Consumers opt in by supplying bytes from a file, fetch, or platform asset. Native clients can memory-map those bytes, while browser and Worker clients can fetch or bind the artifact without inlining it in the package bundle.

## Prototype boundary

The prototype adds an experimental FlatBuffers schema, internal TypeScript builder/reader code, a source probe, and tests. None of these are public package exports. Generated artifacts and downloaded RWS responses stay under `tmp/` and outside Git.

Use a 30-day interval across every available catalog-eligible height location rather than downloading the full multi-year JSON source during format evaluation. The current catalog links 114 locations, but 15 audited locations return HTTP 204 for the complete interval, leaving 99 measured stations. Keep those 15 codes as an explicit prototype allowlist so a newly missing location still fails closed. This exercises both datums and the extrema shape while respecting the service's fair-use guidance. The synthetic fixture covers missing values when the live interval does not contain them. Project full-interval size from encoded bytes per sample and from independently compressed station data.

## File model

The provisional schema uses its own namespace, file identifier, and format-major field. The final extension remains undecided.

### Root

The root contains:

- format major and dataset version;
- source retrieval time, catalog request identity, and source/license provenance;
- global supported bounds and `refresh_after`;
- an event-type string table;
- stations sorted and keyed by stable `rws/<location-code>` ID.

The release manifest, not the file, carries the artifact's SHA-256 because a file cannot reliably contain its own checksum.

### Station series

Each station contains:

- stable ID, provider name, EPSG:4258 coordinates, and native datum (`NAP` or `MSL`);
- an optional `.tcdb` station ID only when a provider crosswalk or location history proves the match;
- UTC start, 600-second cadence, and sample count;
- signed 16-bit centimeter heights;
- a bit-packed missing-value bitmap;
- source metadata that is constant for the represented interval;
- ordered published extrema.

The represented interval is start-inclusive and end-exclusive. The end is derived from start, cadence, and sample count. Chunk boundaries from the inclusive RWS API are deduplicated before encoding.

The source audit found no variation in quality code, status, commissioning organization, sampling height, or reference plane across 105,122 samples. Store those values once per station and reject unexpected variation during the prototype. Quality code `99` maps to the missing-value bitmap. Do not add per-sample metadata overrides until source data demonstrates a need.

### Extrema

Each event stores its UTC timestamp, event-type string-table index, and signed centimeter height. Event type remains open-ended so a future RWS classification does not require a format-major change. Events remain in provider order; the format does not assume alternation or a fixed daily count.

## Reader contract

The prototype reader accepts a caller-provided `Uint8Array`. It exposes only:

- format and dataset metadata;
- keyed station lookup;
- station bounds and datum;
- indexed height/missing access and station-level source metadata;
- ordered event access.

It does not fetch, cache, interpolate, extrapolate, merge with `.tcdb`, or expose a tide-prediction API. Wrong magic, unsupported format major, truncated data, and invalid indexes fail explicitly.

## Source probe

The probe discovers eligible series from the live catalog, then fetches the same 30-day UTC interval for every height station and its matching extrema grouping where available. Requests are bounded and cached under `tmp/` with their parameters, HTTP status, and response checksums. HTTP 204 is accepted only for the 15 codes whose absence was confirmed over both a one-day probe and the complete measurement interval; the report preserves the catalog count and their codes.

The probe must reject:

- a changed or unknown datum;
- per-value metadata variation other than quality code `99` marking a gap;
- duplicate timestamps after boundary deduplication;
- a height cadence other than 600 seconds;
- height values outside signed 16-bit centimeters;
- event type and height channels whose timestamps do not pair exactly;
- a partial HTTP response, service error, or newly missing eligible station.

It writes to a temporary path and renames the artifact only after every station passes validation. A failed run cannot replace a valid prototype.

## Measurement gate

Record these measurements in `sources/rws/README.md`:

- station and sample counts;
- measured encoded bytes per station and per sample;
- measured prototype size;
- projected full-interval raw size;
- conservative projected HTTP gzip size, computed from independently compressed station payloads;
- build time;
- keyed lookup time for one station.

Keep one companion file only when compressed transfer is below 10 MB. Accept a 30-day projection only at or below 8 MB, leaving 20% headroom. A projection between 8 MB and 10 MB requires a full-window measurement. A projection above 10 MB selects per-station FlatBuffers shards behind a small manifest. Do not add custom chunking or seekable compression during this prototype.

## Verification

One synthetic fixture covers:

- a present and a missing height;
- station-level source metadata;
- inclusive source chunks sharing a boundary;
- NAP and MSL stations;
- ordinary and unknown event types;
- events that do not follow a four-per-day pattern.

Tests verify builder/reader round-trip, stable keyed lookup, start-inclusive/end-exclusive bounds, missing bitmap behavior, station metadata, event order, wrong-magic and version rejection, truncated input handling, and deterministic output from the same normalized input.

The repository's FlatBuffers generation check, TypeScript tests, lint, and full test suite must pass. The prototype report must distinguish measured results from projections.

## Files

- `schemas/rws-predictions.fbs`: provisional companion schema.
- `packages/database/src/rws-predictions/types.ts`: internal normalized input and reader result types.
- `packages/database/src/rws-predictions/builder.ts`: deterministic FlatBuffers writer.
- `packages/database/src/rws-predictions/reader.ts`: caller-provided-byte reader.
- `packages/database/test/rws-predictions.test.ts`: synthetic contract and failure tests.
- `sources/rws/prototype.ts`: bounded catalog/sample probe and measurement report.
- `sources/rws/README.md`: measured findings and decision gate result.

Generated FlatBuffers accessors follow the repository's existing generated-code convention. No new package or dependency is needed.

## Out of scope

- Public TypeScript or Swift APIs
- Shipping or attaching a companion artifact
- Full-horizon import and refresh automation
- Browser or Worker fetching helpers
- Interpolation or harmonic fitting
- Automatic TICON identity matching
- Changes to `.tcdb`
