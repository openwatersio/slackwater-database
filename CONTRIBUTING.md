# Contributing

The project layout, local setup, the checks CI runs, how a release is cut, and the traps that have cost someone real time.

See the org-wide [writing style](https://github.com/openwatersio/github/blob/main/docs/agents/writing-style.md) for prose in commits, pull requests, issues, and docs.

## Scientific accuracy

Scientific accuracy comes first. When the scientifically correct change and the convenient one differ, make the correct one, even when it is larger, touches more packages, or changes which stations ship. A smaller diff, a narrower review, or unchanged quality results are never reasons to keep something that is wrong.

- Keep each source's values at the precision it publishes. Carry that precision through our conversions to metres and UTC, and remove the float noise those conversions add (`PUBLISHED_PRECISION` in [packages/stations/station.ts](packages/stations/station.ts)). Stored digits are the publisher's, not a statement of accuracy.
- A quality gate must only decide on differences larger than the uncertainty of the analysis, never on stored digits. A comparison between two values inside their shared uncertainty is noise, and a gate that rejects or accepts on it is wrong. The tolerance and its sources are in [packages/stations/filtering.ts](packages/stations/filtering.ts).
- Below detection is not missing. A small or zero amplitude is a measured value, and the code must treat it as one. Only a source's own marker for a constituent it did not determine, such as NOAA's amplitude 0 with phase 0, means missing.
- When a change exposes a wrong result elsewhere (a gate, a label, a datum), fix the wrong result. Do not pick an option because it hides the problem.
- Back each claim with a measurement on the real data or a cited source, and say plainly when an argument does not hold. A threshold with no published basis is documented as this project's definition.

## Layout

- `packages/database` — the published `@slackwater/database` package and the FlatBuffers builder. Its format is documented in [docs/database-format.md](docs/database-format.md).
- `packages/stations` — station identity, quality evaluation, and the station-file writer.
- `packages/datums` — datum derivation and the ordering gate.
- `packages/harmonic-analysis` — constituent fitting.
- `packages/tcd` — the XTide-compatible TCD writer.
- `packages/swift` — the generated Swift reader. The generated sources are committed, because SwiftPM consumers cannot run `flatc`.
- `sources/*` — one directory per upstream provider: `chs`, `dmi`, `jhod`, `kartverket`, `linz`, `noaa`, `noaa-current`, `rws`, `ticon`.
- `stations/` — one file per published station: its records, URL, redirects and curated fields. See [stations/README.md](stations/README.md).
- `data/`, `metadata/`, `schemas/` — downloaded source data, reviewed reference snapshots, and the FlatBuffers schemas.

## Getting started

```sh
npm ci
npm run check
```

`.mise.toml` pins Node 24, npm 11.19.0 and `flatc` 25.9.23; CI selects the same Node with `actions/setup-node` and gets `flatc` from `jdx/mise-action`. A fresh checkout or worktree needs `mise trust` before anything builds, or `pretest` dies with `spawnSync flatc ENOENT`.

## Commands

From the repo root:

| Command                              | Does                                                                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                      | Lint, test and validate, which CI runs. Run it before pushing; set `PUBLISHED_REF=origin/main` to add CI's published-URL check. |
| `npm run build`                      | Generate the database and build `@slackwater/database`                                                                          |
| `npm test`                           | Build, typecheck, then run every workspace's `test` script                                                                      |
| `npm run stations`                   | Evaluate quality and rewrite the [station files](stations/README.md) after a code or data change                                |
| `npm run merge -w packages/stations` | Make the confident merges `report:merges` lists; `-- <slug>...` also merges the review groups those slugs survive as            |
| `npm run validate`                   | Fail on any station file `npm run stations` would change; `PUBLISHED_REF=<ref>` also checks published URLs against that ref     |
| `npm run pack:local`                 | Build and pack `@slackwater/database` into `tmp/pack` (or `-- <dir>`) and print the tarball's path, for consumers to test       |
| `npm run lint` / `npm run format`    | Prettier check / write                                                                                                          |

Each workspace uses the same verbs, run with `-w <workspace>`:

| Verb                          | Means                                                                                                                                                                                                                                                     | Where                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `import`                      | Pull a source's data into `data/`                                                                                                                                                                                                                         | `sources/noaa`, `noaa-current`, `ticon`, `kartverket`, `linz`, `chs`, `dmi`, `jhod`                                                                                                                                                                                                                                                                                        |
| `refresh:<name>`              | Refresh a pinned snapshot or fixture; review the diff before committing                                                                                                                                                                                   | `refresh:places`, `refresh:water-bodies`, `refresh:maritime-zones`, `refresh:lat-hat`, `refresh:chs-fit` (`packages/stations`), `refresh:sea-regions` (`packages/datums`), `refresh:uhslc` (`sources/ticon`), `refresh:lock`, `refresh:golden` (`sources/noaa-current`), `refresh:fixtures`, `refresh:tide-tables` (`sources/kartverket`), `refresh:jhod` (`sources/jhod`) |
| `report:<name>`               | Diagnostics that change no tracked file; `report:ticon-datums` and `report:score-line` first download GESLA into `tmp/`                                                                                                                                   | `report:quality`, `report:merges`, `report:lat-hat`, `report:ticon-datums`, `report:chs-fit-age` (`packages/stations`), `report:score-line` (`packages/harmonic-analysis`), `report:drift` (`sources/noaa-current`)                                                                                                                                                        |
| `validate`, `validate:<name>` | Check a source's data against its publisher's predictions (`kartverket`, `rws`, `dmi`, `jhod`) or its own schema (`noaa-current`); `rws` and `dmi` also write reports and caches. `validate:chs-fit` checks each CHS results snapshot against its release | `sources/kartverket`, `sources/rws`, `sources/noaa-current`, `sources/dmi`, `sources/jhod`, `validate:chs-fit` (`packages/stations`)                                                                                                                                                                                                                                       |
| `test:docker`, `test:swift`   | Tests that need Docker or a Swift toolchain, run in their own CI jobs                                                                                                                                                                                     | `packages/tcd`, `packages/swift`                                                                                                                                                                                                                                                                                                                                           |

`npm test` **does** include the type gate: it is `npm run build -w packages/database && tsc -p tsconfig.node.json && …`. There is no root `tsconfig.json`, so `npx tsc -p tsconfig.json --noEmit` fails with TS5058 — name `tsconfig.node.json` explicitly. It inherits `exactOptionalPropertyTypes` from `tsconfig.base.json`, so assigning a possibly-undefined value into an optional field is an error; spread it conditionally instead.

If `npm run validate` reports that station files are stale, run `npm run stations`, review the station-file diff, and commit it.

The Swift job uses the runner-provided compiler; `.mise.toml` pins the Node/npm and schema-generator tools. Follow the shared [Swift toolchain guidance](https://github.com/openwatersio/.github/blob/main/docs/agents/swift.md) for local compiler selection, Xcode SDK compatibility and installation or runner changes.

The Swift job additionally regenerates the committed Swift and fails on drift:

```sh
npm run generate -w swift && git diff --exit-code -- packages/swift/Sources
```

## Releases

A release is cut entirely by dispatching the workflow. Nothing is tagged or versioned by hand:

```sh
gh workflow run publish.yml --ref main
```

Before dispatching it, test the release in each consumer. This step is required. The version is the UTC date, so only one release a day can publish, and twice a published release had problems a consumer found afterwards. From an up-to-date `main`:

```sh
npm run pack:local   # builds and packs packages/database, printing the tarball's path
```

The tarball carries the version a release dispatched that UTC day would publish, such as `1.0.0-beta.20261018`, derived the way `publish.yml` derives it, so a consumer that reads the release date from the version sees one. `packages/database/package.json` keeps its floor version.

Install that tarball in each consumer and run its full build and tests against it:

- [slackwater.xyz](https://github.com/openwatersio/slackwater.xyz): `npm install --ignore-scripts <tarball>`, then `npm run build`, `npm run typecheck`, `npm test` and `npm run test:agents`, in that order. The site sets `strict-allow-scripts`, which refuses a local tarball's `prepare` script; a registry install never runs it, so `--ignore-scripts` installs the tarball the way the release will arrive. The build comes first because it writes `src/routeTree.gen.ts`, which is gitignored and which typecheck and the tests import; the site's own CI runs them in this order.
- [slackwater-ios](https://github.com/openwatersio/slackwater-ios): in `tools/`, `npm install <tarball>` and `npm test`, which regenerates the bundle with `build:data` and tests it. Then build and test the app on that bundle. A release ships the Swift reader with the `stations.tcdb` it reads, so in `project.yml` replace the `SlackwaterDatabase` package's `url` and `exactVersion` with `path:` to a checkout of this repository at the commit you packed, and run `./scripts/test.sh --full`, which regenerates the project. The `tools/` tests never compile the app, so they cannot catch a reader change the app does not build against.

Passing means each consumer's bump is ready to open, not that its failures match `main`'s. A failure a `main` tarball shares is drift that bump has to fix, so fix it in the consumer before dispatching. Then read what the release changes in each, because a defect found after publishing waits for the next UTC day's release:

- slackwater-ios: diff the regenerated `Slackwater/Resources/` against the committed bundle. Every tide station that leaves `stations.json` lands in `station-successors.json`, where a saved favorite moves to the station that now holds its route, or in `station-tombstones.json`, where the favorite is lost for good. A tombstone beside a new record of the same gauge is a merge this repo missed, so fix it here before publishing.
- slackwater.xyz: build, then diff `sitemap-tides.xml` and `sitemap-currents.xml` against the live site's. Every URL that leaves must reach its station's new page through `formerPaths`, or be one the quality pass now withholds, which lands on the nearest place page. A new page with a `-<provider>-<id>` slug beside an existing page of the same name is usually that same missed merge.

Dispatch `publish.yml` only when both bumps are ready. Don't commit either consumer's install of the tarball; they pin the published version once it is out.

`packages/database/package.json` holds a **floor** version such as `1.0.0-beta.0`. The workflow replaces its last segment with today's date to derive `1.0.0-beta.20260926`, publishes to npm, then tags and creates the GitHub release with the `.tcd` and `.tcdb` assets. The `exact` input exists only for the first stable `X.Y.0`.

The workflow publishes the release with GitHub-generated notes and the tag as its title, so finish it right after the run, following the org's [release notes guidance](https://github.com/openwatersio/.github/blob/main/docs/agents/releases.md#release-notes). Retitling and editing a published release is safe; the publish workflow does not run on edits.

- Set the title to a short headline of what changed for apps and developers using the station data, in sentence case with no period and no version: `gh release edit <tag> --repo openwatersio/slackwater-database --title "<headline>"`.
- Edit the generated notes (`gh release edit <tag> --repo openwatersio/slackwater-database --notes-file <file>`, or the release page). Open with a sentence or two on what is new and who it is for, list breaking changes first, then one bullet per change people will notice, each linking its pull request. Drop entries nobody using the data would notice: chores, CI, test changes, and dependabot bumps, except a runtime dependency change that matters to consumers.
- The daily betas stay marked as prereleases.

Three things that look like failures and are not:

- The npm registry can take twenty minutes to show a new version after the publish step succeeds, while the step's log says "Your package is being processed".
- `npm view` reports stale dist-tags during that window.
- npm's `latest` tag sits on the `1.0.0-beta.0` floor. The publish step adds `--tag beta` only when the version contains a `-`, so the first stable `1.0.0` will move `latest` by npm's own default. Install `@slackwater/database@beta` until then. This was filed once and closed as not planned (#206).

Verify a release against the registry rather than the run log, since the publish step passes before npm has propagated. Install `@slackwater/database@beta` into a scratch directory and read the affected stations back.

A release is not finished until both consumers pin it. Bump [slackwater-ios](https://github.com/openwatersio/slackwater-ios) and [slackwater.xyz](https://github.com/openwatersio/slackwater.xyz) to the same version in the same pass, so the app and the site name, place, and credit every station alike. slackwater-ios pins it twice, in `tools/package.json` and as the `SlackwaterDatabase` `exactVersion` in `project.yml`, and regenerates its bundle with `cd tools && npm run build:data`.

## Gotchas

**The repo was renamed.** `openwatersio/tide-database` redirects to `openwatersio/slackwater-database`, so an old clone's `origin` keeps working and `gh` resolves through the redirect without saying so. A local checkout directory named `tide-database` is the same repo.

**Build-time lookups are not an indexing problem.** Every boundary lookup runs while the database builds — the iOS app does none — and over ~11k stations they were measured at 187 ms for water bodies, 268 ms for maritime zones, and ~135 ms to load the GeoJSON. There is nothing there for a spatial index to save, so don't reach for FlatGeobuf or an R-tree. When one of these is slow it is algorithmic: the Baltic chart-datum check took 2–6 s because it had no bounding-box test, and adding one (#214) took it to ~20 ms with a byte-identical `.tcdb`. Look for a missing bbox prefilter first.

The coastline audit (`position-audit.ts`, ~3 s) is dominated by 98 onshore stations running ~1,150 spiral probes each. A nearest-segment distance would fix it, but it shifts `metresInland` and every station file's `computed` block would change, so it is left alone deliberately.
