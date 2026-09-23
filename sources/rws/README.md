# Rijkswaterstaat astronomical tides

## Source contract

The validator reads astronomical observations from:

```text
POST https://ddapi20-waterwebservices.rijkswaterstaat.nl/ONLINEWAARNEMINGENSERVICES/OphalenWaarnemingen
```

Rijkswaterstaat Waterdata is available under the
[CC0 declaration](https://rijkswaterstaatdata.nl/waterdata/) unless a component
names a copyright exception. The service documents fair-use throttling, no
uptime guarantee, and a maximum of 160,000 observations per request. Requests
must therefore remain bounded.

Response timestamps require an explicit ISO 8601 offset and are parsed as
absolute instants. Heights are integer centimeters relative to the channel's
`Hoedanigheid.Code`, which must be `NAP` or `MSL`; neither datum is relabeled as
LAT or chart datum. Height chunk boundaries are inclusive, so only an identical
sample shared by adjacent chunk boundaries may be deduplicated.

Calculated high/low water uses paired channels at identical timestamps:

- `GETETTPE` supplies `hoogwater` or `laagwater`;
- `WATHTE` supplies the event height in centimeters relative to the grouping's
  `NAP` or `MSL` datum.

The channels remain paired and in provider order.

## Harmonic validator

Run the fixed validation experiment with:

```bash
npm run validate -w sources/rws
```

- Training period: 2019-01-01 through 2025-01-01.
- Validation period: 2025-01-01 through 2027-01-01.

The live report is:

| Station              | Terms |       Height RMS (m) |       Height p95 (m) |       Height max (m) | Provider events | Predicted events | Matched events | Mean timing (min) |   Max timing (min) |
| -------------------- | ----: | -------------------: | -------------------: | -------------------: | --------------: | ---------------: | -------------: | ----------------: | -----------------: |
| `ameland.nes`        |    99 | 0.016172264221222345 |  0.03146791455111578 | 0.061445649580536554 |            2821 |             2821 |           2821 | 2.546280343849702 | 14.735333333333333 |
| `hoekvanholland`     |    99 | 0.018788666237326265 |  0.03697574651314216 |  0.07908142598322754 |            2821 |             4310 |           2778 | 4.960249004079681 |  59.78478333333333 |
| `denhelder.marsdiep` |    99 | 0.015862789055962986 | 0.031056447681654387 |  0.06420943112767763 |            2821 |             3771 |           2783 | 6.977442202658984 |  57.18888333333334 |

## Decision

Harmonics pass the height representation gates for all three stations. Ameland
also passes its individual event gate; Hoek van Holland and Den Helder do not.
RWS stations remain unpublished until provider event semantics are resolved
across the validation set.
