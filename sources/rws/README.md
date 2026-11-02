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

Harmonics pass the height representation gates for all three stations, so all
three are eligible for harmonic import. Event comparison remains diagnostic:
Ameland matches the RWS event feed, while Hoek van Holland and Den Helder retain
double extrema that RWS reduces to one canonical event per tidal cycle. RWS
does not document a provider-neutral rule that reproduces its shoulder and
plateau timestamp choices, so those differences do not block publication.

## Historical series

TICON's `rws_hist` records are Rijkswaterstaat's long series as GESLA carries them. Quality keeps the ones that run into 2018 and ranks them as historical series. To test that, each record's prediction was compared with the `WATHTE` astronomical series from the `OphalenWaarnemingen` service for January 2026, at the catalogue location nearest the record, with each series' mean removed.

Of the 55 records that run into 2018, 54 have a location within 3 km of their own gauge. They differ from Rijkswaterstaat's prediction by a median RMS of 6.7 cm and at most 14.7 cm (Bath, whose tide has a standard deviation of 158 cm). The other, Rak Zuid, has no such location, and the tidal range check rejects it anyway.

Measured against each location's own tide, the 29 records now published differ by a median 12% of the tide's standard deviation and at most 28%, except Heesbeen, where a 3.2 cm difference is 54% of a 5.9 cm tide. Rak Noord is compared at `willemstad.hollandschdiep`, 1 km away.

Seventeen gauges now publish the `rws_hist` record in place of a record they published before, each at the Rijkswaterstaat location that the records share. Vlissingen replaces two. Den Helder and Vlissingen's CMEMS records sit beyond the 500 m deduplication distance, so they stay accepted on the same station, which shows `rws_hist`. Against the same predictions, in centimetres RMS:

| Gauge                   | RWS location                           | Record replaced | Replaced RMS | `rws_hist` RMS |
| ----------------------- | -------------------------------------- | --------------- | ------------ | -------------- |
| Delfzijl                | `delfzijl`                             | CMEMS           | 10.0         | 9.8            |
| Den Helder              | `denhelder.marsdiep`                   | CMEMS           | 6.3          | 5.8            |
| Den Oever Buiten        | `denoever.waddenzee.voorhaven`         | CMEMS           | 6.2          | 6.0            |
| Haringvliet 10          | `haringvliet.10`                       | CMEMS           | 8.7          | 7.6            |
| Harlingen               | `harlingen.waddenzee`                  | CMEMS           | 7.8          | 7.2            |
| Hoek van Holland        | `hoekvanholland`                       | CMEMS           | 7.6          | 7.2            |
| Huibertgat              | `huibertgat`                           | CMEMS           | 7.0          | 6.5            |
| Keizersveer             | `hank.bergschemaas`                    | CMEMS           | 1.5          | 1.6            |
| Kornwerderzand Buiten   | `kornwerderzand.waddenzee.buitenhaven` | CMEMS           | 6.9          | 6.4            |
| Krimpen ad Lek          | `krimpenaandelek.lek`                  | CMEMS           | 5.9          | 5.9            |
| Nes                     | `ameland.nes`                          | CMEMS           | 6.5          | 6.1            |
| Nieuwe Statenzijl       | `nieuwestatenzijl.dollard`             | CMEMS           | 11.5         | 11.7           |
| Roompot Buiten          | `oosterschelde.roompotsluis.buiten`    | CMEMS           | 9.3          | 8.9            |
| Rotterdam               | `rotterdam.nieuwemaas.boerengat`       | CMEMS           | 7.6          | 8.6            |
| Vlieland Haven          | `vlieland.haven`                       | CMEMS           | 5.8          | 5.1            |
| Vlissingen              | `vlissingen`                           | `rws`, 2023–25  | 12.4         | 10.6           |
| Vlissingen, second page | `vlissingen`                           | CMEMS           | 10.9         | 10.6           |
| Vuren                   | `dalem`                                | CMEMS           | 3.5          | 2.4            |

The `rws_hist` record is closer at 14, level at one, and further at three, by at most 1.0 cm.

At Vlissingen the replaced `rws` record is the outlier. Its 2023–25 fit is too short to separate its constituents: it carries an SA of 33 cm and an L2 of 25 cm, against 12 cm in both long series, and its HAT of 3.56 m sits 65 cm above the `rws_hist` (2.89 m) and CMEMS (2.91 m) values, which agree. At the other gauges the swap moves HAT and LAT by at most 17.5 cm each, and the span between them by at most 21 cm (Vuren).

One month of predictions tests the tide, not the annual term, and a prediction carries no river discharge, so this says nothing about the seasonal signal at the river gauges. Keizersveer's seasonal label depends on the record: its CMEMS record is labelled `seasonal_dominant` and its `rws_hist` record is not.
