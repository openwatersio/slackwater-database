# Validation

A tidal-current engine always produces plausible-looking output. Sinusoids sum to
something that rises and falls twice a day no matter how wrong the constituents,
conventions, or offsets are. The only way to know an implementation is right is to
diff it against NOAA's own published predictions.

## Method

Both halves come from NOAA, so the comparison is self-contained:

1. Pull a station's constituents from `harcon.json` at its `currbin`.
2. Pull NOAA's `currents_predictions` (`interval=max_slack`) for a window of days.
3. Predict that window from the constituents; pair each NOAA event with the nearest
   predicted event of the same kind; report mean and worst timing error and mean
   speed error.

```bash
npm run golden -w sources/noaa-current -- pug1741.json --station PUG1741 --bin 27 \
  --start 2026-07-19 --end 2026-07-21
```

The fixture holds constituents _and_ NOAA's events, so the check replays offline
forever. Wire it into your test suite; it is the regression gate for every convention
decision below.

## What this method settled

Each of these was an open question that the diff answered unambiguously — the wrong
choice produces structural, obvious error, not noise:

| Question                                      | Answer                                               | Wrong-choice cost                                        |
| --------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------- |
| Which phase field?                            | `majorPhaseGMT`                                      | structural offset across all events                      |
| Sign convention for labeling?                 | classify by **velocity sign**, not extremum high/low | a relaxation peak during a long ebb mislabels as flood   |
| Are `mfcAmpAdj`/`mecAmpAdj` ratios or deltas? | ratios                                               | immediate, large speed error                             |
| Include `majorMeanSpeed` (Z₀)?                | yes                                                  | 15.6 → 7.4 min mean timing (see below)                   |
| Reference keyed by id, or (id, bin)?          | (id, bin)                                            | ~50 min at any station whose reference isn't primary-bin |
| Predict type-S via offsets or own harcon?     | own harcon when non-empty                            | 89 min vs 6.8 min at PUG1716                             |

## Measured results

From the reference implementation ([slackwater-engine](https://github.com/openwatersio/slackwater-engine),
Swift), against NOAA's own predictions:

| Check                 | Station(s)                                                          | Result                             |
| --------------------- | ------------------------------------------------------------------- | ---------------------------------- |
| Harmonic oracle       | PUG1741 Bellingham Channel (2.8 kn reversing)                       | **9.7 min / 0.055 kn** (11 events) |
| Subordinate reduction | PCT0236 (ref SFB1201)                                               | **6.1 min / 0.05 kn** (11 events)  |
| Subordinate batch     | 9 pure subordinates — mixed regions, offset signs, ratios 0.2–1.5   | worst **7.7 min / 0.101 kn**       |
| Salish Sea passes     | Deception, Rosario, San Juan Ch., Turn Point, Admiralty, Race Rocks | worst **15.3 min / 0.28 kn**       |

Per-pass: Deception 14.2 min · Rosario 2.2 · San Juan Channel 8.4 · Turn Point 15.3 ·
Admiralty Inlet 3.5 · Race Rocks 6.0.

And independently, from a second implementation
([signalk-currents](https://github.com/sailingnaturali/signalk-currents), TypeScript
over [Slackwater](https://github.com/openwatersio/slackwater)) — the Z₀ measurement at Turn Point,
three days, 24 events:

|            | mean timing | worst      | mean speed   |
| ---------- | ----------- | ---------- | ------------ |
| without Z₀ | 15.6 min    | 55 min     | 0.147 kn     |
| with Z₀    | **7.4 min** | **21 min** | **0.066 kn** |

## Realistic tolerances

Harmonic **±20 min / ±0.35 kn**; subordinate **±30 min / ±0.4 kn**. Tighter than that
and you are fitting noise: the subordinate reduction is a published _table_
approximation, and constricted passes are genuinely harder than open water — Deception
Pass and Turn Point are the worst performers above for real physical reasons, not
implementation ones.

**These are planning-grade numbers.** A 15-minute slack error matters at a pass where
the gate is 20 minutes wide. Derived predictions are unofficial; don't time a transit
of a fast narrows on them alone.

## Extractor fidelity

`extract` is diffed against a known-good bundle whenever it changes. Full US run,
2026-07-19 — 2,785 stations selected, **856 harmonic + 1,705 subordinate**, 238 type-W
skipped, **0 unresolvable references**:

|                                                       |                                     |
| ----------------------------------------------------- | ----------------------------------- |
| Overlapping stations byte-identical                   | **2,558 of 2,558**                  |
| Stations NOAA added since the reference bundle        | 3 (`PUG1519`, `PCT5721`, `PCT5726`) |
| Stations disappeared                                  | 0                                   |
| Subordinate references unresolved                     | 0                                   |
| Reference entries at a **non-primary** bin (`id@bin`) | **14**                              |

That last row is the per-bin trap in live data: 14 subordinates in US waters reduce
against a reference bin that is _not_ that station's primary bin. Key by station id
alone and those 14 silently predict from the wrong depth — while every other station
keeps passing.

Station counts drift as NOAA revises its list; treat the totals as approximate and the
**0 unresolvable references** as the invariant worth gating on.

Unit tests (`npm test`) cover the traps with a fake NOAA: per-bin reference keying,
type-S own-harcon precedence, two-slack offsets, ratio handling, list de-duplication,
and both response shapes NOAA has shipped for `currents_predictions`.
