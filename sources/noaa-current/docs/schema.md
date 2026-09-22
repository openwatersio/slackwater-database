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
  "floodDirection": 23.2,
  "ebbDirection": 203.2,
  "offset": 0.297,
  "constituents": [{ "name": "M2", "amplitude": 1.63, "phase": 295.3 }]
}
```

| Field                      | From NOAA        | Notes                                                                |
| -------------------------- | ---------------- | -------------------------------------------------------------------- |
| `id`                       | station id       | `id` at the primary bin, **`id@bin`** for a reference at another bin |
| `floodDirection`           | `azi`            | major-axis azimuth — the flood set                                   |
| `ebbDirection`             | `azi + 180`      | the reciprocal                                                       |
| `offset`                   | `majorMeanSpeed` | **Z₀**, signed net mean flow. Not optional — see below               |
| `constituents[].amplitude` | `majorAmplitude` | knots (`units=english`)                                              |
| `constituents[].phase`     | `majorPhaseGMT`  | Greenwich phase — pairs with a Greenwich V₀                          |

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
- **Minor-axis constituents.** NOAA publishes `minorAmplitude`/`minorPhaseGMT` for a 2D
  rotary model; a major-axis model doesn't use them, so they aren't carried per station.
  Bundling them was measured and rejected — worth a median 4% of peak speed, and a 2D
  magnitude series never crosses zero, which silently yields no slack events at all.

  The bundle does carry a **`crossFlow` census** at the root: how much perpendicular flow
  the major-axis model drops, and the worst station by ratio and by knots. `validate`
  fails a bundle whose worst ratio exceeds 0.5.
