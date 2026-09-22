# Kartverket Stations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import Kartverket's 33 published harmonic stations as ordinary reference stations that work with the existing database, station chooser, nearest-station search, predictors, Swift reader, and TCD export.

**Architecture:** Add the five missing Kartverket constituent variants to `openwatersio/neaps`, then build a `sources/kartverket` package in `tide-database`. The source package pins and validates XML responses before producing ordinary `data/kartverket/*.json` records. Existing catalogue, FlatBuffer, search, and Swift paths consume those records without schema changes.

**Tech Stack:** TypeScript, Node.js 24, npm workspaces, fast-xml-parser 5.11.1, Vitest, Neaps tide predictor, FlatBuffers, Swift

**Spec:** `docs/superpowers/specs/2026-09-21-kartverket-tide-coverage-design.md`

## Global Constraints

- Work in linked worktrees for both `/Users/clarkbw/src/openwaters/neaps` and `/Users/clarkbw/src/openwaters/tide-database`; never modify either base checkout.
- Every ordinary import and test runs offline from committed fixtures. Only `npm run refresh -w sources/kartverket` contacts Kartverket.
- A failed or incomplete refresh leaves the previous fixture snapshot usable.
- Map constituents by published name, speed, and Extended Doodson identifier. An unresolved tuple fails the import.
- Convert amplitudes from centimetres to metres and phases with `phaseUTC = normalize(phasePublished - speedDegreesPerHour)`.
- Preserve Kartverket `CD`; never substitute `LAT` for chart datum.
- Keep missing observation epochs absent.
- Credit: `Tide and water-level data © Kartverket / Norwegian Mapping Authority, Hydrographic Service, licensed under CC BY 4.0.`
- Numerical validation covers 2020-01-01 through 2040-12-31 with RMSE ≤ 0.02 m, p95 absolute error ≤ 0.03 m, maximum absolute error ≤ 0.05 m, extreme time error ≤ 5 minutes, and extreme height error ≤ 0.05 m.

---

### Task 1: Add Kartverket constituent variants to Neaps

**Repository:** `/Users/clarkbw/src/openwaters/neaps`

**Files:**

- Modify: `packages/tide-predictor/src/constituents/data.json`
- Modify: `packages/tide-predictor/test/constituents/index.test.ts`
- Create: `.changeset/kartverket-constituents.md`

**Interfaces:**

- Consumes: the existing `defineConstituent()` data format.
- Produces: predictor catalogue names `ALP1`, `BET1`, `SA_KV`, `S1_KV`, and `OQ2_KV`.

- [ ] **Step 1: Write the failing constituent test**

Append a table-driven test that fixes each published speed, XDO-derived coefficient vector, and unity nodal correction:

```ts
it.each([
  ["ALP1", 12.38276516, [1, -4, 2, 1, 0, 0, 1]],
  ["BET1", 14.41455671, [1, 0, -2, 1, 0, 0, -1]],
  ["SA_KV", 0.04106668, [0, 0, 1, 0, 0, -1, 0]],
  ["S1_KV", 15.00000196, [1, 1, -1, 0, 0, 1, -1]],
  ["OQ2_KV", 27.35098024, [2, -3, 0, 3, 0, 0, 0]],
] as const)("loads Kartverket constituent %s", (name, speed, coefficients) => {
  const constituent = constituents[name];
  expect(constituent.speed).toBeCloseTo(speed, 8);
  expect(constituent.coefficients).toEqual(coefficients);
  expect(constituent.correction(testAstro)).toEqual({ f: 1, u: 0 });
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `rtk npm test -- packages/tide-predictor/test/constituents/index.test.ts`

Expected: FAIL because the five names are absent.

- [ ] **Step 3: Add the five data entries**

Insert these records in speed order in `data.json`:

```json
{ "name": "ALP1", "speed": 12.38276516, "xdo": [1, 1, 7, 6, 5, 5, 4], "nodalCorrection": "z", "aliases": [] }
{ "name": "BET1", "speed": 14.41455671, "xdo": [1, 5, 3, 6, 5, 5, 6], "nodalCorrection": "z", "aliases": [] }
{ "name": "SA_KV", "speed": 0.04106668, "xdo": [0, 5, 6, 5, 5, 4, 5], "nodalCorrection": "z", "aliases": [] }
{ "name": "S1_KV", "speed": 15.00000196, "xdo": [1, 6, 4, 5, 5, 6, 6], "nodalCorrection": "z", "aliases": [] }
{ "name": "OQ2_KV", "speed": 27.35098024, "xdo": [2, 2, 5, 8, 5, 5, 5], "nodalCorrection": "z", "aliases": [] }
```

Do not add `SA`, `S1`, or `OQ2` aliases to the three variants; those aliases already identify different catalogue entries.

- [ ] **Step 4: Add the patch changeset**

```md
---
"@neaps/tide-predictor": patch
---

Recognize the five harmonic constituent variants published by Kartverket.
```

- [ ] **Step 5: Verify and commit the Neaps change**

Run: `rtk npm test -- packages/tide-predictor/test/constituents/index.test.ts`

Run: `rtk npm run lint`

Expected: PASS.

Commit: `rtk git add packages/tide-predictor .changeset && rtk git commit -m "Support Kartverket harmonic constituents"`

### Task 2: Add the offline Kartverket source parser

**Repository:** `tide-database`

**Files:**

- Create: `sources/kartverket/package.json`
- Create: `sources/kartverket/kartverket.ts`
- Create: `sources/kartverket/import.ts`
- Create: `sources/kartverket/test/kartverket.test.ts`
- Create: `sources/kartverket/README.md`
- Modify: `package-lock.json`

**Interfaces:**

- Consumes: Kartverket station-list, constituent, and location-level XML plus `@neaps/tide-predictor`'s constituent catalogue.
- Produces: `parseStationList(xml)`, `parseConstituents(xml)`, `parseLocationLevels(xml)`, `resolveConstituent(tuple)`, and `buildStation(input): StationData`.

- [ ] **Step 1: Add the workspace package and exact dependencies**

Use these scripts and dependencies:

```json
{
  "name": "@neaps/kartverket",
  "private": true,
  "type": "module",
  "scripts": {
    "import": "node import.ts",
    "refresh": "node import.ts --refresh",
    "test": "vitest"
  },
  "dependencies": {
    "@neaps/stations": "*",
    "@neaps/tide-predictor": "^0.11.1",
    "fast-xml-parser": "^5.11.1"
  },
  "devDependencies": {
    "@neaps/tide-database": "*",
    "vitest": "^4.1.11"
  }
}
```

Run: `rtk npm install`

- [ ] **Step 2: Write parser and trust-boundary tests**

Cover one valid station, phase conversion, exact datum conversion, absent epoch, XML error, entity declaration, wrong unit, wrong UTC offset, and an unknown constituent tuple. The phase assertion is:

```ts
expect(parseConstituents(tromsoXml).constituents[0]).toMatchObject({
  name: "SA_KV",
  amplitude: 0.1286,
  phase: 330.19893332,
});
```

Assert exact special mappings:

```ts
expect(
  resolveConstituent({ name: "EPS2", speed: 27.4238338, doodson: "BWBAZZZ" }),
).toBe("eps2");
expect(
  resolveConstituent({ name: "GAM2", speed: 28.91125066, doodson: "BZXBZZB" }),
).toBe("gamma2");
expect(
  resolveConstituent({ name: "H1", speed: 28.94303758, doodson: "BZYZZAB" }),
).toBe("alpha2");
expect(
  resolveConstituent({ name: "H2", speed: 29.02517093, doodson: "BZAZZYZ" }),
).toBe("M(KS)2");
expect(
  resolveConstituent({ name: "LDA2", speed: 29.45562534, doodson: "BAXAZZB" }),
).toBe("lambda2");
expect(
  resolveConstituent({ name: "SIG1", speed: 12.92713985, doodson: "AWBZZZY" }),
).toBe("sigma1");
expect(
  resolveConstituent({ name: "THE1", speed: 15.51258972, doodson: "ABXAZZA" }),
).toBe("theta1");
```

- [ ] **Step 3: Run the tests and verify failure**

Run: `rtk npm test -w sources/kartverket`

Expected: FAIL because the parser functions do not exist.

- [ ] **Step 4: Implement the minimal parser**

Configure `XMLParser` with attributes enabled and entities disabled. Reject `<!DOCTYPE` and `<!ENTITY` before parsing. Resolve non-placeholder Doodson tuples by comparing their coefficient vector and speed, within `0.0001°/hour`, against unique objects from `@neaps/tide-predictor`'s exported catalogue. Resolve `ZZZZZZZ` compounds by case-insensitive canonical name or alias plus the same speed tolerance. Use an explicit tuple override map for the ten mappings asserted above and the three `_KV` names.

Use these normalization helpers:

```ts
export const normalizePhase = (phase: number, speed: number) =>
  (((phase - speed) % 360) + 360) % 360;

export const centimetersToMeters = (value: string) => Number(value) / 100;
```

Keep only `HAT`, `MHWS`, `MHW`, `MHWN`, `NN2000`, `MSL`, `MLWN`, `MLW`, `MLWS`, `LAT`, and `CD` from location levels. Set `chart_datum: "CD"`, `country: "Norway"`, `type: "reference"`, and the approved source and licence metadata.

- [ ] **Step 5: Run tests and commit**

Run: `rtk npm test -w sources/kartverket`

Expected: PASS.

Commit: `rtk git add sources/kartverket package-lock.json && rtk git commit -m "Parse Kartverket tide stations"`

### Task 3: Pin the source snapshot and generate 33 stations

**Files:**

- Create: `sources/kartverket/fixtures/manifest.json`
- Create: `sources/kartverket/fixtures/stationlist.xml`
- Create: `sources/kartverket/fixtures/constituents/*.xml`
- Create: `sources/kartverket/fixtures/stationlevels/*.xml`
- Create: `data/kartverket/*.json`
- Modify: `sources/kartverket/import.ts`
- Modify: `sources/kartverket/test/kartverket.test.ts`

**Interfaces:**

- Consumes: the parser from Task 2 and Kartverket's `tideapi.php` endpoints.
- Produces: a checksum-verified fixture snapshot and 33 normalized station files.

- [ ] **Step 1: Test manifest verification and safe replacement**

Create a temporary fixture tree in the test, corrupt one response after its checksum is recorded, and assert `verifySnapshot()` rejects it. Mock one failed fetch and assert `refreshSnapshot()` leaves an existing manifest unchanged.

- [ ] **Step 2: Implement refresh staging**

Fetch `stationlist`, then one `constituents` and one `locationdata` response for each published station code. Write every response to a sibling temporary directory, validate the full set, calculate lowercase SHA-256 hashes, and write a sorted manifest. Replace the fixture directory only after validation succeeds; restore the backup directory if the final rename fails.

The manifest shape is:

```ts
interface SnapshotManifest {
  retrievedAt: string;
  files: Array<{ path: string; url: string; sha256: string }>;
}
```

- [ ] **Step 3: Refresh and inspect the source snapshot**

Run: `rtk npm run refresh -w sources/kartverket`

Expected: 67 XML files: one station list, 33 constituent responses, and 33 station-level responses. Confirm the manifest verifies all of them and reports 33 unique codes.

- [ ] **Step 4: Generate station records offline**

Run: `rtk npm run import -w sources/kartverket`

Expected: 33 files under `data/kartverket`, including `TOS.json`, `SVG.json`, `BOH.json`, and `EYD.json`. `BOH` and `EYD` omit `epoch`; every record uses `CD` as chart datum and contains `MSL`.

- [ ] **Step 5: Prove deterministic import**

Run the import twice and compare the tree:

```sh
rtk npm run import -w sources/kartverket
rtk git diff --exit-code -- data/kartverket
```

Expected: no diff on the second import.

- [ ] **Step 6: Commit the snapshot and generated stations**

Commit: `rtk git add sources/kartverket data/kartverket && rtk git commit -m "Import Kartverket tide stations"`

### Task 4: Prefer authoritative Kartverket gauges during quality evaluation

**Files:**

- Modify: `packages/stations/filtering.ts`
- Modify: `packages/stations/evaluate-quality.ts`
- Modify: `packages/stations/test/index.test.ts`
- Modify: `quality.json`

**Interfaces:**

- Consumes: station IDs and the existing proximity/harmonic duplicate test.
- Produces: `authoritativeDuplicateWinner(a, b): string | undefined`, used by source scoring and `pickWinner()`.

- [ ] **Step 1: Write the failing preference test**

```ts
expect(
  authoritativeDuplicateWinner("kartverket/TOS", "ticon/tromso-123-nor-nhs"),
).toBe("kartverket/TOS");
expect(authoritativeDuplicateWinner("ticon/a", "ticon/b")).toBeUndefined();
```

- [ ] **Step 2: Implement the narrow preference**

Treat IDs beginning with `noaa/` or `kartverket/` as direct authoritative provider records. When exactly one duplicate candidate is direct, return it before subordinate-count, score, and coordinate-precision tie-breaks. Use the same predicate to give Kartverket source confidence `1.0`.

- [ ] **Step 3: Rebuild and inspect quality results**

Run: `rtk npm run evaluate-quality -w packages/stations`

Run: `rtk npm run validate-database -w packages/stations`

Expected: all valid Kartverket stations are accepted; co-located TICON duplicates identify the Kartverket ID in `redundant`.

- [ ] **Step 4: Run focused tests and commit**

Run: `rtk npm test -w packages/stations`

Expected: PASS.

Commit: `rtk git add packages/stations quality.json && rtk git commit -m "Prefer authoritative Kartverket gauges"`

### Task 5: Pin and enforce provider prediction comparisons

**Files:**

- Create: `sources/kartverket/validate.ts`
- Create: `sources/kartverket/test/validation.test.ts`
- Create: `sources/kartverket/fixtures/validation/stations/*.xml`
- Modify: `sources/kartverket/package.json`
- Modify: `sources/kartverket/import.ts`

**Interfaces:**

- Consumes: generated Kartverket station JSON, `useStation()`, and pinned Kartverket predictions.
- Produces: `validate` and `refresh-validation` scripts plus deterministic error metrics.

- [ ] **Step 1: Write metric tests**

Test `rmse`, percentile, maximum absolute error, height-at-time comparison, and extreme matching. Boundary assertions are exact:

```ts
expect(assertSeries([{ error: 0.02 }])).not.toThrow;
expect(() => assertSeries([{ error: 0.051 }])).toThrow(/maximum.*0.05 m/);
expect(() => assertExtreme({ timeErrorMinutes: 5.1, heightError: 0 })).toThrow(
  /5 minutes/,
);
```

- [ ] **Step 2: Implement validation parsing and metrics**

For every station, compare Kartverket and Neaps MSL predictions at the pinned timestamps. Compare both January and July windows and include the supported interval endpoints. Report per-station RMSE, p95, maximum error, and matched-extreme errors; throw when any approved threshold is exceeded.

- [ ] **Step 3: Fetch and pin validation responses**

Run: `rtk npm run refresh-validation -w sources/kartverket`

Expected: raw Kartverket XML responses appear under `fixtures/validation/stations`, and the fixture manifest gains their URLs and checksums.

- [ ] **Step 4: Run the offline validation gate**

Run: `rtk npm run validate -w sources/kartverket`

Expected: all 33 stations pass the thresholds in Global Constraints.

- [ ] **Step 5: Commit validation fixtures and code**

Commit: `rtk git add sources/kartverket && rtk git commit -m "Validate Kartverket station predictions"`

### Task 6: Document, package, and verify milestone 1

**Files:**

- Modify: `README.md`
- Modify: `packages/database/NOTICE`
- Modify: `packages/tcd/test/tcd.test.ts`
- Modify: `package-lock.json`

**Interfaces:**

- Consumes: the generated catalogue and the Neaps constituent release from Task 1.
- Produces: attributed npm/TCDB/TCD outputs containing the physical Kartverket stations.

- [ ] **Step 1: Add the source and attribution documentation**

Add Kartverket to the repository Sources section with 33 stations, link `sources/kartverket/README.md`, and add the exact approved credit plus CC BY 4.0 link to `packages/database/NOTICE`.

- [ ] **Step 2: Add a TCD station-presence test**

Extend the TCD integrity suite to assert the generated harmonics source contains a representative Kartverket station and the five new canonical constituent names:

```ts
expect(content).toContain("Tromsø");
for (const name of ["ALP1", "BET1", "SA_KV", "S1_KV", "OQ2_KV"])
  expect(content).toContain(name);
```

- [ ] **Step 3: Run complete verification**

Run: `rtk npm test`

Run: `rtk npm run lint`

Run: `rtk npm run build -w packages/tcd`

Run in the Neaps worktree: `rtk npm test && rtk npm run lint`

Expected: all commands pass. The generated database count increases by 33 source records before quality deduplication, and accepted station search returns `kartverket/TOS`.

- [ ] **Step 4: Commit milestone documentation and verification**

Commit: `rtk git add README.md packages/database/NOTICE packages/tcd package-lock.json && rtk git commit -m "Document Kartverket station coverage"`
