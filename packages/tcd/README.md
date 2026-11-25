# Slackwater Database - TCD (XTide Harmonics File)

This package generates a TCD (Tide Constituent Database) binary file of the Slackwater database. The TCD file can be used with [XTide](https://flaterco.com/xtide/), [OpenCPN](https://opencpn.org), and any software that reads the [libtcd](https://flaterco.com/xtide/libtcd.html) format.

The TCD file includes the predictable tide and current stations in the tide database, with constituents resolved through the list from [@slackwater/engine](https://www.npmjs.com/package/@slackwater/engine). Names whose amplitude is zero in every exported reference station are omitted from its shared constituent table, saving libtcd's limited 255 slots without changing predictions. Those zero values remain in the database.

Current stations are named `<Name>, <Region> Current`, with the NOAA station id appended where several stations share a name (for example, different depths at one location). Speeds are in knots. A few stations can't be represented in the format and are left out: reference currents without harmonic constants, and subordinate currents with a speed ratio of zero, which libtcd would read as "no ratio".

### Nodal corrections

A TCD file holds one table of node factors and equilibrium arguments per constituent, which every station shares, so it can't give each source the nodal corrections its constants were analyzed with. The export computes those tables with `@slackwater/engine`'s IHO formulas, from the catalog's line for each name, and leaves out a source's own definitions. Two sources analyze with other formulas:

- NOAA analyzes with Schureman's, and defines SIGMA1 with O1's correction applied twice. Over January and July 2026 and December 2030, at 20 NOAA reference stations, IHO's formulas move hourly heights 0.0 to 1.0 mm RMS further from NOAA's own predictions than Schureman's.
- Kartverket analyzes with Foreman's. Against Kartverket's own predictions at its 33 stations, hourly RMS is 5 to 10 mm with IHO's formulas and 0.5 to 6.8 mm with Foreman's.

For predictions with each source's own formulas, read the `.tcdb` with `@slackwater/engine`, as [the database format](../../docs/database-format.md#constituent-definitions) describes.

## Usage

Download the latest `slackwater-YYYYMMDD.tcd` from [releases](https://github.com/openwatersio/slackwater-database/releases).

Heights are in meters and current speeds in knots. XTide and OpenCPN convert for display, so use `tide -u ft` or the OpenCPN unit setting to see feet.

### OpenCPN

Open the OpenCPN options, navigate to the "Charts" tab, and add the TCD file as a "Tides & Currents" data source. See the [OpenCPN manual](https://opencpn.org/wiki/dokuwiki/doku.php?id=opencpn%3Amanual_basic%3Aset_options%3Acharts%3Atides-currents) for more details.

![screenshot of tide stations in OpenCPN](https://github.com/user-attachments/assets/6e57f4fd-0dad-4aae-b1db-fe638915c225)

### XTide

To use the TCD file with XTide, set the `HFILE_PATH` environment variable to point to the downloaded TCD file:

```sh
export HFILE_PATH=/path/to/slackwater-*.tcd
```

Station names and notes are UTF-8, which OpenCPN reads directly. XTide assumes TCD strings are Latin-1 and converts them to your locale, so under a UTF-8 locale a name like Bodø shows as "BodÃ¸". Run XTide in the C locale to see them correctly. XTide's own degree signs then show as `�`, because XTide writes them in Latin-1:

```sh
LC_ALL=C tide -l "Bodø, Nordland, Norway"
```

Launch the XTide graphical interface:

```sh
xtide
```

#### Command-line usage

List all stations:

```sh
tide -m l
```

Search for stations by name (case-insensitive prefix match):

```sh
tide -m l | grep -i boston
```

Get tide predictions for a station:

```sh
tide -l "BOSTON, MA, United States"
```

Get current predictions (max flood, max ebb, and slack) for a current station:

```sh
tide -l "Pollock Rip Channel (butler Hole), Massachusetts Current"
```

Get predictions for a specific date range in CSV format:

```sh
tide -l "BOSTON, MA, United States" -b "2026-01-01 00:00" -e "2026-01-08 00:00" -f c -u m
```

## Contributing

- Build the TCD file with: `npm run build`
- Run tests with: `npm run test:docker` (needs Docker)

## References

- [XTide](https://flaterco.com/xtide/)
- [libtcd documentation](https://flaterco.com/xtide/libtcd.html)
- [TCD file format specification](https://flaterco.com/xtide/tcd.html)
- [@slackwater/engine](https://www.npmjs.com/package/@slackwater/engine)
