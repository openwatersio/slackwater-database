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
| `ameland.nes`        |   207 |  0.01435578112301965 |  0.02764380845418002 | 0.056971051010291096 |            2821 |             2821 |           2821 | 1.1904227519792059 |            7.32635 |
| `hoekvanholland`     |   219 | 0.014470522097954535 |  0.02818308431638611 |  0.06443857560931221 |            2821 |             4251 |           2804 | 2.1184527876842583 |              54.59 |
| `denhelder.marsdiep` |   222 |  0.01219942817154733 | 0.023392793434850345 |  0.04495253320889536 |            2821 |             3523 |           2800 | 2.5217355714285663 | 58.165366666666664 |

## Decision

Harmonics pass the height representation gates for all three stations, so all
three are eligible for harmonic import. Event comparison remains diagnostic:
Ameland matches the RWS event feed, while Hoek van Holland and Den Helder retain
double extrema that RWS reduces to one canonical event per tidal cycle. RWS
does not document a provider-neutral rule that reproduces its shoulder and
plateau timestamp choices, so those differences do not block publication.
