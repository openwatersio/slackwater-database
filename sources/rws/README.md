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

| Station              | Terms |       Height RMS (m) |       Height p95 (m) |       Height max (m) | Provider events | Predicted events | Matched events |  Mean timing (min) |   Max timing (min) |
| -------------------- | ----: | -------------------: | -------------------: | -------------------: | --------------: | ---------------: | -------------: | -----------------: | -----------------: |
| `ameland.nes`        |   118 | 0.014809214414647314 | 0.028209086670600625 |  0.05939561230051893 |            2821 |             2821 |           2821 | 1.1986776497695844 |  6.846316666666667 |
| `hoekvanholland`     |   122 | 0.015268396055516291 |  0.02935155250097088 |  0.06003106007675019 |            2821 |             4257 |           2805 | 2.1184636779560315 | 58.142266666666664 |
| `denhelder.marsdiep` |   119 | 0.012757789073330819 | 0.024299580280432553 | 0.041181919753163654 |            2821 |             3521 |           2797 | 2.5608972053390517 | 59.773583333333335 |

## Decision

Harmonics pass the height representation gates for all three stations, so all
three are eligible for harmonic import. Event comparison remains diagnostic:
Ameland matches the RWS event feed, while Hoek van Holland and Den Helder retain
double extrema that RWS reduces to one canonical event per tidal cycle. RWS
does not document a provider-neutral rule that reproduces its shoulder and
plateau timestamp choices, so those differences do not block publication.
