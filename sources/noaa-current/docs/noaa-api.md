# The NOAA CO-OPS currents API, as it actually behaves

Everything here was found by building against the API and validating the output against
NOAA's own published predictions. Several of these behaviours are undocumented, and at
least two of them will make you conclude — wrongly — that the data you want doesn't
exist. That conclusion is why this document exists.

NOAA data is **public domain**. Predictions you derive from it are **unofficial** and
must not be presented as NOAA's own or used as a primary means of navigation.

---

## The one that costs everyone a day

**`harcon.json` returns an empty constituent list unless you query the station's
`currbin`.**

```
GET /mdapi/prod/webapi/stations/PUG1701/harcon.json?units=english&bin=0
→ { "HarmonicConstituents": [] }

GET /mdapi/prod/webapi/stations/PUG1701/harcon.json?units=english&bin=18
→ 26 constituents
```

There is no error, no hint, and `bin=0` is the natural thing to try. The empty array
reads as "NOAA doesn't publish harmonic constituents for currents" — which is what we
concluded, and it is wrong. NOAA publishes constituents for **856 current stations** in
US waters (2026-07; the count drifts as NOAA revises its list).

`currbin` comes from the station list. It is per-station and unguessable.

---

## Endpoints

Base: `https://api.tidesandcurrents.noaa.gov`

| Purpose               | Path                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------- |
| Station list          | `/mdapi/prod/webapi/stations.json?type=currentpredictions&units=english`               |
| Harmonic constituents | `/mdapi/prod/webapi/stations/<id>/harcon.json?units=english&bin=<currbin>`             |
| Subordinate offsets   | `/mdapi/prod/webapi/stations/<id>_<currbin>/currentpredictionoffsets.json`             |
| Published predictions | `/api/prod/datagetter?product=currents_predictions&interval=max_slack&bin=<currbin>&…` |

Note the subordinate-offsets path takes a **composite `<id>_<currbin>`**, unlike every
other station path. `stations/PCT0236/currentpredictionoffsets.json` 404s;
`stations/PCT0236_1/currentpredictionoffsets.json` works.

## The station list repeats itself

Each station appears **once per depth bin**. De-dup by `id` keeping the **first**
entry — that one carries the primary `currbin`. Fields that matter:

```
id, name, lat, lng, type, currbin
```

`type` is `H` (harmonic), `S` (subordinate), or `W` (weak and variable / rotary —
NOAA doesn't publish a usable reversing model for these; we skip them).

## `harcon.json` fields

```
constituentName, description,
majorAmplitude, majorPhase (local °), majorPhaseGMT (Greenwich °),
minorAmplitude, minorPhase, minorPhaseGMT,
majorMeanSpeed, minorMeanSpeed,
azi (major-axis azimuth, ° true), binNbr, binDepth, constNum
```

Mapping that produces predictions matching NOAA's own:

| You want           | Use                              | Notes                                                                                                                                           |
| ------------------ | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| amplitude          | `majorAmplitude`                 | **knots** under `units=english`, **cm/s** under `units=metric` (÷ 51.4444)                                                                      |
| phase              | `majorPhaseGMT`                  | Greenwich phase. Pairs with a Greenwich V₀ — confirmed empirically, see below                                                                   |
| flood direction    | `azi`                            | ebb is `azi + 180`                                                                                                                              |
| **Z₀ / mean flow** | `majorMeanSpeed`                 | signed, knots. **Do not drop this** — see below                                                                                                 |
| minor axis         | `minorAmplitude`/`minorPhaseGMT` | for a 2D/rotary model; unused by a major-axis model — but see `minorMeanSpeed` below                                                            |
| cross-flow         | `minorMeanSpeed`                 | DC flow perpendicular to the axis, running at ALL times including slack. Not carried per station; summarised in the bundle's `crossFlow` census |

### Z₀ is not optional

`majorMeanSpeed` is the station's net mean flow along the major axis. It is a DC offset
on the whole velocity curve, and **slack is defined by where that curve crosses zero** —
so dropping it moves every slack time and skews peak speeds.

It is not a small correction. The Salish Sea passes run **−0.74 to +0.30 kn** of mean
flow (net ebb, as you would expect where a large river system drains to sea). Measured
at Turn Point (PUG1717) against NOAA's own predictions over three days:

|            | mean timing error | worst      | mean speed error |
| ---------- | ----------------- | ---------- | ---------------- |
| without Z₀ | 15.6 min          | 55 min     | 0.147 kn         |
| with Z₀    | **7.4 min**       | **21 min** | **0.066 kn**     |

If your predictions are "close but consistently off around slack", this is why.

### Phase convention

`majorPhaseGMT` is correct for an engine using a Greenwich V₀. This was settled
empirically rather than from documentation: predict a station from its constituents and
compare against NOAA's `currents_predictions` for the same days. With the right
convention the max flood/ebb events land within ~10 minutes; with the wrong one the
error is structural and obvious.

## Subordinate stations

```
refStationId, refStationBin, meanFloodDir, meanEbbDir,
sbfTimeAdjMin (slack before flood),  sbeTimeAdjMin (slack before ebb),
mfcTimeAdjMin (max flood current),   mecTimeAdjMin (max ebb current),
mfcAmpAdj, mecAmpAdj
```

Two things people get wrong:

- **There are two slack offsets, not one.** A slack event takes the offset for the phase
  it _precedes_ — `sbfTimeAdjMin` for a slack before flood, `sbeTimeAdjMin` before ebb.
- **`mfcAmpAdj` / `mecAmpAdj` are ratios**, applied to the reference peak speed. Not
  deltas. (Confirmed by validation: treating them as deltas fails immediately.)

### A reference is a (station, **bin**) pair

A reference station can publish several bins with **different constituents**, and the
subordinate names the one it wants in `refStationBin`:

```
SFB1201 currbin list: [26, 20, 10]
  bin 26 → M2 2.359 kn @ 165.5°
  bin 10 → M2 1.935 kn @ 161.7°
```

Store references keyed by `(id, bin)`. Keying by `id` alone silently predicts from the
wrong depth — and it will _pass_ a single-station test whenever that station's reference
happened to use the primary bin, then be ~50 min wrong elsewhere. Validate against a
diverse batch: mixed regions, positive and negative offsets, ratios from 0.2 to 1.5.

### `type: S` does not mean "use the offset reduction"

Some type-S stations carry their **own** harmonic constituents, and NOAA predicts those
**harmonically**. Applying the offset reduction to them overshoots badly:

| PUG1716 predicted as | error vs NOAA         |
| -------------------- | --------------------- |
| offset reduction     | 89 min / 0.72 kn      |
| own harmonics        | **6.8 min / 0.06 kn** |

**Rule:** for any type-S station, fetch its own `harcon.json` at its `currbin` first. If
it comes back non-empty, treat it as harmonic. Only fall back to
`currentpredictionoffsets.json` for stations whose harcon is genuinely empty — the true
table-subordinates.

**How often does this bite?** Measured across the full US set (2026-07): **1 of 1,706**
type-S stations — `PUG1716`, Waldron Island. Earlier notes of ours said "many"; that was
generalizing from the single case we happened to hit. The rule still stands, because the
check is one request you are already making and the cost of skipping it is an 89-minute
error at whichever station it turns out to be. But calibrate your expectations: this is a
rare-but-severe trap, not a widespread one.

---

## A correction

One widely-repeated claim that **does not reproduce**, recorded here because acting on
it costs real work.

### "NOAA 404s the default fetch/curl User-Agent"

**Not reproducible.** Tested 2026-07-19 from a residential connection with Node 24's
built-in `fetch`, default User-Agent, against five endpoints:

| endpoint                        | default UA   | browser UA   |
| ------------------------------- | ------------ | ------------ |
| `harcon.json`                   | 200, 10898 B | 200, 10898 B |
| `datagetter` (`max_slack`)      | 200, 2023 B  | 200, 2023 B  |
| `stations.json`                 | 200, 3.75 MB | 200, 3.75 MB |
| `currentpredictionoffsets.json` | 200, 375 B   | 200, 375 B   |

Byte-identical responses. The original observation was almost certainly rate-limiting
from high-volume probing, coinciding with a `currents_predictions` product outage on
2026-07-18. This client still sends a browser User-Agent — it costs nothing and NOAA
may well throttle unfamiliar clients under load — but **a missing User-Agent is not the
cause of a 404 you are debugging.** Look at your `bin` first.

The supported way to identify yourself is the `application` parameter on `datagetter`.

### What _is_ real about access

- **Datacenter IPs are _not_ blocked**, contrary to what we believed. A GitHub-hosted
  runner fetched all four endpoint families — `stations.json` (3.75 MB), `harcon`,
  `currentpredictionoffsets`, and `datagetter` — with 200s and byte counts identical to
  a residential connection (2026-07-19). A **full US extraction also completes from a
  GitHub-hosted runner** — 2,785 stations, ~2,800 paced requests, 25 minutes, zero
  throttling failures — so this is safe to automate in CI.
- **NOAA throttles bulk callers.** A full US extraction is thousands of requests. Pace
  them (this client defaults to 400 ms) or you will get intermittent failures that look
  like missing data.
- **The predictions product does go down.** It was unavailable on 2026-07-18. If
  `currents_predictions` returns "not available" for a station you believe is served,
  check a known-good station before concluding anything about yours.

---

## Dead ends, ruled out

- **XTide / Harmbase2 as the constituent source.** Unnecessary. NOAA publishes current
  constituents directly, public domain, at `currbin`.
- **`harcon.json?bin=0`.** Empty for currents. Always use `currbin`.
- **`currents_predictions` for observation/survey stations.** Real-time buoys (e.g.
  `cb0102`) aren't served by the predictions product; it is a published-tables product.
  Note that station _type_ alone doesn't tell you: PUG1717 is survey-flagged and **is**
  served at bin 35. Ask the API rather than inferring.

## Validating your own implementation

Don't trust a currents engine that hasn't been diffed against NOAA. The method is
self-contained, since both halves come from NOAA:

1. Pull a station's constituents from `harcon.json` at its `currbin`.
2. Pull NOAA's own `currents_predictions` (`interval=max_slack`) for a window.
3. Predict that window from the constituents and diff the events.

`noaa-current-stations golden` captures both halves into one fixture so the comparison
replays offline. Expect ~10 min / 0.05 kn at a clean reversing station; see
[validation.md](validation.md) for measured results and realistic tolerances.

## Prior art

- [`RyanCardin15/Perigee-Tides`](https://github.com/RyanCardin15/Perigee-Tides) — an MCP
  server over the same API. Comparing its request format against ours confirmed the
  request shape was never the problem, which is what pointed us at `currbin`.
