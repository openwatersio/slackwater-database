# RWS harmonic fit design

## Goal

Prove that Rijkswaterstaat astronomical heights can be represented by the existing harmonic station model. The work ends with a robust fitter and a reproducible validator. It does not import, publish, or ship RWS stations.

## Scope

- Fit the 49 TICON RWS constituents plus 50 residual-ranked constituents with a numerically stable least-squares solver.
- Train from 2019 through 2024 and validate against the untouched 2025–2026 height and event series.
- Validate three representative stations: `ameland.nes`, `hoekvanholland`, and `denhelder.marsdiep`.
- Report height accuracy, coefficient sanity, and provider-event agreement.
- Remove the sampled-prediction schema, reader, builder, prototype, tests, and completed sampled-prediction documents.
- Keep all generated responses, caches, and reports under ignored `tmp/rws/`.

## Harmonic solver

Keep `fitHarmonics(samples, names)` and its streaming normal-equation implementation unchanged for TICON callers. Add an opt-in SVD mode through a third argument. The SVD path uses `ml-matrix`; it does not add another matrix implementation to the repository.

The caller must pass a bounded sample set because the SVD path materializes the design matrix. The RWS validator passes 4,000 samples, producing a matrix of roughly 4,000 by 199 rather than one row for every ten-minute observation. The fitter continues to resolve aliases, reject known mismatched constituent definitions, and return the existing amplitude/phase shape.

One harmonic-analysis test fits a deterministic 99-constituent synthetic series and verifies finite coefficients and reconstructed levels. A rank-deficient input returns the SVD minimum-norm solution and must never return non-finite coefficients.

## RWS analysis

The validator is a source-owned command under `sources/rws/`. It performs one fixed experiment rather than exposing a general fitting framework.

For each station it:

1. fetches and validates the complete 2019–2026 ten-minute height series and the 2025–2026 calculated extrema;
2. uses 2019–2024 only for constituent selection and fitting;
3. fits the existing 49-constituent TICON basis;
4. scores every remaining canonical positive-speed `@neaps/tide-predictor` constituent against residuals from a deterministic 24,000-row spread sample;
5. selects the 50 highest residual amplitudes that are not aliases of an existing term;
6. performs the SVD fit on a deterministic 4,000-row spread sample; and
7. evaluates every 2025–2026 height and published event without using either series to select constituents or coefficients.

Deterministic spread sampling covers the complete training interval and uses the station code only to offset the selected rows. A second deterministic 4,000-row selection checks prediction stability. The two fits may distribute amplitude differently among near-collinear constituents, but their full held-out predictions must agree within 5 mm RMS.

The command writes a JSON report and exits nonzero when a required gate fails. Cached HTTP responses include request identity and checksum. Incomplete responses, changed datum, unexpected cadence, duplicate timestamps, non-finite values, or event channels that do not pair by timestamp fail before fitting.

## Validation gates

Height representation passes per station when:

- held-out RMS error is at most 2 cm;
- held-out 95th-percentile absolute error is at most 4 cm;
- held-out maximum absolute error is at most 10 cm;
- all amplitudes and phases are finite; and
- the independent-fit prediction difference is at most 5 mm RMS.

Event diagnostics use the repository's existing matching rule: same event type, unique match, and at most 60 minutes apart. The report includes provider count, predicted count, matched count, mean timing error, and maximum timing error. The publication gate remains at least 95% matched, mean below 5 minutes, and maximum below 15 minutes. Event failure is an explicit blocker; the validator does not add smoothing, prominence tuning, or double-extrema heuristics.

The measured three-station experiment supports the height gates: 1.54–1.76 cm held-out RMS, roughly 3.0–3.4 cm p95, and 6.1–9.3 cm maximum error. It does not support the event gate at Hoek van Holland or Den Helder.

## Repository shape

- `packages/harmonic-analysis/index.ts`: opt-in SVD solve using the existing basis construction and result type.
- `packages/harmonic-analysis/index.test.ts`: one robust-fit regression test in addition to the existing normal-equation test.
- `packages/harmonic-analysis/package.json`: `ml-matrix` dependency.
- `sources/rws/harmonics.ts`: RWS fetch, deterministic selection, fit, and validation command.
- `sources/rws/harmonics.test.ts`: one bounded test covering deterministic selection and validation failure reporting.
- `sources/rws/package.json`: command and test scripts so the root suite can run the source test.
- `sources/rws/README.md`: source semantics, harmonic decision, measured height evidence, and event blocker.

The sampled-prediction FlatBuffers schema and internal database reader/writer are absent. Their generated accessor remains ignored and is removed by the normal generation step. The root schema-generation list and test command include only live components.

## Out of scope

- Importing RWS stations into the database
- Publishing generated constituent records
- Shipping sampled heights or provider events
- Changing TICON fitting behavior
- Solving event selection or double-extrema semantics
- Running the experiment across the complete RWS catalog
- Adding refresh or release automation
