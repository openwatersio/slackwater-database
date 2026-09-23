# RWS Harmonic Fit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a numerically stable harmonic fit and a reproducible three-station RWS validator, then remove the sampled-prediction prototype without importing or publishing stations.

**Architecture:** The existing streaming normal-equation fit remains the default for TICON. An opt-in SVD path accepts a deliberately bounded sample set; a single RWS source command owns data retrieval, residual-based constituent selection, held-out height validation, and provider-event diagnostics.

**Tech Stack:** TypeScript, Node.js, Vitest, `@neaps/tide-predictor`, `ml-matrix`, RWS WaterWebservices.

**Spec:** `docs/superpowers/specs/2026-09-22-rws-harmonic-fit-design.md`

## Global Constraints

- Do not import, publish, or ship RWS station records.
- Keep `fitHarmonics(samples, names)` behavior unchanged unless `{ solver: "svd" }` is explicitly supplied.
- Pass exactly 4,000 deterministically spread samples to the SVD fit; never materialize the full multi-year design matrix.
- Use 2019–2024 only for constituent selection and fitting, and 2025–2026 only for held-out validation.
- Validate only `ameland.nes`, `hoekvanholland`, and `denhelder.marsdiep`.
- Height gates are RMS ≤ 0.02 m, p95 ≤ 0.04 m, maximum ≤ 0.10 m, and independent-fit disagreement ≤ 0.005 m RMS.
- Event gates are at least 95% matched by type within 60 minutes, mean timing error < 5 minutes, and maximum timing error < 15 minutes.
- Event failure remains a blocker; do not add smoothing, prominence tuning, or double-extrema heuristics.
- Keep responses and reports under ignored `tmp/rws/`.
- Use current-state prose in `sources/rws/README.md` and delete completed plans/specs when the implementation is complete.

## Review Focus

- Duplicate or near-collinear constituent columns must return finite SVD minimum-norm predictions rather than a singular-matrix failure; Task 1 pins this with a duplicated-constituent test.
- Provider timestamps without an explicit UTC offset must be rejected rather than interpreted in the host timezone; Task 2 tests height and event responses.
- Inclusive RWS chunks may repeat an identical boundary sample, while a conflicting duplicate must fail; Task 2 tests both cases.
- A cached response with a changed request identity or checksum must fail before JSON parsing; Task 2 corrupts each field independently.
- Event type and height channels with unequal lengths or different timestamps must fail before matching; Task 2 exercises both mismatches.

---

### Task 1: Add opt-in SVD harmonic fitting

**Files:**
- Modify: `packages/harmonic-analysis/index.ts`
- Modify: `packages/harmonic-analysis/test/harmonic-analysis.test.ts`
- Modify: `packages/harmonic-analysis/package.json`
- Modify: `package-lock.json`
- Add to first commit: `docs/superpowers/specs/2026-09-22-rws-harmonic-fit-design.md`
- Add to first commit: `docs/superpowers/plans/2026-09-22-rws-harmonic-fit.md`

**Interfaces:**
- Consumes: existing `Sample` and `HarmonicConstituent` types.
- Produces: `fitHarmonics(samples: Sample[], names: string[], options?: { solver?: "normal-equations" | "svd" }): HarmonicConstituent[]`.
- Preserves: a two-argument call uses the existing normal-equation solver.

- [ ] **Step 1: Add failing SVD and rank-deficiency tests**

Extend the existing `fitHarmonics` suite. Build 99 canonical positive-speed models from unique `model.name` values, excluding the six names guarded by `TICON_REFERENCE_SPEED`. Generate 4,000 timestamps spread across six years, synthesize each constituent with deterministic amplitude and phase, and assert that the SVD fit reconstructs the samples within 3 mm RMS.

Add a second case with `["M2", "M2"]`. Assert both returned entries are finite and their combined prediction reconstructs a single M2 series within 3 mm RMS:

```ts
const fit = fitHarmonics(samples, names, { solver: "svd" });
expect(fit).toHaveLength(99);
expect(
  fit.every(
    ({ amplitude, phase }) =>
      Number.isFinite(amplitude) && Number.isFinite(phase),
  ),
).toBe(true);
expect(predictionRms(fit, samples)).toBeLessThan(0.003);

const duplicate = fitHarmonics(m2Samples, ["M2", "M2"], {
  solver: "svd",
});
expect(duplicate).toHaveLength(2);
expect(
  duplicate.every(
    ({ amplitude, phase }) =>
      Number.isFinite(amplitude) && Number.isFinite(phase),
  ),
).toBe(true);
expect(predictionRms(duplicate, m2Samples)).toBeLessThan(0.003);
```

The test helper must use `createTidePredictor(fit, { offset: false })` and compute RMS over the supplied sample levels. Keep the existing three-constituent normal-equation test unchanged.

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```bash
rtk npm run test -w packages/harmonic-analysis -- --run test/harmonic-analysis.test.ts
```

Expected: FAIL because `fitHarmonics` does not accept `solver` and the normal-equation path is singular for duplicated columns.

- [ ] **Step 3: Install the numerical dependency**

Run:

```bash
rtk npm install -w packages/harmonic-analysis ml-matrix
```

Expected: `packages/harmonic-analysis/package.json` and `package-lock.json` record `ml-matrix`.

- [ ] **Step 4: Implement the minimal opt-in solver**

Import `Matrix` and `solve` from `ml-matrix`. Add:

```ts
export interface FitOptions {
  solver?: "normal-equations" | "svd";
}
```

Change the existing declaration to `fitHarmonics(samples: Sample[], names: string[], options: FitOptions = {}): HarmonicConstituent[]`. Keep the existing constituent-resolution block. Immediately after it computes `ncol`, return from the opt-in branch:

```ts
if (options.solver === "svd") {
  const rows = samples.map((sample) => {
    const row = new Array<number>(ncol).fill(0);
    row[0] = 1;
    const a = neaps.astro(new Date(sample.t));
    for (let k = 0; k < cons.length; k++) {
      const con = cons[k]!.c;
      const { f, u } = con.correction(a);
      const arg = (con.value(a) + u) * DEG;
      row[1 + 2 * k] = f * Math.cos(arg);
      row[2 + 2 * k] = f * Math.sin(arg);
    }
    return row;
  });
  const x = solve(
    new Matrix(rows),
    Matrix.columnVector(samples.map(({ level }) => level)),
    true,
  ).getColumn(0);
  if (!x.every(Number.isFinite))
    throw new Error("non-finite harmonic SVD solution");
  return cons.map((co, k) => {
    const p = x[1 + 2 * k]!;
    const q = x[2 + 2 * k]!;
    return {
      name: co.name,
      amplitude: Math.round(Math.hypot(p, q) * 1000) / 1000,
      phase:
        Math.round(
          ((((Math.atan2(q, p) / DEG) % 360) + 360) % 360) * 100,
        ) / 100,
    };
  });
}
```

Leave the current ATA/ATy accumulation, `solveSymmetric` call, rounding, and return mapping immediately after this branch. Do not introduce sampling, tolerances, or RWS-specific behavior into this package.

- [ ] **Step 5: Run the focused and package tests**

Run:

```bash
rtk npm run test -w packages/harmonic-analysis -- --run
```

Expected: PASS, including the unchanged normal-equation test and the new 99-term and duplicate-column cases.

- [ ] **Step 6: Commit the solver and approved documents**

Run:

```bash
rtk git status --short
rtk git add packages/harmonic-analysis/index.ts packages/harmonic-analysis/test/harmonic-analysis.test.ts packages/harmonic-analysis/package.json package-lock.json docs/superpowers/specs/2026-09-22-rws-harmonic-fit-design.md docs/superpowers/plans/2026-09-22-rws-harmonic-fit.md
rtk git commit -m "feat: add stable harmonic least squares"
```

Expected: one commit containing only the SVD option, its tests/dependency, and the approved implementation documents.

---

### Task 2: Add the fixed RWS harmonic validator

**Files:**
- Create: `sources/rws/package.json`
- Create: `sources/rws/harmonics.ts`
- Create: `sources/rws/harmonics.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: `fitHarmonics(..., { solver: "svd" })`, `Sample`, `createTidePredictor`, and three committed TICON JSON files.
- Produces:
  - `spreadSample<T>(points: readonly T[], count: number, salt: number): T[]`
  - `parseHeightChunks(code: string, datum: "NAP" | "MSL", chunks: unknown[], bounds: Bounds): Sample[]`
  - `parseEvents(code: string, datum: "NAP" | "MSL", grouping: string, response: unknown, bounds: Bounds): RwsEvent[]`
  - `selectExtraConstituents(samples: Sample[], residuals: number[], excludedNames: readonly string[], count: number): string[]`
  - `readCachedJson(path: string, expectedUrl: string, expectedBody: JsonRecord): Promise<unknown>`
  - `validationGates(height: ErrorMetrics, stabilityRms: number, events: EventMetrics): ValidationGates`
  - `runRwsHarmonicValidation(options: ValidationOptions): Promise<ValidationReport>`
- Writes: `tmp/rws/harmonics-report.json` and checksum-protected cached responses.

- [ ] **Step 1: Create the source workspace and failing boundary tests**

Create `sources/rws/package.json`:

```json
{
  "name": "@neaps/rws",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest",
    "validate": "node harmonics.ts"
  },
  "dependencies": {
    "@neaps/harmonic-analysis": "*",
    "@neaps/tide-predictor": "^0.11.0"
  },
  "devDependencies": {
    "vitest": "^5.0.1"
  }
}
```

Create `sources/rws/harmonics.test.ts`. Import `createHash`, `mkdtemp`, `readFile`, `rm`, and `writeFile` from Node, plus `tmpdir`, `join`, `astro`, and `constituents`. Use these inline response builders:

```ts
function heightResponse(
  times: string[],
  values: number[],
  datum: "NAP" | "MSL",
) {
  return {
    Succesvol: true,
    WaarnemingenLijst: [
      {
        AquoMetadata: {
          Eenheid: { Code: "cm" },
          Groepering: { Code: "" },
          Grootheid: { Code: "WATHTE" },
          Hoedanigheid: { Code: datum },
          ProcesType: "astronomisch",
        },
        Locatie: { Code: "nap" },
        MetingenLijst: times.map((Tijdstip, index) => ({
          Tijdstip,
          Meetwaarde: { Waarde_Numeriek: values[index] },
          WaarnemingMetadata: { Kwaliteitswaardecode: "00" },
        })),
      },
    ],
  };
}

function eventResponse(
  typeTimes: string[],
  heightTimes: string[],
  datum: "NAP" | "MSL",
  grouping: string,
) {
  const metadata = (type: boolean) => ({
    Eenheid: { Code: type ? "DIMSLS" : "cm" },
    Groepering: { Code: grouping },
    Grootheid: { Code: type ? "NVT" : "WATHTE" },
    Hoedanigheid: { Code: type ? "NVT" : datum },
    ProcesType: "astronomisch",
    Typering: { Code: type ? "GETETTPE" : "NVT" },
  });
  return {
    Succesvol: true,
    WaarnemingenLijst: [
      {
        AquoMetadata: metadata(true),
        Locatie: { Code: "nap" },
        MetingenLijst: typeTimes.map((Tijdstip, index) => ({
          Tijdstip,
          Meetwaarde: {
            Waarde_Alfanumeriek: index % 2 ? "laagwater" : "hoogwater",
          },
        })),
      },
      {
        AquoMetadata: metadata(false),
        Locatie: { Code: "nap" },
        MetingenLijst: heightTimes.map((Tijdstip, index) => ({
          Tijdstip,
          Meetwaarde: { Waarde_Numeriek: index % 2 ? -30 : 90 },
        })),
      },
    ],
  };
}
```

Add these cases:

```ts
test("spread sampling and residual ranking are deterministic", () => {
  const screenSamples = Array.from({ length: 400 }, (_, index) => ({
    t: Date.UTC(2020, 0, 1) + index * 86_400_000,
    level: 0,
  }));
  const residuals = screenSamples.map(({ t }) => {
    const astronomy = astro(new Date(t));
    return [
      ["M2", 1],
      ["S2", 0.5],
    ].reduce((level, [name, amplitude]) => {
      const model = constituents[String(name)]!;
      const { f, u } = model.correction(astronomy);
      return (
        level +
        Number(amplitude) *
          f *
          Math.cos((model.value(astronomy) + u) * (Math.PI / 180))
      );
    }, 0);
  });
  expect(spreadSample([...Array(20).keys()], 5, 3)).toEqual([
    3, 4, 9, 14, 19,
  ]);
  expect(
    selectExtraConstituents(screenSamples, residuals, [], 2),
  ).toEqual(["M2", "S2"]);
});
```

Define `bounds` as four ten-minute intervals and create compact `heightResponse(times, values, datum)` and `eventResponse(typeTimes, heightTimes, datum, grouping)` builders with the exact RWS shape. Derive the boundary cases without external fixtures:

```ts
const bounds = {
  startMs: Date.parse("2026-07-01T00:00:00Z"),
  endMs: Date.parse("2026-07-01T00:30:00Z"),
};
const matchingBoundary = [
  heightResponse(
    ["2026-07-01T01:00:00+01:00", "2026-07-01T01:10:00+01:00",
      "2026-07-01T01:20:00+01:00"],
    [0, 1, 2],
    "NAP",
  ),
  heightResponse(
    ["2026-07-01T01:20:00+01:00", "2026-07-01T01:30:00+01:00"],
    [2, 3],
    "NAP",
  ),
];
const conflictingBoundary = structuredClone(matchingBoundary);
conflictingBoundary[1].WaarnemingenLijst[0].MetingenLijst[0]
  .Meetwaarde.Waarde_Numeriek = 9;
const noOffset = structuredClone(matchingBoundary);
noOffset[0].WaarnemingenLijst[0].MetingenLijst[0].Tijdstip =
  "2026-07-01T00:00:00";

test("requires offsets and accepts only identical chunk boundaries", () => {
  expect(() => parseHeightChunks("nap", "NAP", noOffset, bounds)).toThrow(
    /explicit offset/,
  );
  expect(
    parseHeightChunks("nap", "NAP", matchingBoundary, bounds),
  ).toHaveLength(4);
  expect(() =>
    parseHeightChunks("nap", "NAP", conflictingBoundary, bounds),
  ).toThrow(/conflicting duplicate timestamp/);
});

test("rejects changed datum, cadence, and non-finite heights", () => {
  const mslResponse = structuredClone(matchingBoundary);
  mslResponse[0].WaarnemingenLijst[0].AquoMetadata.Hoedanigheid.Code = "MSL";
  const fiveMinute = structuredClone(matchingBoundary);
  fiveMinute[0].WaarnemingenLijst[0].MetingenLijst[1].Tijdstip =
    "2026-07-01T01:05:00+01:00";
  const nonFinite = structuredClone(matchingBoundary);
  nonFinite[0].WaarnemingenLijst[0].MetingenLijst[0]
    .Meetwaarde.Waarde_Numeriek = Number.NaN;
  expect(() => parseHeightChunks("nap", "NAP", mslResponse, bounds)).toThrow(
    /datum.*NAP/,
  );
  expect(() => parseHeightChunks("nap", "NAP", fiveMinute, bounds)).toThrow(
    /cadence.*600/,
  );
  expect(() => parseHeightChunks("nap", "NAP", nonFinite, bounds)).toThrow(
    /finite/,
  );
});

test("requires paired event channels and explicit offsets", () => {
  const valid = eventResponse(
    ["2026-07-01T01:05:00+01:00"],
    ["2026-07-01T01:05:00+01:00"],
    "NAP",
    "GETETBRKD2",
  );
  const unequal = structuredClone(valid);
  unequal.WaarnemingenLijst[1].MetingenLijst.push(
    structuredClone(unequal.WaarnemingenLijst[1].MetingenLijst[0]),
  );
  const misaligned = structuredClone(valid);
  misaligned.WaarnemingenLijst[1].MetingenLijst[0].Tijdstip =
    "2026-07-01T01:06:00+01:00";
  const noOffsetEvent = structuredClone(valid);
  noOffsetEvent.WaarnemingenLijst[0].MetingenLijst[0].Tijdstip =
    "2026-07-01T00:05:00";
  expect(() =>
    parseEvents("nap", "NAP", "GETETBRKD2", unequal, bounds),
  ).toThrow(/lengths.*match/);
  expect(() =>
    parseEvents("nap", "NAP", "GETETBRKD2", misaligned, bounds),
  ).toThrow(/timestamps.*pair/);
  expect(() =>
    parseEvents("nap", "NAP", "GETETBRKD2", noOffsetEvent, bounds),
  ).toThrow(/explicit offset/);
});

test("rejects corrupt or mismatched cache entries", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rws-cache-test-"));
  const cachePath = join(directory, "entry.json");
  const url = "https://example.test/rws";
  const body = { Locatie: { Code: "nap" } };
  const responseText = "{}";
  const valid = {
    url,
    body,
    status: 200,
    responseText,
    sha256: createHash("sha256").update(responseText).digest("hex"),
  };
  await writeFile(cachePath, JSON.stringify({ ...valid, sha256: "bad" }));
  await expect(readCachedJson(cachePath, url, body)).rejects.toThrow(
    /cache.*checksum/,
  );
  await writeFile(
    cachePath,
    JSON.stringify({ ...valid, body: { Locatie: { Code: "other" } } }),
  );
  await expect(readCachedJson(cachePath, url, body)).rejects.toThrow(
    /cache.*request/,
  );
  await rm(directory, { recursive: true, force: true });
});

test("applies height and event gates independently", () => {
  const gates = validationGates(
    { rms: 0.018, p95: 0.035, max: 0.09 },
    0.004,
    {
      provider: 100,
      predicted: 130,
      matched: 94,
      meanMinutes: 4,
      maxMinutes: 14,
    },
  );
  expect(gates).toEqual({
    height: true,
    events: false,
    publishable: false,
  });
});
```

The fixture builders must use explicit `+01:00` timestamps, `cm` units, `astronomisch` process, the requested datum/grouping, and paired `GETETTPE`/`WATHTE` channels. Keep fixtures in the test file; do not add fixture files.

- [ ] **Step 2: Register dependencies and verify the tests fail**

Add `-w sources/rws` to the root `test` script, then run:

```bash
rtk npm install
rtk npm run test -w sources/rws -- --run
```

Expected: FAIL because `sources/rws/harmonics.ts` and its exports do not exist.

- [ ] **Step 3: Implement strict response normalization and caching**

Create `sources/rws/harmonics.ts`. Define:

```ts
type Bounds = { startMs: number; endMs: number };
type JsonRecord = Record<string, unknown>;
export type RwsEvent = { t: number; type: string; level: number };
export type ErrorMetrics = { rms: number; p95: number; max: number };
export type EventMetrics = {
  provider: number;
  predicted: number;
  matched: number;
  meanMinutes: number;
  maxMinutes: number;
};
export type ValidationGates = {
  height: boolean;
  events: boolean;
  publishable: boolean;
};
export type ValidationOptions = {
  fetch: typeof fetch;
  cacheDir: string;
  reportPath: string;
  nowMs: number;
};
export type StationReport = {
  station: string;
  terms: number;
  samples: { train: number; validation: number };
  height: ErrorMetrics;
  stabilityRms: number;
  amplitudeMax: number;
  amplitudeSum: number;
  events: EventMetrics;
  gates: ValidationGates;
};
export type ValidationReport = {
  stations: StationReport[];
  heightPass: boolean;
  eventPass: boolean;
  publishable: boolean;
};
```

Port only the source checks needed by the harmonic experiment from `prototype.ts`:

- require HTTP 200 and non-empty JSON;
- key the cache by SHA-256 of `{url, body}`;
- store and verify `url`, `body`, `status`, `responseText`, and response SHA-256;
- require `Succesvol === true`;
- require the requested station, `WATHTE`, `cm`, `astronomisch`, and exact datum/grouping;
- require an explicit `Z` or numeric offset in every timestamp;
- accept quality `00` only and reject gaps for this complete-series experiment;
- deduplicate only identical timestamps with identical levels at inclusive chunk boundaries;
- require exact 600-second cadence and the requested first/last timestamps;
- require paired event type/height channels with equal timestamps.

Implement deterministic spread sampling exactly:

```ts
export function spreadSample<T>(
  points: readonly T[],
  count: number,
  salt: number,
): T[] {
  if (points.length <= count) return [...points];
  return Array.from({ length: count }, (_, index) => {
    const low = Math.floor((index * points.length) / count);
    const high = Math.floor(((index + 1) * points.length) / count);
    return points[
      low + ((index * 104_729 + salt) % Math.max(1, high - low))
    ]!;
  });
}
```

Keep cache writes recoverable by writing `${path}.tmp-${process.pid}` and renaming only after the complete entry is serialized. Always remove a leftover temporary file in `finally`.

- [ ] **Step 4: Implement constituent selection, fitting, and gates**

Use a unique `model.name` map over `@neaps/tide-predictor.constituents` and keep positive-speed models only. For each unexcluded model, fit its cosine/sine columns to the baseline residual and rank by `Math.hypot(p, q)`. Skip only a zero two-column determinant; let SVD handle correlation in the final joint fit.

Implement the gates exactly:

```ts
export function validationGates(
  height: ErrorMetrics,
  stabilityRms: number,
  events: EventMetrics,
): ValidationGates {
  const heightPass =
    height.rms <= 0.02 &&
    height.p95 <= 0.04 &&
    height.max <= 0.1 &&
    stabilityRms <= 0.005;
  const eventPass =
    events.provider > 0 &&
    events.matched / events.provider >= 0.95 &&
    events.meanMinutes < 5 &&
    events.maxMinutes < 15;
  return {
    height: heightPass,
    events: eventPass,
    publishable: heightPass && eventPass,
  };
}
```

For event matching, walk provider events in order, choose the nearest unused predicted event with the same `hoogwater`/`laagwater` type within 60 minutes, and report provider, predicted, matched, mean, and maximum. Do not filter predicted events.

- [ ] **Step 5: Implement the fixed three-station run**

Hard-code only these experiment inputs:

```ts
const STATIONS = [
  {
    code: "ameland.nes",
    datum: "NAP",
    grouping: "GETETBRKD2",
    ticon: "data/ticon/nes-nes-nld-rws_hist.json",
  },
  {
    code: "hoekvanholland",
    datum: "NAP",
    grouping: "GETETBRKD2",
    ticon: "data/ticon/hoek_van_holland-hoekvhld-nld-rws_hist.json",
  },
  {
    code: "denhelder.marsdiep",
    datum: "NAP",
    grouping: "GETETBRKD2",
    ticon: "data/ticon/den_helder-denhdr-nld-rws_hist.json",
  },
] as const;
```

For each station:

1. fetch 2019-01-01–2022-01-01 and 2022-01-01–2025-01-01 heights, then join their identical shared boundary;
2. fetch 2025-01-01–2027-01-01 heights and events;
3. read the TICON constituent names;
4. fit the baseline on `spreadSample(train, 12_000, code.length)`;
5. score residual candidates on `spreadSample(train, 24_000, code.length * 17)`;
6. take the first 50 unique canonical names not in the baseline;
7. fit the 99-term basis with SVD on salts `code.length * 97` and `code.length * 97 + 1`, 4,000 rows each;
8. calculate each fit's mean offset from its own 4,000 training rows;
9. calculate height metrics from every held-out height, stability RMS between the two full held-out predictions, coefficient maximum/sum, event metrics, and gates.

Write the complete `ValidationReport` to `tmp/rws/harmonics-report.json` before setting `process.exitCode = 1` when `publishable` is false. The CLI must print the report path and one height/event summary line per station.

- [ ] **Step 6: Run the RWS source tests**

Run:

```bash
rtk npm run test -w sources/rws -- --run
```

Expected: PASS for deterministic selection, strict normalization, cache integrity, and independent gates.

- [ ] **Step 7: Commit the validator**

Run:

```bash
rtk git status --short
rtk git add sources/rws/package.json sources/rws/harmonics.ts sources/rws/harmonics.test.ts package.json package-lock.json
rtk git commit -m "feat: validate RWS harmonic fits"
```

Expected: one commit containing the source-owned experiment and its bounded tests.

---

### Task 3: Remove sampled predictions and record the live result

**Files:**
- Delete: `schemas/rws-predictions.fbs`
- Delete: `packages/database/src/rws-predictions/types.ts`
- Delete: `packages/database/src/rws-predictions/builder.ts`
- Delete: `packages/database/src/rws-predictions/reader.ts`
- Delete: `packages/database/test/rws-predictions.test.ts`
- Delete: `sources/rws/prototype.ts`
- Modify: `packages/database/scripts/generate-database.ts`
- Rewrite: `sources/rws/README.md`
- Delete after implementation: `docs/superpowers/plans/2026-09-21-rws-prediction-prototype.md`
- Delete after implementation: `docs/superpowers/specs/2026-09-21-rws-prediction-prototype-design.md`
- Delete after implementation: `docs/superpowers/plans/2026-09-21-rws-source-audit.md`
- Delete after implementation: `docs/superpowers/specs/2026-09-21-rws-source-audit-design.md`
- Delete after implementation: `docs/superpowers/plans/2026-09-22-rws-harmonic-fit.md`
- Delete after implementation: `docs/superpowers/specs/2026-09-22-rws-harmonic-fit-design.md`

**Interfaces:**
- Consumes: `npm run validate -w sources/rws` and its JSON report.
- Produces: a repository with one RWS harmonic experiment, no sampled-prediction format, and a current-state README.

- [ ] **Step 1: Run the live validator and inspect the report**

Run:

```bash
rtk proxy npm run validate -w sources/rws
rtk json tmp/rws/harmonics-report.json
```

Expected:

- the command writes the report and exits nonzero because at least one event gate fails;
- all three height gates pass;
- held-out height RMS is at most 0.02 m for each station;
- `hoekvanholland` and `denhelder.marsdiep` report extra predicted events or failed timing gates;
- no generated station record is written.

If a height gate fails, stop and diagnose the fit; do not loosen a threshold. If only event gates fail as expected, continue.

- [ ] **Step 2: Delete the sampled implementation and disconnect schema generation**

Remove the schema, three internal database files, combined prototype test, and `sources/rws/prototype.ts`. Replace:

```ts
for (const schema of ["database.fbs", "rws-predictions.fbs"]) {
```

with:

```ts
for (const schema of ["database.fbs"]) {
```

Do not add compatibility stubs or exports; the prototype has no public package export.

- [ ] **Step 3: Rewrite the RWS README from the live report**

Keep only:

- source endpoint, CC0 reuse terms, fair-use/request-size constraints, explicit-offset timestamp semantics, centimeter units, NAP/MSL datum handling, inclusive chunk boundaries, and paired event channels;
- the fixed validator command and train/validation periods;
- a table copied from the live report with station, terms, height RMS/p95/max, provider/predicted/matched events, mean timing, and maximum timing;
- the decision: harmonics pass the height representation gates, while provider-event reproduction blocks station publication;
- the explicit next boundary: solve event semantics before any importer or station artifact exists.

Do not retain sampled file sizes, FlatBuffers layout, shard decisions, refresh horizons, prototype artifact names, or historical narration.

- [ ] **Step 4: Delete completed design and plan documents**

Delete the six completed RWS documents listed in this task. Their rationale remains in Git history; `sources/rws/README.md` is the only live RWS status document.

- [ ] **Step 5: Verify no sampled-path references remain**

Run:

```bash
rtk rg -n "rws-predictions|runRwsPrototype|sampled-prediction|\\.rwsp" package.json packages sources schemas docs
```

Expected: no matches. References to historical TICON RWS harmonic handling remain untouched.

- [ ] **Step 6: Run formatting, focused tests, and the full suite**

Run:

```bash
rtk prettier --check .
rtk npm run test -w packages/harmonic-analysis -- --run
rtk npm run test -w sources/rws -- --run
rtk npm test
rtk git diff --check
```

Expected: every command passes. The live `validate` command is intentionally not part of `npm test` because it requires network access and currently reports the event blocker with a nonzero exit.

- [ ] **Step 7: Commit the cleanup and current result**

Run:

```bash
rtk git status --short
rtk git add schemas/rws-predictions.fbs packages/database/scripts/generate-database.ts packages/database/src/rws-predictions packages/database/test/rws-predictions.test.ts sources/rws/prototype.ts sources/rws/README.md docs/superpowers
rtk git commit -m "refactor: remove sampled RWS prototype"
```

Expected: the commit contains only sampled-path deletion, current RWS documentation, and completed-doc cleanup. `tmp/rws/` remains untracked and ignored.

- [ ] **Step 8: Review branch scope**

Run:

```bash
rtk git status --short
rtk git log --oneline origin/main..HEAD
rtk git diff --stat origin/main...HEAD
rtk rg -n "rws-predictions|runRwsPrototype|sampled-prediction|\\.rwsp" package.json packages sources schemas docs
```

Expected: clean worktree, exactly three task commits, a deletion-heavy diff, and no sampled-path references.
