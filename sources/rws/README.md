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

| Station              | Terms |       Height RMS (m) |      Height p95 (m) |      Height max (m) | Provider events | Predicted events | Matched events | Mean timing (min) |   Max timing (min) |
| -------------------- | ----: | -------------------: | ------------------: | ------------------: | --------------: | ---------------: | -------------: | ----------------: | -----------------: |
| `ameland.nes`        |    99 | 0.017409104477907805 | 0.03386649035839129 |  0.0633979215455307 |            2821 |             2821 |           2821 | 2.602195397613132 |           17.65325 |
| `hoekvanholland`     |    99 | 0.017703833207220594 |  0.0345284129698904 | 0.09415214715516984 |            2821 |             4327 |           2793 | 4.349037981859403 |  56.56828333333333 |
| `denhelder.marsdiep` |    99 | 0.015482873446090605 |  0.0301846084702182 | 0.06531766591323769 |            2821 |             3749 |           2786 | 7.055130629337159 | 59.649816666666666 |

## Decision

Harmonics pass the height representation gates for all three stations. Provider
event reproduction fails, so no RWS station is publishable.

Event semantics must be solved before an importer or station artifact exists.
