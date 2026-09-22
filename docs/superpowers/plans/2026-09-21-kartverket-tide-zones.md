# Kartverket Tide Zones Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve Norwegian positions through Kartverket's official coastal polygons before falling back to nearest-station search, while publishing all source polygons as a GitHub-viewable GeoJSON file.

**Architecture:** Extend the Kartverket importer to generate one normalized GeoJSON `FeatureCollection` containing all 590 source polygons. The TCDB builder reads the 495 supported features into a first-class `TideZone` vector. JavaScript and Swift perform the same bounding-box-prefiltered linear polygon scan, and Neaps applies the zone correction after predicting its referenced station about MSL.

**Tech Stack:** TypeScript, Node.js 24, GeoJSON, FlatBuffers, Vitest, Swift Package Manager, Neaps tide predictor

**Spec:** `docs/superpowers/specs/2026-09-21-kartverket-tide-coverage-design.md`

## Global Constraints

- Complete the Kartverket Stations plan first.
- Work in linked worktrees for both `tide-database` and `neaps`.
- Commit `data/kartverket/tide-zones.geojson` with all 590 polygons; TCDB contains only the 495 computable zones.
- A supported feature has a resolvable `referenceStationId`, finite factor and delay, `MSL`, `CD`, and a valid polygon.
- Unsupported features have `supported: false` and exactly one `exclusionReason`: `missing_reference_station` or `missing_tide_data`.
- Coordinate arrays use GeoJSON longitude-latitude order and closed rings.
- Manual station selection and the exported `nearestStation()` function remain station-only.
- Automatic prediction functions check a containing supported zone first, then use the current nearest-station fallback.
- A positive zone delay produces a later local tide: evaluate the reference at `t - delay`, multiply its MSL height by the factor, then add `zone.datums.MSL - zone.datums[datum]`.
- Position lookup treats an edge as inside; the lowest numeric zone ID wins overlaps; there is no nearest-polygon fallback.
- Keep the linear scan. Add a spatial index only after profiling shows the roughly 5,000-edge scan is a problem.
- Zone validation uses the same 2020-01-01 through 2040-12-31 interval and numerical thresholds as the station plan.

---

### Task 1: Generate the complete GeoJSON zone view

**Repository:** `tide-database`

**Files:**

- Modify: `sources/kartverket/kartverket.ts`
- Modify: `sources/kartverket/import.ts`
- Modify: `sources/kartverket/test/kartverket.test.ts`
- Create: `sources/kartverket/fixtures/tidezones.xml`
- Create: `sources/kartverket/zone-exclusions.json`
- Create: `data/kartverket/tide-zones.geojson`

**Interfaces:**

- Consumes: pinned `tidezones` XML and the 33 imported station IDs.
- Produces: `parseTideZones(xml): KartverketZone[]` and a normalized GeoJSON feature collection used by TCDB and GitHub.

- [ ] **Step 1: Write failing supported and excluded zone tests**

Use small XML samples for a supported zone, a zone whose reference code is absent from the station set, and a zone without tide levels. Assert this exact normalized shape for the supported feature:

```ts
expect(feature).toMatchObject({
  type: "Feature",
  id: 524,
  bbox: [5.430789, 59.401, 5.67129, 59.5431],
  properties: {
    id: 524,
    name: "Stavanger",
    referenceStationCode: "SVG",
    referenceStationId: "kartverket/SVG",
    heightFactor: 0.3,
    delayMinutes: 165,
    chartDatum: "CD",
    supported: true,
  },
  geometry: { type: "Polygon" },
});
expect(feature.geometry.coordinates[0][0]).toEqual(
  feature.geometry.coordinates[0].at(-1),
);
```

Assert unsupported features retain geometry and omit `referenceStationId`.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `rtk npm test -w sources/kartverket`

Expected: FAIL because zone parsing is absent.

- [ ] **Step 3: Implement zone classification and GeoJSON generation**

Keep only `HAT`, `MHWS`, `MHW`, `MHWN`, `NN2000`, `MSL`, `MLWN`, `MLW`, `MLWS`, `LAT`, and `CD` in `properties.datums`. Every feature carries `id`, `name`, raw `referenceStationCode`, optional `observationStationCode`, optional `heightFactor`, optional `delayMinutes`, `revision`, `supported`, and optional `exclusionReason`. Supported features also carry `referenceStationId` and `chartDatum: "CD"`.

Use this collection envelope:

```ts
{
  type: "FeatureCollection",
  attribution: "Tide and water-level data © Kartverket / Norwegian Mapping Authority, Hydrographic Service, licensed under CC BY 4.0.",
  source: "https://www.kartverket.no/en/api-and-data/tides-and-water-level-data",
  license: "https://creativecommons.org/licenses/by/4.0/",
  features: features.sort((a, b) => Number(a.id) - Number(b.id)),
}
```

Do not add a generation timestamp.

- [ ] **Step 4: Extend refresh and generate the committed files**

Add the `tidezones` response to the staged snapshot and manifest. Run:

```sh
rtk npm run refresh -w sources/kartverket
rtk npm run import -w sources/kartverket
```

Expected: 590 GeoJSON features, 495 with `supported: true`, 41 with `missing_reference_station`, and 54 with `missing_tide_data`. `zone-exclusions.json` lists the 95 unsupported IDs, source codes, and reasons sorted by numeric ID.

- [ ] **Step 5: Validate and commit the human-facing artifacts**

Parse the GeoJSON in the test, verify all rings close, all coordinates are finite, all supported references exist, and importing twice is byte-identical.

Commit: `rtk git add sources/kartverket data/kartverket/tide-zones.geojson && rtk git commit -m "Publish Kartverket tide zones as GeoJSON"`

### Task 2: Add TideZone to TCDB

**Files:**

- Modify: `schemas/database.fbs`
- Modify: `packages/database/src/types.ts`
- Modify: `packages/database/package.json`
- Modify: `packages/database/src/database/builder.ts`
- Modify: `packages/database/test/database.test.ts`
- Modify: `packages/database/scripts/generate-database.ts`
- Modify: `packages/stations/load-catalogue.ts`
- Create: `packages/stations/tide-zones.ts`
- Create: `packages/stations/test/tide-zones.test.ts`
- Regenerate: `packages/database/src/generated/fbs/**`
- Regenerate: `packages/swift/Sources/NeapsTideDatabase/generated/database_generated.swift`

**Interfaces:**

- Consumes: supported features from `data/kartverket/tide-zones.geojson`.
- Produces: `TideZoneInput`, a sorted `Root.tide_zones` vector, and generated accessors in TypeScript and Swift.

- [ ] **Step 1: Add failing loader and round-trip tests**

The loader test asserts it returns only supported features and rejects a dangling `referenceStationId`. The database test calls:

```ts
const zones: TideZoneInput[] = [
  {
    id: 524,
    name: "Stavanger",
    reference_station_id: "test/2",
    reference_station_code: "SVG",
    observation_station_code: "SVG",
    height_factor: 0.3,
    delay_minutes: 165,
    datums: { MSL: 0, CD: -0.344, LAT: -0.144 },
    chart_datum: "CD",
    revision: "2026-03-01T00:00:00+01:00",
    bounds: [4.8, 58.7, 5.9, 59.1],
    polygon: [
      [4.8, 58.7],
      [5.9, 58.7],
      [5.9, 59.1],
      [4.8, 58.7],
    ],
    source: identity.source,
    license: identity.license,
  },
];
const db = openDatabase(buildDatabase(inputs, { zones }));
expect(db.tideZonesLength()).toBe(1);
expect(db.tideZones(0)!.id()).toBe(524);
expect(db.tideZones(0)!.referenceStationId()).toBe("test/2");
```

- [ ] **Step 2: Extend the FlatBuffers schema**

Add:

```fbs
struct GeoPoint { longitude: double; latitude: double; }
struct GeoBounds { min_longitude: double; min_latitude: double; max_longitude: double; max_latitude: double; }

table TideZone {
  id: uint (key);
  name: string (required);
  reference_station_id: string (required);
  reference_station_code: string (required);
  observation_station_code: string;
  height_factor: float;
  delay_minutes: int;
  datums: [Datum];
  chart_datum: string (required);
  revision: string;
  bounds: GeoBounds;
  polygon: [GeoPoint];
  source: Source;
  license: License;
}
```

Append `tide_zones:[TideZone]` to `Root` so existing field ordinals remain stable.

- [ ] **Step 3: Implement the GeoJSON loader and builder input types**

Export `TideZoneInput` with the exact snake-case fields used in the test. `loadKartverketTideZones(root)` parses the GeoJSON, selects `supported: true`, converts properties and coordinates, and rejects missing station references. Return zones sorted by numeric ID.

- [ ] **Step 4: Serialize zones without disturbing station locality**

Change the builder signature to:

```ts
buildDatabase(stations, { version, routes, zones = [] });
```

Write polygon and datum vectors with other prediction data before station identity tables, then write zone tables in one contiguous phase. Reject duplicate IDs, fewer than four ring coordinates, non-closed rings, invalid bounds, non-finite factors, and dangling station references.

- [ ] **Step 5: Regenerate accessors and run focused tests**

Set the database package's minor version to `0.10.0`, reflecting the additive TCDB and public API fields.

Run: `rtk npm run generate -w packages/database`

Run: `rtk ./packages/swift/generate`

Run: `rtk npm test -w packages/database -w packages/stations`

Expected: PASS, with the station prediction-data locality assertion still passing.

- [ ] **Step 6: Commit the schema and builder**

Commit: `rtk git add schemas packages/database packages/stations packages/swift/Sources/NeapsTideDatabase/generated && rtk git commit -m "Store Kartverket tide zones in TCDB"`

### Task 3: Expose deterministic JavaScript zone lookup

**Files:**

- Create: `packages/database/src/tide-zones.ts`
- Create: `packages/database/test/tide-zones.test.ts`
- Modify: `packages/database/src/index.ts`
- Modify: `packages/database/README.md`

**Interfaces:**

- Consumes: the existing `Position` aliases and `positionToPoint()` helper from `src/search/index.ts`.
- Produces: `tideZones`, `tideZonesById`, and `tideZoneAt(position: Position): TideZone | undefined`.

- [ ] **Step 1: Write lookup tests**

Build fixtures for interior, exact vertex, edge, overlap, and outside positions. Assert the lower numeric ID wins an overlap and `undefined` is returned outside all supported polygons.

- [ ] **Step 2: Implement lazy zone records**

Read scalar identity and bounds eagerly. Expose `datums` and `polygon` as getters backed by the FlatBuffer record, matching the station reader's lazy pattern. Build `tideZonesById` from the sorted vector.

- [ ] **Step 3: Implement the bounded linear scan**

Use `positionToPoint()` so `latitude`/`lat` and `longitude`/`lon`/`lng` work exactly like station search. Use `1e-10` degrees as the boundary epsilon. Check `pointOnSegment()` before ray crossing. Scan in ascending zone-ID order and return the first containing zone.

Add this implementation comment:

```ts
// ponytail: 495 zones contain about 5,000 edges; add a spatial index only if profiling shows this scan matters.
```

- [ ] **Step 4: Verify and document the API**

Run: `rtk npm test -w packages/database`

Run: `rtk npm run build -w packages/database`

Expected: PASS in Node, browser, and worker bundles.

Commit: `rtk git add packages/database && rtk git commit -m "Resolve positions through Kartverket tide zones"`

### Task 4: Expose matching Swift zone lookup

**Files:**

- Modify: `packages/swift/scripts/generate-fixture.ts`
- Modify: `packages/swift/Sources/NeapsTideDatabase/TideDatabase.swift`
- Modify: `packages/swift/Tests/NeapsTideDatabaseTests/TideDatabaseTests.swift`
- Modify: `packages/swift/README.md`

**Interfaces:**

- Produces: `TideDatabase.tideZones`, `TideDatabase.tideZone(latitude:longitude:)`, and a lazy `TideZone` wrapper.

- [ ] **Step 1: Add zone data to the generated Swift fixture**

Reuse zone 524 from Task 2 so TypeScript builds the fixture Swift reads.

- [ ] **Step 2: Write failing Swift tests**

Assert ID, reference station, factor, delay, datums, closed polygon, interior lookup, edge lookup, and outside `nil`. Use an overlap fixture to assert the lower ID wins.

- [ ] **Step 3: Implement the Swift wrapper and identical geometry rules**

Expose zone scalars directly and resolve datum names through `root.datumNames`. Implement the same `1e-10` point-on-segment and ray-crossing operations used by TypeScript. Keep the sorted linear scan and the same `ponytail:` ceiling comment.

- [ ] **Step 4: Run Swift and database tests**

Run: `rtk npm test -w packages/swift`

Run: `rtk npm test -w packages/database`

Expected: PASS.

- [ ] **Step 5: Commit Swift support**

Commit: `rtk git add packages/swift && rtk git commit -m "Read Kartverket tide zones from Swift"`

### Task 5: Add zone predictions to the Neaps tide predictor

**Repository:** `/Users/clarkbw/src/openwaters/neaps`

**Files:**

- Create: `packages/tide-predictor/src/zone.ts`
- Create: `packages/tide-predictor/test/zone.test.ts`
- Modify: `packages/tide-predictor/src/index.ts`
- Modify: `packages/tide-predictor/README.md`
- Create: `.changeset/kartverket-tide-zones.md`

**Interfaces:**

- Consumes: a structural `TideZone` and its referenced `Station`.
- Produces: `useTideZone(zone, station)`, whose prediction results retain `station` and add `zone`.

- [ ] **Step 1: Write failing transformation tests**

Use a reference station with `{ MSL: 0, CD: -0.344 }`, a zone with factor `0.3`, delay `165`, and `{ MSL: 0, CD: -0.344 }`. For each prediction method, compare against `useStation(reference)` evaluated 165 minutes earlier:

```ts
const expected = referenceMSL.level * 0.3 + 0.344;
expect(zonePrediction.level).toBeCloseTo(expected, 8);
expect(zonePrediction.time).toEqual(requestedTime);
expect(zonePrediction.station.id).toBe(reference.id);
expect(zonePrediction.zone.id).toBe(524);
```

Add a negative-delay case and assert unavailable datum and mismatched reference IDs throw useful errors.

- [ ] **Step 2: Define the structural zone types**

```ts
export type TideZone = {
  id: number;
  name: string;
  reference_station_id: string;
  height_factor: number;
  delay_minutes: number;
  datums: Record<string, number>;
  chart_datum: string;
};
```

The published predictor must not import runtime code from `@neaps/tide-database`.

- [ ] **Step 3: Implement MSL-first prediction**

Create one `useStation(reference)` predictor. Call it with `datum: "MSL"`, shifted input times, and `units: "meters"`. Transform every result in this order:

```ts
level = referenceMSL.level * zone.height_factor;
level += zone.datums.MSL - zone.datums[datum];
```

Shift returned timeline and extreme times forward by `delay_minutes`; preserve the caller's requested instant for `getWaterLevelAtTime`. Convert to feet only after both height operations.

- [ ] **Step 4: Export, document, and add a minor changeset**

Export `useTideZone` and its types from `src/index.ts`. Document that it wraps a reference station and does not change subordinate-station behavior.

```md
---
"@neaps/tide-predictor": minor
---

Predict tide timelines, extrema, and water levels through a coastal zone's reference station and local corrections.
```

- [ ] **Step 5: Verify and commit**

Run: `rtk npm test -- packages/tide-predictor/test/zone.test.ts packages/tide-predictor/test/station.test.ts`

Run: `rtk npm run lint`

Expected: PASS.

Commit: `rtk git add packages/tide-predictor .changeset && rtk git commit -m "Predict tides through coastal zones"`

### Task 6: Use zones for automatic Neaps location predictions

**Repository:** `/Users/clarkbw/src/openwaters/neaps`

**Files:**

- Modify: `packages/neaps/src/index.ts`
- Modify: `packages/neaps/test/index.test.ts`
- Modify: `packages/neaps/package.json`
- Create: `.changeset/kartverket-location-resolution.md`

**Interfaces:**

- Consumes: `tideZoneAt`, `stationsById`, `useTideZone`, and the existing `nearest()` fallback.
- Produces: zone-first behavior for `getExtremesPrediction`, `getTimelinePrediction`, and `getWaterLevelAtTime`; `nearestStation()` remains unchanged.

- [ ] **Step 1: Write the location behavior tests**

Mock a containing zone and assert all three automatic prediction functions use its reference station and include `zone` in the result. Mock no zone and assert they call the current nearest-station path. Assert `nearestStation(position)` still returns the geometrically nearest station even when a zone exists.

- [ ] **Step 2: Implement one shared resolver**

```ts
function predictionTarget(options: NearestOptions) {
  const zone = tideZoneAt(options);
  if (zone) {
    const station = stationsById.get(zone.reference_station_id);
    if (!station)
      throw new Error(
        `Tide zone ${zone.id} references missing station ${zone.reference_station_id}`,
      );
    return useTideZone(zone, station);
  }
  return nearestStation(options);
}
```

Route only the three automatic prediction functions through `predictionTarget()`.

- [ ] **Step 3: Update package ranges and changeset**

Set `@neaps/tide-database` to `0.10` and `@neaps/tide-predictor` to `^0.12.0`. Add this changeset:

```md
---
"neaps": minor
---

Use Kartverket tide zones before nearest-station fallback for automatic predictions at Norwegian positions.
```

- [ ] **Step 4: Verify and commit**

Run: `rtk npm test -- packages/neaps/test/index.test.ts`

Run: `rtk npm run build && rtk npm run lint`

Expected: PASS.

Commit: `rtk git add packages/neaps .changeset && rtk git commit -m "Use tide zones for location predictions"`

### Task 7: Validate zone predictions and finish documentation

**Repository:** `tide-database`

**Files:**

- Modify: `sources/kartverket/validate.ts`
- Modify: `sources/kartverket/import.ts`
- Create: `sources/kartverket/fixtures/validation/zones/*.xml`
- Modify: `sources/kartverket/README.md`
- Modify: `packages/database/NOTICE`
- Modify: `docs/database-format.md`
- Modify: `packages/tcd/README.md`
- Modify: `packages/tcd/test/tcd.test.ts`

**Interfaces:**

- Consumes: built TCDB zones and the Neaps zone predictor.
- Produces: the provider comparison gate and explicit TCD compatibility documentation.

- [ ] **Step 1: Extend validation fixtures across the zone matrix**

Pin all-zone spot values plus detailed 72-hour responses for zones 420, 524, 347, 1, and 496. This set covers delays from `-50` through `+165` minutes, factors from `0.30` through `1.30`, regional spread, and a chart datum that differs from LAT.

- [ ] **Step 2: Compare every supported zone and detailed extrema**

For all 495 zones, compare representative timestamps in winter, summer, spring, and neap conditions. For the five detailed zones, compare 10-minute MSL and CD timelines plus high/low events. Apply the exact thresholds in Global Constraints and report errors by zone ID.

- [ ] **Step 3: Document format, attribution, and TCD omission**

Document `TideZone`, GeoJSON properties, lookup boundary behavior, and calculation order. State that TCD contains the 33 physical stations and omits all polygon zones because TCD has no polygonal target model. Add the approved Kartverket credit to NOTICE if the station milestone has not already done so.

- [ ] **Step 4: Add TCD non-fabrication coverage**

Assert the TCD station count gains physical Kartverket references only and contains no generated name or ID derived from a zone. The test should reject `Kartverket zone` and a representative synthetic zone ID such as `kartverket/zone/524`.

- [ ] **Step 5: Run the full release gate**

Run:

```sh
rtk npm run validate -w sources/kartverket
rtk npm test
rtk npm run lint
rtk npm run build -w packages/tcd
rtk npm test -w packages/swift
```

Run in the Neaps worktree:

```sh
rtk npm test
rtk npm run build
rtk npm run lint
```

Expected: every command passes, GeoJSON reports 590/495/95, TypeScript and Swift agree on every geometry fixture, and provider comparisons stay within the approved thresholds.

- [ ] **Step 6: Commit final validation and documentation**

Commit: `rtk git add sources/kartverket docs packages && rtk git commit -m "Validate Kartverket coastal tide coverage"`
