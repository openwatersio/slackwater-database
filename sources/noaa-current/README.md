# NOAA Current Stations

**NOAA CO-OPS tidal-current station data — the extractor, the schema, and the API's
undocumented behaviour, in one place.**

NOAA publishes harmonic constituents for **856 tidal-current stations** in US waters,
plus offset tables for **1,700-odd subordinate** stations. That is enough to predict slack
water and max flood/ebb offline, anywhere in US waters, with no network at runtime.

This private source workspace owns NOAA-current extraction and its reviewed bundle. The bundle feeds the unified TCDB release and is not published as a separate npm package.

## Use it

```bash
npm run check -w sources/noaa-current
npm run extract -w sources/noaa-current -- --pace 300
npm run golden -w sources/noaa-current -- pug1741.json --station PUG1741 --bin 27 --start 2026-07-19 --end 2026-07-21
npm run lock -w sources/noaa-current
npm run validate -w sources/noaa-current
```

> A full US extraction is ~2,800 paced requests and takes several minutes. NOAA
> throttles bulk callers — leave the pacing alone unless you have a reason.

The extractor and live API client are available to other workspace code:

```js
import {
  extractBundle,
  fetchCurrentPredictions,
  fetchHarcon,
} from "@neaps/noaa-current";

// A bundle you can ship and predict from offline.
const { bundle, skipped } = await extractBundle({ stations: ["PUG1717"] });

// Or NOAA's own published predictions, live.
const events = await fetchCurrentPredictions(
  "PUG1717",
  35,
  new Date("2026-07-19"),
  new Date("2026-07-21"),
);
// → [{ time: '2026-07-19T01:44:00.000Z', kind: 'flood', velocityMajor: 2.85, … }]
```

## What a bundle looks like

```json
{
  "note": "Generated from NOAA CO-OPS mdapi …",
  "crossFlow": {
    "measured": "…",
    "records": 856,
    "gte0_25kn": 62,
    "gte0_50kn": 12,
    "worstRatio": {
      "id": "BOS1130",
      "crossFlow": 0.178,
      "alongAxisPeak": 0.74,
      "ratio": 0.241
    },
    "worstAbsolute": { "id": "PUG1619", "crossFlow": 0.803 }
  },
  "stations": [
    {
      "id": "PUG1717",
      "name": "Turn Point, Boundary Pass",
      "type": "harmonic",
      "floodDirection": 23.2,
      "ebbDirection": 203.2,
      "offset": 0.297,
      "constituents": [{ "name": "M2", "amplitude": 1.63, "phase": 295.3 }]
    },
    {
      "id": "PCT0236",
      "name": "…",
      "type": "subordinate",
      "reference": "SFB1201@10",
      "slackBeforeFloodOffset": -720,
      "slackBeforeEbbOffset": 480,
      "floodSpeedRatio": 0.7,
      "ebbSpeedRatio": 1.2
    }
  ]
}
```

Speeds in knots, directions degrees true, time offsets in seconds. Full schema:
[schema/currents.schema.json](schema/currents.schema.json) ·
[docs/schema.md](docs/schema.md).

Four details that are easy to get wrong and expensive to debug:

- **`offset` is Z₀**, the station's net mean flow (NOAA `majorMeanSpeed`). Slack is
  where the velocity curve crosses zero, so dropping this moves every slack time. The
  Salish passes carry −0.74 to +0.30 kn of it. Measured cost of omitting it: **15.6 →
  7.4 min** mean timing error.
- **A reference is `(station, bin)`**, hence `SFB1201@10`. Constituents vary by depth
  bin and a station may publish several; keying by station id alone silently predicts
  from the wrong depth.
- **A `type: S` station is not necessarily subordinate.** A few carry their own harcon
  and NOAA predicts them harmonically; the offset reduction overshoots them badly
  (89 min vs 6.8 min at PUG1716). Rare — 1 of 1,706 — but you can't tell which without
  asking, and the ask is one request.
- **The model is one axis, and the bundle says how much that costs.** `crossFlow` is a
  census of NOAA's `minorMeanSpeed`, the flow perpendicular to the flood axis that runs
  even at slack. `validate` fails above a 0.5 ratio. Bundling the full minor axis was
  measured and rejected: a 2D magnitude series never crosses zero, so slack detection
  silently returns nothing.

## Maintenance

`currents.json` is committed, pretty-printed, so a change in NOAA's data is reviewable
as a diff. [`update-currents`](../../.github/workflows/update-currents.yml) keeps it current:

| Cadence | What runs                                               | Catches                                                   |
| ------- | ------------------------------------------------------- | --------------------------------------------------------- |
| Weekly  | pre-flight — **one** request for the station list       | stations added, removed, or reclassified                  |
| Monthly | forced full extraction (~2,800 paced requests, ~25 min) | NOAA revising an existing station's constituents in place |

The weekly pre-flight only escalates to a full extraction when something moved, so the
common case costs a single request. Either way, a change pushes a branch and files a
review issue with the validation summary and pull-request link — nothing updates silently.

`stations.lock.json` pins the current list; `noaa-current-stations check` is the same
pre-flight you can run yourself, and exits non-zero on drift.

```bash
npm run check -w sources/noaa-current
npm run validate -w sources/noaa-current
```

`validate` gates the automated review branch: it fails on a subordinate whose reference
went missing, duplicate ids, a harmonic station with no constituents, or a bundle that
lost its Z₀ offsets — the shapes a truncated extraction takes.

## Don't trust it until you've diffed it

Both halves of a validation come from NOAA, so the check is self-contained: predict from
`harcon` constituents, compare against NOAA's own `currents_predictions` for the same
days. `noaa-current-stations golden` captures both into one fixture that replays offline.

Expect ~10 min / 0.05 kn at a clean reversing station. Measured results, realistic
tolerances, and the list of convention questions this method settled:
[docs/validation.md](docs/validation.md).

## Scope

US waters only — this is a NOAA client, and NOAA publishes US stations. Other national
hydrographic offices publish current data under their own terms; that is out of scope
here.

## If you're calling the NOAA API yourself

You probably don't need to — that's what the bundle is for. But if you are, the API has
undocumented behaviours that make the data look like it doesn't exist. The worst one:

```
GET /stations/PUG1701/harcon.json?bin=0   → { "HarmonicConstituents": [] }
GET /stations/PUG1701/harcon.json?bin=18  → 26 constituents
```

`bin=0` is the natural thing to try, and the empty array reads as "NOAA doesn't publish
current constituents." It does — at each station's `currbin`, and nowhere else.

**[→ docs/noaa-api.md](docs/noaa-api.md)** has the rest, including the widely-repeated
User-Agent-blocking claim that turns out **not** to be true.

## Licence and disclaimer

Code MIT. NOAA CO-OPS data is **public domain**.

**Predictions derived from this data are UNOFFICIAL.** They are not NOAA products, they
are not certified for navigation, and they should not be presented as either. Slack
timing at constricted passes can be off by 15 minutes or more. Use official published
tables to time anything that matters.
