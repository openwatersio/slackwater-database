# Workspace restructure plan

Goal: the repo root stops being the `@neaps/tide-database` npm package, `tools/` goes away, and every consumer and producer of `data/` lives in a workspace package.

## Target layout

```
data/               station JSON (stays at root — the shared substrate)
quality.json        stays at root, written by stations package, read by database package
packages/
  database/         @neaps/tide-database — the published npm module
  tcd/              (existing) XTide TCD export
  datums/           datum math + sea regions + datum maintenance scripts
  harmonic-analysis/ least-squares re-analysis on @neaps/tide-predictor
  stations/         station file I/O, normalization, filtering/quality, geocode, name cleanup
sources/
  noaa/             monthly NOAA station updater
  ticon/            TICON import pipeline (incl. GESLA download)
```

A possible follow-up (not in scope now): split `data/` into `sources/<source>/data/` so each importer owns its output. Station IDs are already `<source>/<id>` and save/load already take the source as a parameter, so it's a mechanical `git mv` plus repointing the data globs — but it renames ~6,000 files, so it should land on its own when no update PRs are open.

Root `package.json` becomes a private workspace root: `"workspaces": ["packages/*", "sources/*"]`, shared devDeps (typescript, prettier, vitest), and `test`/`lint` scripts that fan out (`npm run test -ws --if-present`).

## Package contents (from current files)

### packages/database (published, keeps name `@neaps/tide-database`)

- `src/`, `scripts/{generate-pack,copy-pack,smoke}.mjs`, `tsdown.config.ts`, `schemas/`, `examples/`, `docs/lazy-loading.md`
- Tests: `test/{search,station-bundle}.test.ts` (`index.test.ts` moves to the stations package — it depends on filtering constants)
- Path fixes: `generate-pack.mjs` data dir → `../../data`; `src/stations.ts` quality import → `../../quality.json`; `src/station-bundle.ts` macro `base: "../data"` → `"../../data"`
- Keeps `prepare`, `imports` (`#station-data`), `exports`, `files` from the current root manifest

### packages/datums

- `tools/datum.ts`, `tools/sea-regions.ts`, `tools/fetch-sea-regions.ts`, `tools/download-gesla.ts` (GESLA feeds datum computation/validation)
- Tests: `test/{datum,chart-datums}.test.ts`
- Deps: `@neaps/tide-predictor`, make-fetch-happen; devDeps: `@neaps/tide-database` (`allStations` in chart-datums test)
- Pure library + its own data fetchers — no dependency on the stations package, so the layering stays one-way (stations → datums)

### packages/harmonic-analysis

- `tools/harmonic-analysis.ts` + `test/harmonic-analysis.test.ts`
- Deps: `@neaps/tide-predictor` only

### packages/stations

- `tools/station.ts` (load/save/normalize, `DATA_DIR` → `../../data`), `tools/filtering.ts`, `tools/name-cleanup.ts`, `tools/geocode.ts`, `tools/util.ts`
- Scripts: `tools/evaluate-quality.ts` as `npm run evaluate-quality` (writes root `quality.json`), plus the cross-source datum maintenance scripts `tools/{backfill-lat-hat,check-lat-hat,validate-datums}.ts` — they need station save/load, and putting them in datums would create a datums↔stations cycle
- Tests: `test/{geocode,name-cleanup}.test.ts`, plus `test/index.test.ts` (validates every data file against the schema and quality gates; imports the database package and filtering constants)
- Deps: geo-tz, country-code-lookup, sort-object-keys, kdbush, geokdbush, make-fetch-happen; `@neaps/tide-database` for types; datums package (`NODAL_CYCLE_DAYS` in evaluate-quality)
- ponytail: filtering/quality lives here rather than a separate `packages/quality`; split it out only if this package grows past station-record concerns

### sources/noaa

- `tools/update-noaa-stations.ts` → `npm run import`
- Deps: stations package

### sources/ticon

- `tools/import-ticon.ts` + the `tools/import-ticon` bash wrapper → `npm run import`
- Deps: stations, datums, harmonic-analysis packages

### Deleted

- `tools/hawaii-converter.js` — legacy UHSLC→Harmgen converter with no pipeline hooks; git history keeps it. Resurrect into `sources/uhslc` if/when UHSLC becomes a real source.
- `tools/README.md` — folded into per-package READMEs / root README.

Internal packages are `"private": true`, named `@tide-database/<name>`, and depend on each other with `"*"` (npm workspace linking). No runtime cycle exists: database imports nothing from the internal packages; they import only types from it.

## CI / workflow changes

- `ci.yml`: `npm pack` / pkg-pr-new / build run `-w @neaps/tide-database`; keep the tcd job as-is (`file:../..` dep → `"*"`)
- `publish.yml`: `npm publish -w @neaps/tide-database`
- `updates.yml`: `tools/update-noaa-stations.ts` → `npm run import -w sources/noaa`; `tools/backfill-lat-hat.ts` → `npm run backfill-lat-hat -w packages/stations`; `tools/evaluate-quality.ts` → `npm run evaluate-quality -w packages/stations`

## Migration order (each step lands green)

1. **Move the module to `packages/database`.** Root becomes private workspace root. Rewrite `tools/*` type imports from `../src/...` to `@neaps/tide-database`. Update tcd's dep, CI pack/publish/build targets, and the three path anchors listed above. This is the risky step — verify `npm install && npm run build -w @neaps/tide-database && npm test` plus `npm run build -w tcd` and a local `npm pack` inspection (dist + schemas present).
2. **Extract `packages/harmonic-analysis` and `packages/datums`.** Move files + tests, fix imports in remaining `tools/*`.
3. **Extract `packages/stations`** (I/O, filtering, geocode, name-cleanup, util, evaluate-quality). At this point `tools/` holds only the two source importers.
4. **Create `sources/noaa` and `sources/ticon`,** add `sources/*` to workspaces, update `updates.yml`, delete `tools/` and `hawaii-converter.js`.
5. **Docs pass:** root README points at the new layout; per-package READMEs carry what `tools/README.md` covered.

Steps 2–4 can be one PR if reviewed together; step 1 should stand alone since it touches publishing.

## Verification per step

- `npm install && npm test` at root (all workspaces)
- `npm run build -w tcd` (exercises the database package as a consumer)
- After step 4: dry-run `npm run import -w sources/noaa` and confirm `git status data/` churn looks like a normal monthly update; run `npm run evaluate-quality -w packages/stations` and diff `quality.json` (should be a no-op)

## Risks

- `publish.yml` and pkg-pr-new are the easiest things to silently break — the npm tarball must be diffed against the current published 0.9.0 layout before merging step 1.
- `updates.yml` runs monthly and unattended; trigger it manually (workflow_dispatch) after step 4 lands and watch the run.
- The `station-bundle.ts` browser build uses a compile-time macro over `data/`; confirm the browser dist still embeds stations after the path change (the existing smoke test should catch it).
