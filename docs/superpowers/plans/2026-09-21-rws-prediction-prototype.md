# RWS Sampled-Prediction Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and measure a private 30-day, all-station FlatBuffers prototype for Rijkswaterstaat astronomical heights and published extrema.

**Architecture:** Add one provisional, size-prefixed FlatBuffers companion format beside the existing database format, with an internal builder and caller-provided-byte reader. Keep RWS catalog/observation parsing in one source-owned CLI that caches exact responses under `tmp/`, validates the complete run, writes the artifact atomically, and prints the measurements used to update the audit README.

**Tech Stack:** TypeScript, FlatBuffers 25.9.23, Node.js 24 standard library, Vitest, Rijkswaterstaat WaterWebservices JSON API

**Spec:** `docs/superpowers/specs/2026-09-21-rws-prediction-prototype-design.md`

## Global Constraints

- Keep the prototype internal: do not export it from `packages/database/src/index.ts` or add it to package exports.
- Add no package and no dependency; use the installed `flatbuffers` package and Node.js standard library.
- Use `2026-07-01T00:00:00.000Z` through `2026-07-31T00:00:00.000Z` as the measured 30-day interval and project the two-year target interval `2025-01-01T00:00:00.000Z` through `2027-01-01T00:00:00.000Z`.
- Discover every catalog row with `Grootheid.Code = WATHTE` and `ProcesType = astronomisch`; select `GETETBRKD2` for NAP events and `GETETBRKDMSL2` for MSL events when that grouping exists.
- Preserve EPSG:4258 coordinates, native `NAP`/`MSL` datum, integer-centimeter heights, explicit timestamp offsets converted to UTC, provider event order, and open-ended event type strings.
- Encode a station only after its full height series and optional extrema stream pass validation; a failed or partial run must not replace the last valid artifact.
- Store downloads, cache entries, temporary output, and the generated prototype artifact under ignored `tmp/`; commit no generated FlatBuffers accessors or RWS data.
- Keep one companion file only when projected gzip transfer is at most 8 MB. A projection above 8 MB and at most 10 MB requires a full-window measurement; above 10 MB selects per-station shards in a later design and implementation cycle.

## Review Focus

- A size-prefixed buffer with the right magic but a forged length must fail at open time rather than exposing partial data; Task 1 tests both shorter and longer declared lengths.
- A missing height must not be confused with a real zero-centimeter height; Task 1 asserts both values at adjacent indexes.
- Two inclusive source chunks that share a timestamp must deduplicate exactly one identical boundary sample and reject conflicting values; Task 2 tests both cases.
- A quality-99 gap may differ in quality code but no other per-value metadata; Task 2 tests a valid gap and a status change on a gap.
- A successful cache replay must verify the cached response checksum before parsing; Task 3 corrupts a cached response and expects the run to fail without replacing the artifact.

---

### Task 1: Add the private companion binary contract

**Files:**

- Create: `schemas/rws-predictions.fbs`
- Modify: `packages/database/scripts/generate-database.ts`
- Create: `packages/database/src/rws-predictions/types.ts`
- Create: `packages/database/src/rws-predictions/builder.ts`
- Create: `packages/database/src/rws-predictions/reader.ts`
- Create: `packages/database/test/rws-predictions.test.ts`

**Interfaces:**

- Consumes: `flatbuffers.Builder`, generated `NeapsRws` accessors, and normalized `RwsPredictionsInput` values.
- Produces: `buildRwsPredictions(input: RwsPredictionsInput): Uint8Array` and `openRwsPredictions(bytes: Uint8Array): RwsPredictionsReader` for Tasks 2 and 3.
- Produces: `RwsStationInput`, `RwsEventInput`, `RwsSourceMetadata`, and `RwsPredictionsInput` as the source probe's normalized boundary.

- [ ] **Step 1: Add the provisional schema and generate accessors**

Create `schemas/rws-predictions.fbs` with this exact model:

```fbs
namespace NeapsRws;

enum Datum : ubyte { NAP = 0, MSL = 1 }

table SourceMetadata {
  quality_code: string (required);
  status: string (required);
  commissioning_organization: string (required);
  sampling_height: int;
  reference_plane: string (required);
}

struct Event {
  timestamp_ms: long;
  type_index: ushort;
  height_cm: short;
}

table Station {
  id: string (key, required);
  name: string (required);
  latitude: double;
  longitude: double;
  datum: Datum;
  tcdb_station_id: string;
  start_ms: long;
  cadence_seconds: uint;
  heights_cm: [short] (required);
  missing: [ubyte] (required);
  source_metadata: SourceMetadata (required);
  events: [Event];
}

table Root {
  format_major: ushort;
  dataset_version: string (required);
  retrieved_at_ms: long;
  catalog_request: string (required);
  catalog_sha256: string (required);
  source_url: string (required);
  license_url: string (required);
  supported_start_ms: long;
  supported_end_ms: long;
  refresh_after_ms: long;
  event_types: [string] (required);
  stations: [Station] (required);
}

root_type Root;
file_identifier "RWSP";
```

Do not set `file_extension`; the prototype deliberately leaves that public choice open.

In `packages/database/scripts/generate-database.ts`, invoke `flatc --ts` for both `database.fbs` and `rws-predictions.fbs`. Replace the two-directory import-rewrite loop with a recursive `readdirSync(dir, { withFileTypes: true })` walk so every generated `.ts` file under `src/generated/fbs/` changes `.js'` imports to `.ts'`, including the new namespace directory.

Run:

```bash
rtk npm run generate -w packages/database
```

Expected: PASS; `packages/database/src/generated/fbs/neaps-rws.ts` exists under the ignored generated directory, and the normal `neaps.tcdb` generation still completes.

- [ ] **Step 2: Define the normalized input contract**

Create `packages/database/src/rws-predictions/types.ts`:

```ts
export type RwsDatum = "NAP" | "MSL";

export type RwsSourceMetadata = {
  qualityCode: string;
  status: string;
  commissioningOrganization: string;
  samplingHeight: number;
  referencePlane: string;
};

export type RwsEventInput = {
  timestampMs: number;
  type: string;
  heightCm: number;
};

export type RwsStationInput = {
  id: `rws/${string}`;
  name: string;
  latitude: number;
  longitude: number;
  datum: RwsDatum;
  tcdbStationId?: string;
  startMs: number;
  cadenceSeconds: 600;
  heightsCm: (number | null)[];
  sourceMetadata: RwsSourceMetadata;
  events: RwsEventInput[];
};

export type RwsPredictionsInput = {
  formatMajor: 1;
  datasetVersion: string;
  retrievedAtMs: number;
  catalogRequest: string;
  catalogSha256: string;
  sourceUrl: string;
  licenseUrl: string;
  supportedStartMs: number;
  supportedEndMs: number;
  refreshAfterMs: number;
  stations: RwsStationInput[];
};
```

The live probe leaves `tcdbStationId` absent because the audit found proximity, not a provider crosswalk.

- [ ] **Step 3: Write the failing round-trip and reader-boundary tests**

In `packages/database/test/rws-predictions.test.ts`, define a two-station fixture. Use one NAP station with heights `[0, null, 17]`, ordinary `hoogwater`/`laagwater` events plus a third `dubbel-laagwater` event, and one MSL station. Give both stations the same start and 600-second cadence but different coordinates and source metadata.

Add tests that call the desired API:

```ts
const bytes = buildRwsPredictions(input);
const db = openRwsPredictions(bytes);

expect(db.formatMajor).toBe(1);
expect(db.datasetVersion).toBe("fixture-v1");
expect(db.station("rws/nap")?.datum).toBe("NAP");
expect(db.station("rws/msl")?.datum).toBe("MSL");
expect(db.station("rws/nap")?.height(0)).toBe(0);
expect(db.station("rws/nap")?.height(1)).toBeNull();
expect(db.station("rws/nap")?.endMs).toBe(
  input.stations[0]!.startMs + 3 * 600_000,
);
expect(db.station("rws/nap")?.events()).toEqual(input.stations[0]!.events);
expect(db.station("rws/missing")).toBeUndefined();
expect(buildRwsPredictions(input)).toEqual(bytes);
```

Also assert that the keyed result exposes its id, name, EPSG:4258 coordinates, optional tcdb id, station-level source metadata, start, end, cadence, and sample count.

Run:

```bash
rtk npm run test -w packages/database -- rws-predictions.test.ts
```

Expected: FAIL because `builder.ts` and `reader.ts` do not exist.

- [ ] **Step 4: Implement the deterministic builder**

Create `packages/database/src/rws-predictions/builder.ts` with:

```ts
export function buildRwsPredictions(input: RwsPredictionsInput): Uint8Array;
```

Implement only these operations:

1. Copy and sort stations by ASCII `id`; reject empty/non-`rws/` ids and adjacent duplicates.
2. Validate root millisecond values as safe integers, require `formatMajor === 1`, non-empty provenance strings, `supportedStartMs < supportedEndMs`, and `refreshAfterMs <= supportedEndMs`.
3. Validate coordinates as finite numbers, cadence as exactly 600, non-empty samples, every present height as an integer in `[-32768, 32767]`, and every event timestamp/height as safe-integer/int16 values. Require event timestamps to be nondecreasing so provider order is retained without sorting.
4. Build a lexically sorted, deduplicated event-type table across all stations. Reject more than 65,536 distinct values because `type_index` is a `ushort`.
5. Encode each null height as zero in `heights_cm` and set its bit in `missing`, where sample `i` uses `missing[i >> 3] & (1 << (i & 7))`.
6. Build events as FlatBuffers structs, station metadata once per station, station tables in sorted-id order, and the root metadata.
7. Finish with `builder.finish(root, "RWSP", true)` so the first four bytes carry the payload length and return `builder.asUint8Array()`.

Do not add an interface, factory, compression layer, or public export.

- [ ] **Step 5: Implement the caller-provided-byte reader**

Create `packages/database/src/rws-predictions/reader.ts`. Export the concrete classes `RwsPredictionsReader` and `RwsStationReader` plus:

```ts
export function openRwsPredictions(bytes: Uint8Array): RwsPredictionsReader;
```

At open time:

1. Require at least 12 bytes.
2. Read the little-endian uint32 size prefix and require it to equal `bytes.length - 4`.
3. Require bytes 8–11 to decode as `RWSP`.
4. Call `Root.getSizePrefixedRootAsRoot(new flatbuffers.ByteBuffer(bytes))` inside a `try` block and translate parsing failures to `Error("Invalid RWS predictions buffer: ...")`.
5. Require `formatMajor() === 1` before returning the wrapper.

Expose root metadata as readonly scalar properties. Implement `station(id)` with generated `stationsByKey(id)` and return `undefined` on a miss. `RwsStationReader` exposes readonly station identity/bounds/source properties, `height(index): number | null`, and `events(): RwsEventInput[]`. Both height and event-type indexes must be checked before access and throw `RangeError` with the station id and bad index.

Run:

```bash
rtk npm run test -w packages/database -- rws-predictions.test.ts
```

Expected: PASS for the round-trip, keyed lookup, missing-versus-zero, event order, station metadata, bounds, and deterministic-output assertions.

- [ ] **Step 6: Write failing corruption and builder-validation tests**

Add one table-driven test for these invalid inputs: duplicate station id, cadence 300, out-of-int16 height, out-of-int16 event height, descending event timestamp, unsafe root timestamp, and 65,537 event types. Match the station id and violated field in each error.

Add reader tests that clone valid bytes and independently mutate:

- magic byte 8;
- format-major scalar through the generated root accessor's byte buffer position;
- size prefix to `bytes.length - 5`;
- size prefix to `bytes.length - 3`;
- an event type index past the string-table length;
- a height access at `-1` and at `sampleCount`.

Run:

```bash
rtk npm run test -w packages/database -- rws-predictions.test.ts
```

Expected: FAIL on the first missing validation rather than on fixture construction.

- [ ] **Step 7: Add only the missing validations and rerun the package tests**

Add the smallest checks needed for Step 6. Keep validation in the builder for normalized input and in the reader for untrusted bytes; do not duplicate source-response validation here.

Run:

```bash
rtk npm run test -w packages/database -- rws-predictions.test.ts
rtk npm run test -w packages/database
```

Expected: PASS; the focused file and all database package tests are green.

- [ ] **Step 8: Commit the binary contract**

```bash
rtk git add schemas/rws-predictions.fbs packages/database/scripts/generate-database.ts packages/database/src/rws-predictions packages/database/test/rws-predictions.test.ts
rtk git commit -m "feat: prototype RWS prediction format"
```

---

### Task 2: Normalize and validate RWS catalog responses

**Files:**

- Create: `sources/rws/prototype.ts`
- Modify: `packages/database/test/rws-predictions.test.ts`

**Interfaces:**

- Consumes: unknown JSON from RWS catalog and observation endpoints.
- Consumes: `RwsStationInput` and `RwsEventInput` from Task 1.
- Produces: `discoverRwsSeries(catalog: unknown): RwsSeries[]`, `normalizeHeightChunks(series, chunks, bounds): RwsStationInput`, and `normalizeEvents(series, response, bounds): RwsEventInput[]` for Task 3.

- [ ] **Step 1: Write failing synthetic source-normalization tests**

Extend `packages/database/test/rws-predictions.test.ts` with inline fixture builders that use the real Dutch response field names observed in the audit. Cover:

- one NAP and one MSL catalog join selected by message id;
- unrelated quantities and non-astronomical process rows ignored;
- stable ids `rws/<Locatie.Code>` and original provider names/coordinates;
- explicit `+01:00` timestamps parsed with `Date.parse`, so `2026-07-01T01:00:00+01:00` becomes `2026-07-01T00:00:00.000Z`;
- two inclusive height chunks sharing one identical boundary sample, producing one sample at that instant;
- quality `99` producing `null` while a neighboring zero remains `0`;
- station-level metadata copied from the first present value;
- NAP choosing `GETETBRKD2` and MSL choosing `GETETBRKDMSL2`;
- event type and height channels paired by exact timestamp while preserving `hoogwater`, `laagwater`, and an unknown `dubbel-laagwater` in provider order.

Run:

```bash
rtk npm run test -w packages/database -- rws-predictions.test.ts
```

Expected: FAIL because `sources/rws/prototype.ts` does not exist.

- [ ] **Step 2: Implement the minimal catalog and observation normalizers**

Create `sources/rws/prototype.ts` with these exported types and functions:

```ts
export type RwsSeries = {
  code: string;
  name: string;
  latitude: number;
  longitude: number;
  datum: "NAP" | "MSL";
  heightMetadataId: string;
  eventGrouping?: "GETETBRKD2" | "GETETBRKDMSL2";
};

export function discoverRwsSeries(catalog: unknown): RwsSeries[];
export function normalizeHeightChunks(
  series: RwsSeries,
  chunks: unknown[],
  bounds: { startMs: number; endMs: number },
): RwsStationInput;
export function normalizeEvents(
  series: RwsSeries,
  response: unknown,
  bounds: { startMs: number; endMs: number },
): RwsEventInput[];
```

Use small assertion helpers (`record`, `array`, `string`, `number`) at the JSON trust boundary. Join `AquoMetadataLijst`, `LocatieLijst`, and `AquoMetadataLocatieLijst` by their message ids. Sort discovered series by provider code only after rejecting duplicates. Do not add a generic schema framework.

For height chunks, flatten provider order, parse every timestamp with `Date.parse`, and deduplicate only an adjacent boundary whose timestamp, value, missing state, and metadata are identical. Then require:

- datum equals the catalog series datum;
- first timestamp equals `bounds.startMs`, last raw timestamp equals the API's inclusive `bounds.endMs`, and every following timestamp advances exactly 600,000 ms; after validation, omit the terminal sample at `bounds.endMs` so the encoded station remains start-inclusive and end-exclusive;
- no duplicate remains after boundary deduplication;
- present values and event heights are integer centimeters in int16 range;
- quality code `99` is the only missing marker;
- at least one sample is present, and station-level metadata comes from the first present sample;
- quality, status, commissioning organization, sampling height, and reference plane are constant, except quality may switch between the ordinary code and `99`;
- both event channels exist, have equal lengths, and have exactly equal timestamps at every index; validate the closed API response bounds, then omit an event exactly at `bounds.endMs` from the encoded end-exclusive interval.

Return no `tcdbStationId`. Leave the `events` array empty until `normalizeEvents` returns its paired events.

Guard CLI execution with an `import.meta.url`/`pathToFileURL(process.argv[1])` comparison so importing the module in Vitest has no network or filesystem side effects.

- [ ] **Step 3: Run the successful normalization tests**

```bash
rtk npm run test -w packages/database -- rws-predictions.test.ts
```

Expected: PASS for catalog selection, UTC conversion, boundary deduplication, missing bitmap input, both datums, event pairing, and open-ended event types.

- [ ] **Step 4: Write failing rejection tests**

Add table-driven fixture mutations for:

- unknown datum and response datum different from catalog datum;
- quality other than the ordinary station code or `99`;
- an all-quality-99 station with no present sample from which to establish station metadata;
- changed status, commissioning organization, sampling height, or reference plane, including on a quality-99 sample;
- conflicting values at a shared chunk boundary;
- duplicate non-boundary timestamps;
- 5-minute or 20-minute cadence;
- height outside int16;
- missing event type channel, missing event height channel, unequal channel length, and mismatched timestamps;
- duplicate catalog location code.

Run:

```bash
rtk npm run test -w packages/database -- rws-predictions.test.ts
```

Expected: FAIL on the first absent rejection with an error that names the station and violated condition.

- [ ] **Step 5: Add the rejection paths and verify root TypeScript**

Add the smallest explicit checks needed by Step 4. Do not recover from invalid provider data and do not add per-value metadata overrides.

Run:

```bash
rtk npm run test -w packages/database -- rws-predictions.test.ts
rtk tsc -p tsconfig.node.json
```

Expected: PASS; the source probe and database tests type-check under strict settings.

- [ ] **Step 6: Commit source normalization**

```bash
rtk git add sources/rws/prototype.ts packages/database/test/rws-predictions.test.ts
rtk git commit -m "feat: validate RWS prediction responses"
```

---

### Task 3: Fetch, cache, build, and measure atomically

**Files:**

- Modify: `sources/rws/prototype.ts`
- Modify: `packages/database/test/rws-predictions.test.ts`

**Interfaces:**

- Consumes: Task 2 normalizers and Task 1 `buildRwsPredictions`/`openRwsPredictions`.
- Produces: `runRwsPrototype(options: PrototypeOptions): Promise<PrototypeMeasurements>` and a CLI that writes `tmp/rws/rws-predictions.rwsp` only after all 114 height stations validate.

- [ ] **Step 1: Write failing orchestration, cache, and atomic-output tests**

Use `mkdtemp`, `readFile`, and `rm` from `node:fs/promises` with a fake `fetch` implementation backed by the two-station fixtures. Define the desired options:

```ts
export type PrototypeOptions = {
  fetch: typeof fetch;
  cacheDir: string;
  outPath: string;
  startMs: number;
  endMs: number;
  targetStartMs: number;
  targetEndMs: number;
  nowMs: number;
};

export type PrototypeMeasurements = {
  measured: {
    startMs: number;
    endMs: number;
    stationCount: number;
    napStationCount: number;
    mslStationCount: number;
    sampleCount: number;
    eventCount: number;
    encodedBytes: number;
    gzipBytes: number;
    bytesPerStation: number;
    bytesPerSample: number;
    independentStationGzipBytes: number;
    buildMilliseconds: number;
    lookupMicroseconds: number;
  };
  projected: {
    startMs: number;
    endMs: number;
    sampleCount: number;
    rawBytes: number;
    gzipBytes: number;
    gate: "one-file" | "full-window-required" | "shards-required";
  };
};
```

Test that a successful run:

- requests the catalog once, each height station once, and only the matching event grouping that exists;
- writes one cache file per request containing `{ fetchedAtMs, url, body, sha256, responseText }`;
- creates a readable final companion file with both stations;
- leaves no temporary output file;
- reports station count, sample count, encoded bytes, whole-file gzip bytes, bytes per station, bytes per sample, sum of independently gzipped one-station files, two-year projected raw/gzip bytes, build milliseconds, and keyed lookup microseconds.

Then run the same options with a fetch that throws and expect zero network calls because the verified cache is used. Corrupt one cache entry's `responseText` without changing its checksum and expect rejection. Pre-create `outPath` with `known-good`, inject an HTTP 500 for one station, and assert the bytes remain `known-good` with no temporary output left behind.

Run:

```bash
rtk npm run test -w packages/database -- rws-predictions.test.ts
```

Expected: FAIL because `runRwsPrototype` is not implemented.

- [ ] **Step 2: Implement exact-response caching and bounded requests**

Add `fetchCachedJson(url, body, options)` in `sources/rws/prototype.ts`:

1. Canonicalize the request as `JSON.stringify({ url, body })` and use its SHA-256 as the cache filename.
2. On a cache hit, parse the wrapper, recompute SHA-256 over `responseText`, require equality, then parse `responseText` as JSON and return the wrapper's `fetchedAtMs` with it.
3. On a miss, issue a POST with `content-type: application/json`, require status 200, read exact text, require non-empty valid JSON, and atomically rename a temporary cache wrapper with `fetchedAtMs: options.nowMs` into place.
4. Include the request body and exact response checksum in every wrapper. Do not add retries or parallel requests to this prototype.

`runRwsPrototype` fetches the catalog, discovers all eligible height stations, then processes stations sequentially. Use one inclusive 30-day height request per station because 4,321 values is far below the documented 160,000-observation limit. Fetch the datum-specific event grouping only when present. Reject an empty response, an HTTP error, a station missing from the response, or a final discovered/built station count mismatch.

- [ ] **Step 3: Implement atomic build and measurements**

After every station validates:

1. Build a root input with format major 1, source/license URLs from the audit, catalog request JSON and SHA-256, the fixed measured bounds, `refreshAfterMs = supportedEndMs`, dataset version `rws-prototype-2026-07`, and `retrievedAtMs` equal to the latest `fetchedAtMs` among the verified cache entries used by the run.
2. Time `buildRwsPredictions` with `performance.now()`.
3. Open the result and time 1,000 keyed lookups of the middle sorted station; divide elapsed time into microseconds per lookup and assert the id matches.
4. Measure `gzipSync(bytes, { level: 9 }).length` for the complete 30-day prototype. Also build each station as a one-station file and sum `gzipSync(singleStationBytes, { level: 9 }).length` for the conservative projection.
5. Project two-year raw bytes as measured encoded bytes per sample times the target sample count. Project gzip bytes as the summed independent-station gzip bytes times `(targetEndMs - targetStartMs) / (endMs - startMs)`; this intentionally repeats station/container overhead for every 30-day block. Report the formulas and keep measured/projection labels distinct.
6. Write the complete bytes to `${outPath}.tmp-${process.pid}`, rename to `outPath`, and remove the temporary file in a `finally` block. Never unlink or truncate the old `outPath` before rename.

The CLI calls `runRwsPrototype` with global `fetch`, cache `tmp/rws/cache`, output `tmp/rws/rws-predictions.rwsp`, the fixed intervals from Global Constraints, and `Date.now()`. Print `PrototypeMeasurements` as stable, pretty JSON followed by exactly one gate result: `one-file`, `full-window-required`, or `shards-required` using the 8/10 MB thresholds.

- [ ] **Step 4: Run focused and full tests**

```bash
rtk npm run test -w packages/database -- rws-predictions.test.ts
rtk npm test
```

Expected: PASS; all repository tests are green and the corruption/partial-response tests preserve the pre-existing artifact.

- [ ] **Step 5: Commit the runnable prototype**

```bash
rtk git add sources/rws/prototype.ts packages/database/test/rws-predictions.test.ts
rtk git commit -m "feat: build RWS prediction prototype"
```

---

### Task 4: Run the all-station measurement and record the gate

**Files:**

- Modify: `sources/rws/README.md`

**Interfaces:**

- Consumes: the Task 3 CLI, live RWS responses, and its `PrototypeMeasurements` JSON.
- Produces: the measured one-file/full-window/shards decision for issue #152; no committed artifact.

- [ ] **Step 1: Run the live 30-day all-station prototype**

Run:

```bash
rtk node --experimental-transform-types sources/rws/prototype.ts
```

Expected: the command discovers 114 height stations, validates each available matching event grouping, writes only under `tmp/rws/`, prints measured/projection JSON, and ends with one gate result. If current catalog counts differ, stop: update the audit evidence and design before changing a test to accept silent source drift.

- [ ] **Step 2: Verify cache replay and artifact determinism**

Run the same command again without deleting `tmp/rws/cache`, then compare the artifact SHA-256 from both runs.

Expected: the second run uses verified cache entries and produces the same artifact bytes because `nowMs`, dataset version, and retrieved time are read from cached request metadata rather than the wall clock after the first successful fetch.

- [ ] **Step 3: Record measured results and decision**

Replace the README's “Follow-up prototype” language with a “Prototype measurement” section containing the exact emitted values for:

- measured interval and two-year target interval;
- station/sample/event counts split by NAP/MSL where emitted;
- encoded bytes, whole-file gzip bytes, bytes per station, and bytes per sample;
- summed independent-station gzip bytes;
- projected two-year raw and gzip bytes with the stated formula;
- build time and keyed lookup time;
- the selected one-file/full-window/shards gate and its threshold.

Keep measured values and projections in separate table rows. State that the file under `tmp/` is experimental and uncommitted and that public API, extension, release automation, and full-window import remain out of scope.

- [ ] **Step 4: Verify formatting, generation, types, and the full suite**

Run:

```bash
rtk npm run generate -w packages/database
rtk npm run lint
rtk npm test
rtk git diff --check
rtk git status --short
```

Expected: generation, Prettier, TypeScript, and all tests pass; Git shows only the planned source/schema/test/docs files and no `tmp/` or generated accessors.

- [ ] **Step 5: Commit the measurement report**

```bash
rtk git add sources/rws/README.md
rtk git commit -m "docs: measure RWS prediction prototype"
```
