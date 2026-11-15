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
| `ameland.nes`        |   195 | 0.014355786941592534 |  0.02764512645545525 | 0.056973474833844295 |            2821 |             2821 |           2821 | 1.1904450785773333 |  7.327366666666666 |
| `hoekvanholland`     |   211 |  0.01447056417881225 | 0.028183352452417654 |  0.06444121342169273 |            2821 |             4251 |           2804 | 2.1183862755587244 | 54.586983333333336 |
| `denhelder.marsdiep` |   208 | 0.012199801341323351 | 0.023392913271757965 |  0.04495705107763709 |            2821 |             3523 |           2800 | 2.5218528511904768 |           58.17065 |

## Decision

Harmonics pass the height representation gates for all three stations, so all
three are eligible for harmonic import. Event comparison remains diagnostic:
Ameland matches the RWS event feed, while Hoek van Holland and Den Helder retain
double extrema that RWS reduces to one canonical event per tidal cycle. RWS
does not document a provider-neutral rule that reproduces its shoulder and
plateau timestamp choices, so those differences do not block publication.
