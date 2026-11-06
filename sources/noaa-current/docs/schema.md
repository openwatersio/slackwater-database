# Bundle schema

Machine-readable: [`schema/currents.schema.json`](../schema/currents.schema.json).

A bundle is `{ note, generated, stations[] }`. Every station is either **harmonic** (has
its own constituents) or **subordinate** (reduces against a harmonic reference).

Units throughout: **speeds knots**, **directions degrees true**, **time offsets
seconds**, **phases degrees Greenwich**.

## Harmonic station

```json
{
  "id": "PUG1717",
  "name": "Turn Point, Boundary Pass",
  "type": "harmonic",
  "azimuth": 23.2,
  "floodDirection": 23.2,
  "ebbDirection": 203.2,
  "offset": 0.297,
  "minorMeanFlow": -0.633,
  "minorConstituents": [{ "name": "M2", "amplitude": 0.14, "phase": 325.6 }],
  "constituents": [{ "name": "M2", "amplitude": 1.63, "phase": 295.3 }]
}
```

| Field                      | From NOAA                          | Notes                                                                                |
| -------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------ |
| `id`                       | station id                         | `id` at the primary bin, **`id@bin`** for a reference at another bin                 |
| `floodDirection`           | `azi`                              | major-axis azimuth — the flood set                                                   |
| `ebbDirection`             | `azi + 180`                        | the reciprocal                                                                       |
| `offset`                   | `majorMeanSpeed`                   | **Z₀**, signed net mean flow. Not optional — see below                               |
| `constituents[].amplitude` | `majorAmplitude`                   | knots (`units=english`)                                                              |
| `constituents[].phase`     | `majorPhaseGMT`                    | Greenwich phase — pairs with a Greenwich V₀                                          |
| `minorConstituents`        | `minorAmplitude` / `minorPhaseGMT` | optional array with the same name/amplitude/phase shape; knots and Greenwich degrees |
| `minorMeanFlow`            | `minorMeanSpeed`                   | optional signed cross-axis mean in knots; published zero is retained                 |
| `azimuth`                  | `azi`                              | optional major-axis bearing in degrees true; missing bearings remain absent          |

Minor constituents come from the same `(station, bin)` as the major constants. There is no amplitude cutoff. Only NOAA's undetermined amplitude=0, phase=0 pairs are omitted. `floodDirection` and `ebbDirection` are also absent when `azi` is missing.

### Predicting from it

Signed velocity along the major axis, at time _t_:

```
v(t) = Z₀ + Σ  fᵢ · Aᵢ · cos(ωᵢ·t + (V₀ᵢ + uᵢ) − φᵢ)
```

…the same sum-of-cosines as a tide station, with nodal corrections _f_, _u_ applied as
usual. Then:

- **positive** velocity = flood, along `floodDirection`
- **negative** = ebb, along `ebbDirection`
- **max flood / max ebb** = the slope-zeros (extrema)
- **slack** = the **value**-zeros — where `v(t)` crosses zero

Label an extremum by the **sign of its velocity**, not by whether it's a curve high or
low. With Z₀ applied, a relaxation peak during a long ebb is a local maximum but is
still an ebb; NOAA labels it `maxEbb` and so should you.

That `Z₀` term is why slack is where it is. Drop it and every zero crossing moves —
measured at 15.6 min mean / 55 min worst error, versus 7.4 / 21 with it.

For a vector timeline, sum `minorConstituents` with the same astronomical arguments and add `minorMeanFlow` to obtain cross-axis velocity `w(t)`. The magnitude is `hypot(v(t), w(t))`; the true bearing is `azimuth + atan2(w(t), v(t))`, with the angle converted to degrees and normalized to [0, 360). Direction requires a known axis and a nonzero vector. Continue finding slack and extrema on the signed major curve: the vector magnitude can remain positive through slack.

The optional root `crossFlow` census describes the cross-axis mean omitted by a one-axis consumer. It is diagnostic; a large cross-flow does not invalidate a record carrying both axes.

## Subordinate station

```json
{
  "id": "PCT0236",
  "name": "…",
  "type": "subordinate",
  "reference": "SFB1201@10",
  "floodDirection": 60,
  "ebbDirection": 240,
  "slackBeforeFloodOffset": -720,
  "slackBeforeEbbOffset": 480,
  "floodTimeOffset": -300,
  "ebbTimeOffset": 180,
  "floodSpeedRatio": 0.7,
  "ebbSpeedRatio": 1.2
}
```

Predict the **reference** station's events, then transform each:

| Event              | Time shift                 | Speed               |
| ------------------ | -------------------------- | ------------------- |
| max flood          | `+ floodTimeOffset`        | `× floodSpeedRatio` |
| max ebb            | `+ ebbTimeOffset`          | `× ebbSpeedRatio`   |
| slack before flood | `+ slackBeforeFloodOffset` | 0                   |
| slack before ebb   | `+ slackBeforeEbbOffset`   | 0                   |

Two traps:

- **Two slack offsets.** A slack takes the offset for the phase it _precedes_ — which
  means you must know what follows it before you can place it.
- **Speed fields are ratios**, multipliers on the reference peak. Not deltas.

`reference` is a key into `stations[]` **including any `@bin` suffix**. Resolve it
exactly; a reference station may appear at several bins with different constituents.

## Not in the bundle

- **Type-W (weak and variable / rotary) stations.** NOAA doesn't publish a usable
  reversing model for them. The extractor counts them in `skipped.typeW` rather than
  emitting something misleading.
- **Subordinates whose reference didn't resolve.** Counted in `skipped.unresolvable`. A
  healthy full-US run drops zero.
