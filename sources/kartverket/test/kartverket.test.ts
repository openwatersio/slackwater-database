import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { refreshSnapshot, verifySnapshot } from "../import.ts";
import {
  buildStation,
  parseConstituents,
  parseLocationLevels,
  parseStationList,
  resolveConstituent,
} from "../kartverket.ts";

const stationListXml = `<tide><stationinfo><station name="Tromsø" code="TOS" latitude="69.646110" longitude="18.954790" type="PERM"/></stationinfo></tide>`;
const currentStationListXml = stationListXml.replace("station ", "location ");
const tromsoXml = `<tide><constituents unit="cm" utcoffset="+01:00"><location name="Tromsø" code="TOS" latitude="69.646110" longitude="18.954790"/><observations start="2006-01-01T00:00:00+01:00" end="2020-12-31T23:00:00+01:00"/><constituent name="SA" doodson="ZZAZZYZ" speed="0.04106668" phaseangle="330.24" amplitude="12.86"/></constituents></tide>`;
const tromsoLevelsXml = `<tide><locationlevel unit="cm" reflevel="CD"><location name="Tromsø" code="TOS" latitude="69.646110" longitude="18.954790"/><reflevel code="HAT" value="174.1"/><reflevel code="MSL" value="-6.1" epoch="1996-2014"/><reflevel code="CD" value="-174.1"/><reflevel code="LAT" value="-174.1"/><reflevel code="100YMAX" value="300.0"/></locationlevel></tide>`;

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "kartverket-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

describe("Kartverket source parser", () => {
  it("parses the current station-list location elements", () => {
    expect(parseStationList(currentStationListXml).stations[0]?.code).toBe(
      "TOS",
    );
  });

  it("parses a valid station and builds a normalized reference record", () => {
    const station = buildStation({
      station: parseStationList(stationListXml).stations[0]!,
      constituents: parseConstituents(tromsoXml),
      levels: parseLocationLevels(tromsoLevelsXml),
    });

    expect(station).toMatchObject({
      name: "Tromsø",
      country: "Norway",
      type: "reference",
      latitude: 69.64611,
      longitude: 18.95479,
      chart_datum: "CD",
      datums: { HAT: 1.741, MSL: -0.061, CD: -1.741, LAT: -1.741 },
      epoch: { start: "2006-01-01", end: "2020-12-31" },
      source: {
        id: "TOS",
        published_harmonics: true,
        url: "https://www.kartverket.no/en/api-and-data/tides-and-water-level-data",
      },
      license: {
        type: "cc-by-4.0",
        commercial_use: true,
        url: "https://www.kartverket.no/en/api-and-data/terms-of-use",
      },
    });
  });

  it("converts UTC+1 constituent phases and centimetres", () => {
    expect(parseConstituents(tromsoXml).constituents[0]).toMatchObject({
      name: "SA_KV",
      amplitude: 0.1286,
      phase: 330.19893332,
    });
  });

  it("leaves a missing observation epoch absent", () => {
    const xml = tromsoXml.replace(/<observations[^>]*\/>/, "");

    expect(parseConstituents(xml).epoch).toBeUndefined();
  });

  it("accepts station levels modeled from a named reference gauge", () => {
    const station = {
      name: "Bøfjorden",
      code: "BOH",
      latitude: 61.135925,
      longitude: 5.339699,
    };
    const constituents = parseConstituents(
      tromsoXml
        .replaceAll("Tromsø", "Bøfjorden")
        .replaceAll("TOS", "BOH")
        .replace("69.646110", "61.135925")
        .replace("18.954790", "5.339699")
        .replace(/<observations[^>]*\/>/, ""),
    );
    const levels = parseLocationLevels(
      tromsoLevelsXml.replace(
        /<location[^>]*\/>/,
        '<location name="Bergen" code="BGO" latitude="61.135925" longitude="5.339699" place="Bøfjorden"/>',
      ),
    );

    const record = buildStation({ station, constituents, levels });
    expect(record).toMatchObject({ source: { id: "BOH" } });
    expect(record).not.toHaveProperty("epoch");
  });

  it("rejects XML error responses and unsafe declarations", () => {
    expect(() =>
      parseStationList('<tide><error message="Not found"/></tide>'),
    ).toThrow(/Not found/);
    expect(() => parseStationList("<!DOCTYPE tide><tide/>")).toThrow(/DOCTYPE/);
    expect(() => parseStationList('<!ENTITY x "unsafe"><tide/>')).toThrow(
      /ENTITY/,
    );
  });

  it("rejects unexpected source units and UTC offsets", () => {
    expect(() =>
      parseConstituents(tromsoXml.replace('unit="cm"', 'unit="m"')),
    ).toThrow(/unit/i);
    expect(() =>
      parseConstituents(tromsoXml.replace("+01:00", "+00:00")),
    ).toThrow(/UTC offset/i);
    expect(() =>
      parseLocationLevels(tromsoLevelsXml.replace('unit="cm"', 'unit="m"')),
    ).toThrow(/unit/i);
  });

  it("rejects missing or invalid constituent amplitudes", () => {
    expect(() =>
      parseConstituents(tromsoXml.replace(' amplitude="12.86"', "")),
    ).toThrow(/amplitude/i);
    expect(() =>
      parseConstituents(tromsoXml.replace('amplitude="12.86"', 'amplitude=""')),
    ).toThrow(/amplitude/i);
    expect(() =>
      parseConstituents(
        tromsoXml.replace('amplitude="12.86"', 'amplitude="invalid"'),
      ),
    ).toThrow(/amplitude/i);
  });

  it("rejects missing or invalid datum values", () => {
    expect(() =>
      parseLocationLevels(tromsoLevelsXml.replace(' value="174.1"', "")),
    ).toThrow(/datum/i);
    expect(() =>
      parseLocationLevels(tromsoLevelsXml.replace('value="174.1"', 'value=""')),
    ).toThrow(/datum/i);
    expect(() =>
      parseLocationLevels(
        tromsoLevelsXml.replace('value="174.1"', 'value="invalid"'),
      ),
    ).toThrow(/datum/i);
  });

  it("requires location levels relative to chart datum", () => {
    expect(() =>
      parseLocationLevels(
        tromsoLevelsXml.replace('reflevel="CD"', 'reflevel="LAT"'),
      ),
    ).toThrow(/reflevel/i);
  });

  it("uses the exact exceptional constituent tuples", () => {
    expect(
      resolveConstituent({
        name: "EPS2",
        speed: 27.4238338,
        doodson: "BWBAZZZ",
      }),
    ).toBe("eps2");
    expect(
      resolveConstituent({
        name: "GAM2",
        speed: 28.91125066,
        doodson: "BZXBZZB",
      }),
    ).toBe("gamma2");
    expect(
      resolveConstituent({
        name: "H1",
        speed: 28.94303758,
        doodson: "BZYZZAB",
      }),
    ).toBe("alpha2");
    expect(
      resolveConstituent({
        name: "H2",
        speed: 29.02517093,
        doodson: "BZAZZYZ",
      }),
    ).toBe("M(KS)2");
    expect(
      resolveConstituent({
        name: "LDA2",
        speed: 29.45562534,
        doodson: "BAXAZZB",
      }),
    ).toBe("lambda2");
    expect(
      resolveConstituent({
        name: "SIG1",
        speed: 12.92713985,
        doodson: "AWBZZZY",
      }),
    ).toBe("sigma1");
    expect(
      resolveConstituent({
        name: "THE1",
        speed: 15.51258972,
        doodson: "ABXAZZA",
      }),
    ).toBe("theta1");
    expect(
      resolveConstituent({ name: "SA", speed: 0.04106668, doodson: "ZZAZZYZ" }),
    ).toBe("SA_KV");
    expect(
      resolveConstituent({
        name: "S1",
        speed: 15.00000196,
        doodson: "AAYZZAA",
      }),
    ).toBe("S1_KV");
    expect(
      resolveConstituent({
        name: "OQ2",
        speed: 27.35098024,
        doodson: "BWZCZZZ",
      }),
    ).toBe("OQ2_KV");
  });

  it("resolves ordinary catalogue tuples and rejects unknown ones", () => {
    expect(
      resolveConstituent({
        name: "M2",
        speed: 28.98410425,
        doodson: "BZZZZZZ",
      }),
    ).toBe("M2");
    expect(
      resolveConstituent({
        name: "2Q1",
        speed: 12.85428625,
        doodson: "AWZBZZY",
      }),
    ).toBe("2Q1");
    expect(
      resolveConstituent({
        name: "ALP1",
        speed: 12.38276516,
        doodson: "AVBAZZY",
      }),
    ).toBe("ALP1");
    expect(() =>
      resolveConstituent({ name: "unknown", speed: 1, doodson: "ZZZZZZZ" }),
    ).toThrow(/unknown constituent/i);
  });
});

describe("Kartverket fixture snapshot", () => {
  it("rejects a response changed after its checksum was recorded", async () => {
    const fixtures = await temporaryDirectory();
    const path = "stationlist.xml";
    await writeFile(join(fixtures, path), stationListXml);
    await writeFile(
      join(fixtures, "manifest.json"),
      JSON.stringify({
        retrievedAt: "2026-09-21T00:00:00.000Z",
        files: [
          {
            path,
            url: "https://example.test/stationlist",
            sha256: createHash("sha256").update(stationListXml).digest("hex"),
          },
        ],
      }),
    );
    await writeFile(join(fixtures, path), `${stationListXml}\ncorrupt`);

    await expect(verifySnapshot(fixtures)).rejects.toThrow(/checksum/i);
  });

  it("keeps the current manifest when a refresh request fails", async () => {
    const parent = await temporaryDirectory();
    const fixtures = join(parent, "fixtures");
    const manifest = '{"current":true}\n';
    await mkdir(fixtures);
    await writeFile(join(fixtures, "manifest.json"), manifest);
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(new Error("network unavailable"));

    await expect(refreshSnapshot(fixtures, fetch)).rejects.toThrow(
      /network unavailable/,
    );
    expect(await readFile(join(fixtures, "manifest.json"), "utf8")).toBe(
      manifest,
    );
  });
});
