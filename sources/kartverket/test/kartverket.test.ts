import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { refreshSnapshot, verifySnapshot } from "../import.ts";
import {
  buildStation,
  meanTtMinusUtc,
  parseTimestamp,
  parseConstituents,
  parseLocationLevels,
  parseStationList,
  resolveConstituent,
} from "../kartverket.ts";

const stationListXml = `<tide><stationinfo><station name="Tromsø" code="TOS" latitude="69.646110" longitude="18.954790" type="PERM"/></stationinfo></tide>`;
const currentStationListXml = stationListXml.replace("station ", "location ");
const tromsoXml = `<tide><constituents unit="cm" utcoffset="+01:00"><location name="Tromsø" code="TOS" latitude="69.646110" longitude="18.954790"/><observations start="2006-01-01T00:00:00+01:00" end="2020-12-31T23:00:00+01:00"/><constituent name="SA" doodson="ZZAZZYZ" speed="0.04106668" phaseangle="330.24" amplitude="12.86"/></constituents></tide>`;
const tromsoLevelsXml = `<tide><locationlevel unit="cm" reflevel="CD"><location name="Tromsø" code="TOS" latitude="69.646110" longitude="18.954790"/><reflevel code="HAT" value="174.1"/><reflevel code="MSL" value="-6.1" epoch="1996-2014"/><reflevel code="CD" value="-174.1"/><reflevel code="LAT" value="-174.1"/><reflevel code="100YMAX" value="300.0"/></locationlevel></tide>`;
const stationCodes = [
  "AES",
  "ANX",
  "BGO",
  "BOH",
  "BOO",
  "BRJ",
  "EYD",
  "HAR",
  "HEI",
  "HFT",
  "HRO",
  "HVG",
  "KAB",
  "KAZ",
  "KSU",
  "LEH",
  "MAY",
  "MSU",
  "NVK",
  "NYA",
  "OSC",
  "OSL",
  "RVK",
  "SBG",
  "SIE",
  "SOY",
  "SVG",
  "TAZ",
  "TOS",
  "TRD",
  "TRG",
  "VAW",
  "VIK",
];

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

function snapshotFetch(
  codes: string[],
  levelResponse = (code: string) =>
    tromsoLevelsXml.replaceAll("Tromsø", code).replaceAll("TOS", code),
) {
  return vi.fn<typeof globalThis.fetch>(async (input) => {
    const url = new URL(
      input instanceof Request ? input.url : input.toString(),
    );
    const request = url.searchParams.get("tide_request");
    const code = url.searchParams.get("stationcode") ?? "";
    const body =
      request === "stationlist"
        ? `<tide><stationinfo>${codes.map((value) => `<location name="${value}" code="${value}" latitude="69.646110" longitude="18.954790" type="PERM"/>`).join("")}</stationinfo></tide>`
        : request === "constituents"
          ? tromsoXml.replaceAll("Tromsø", code).replaceAll("TOS", code)
          : levelResponse(code);
    return new Response(body, {
      status: 200,
      headers: { "content-type": "text/xml" },
    });
  });
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
        url: "https://creativecommons.org/licenses/by/4.0/",
      },
    });
    expect(station).not.toHaveProperty("code");
  });

  it("converts UTC+1 constituent phases and centimetres", () => {
    expect(parseConstituents(tromsoXml).constituents[0]).toMatchObject({
      name: "SA_KV",
      amplitude: 0.1286,
      phase: 330.19816692,
    });
  });

  it("takes TT − UTC over the analysis period out of each phase", () => {
    const m2 = tromsoXml.replace(
      /<constituent [^>]*\/>/,
      `<constituent name="M2" doodson="BZZZZZZ" speed="28.98410420" phaseangle="100" amplitude="10"/>`,
    );
    // 67.18 s of M2's speed past the hour for UTC+1.
    expect(parseConstituents(m2).constituents[0]!.phase).toBeCloseTo(
      100 - 28.9841042 - 0.54091,
      5,
    );
  });

  it("averages TT − UTC over leap seconds and uses today's without a period", () => {
    expect(
      meanTtMinusUtc(
        Date.parse("2006-01-01T00:00:00+01:00"),
        Date.parse("2020-12-31T23:00:00+01:00"),
      ),
    ).toBeCloseTo(67.1845, 4);
    expect(
      meanTtMinusUtc(Date.parse("2022-11-25"), Date.parse("2025-02-06")),
    ).toBe(69.184);
    expect(meanTtMinusUtc()).toBe(69.184);
    // 25 s in 1990, 26 s in 1991, then 32.184 s more.
    expect(
      meanTtMinusUtc(Date.UTC(1990, 6, 1), Date.UTC(1991, 6, 1)),
    ).toBeCloseTo(32.184 + 25.5, 1);
    for (const [start, end] of [
      [Date.UTC(1960, 0, 1), Date.UTC(1980, 0, 1)],
      [Date.UTC(2010, 0, 1), Date.UTC(2009, 0, 1)],
      [Date.UTC(2010, 0, 1), undefined],
    ] as const)
      expect(() => meanTtMinusUtc(start, end)).toThrow(/analysis period/);
  });

  it("reads hour-only offsets and refuses impossible timestamps", () => {
    expect(parseTimestamp("2006-01-01T00:00:00+01")).toBe(
      Date.UTC(2005, 11, 31, 23),
    );
    expect(parseTimestamp("2006-01-01T00:00:00.000Z")).toBe(
      Date.UTC(2006, 0, 1),
    );
    const shortOffsets = tromsoXml.replaceAll(
      /(T\d{2}:\d{2}:\d{2})\+01:00/g,
      "$1+01",
    );
    expect(parseConstituents(shortOffsets).constituents).toEqual(
      parseConstituents(tromsoXml).constituents,
    );
    for (const [from, to] of [
      ["2006-01-01T00:00:00", "2006-02-31T00:00:00"],
      ["2006-01-01T00:00:00+01:00", "2006-01-01T00:00:00+99:00"],
    ] as const)
      expect(() => parseConstituents(tromsoXml.replace(from, to))).toThrow(
        /Invalid timestamp/,
      );
  });

  it("refuses an analysis period with only one end", () => {
    const xml = tromsoXml.replace(/ end="[^"]*"/, "");

    expect(() => parseConstituents(xml)).toThrow(/Incomplete analysis period/);
  });

  it("brings Andenes' M2 onto independent analyses of the same gauge", async () => {
    // UHSLC's research and fast-delivery series, CMEMS's relay and TICON's
    // analysis of Kartverket's record, all against UTC.
    const read = async (path: string) =>
      JSON.parse(
        await readFile(
          new URL(`../../../data/${path}`, import.meta.url),
          "utf8",
        ),
      ) as { harmonic_constituents: { name: string; phase: number }[] };
    const m2 = async (path: string) => {
      const m2 = (await read(path)).harmonic_constituents.find(
        (c) => c.name === "M2",
      );
      if (!m2) throw new Error(`${path} has no M2`);
      return m2.phase;
    };
    const independent = await Promise.all(
      [
        "ticon/andenes-800-nor-uhslc_fd.json",
        "ticon/andenes-800a-nor-uhslc_rq.json",
        "ticon/andenestg-and-nor-cmems.json",
        "ticon/andenes-anx-nor-nhs.json",
      ].map(m2),
    );
    const kartverket = await m2("kartverket/ANX.json");
    for (const phase of independent)
      expect(Math.abs(kartverket - phase)).toBeLessThan(0.05);
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
    expect(
      resolveConstituent({
        name: "M3",
        speed: 43.47615636,
        doodson: "CZZZZZB",
      }),
    ).toBe("M3");
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

  it("rejects unsafe station codes before touching the current snapshot", async () => {
    const parent = await temporaryDirectory();
    const fixtures = join(parent, "fixtures");
    const manifest = '{"current":true}\n';
    const stationList = "previous station list\n";
    await mkdir(fixtures);
    await writeFile(join(fixtures, "manifest.json"), manifest);
    await writeFile(join(fixtures, "stationlist.xml"), stationList);
    const codes = [...stationCodes];
    codes[0] = "../../fixtures/stationlist";

    await expect(
      refreshSnapshot(fixtures, snapshotFetch(codes)),
    ).rejects.toThrow(/station code/i);
    expect(await readFile(join(fixtures, "manifest.json"), "utf8")).toBe(
      manifest,
    );
    expect(await readFile(join(fixtures, "stationlist.xml"), "utf8")).toBe(
      stationList,
    );
  });

  it("keeps the current snapshot when a station response omits MSL", async () => {
    const parent = await temporaryDirectory();
    const fixtures = join(parent, "fixtures");
    const manifest = '{"current":true}\n';
    const stationList = "previous station list\n";
    await mkdir(fixtures);
    await writeFile(join(fixtures, "manifest.json"), manifest);
    await writeFile(join(fixtures, "stationlist.xml"), stationList);
    const fetch = snapshotFetch(stationCodes, (code) => {
      const xml = tromsoLevelsXml
        .replaceAll("Tromsø", code)
        .replaceAll("TOS", code);
      return code === "AES"
        ? xml.replace(/<reflevel code="MSL"[^>]*\/>/, "")
        : xml;
    });

    await expect(refreshSnapshot(fixtures, fetch)).rejects.toThrow(/MSL/);
    expect(await readFile(join(fixtures, "manifest.json"), "utf8")).toBe(
      manifest,
    );
    expect(await readFile(join(fixtures, "stationlist.xml"), "utf8")).toBe(
      stationList,
    );
  });
});
