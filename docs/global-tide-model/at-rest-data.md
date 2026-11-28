# Vessels at rest in the crowd data

How much at-rest depth data the crowd-depth sources hold, and whether its depth follows the tide. Measured in October 2026 for [a global tide model with vessel observations](README.md).

## Data

- **Open Waters:** every plugin submission in the crowd-depth R2 bucket, 11,219 GeoJSON files (10.2 GB) from 20 vessels. These are unsimplified. Of the files, 65 come from plugin v1.3.0 or later, which drops at-rest soundings from vessels with an antenna offset and no heading sensor, 11,152 from earlier versions, which kept them, and 2 name no version.
- **NOAA CSB:** a local subset of the DCDB archive, 6,390 CSVs (5.5 GB) from 201 vessels. Most were processed in January 2026 and the rest in April 2017. The archive holds about 784,000 files, so this is under 1% of it, and it is not a random sample. Vessels whose ids start with `SIGNALK-` are Open Waters vessels forwarded to NOAA. One appears in the subset, and it is left out so no vessel is counted twice.

Both are private or local copies. The numbers depend on those files and on the station database at the time of measurement. Soundings that could not be read, or whose depth was a missing-value sentinel, were skipped: 0.9% of Open Waters soundings and 2.5% of NOAA's.

## Method

1. Reduce each vessel's soundings to one-minute medians of position and depth. Overlapping uploads are deduplicated by keeping the fullest minute. Times without a zone are read as UTC.
2. Mark a minute as still when the vessel is within 50 m of where it was 5 minutes before and 5 minutes after. Where a track has no sample inside that window, as in a simplified track, the adjacent samples within the gap limit stand in.
3. Join still minutes into an episode until a moving minute or a gap of more than 30 minutes. Keep episodes of at least an hour whose footprint, the 95th percentile distance from their median position, is at most 150 m.
4. Group episodes into sites: each episode joins the first site whose first episode lies within 200 m, or starts a new site. Sites are counted per source.
5. Find the nearest accepted tide station of any kind within 50 km, and the nearest accepted tide reference station with harmonics within 50 km. Current stations predict speed and subordinate stations have no harmonics of their own, so neither is used as a reference.
6. Take the range as the reference station's predicted range over the 25 hours centred on the episode's midpoint. That is one measure for every source, at that point in the spring–neap cycle. A stay longer than a day is binned by its middle day.
7. For episodes of 6 hours or more with at least 60 sampled minutes, fit `depth = a + gain·η(t − lag) + drift·t` by least squares, where `η` is the same station's predicted tide. The lag is searched over ±3 hours in 5-minute steps. The tide R² is the share of what intercept and drift leave unexplained that the tide term explains, so a drifting depth with no tide in it scores zero.

The fit is a check that the depth tracks the tide, not a tidal analysis. Gain and lag combine the real difference between the anchorage and the station with every error source in the README. Choosing the best of 73 lags makes the tide R² slightly optimistic.

## Reproducing

The [scripts](scripts) run in order on a directory of submissions. The Open Waters files come from the crowd-depth R2 bucket, and NOAA's from the DCDB archive. Downloaded files are untrusted, so run Python with `-I` and pass the data directory as an argument. `tide.mjs` needs a built database (`npm run build`).

```bash
python3 -I docs/global-tide-model/scripts/extract.py <data_dir> <out_dir>
```

```bash
uv run --with numpy python -I docs/global-tide-model/scripts/episodes.py <out_dir>
```

```bash
node --max-old-space-size=8192 docs/global-tide-model/scripts/tide.mjs <out_dir>
```

```bash
uv run --with pandas --with numpy --with tabulate python -I docs/global-tide-model/scripts/summary.py <out_dir>
```

For NOAA data, set `EXCLUDE_VESSEL_PREFIX=SIGNALK-` before `extract.py` to leave out Open Waters vessels. Setting `MAX_GAP_MIN=720` before `episodes.py` repeats the gap check. `extract.py` holds every vessel-minute in memory, about 1 GB for these sets, so the whole NOAA archive would need it to work in parts. The output directory holds vessel ids and positions, so it stays private.

## Totals

| Source      | Episodes |  Hours | Vessels | Sites | Still share of all minutes | Median footprint | 90th pct footprint |
| ----------- | -------: | -----: | ------: | ----: | -------------------------: | ---------------: | -----------------: |
| Open Waters |    1,291 | 56,654 |      18 |   714 |                        92% |           13.4 m |             43.1 m |
| NOAA subset |    1,773 | 20,736 |     140 |   618 |                        52% |            3.8 m |             30.2 m |

If the NOAA subset is typical of the archive, the whole archive holds on the order of two million hours at rest. Open Waters holds fewer vessels but much longer stays: a few vessels upload months of history, including berths of 15 to 90 days.

### Does NOAA's simplification remove at-rest time?

NOAA thins tracks with Douglas-Peucker before publishing them. Two checks:

- **The same vessel in both sources.** The Open Waters vessel that also appears in the NOAA subset has 60 submissions there, over 125 days. NOAA's copy holds all 11,832 of the soundings in the raw submissions, and the same 31 episodes. That vessel sent one sounding a minute, so this shows NOAA did not thin those files, not what it does to denser tracks.
- **Wider gaps.** Allowing gaps of up to 12 hours between samples, instead of 30 minutes, adds 3.4% to the NOAA subset's hours at rest. That much at-rest time sits across longer gaps, and is missed at the default setting. A stay thinned down to its arrival and departure points would not be found at any setting, so this check bounds only the stays that keep some samples in between.

## By length

| Length  | Open Waters episodes |  Hours | Sites | NOAA episodes | Hours | Sites |
| ------- | -------------------: | -----: | ----: | ------------: | ----: | ----: |
| 1–6 h   |                  345 |    884 |   187 |           819 | 2,092 |   426 |
| 6–13 h  |                  104 |    945 |    73 |           534 | 5,043 |   226 |
| 13–25 h |                  336 |  6,350 |   269 |           262 | 4,543 |   143 |
| 1–3 d   |                  318 | 14,883 |   251 |           131 | 5,257 |    74 |
| 3–15 d  |                  176 | 25,538 |   121 |            26 | 3,270 |     9 |
| 15+ d   |                   12 |  8,055 |     7 |             1 |   530 |     1 |

Most NOAA episodes are an overnight stay or shorter. Of the Open Waters hours, 59% are in stays of 3 days or more. Stays of 15 days or more are long enough to separate the main constituents (Parker 2007); shorter ones give an offset against a station, band by band.

## By tidal range

Predicted range of the nearest tide reference station within 50 km, over the 25 hours centred on each episode.

| Range             | Open Waters episodes |  Hours | Sites | NOAA episodes | Hours | Sites |
| ----------------- | -------------------: | -----: | ----: | ------------: | ----: | ----: |
| < 0.5 m           |                  401 | 18,999 |   243 |           783 | 8,797 |   291 |
| 0.5–1 m           |                   81 |  3,587 |    50 |           240 | 2,311 |   120 |
| 1–2 m             |                  200 |  6,615 |   103 |           235 | 1,840 |    81 |
| 2–4 m             |                  104 |  2,638 |    67 |           177 | 3,231 |    57 |
| 4+ m              |                   17 |  1,120 |     6 |            74 | 1,771 |    23 |
| No tide reference |                   84 |  2,646 |    47 |             2 |    11 |     2 |
| No tide station   |                  404 | 21,050 |   218 |           262 | 2,773 |   122 |

"No tide station" means no accepted tide station of any kind within 50 km: 37% of Open Waters hours and 13% of NOAA hours. Those are the places a station-based reduction cannot reach today. "No tide reference" means tide stations are nearby, but none is a reference station with harmonics, for example where only subordinate or identity-only stations are within 50 km.

## By location

Continent of the nearest tide reference station. Cells with fewer than 3 vessels are folded together and left out if they still have fewer than 3, so no row points at one boat's mooring. That leaves out 796 Open Waters hours and 11 NOAA hours.

| Open Waters       |  Hours | Vessels | Sites |     | NOAA subset     |  Hours | Vessels | Sites |
| ----------------- | -----: | ------: | ----: | --- | --------------- | -----: | ------: | ----: |
| No tide station   | 21,050 |      12 |   218 |     | Americas        | 16,550 |     116 |   448 |
| Americas          | 14,290 |       7 |   147 |     | No tide station |  2,773 |      29 |   122 |
| Europe            | 14,232 |       6 |   242 |     | Europe          |  1,017 |      14 |    23 |
| Oceania           |  3,641 |       4 |    42 |     | Oceania         |    383 |       7 |    23 |
| No tide reference |  2,646 |       6 |    47 |     |                 |        |         |       |

Open Waters vessels are cruising sailboats spread around the world. The NOAA subset is mostly US waters, and includes cruise ships at berth.

## Does depth follow the tide?

Episodes of 6 hours or more, fitted against the nearest tide reference station within 50 km. "Good vessels" counts the vessels whose own median tide R² is above 0.9, so a few prolific vessels cannot dominate it.

| Range   | Source      | Fits | Good vessels | Median tide R² | Tide R² > 0.9 | Median gain | Median \|lag\| | Median RMS |
| ------- | ----------- | ---: | -----------: | -------------: | ------------: | ----------: | -------------: | ---------: |
| < 0.5 m | Open Waters |  326 |       0 of 8 |           0.20 |            1% |        1.20 |         80 min |     0.09 m |
|         | NOAA        |  418 |      0 of 65 |           0.13 |            0% |        1.06 |        110 min |     0.18 m |
| 0.5–1 m | Open Waters |   56 |       0 of 7 |           0.82 |           32% |        1.03 |         15 min |     0.12 m |
|         | NOAA        |  150 |      1 of 58 |           0.42 |            9% |        1.02 |         40 min |     0.12 m |
| 1–2 m   | Open Waters |  132 |       2 of 6 |           0.83 |           42% |        0.97 |         10 min |     0.16 m |
|         | NOAA        |  129 |     10 of 37 |           0.60 |           26% |        0.99 |         15 min |     0.20 m |
| 2–4 m   | Open Waters |   50 |       5 of 6 |           0.97 |           76% |        1.01 |        7.5 min |     0.14 m |
|         | NOAA        |  108 |     12 of 26 |           0.65 |           40% |        1.05 |         10 min |     0.32 m |
| 4+ m    | Open Waters |   13 |       1 of 3 |           0.90 |           54% |        0.74 |          5 min |     0.37 m |
|         | NOAA        |   48 |       3 of 6 |           0.61 |           25% |        1.02 |          5 min |     0.86 m |
| 2 m+    | Open Waters |   63 |       5 of 7 |           0.97 |           71% |        0.96 |          5 min |     0.15 m |
|         | NOAA        |  156 |     12 of 26 |           0.64 |           35% |        1.03 |         10 min |     0.57 m |

The tide is in the data. Where the range is 2 m or more, depth at rest follows the station's predicted tide with a median gain near 1 and a lag of 5 to 10 minutes in both sources. How cleanly it follows depends on the vessel:

- **Open Waters:** 5 of the 7 vessels with fits at 2 m or more have a median tide R² above 0.9, with residuals of about 0.15 m.
- **NOAA:** 12 of 26 vessels do. Six vessels with median residuals over 0.5 m, including two cruise ships whose sounders are off by several meters, account for half the fits. Among the other 20 vessels, 12 track the tide with a tide R² above 0.9.

Vessel quality therefore has to be scored before any offset is trusted, as crowd-depth already does for depth. As the range falls, fewer vessels track the tide well, and below 0.5 m none do. There the tide is about the size of the noise and the non-tidal residual, as it would be for a real gauge over a short record.

Length on its own does not improve the fit, because it is mixed up with range and vessel: long Open Waters stays are mostly in the Caribbean and the Baltic, where the range is small. A linear drift term is also too simple for multi-day stays, which carry weather and draft changes.

## Not measured

- Whether gain and lag differ from 1 and 0 by more than their uncertainty. That would be a real offset between anchorage and station, which is what option 1 in the README estimates.
- Why the noisy vessels are noisy: sounder, swing over a slope, or water the station does not represent. Footprints are small (median 4–13 m), but swing was not separated from the residual.
- Grounding at low water, which would clip the low tide.
- Observed water levels at NOAA stations. Every fit is against a prediction, so surge stays in the residual.
- What NOAA's simplification does to tracks denser than one sounding a minute.
- The rest of the NOAA archive.
