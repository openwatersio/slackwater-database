import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { openDatabase } from "../src/database/reader.ts";
import { buildDatabase } from "../src/database/builder.ts";
import { credits } from "../src/generated/credits.ts";
import { loadStations } from "../src/load-stations.js";

import {
  MODIFICATIONS_URL,
  PROJECT_CREDIT,
  attributionWithCredit,
} from "../src/attribution.ts";
// From source: the stations package loads data, and this test checks the
// database against the same per-source metadata the build used.
import { loadSources } from "../../stations/sources.ts";

const { all: allStations } = await loadStations();

const sources = loadSources();
const creditOf = (name: string) => sources.get(name)?.credit;

const shipped = openDatabase(
  readFileSync(new URL("../src/generated/slackwater.tcdb", import.meta.url)),
);

const ccBy = {
  type: "cc-by-4.0",
  url: "https://creativecommons.org/licenses/by/4.0/",
};
const ccByNc = {
  type: "cc-by-nc-4.0",
  url: "https://creativecommons.org/licenses/by-nc/4.0/",
};
const publicDomain = {
  type: "public domain",
  url: "https://tidesandcurrents.noaa.gov/disclaimers.html",
};

describe("attribution", () => {
  test("a JHOD station names its licence and preserves the editing notice", () => {
    const notice = attributionWithCredit(
      creditOf("Japan Coast Guard, Hydrographic and Oceanographic Department"),
      {
        type: "Government Standard Terms of Use 2.0",
        url: "https://www1.kaiho.mlit.go.jp/copyright.html",
      },
    );
    expect(notice).toContain(
      "Licensed Government Standard Terms of Use 2.0 (https://www1.kaiho.mlit.go.jp/copyright.html)",
    );
    expect(notice).toContain("Edited by Open Waters");
  });

  test("published credits preserve notices in a filtered rebuild", () => {
    const representatives = [
      ...new Map(
        allStations.map((station) => [
          `${station.source!.name}/${station.license!.type}`,
          station,
        ]),
      ).values(),
    ];
    const rebuilt = openDatabase(buildDatabase(representatives, { credits }));
    const notices = new Map(
      representatives.map((station) => [station.id, station.attribution]),
    );
    expect(rebuilt.stationsLength()).toBe(representatives.length);
    for (let i = 0; i < rebuilt.stationsLength(); i++) {
      const station = rebuilt.stations(i)!;
      expect(station.attribution()).toBe(notices.get(station.id()!));
      const name = station.source()!.name()!;
      expect(credits.has(name)).toBe(true);
      expect(credits.get(name)).toBe(creditOf(name));
    }
  });

  // The guard that keeps credit honest: a source added to the database without
  // a metadata.yaml fails here rather than shipping stations that quietly
  // credit no one. The catalogue load also refuses one.
  test("every source in the shipped database has a credit decision", () => {
    const unknown = new Set<string>();
    for (let i = 0; i < shipped.stationsLength(); i++) {
      const name = shipped.stations(i)?.source()?.name();
      if (name && !sources.has(name)) unknown.add(name);
    }
    expect([...unknown]).toEqual([]);
  });

  // A notice repeats the station's licence URL, and CC BY 4.0 §3(a)(1)(C)
  // needs that to be the licence itself, not a publisher's terms page.
  test("every Creative Commons station links its licence", () => {
    const wrong = new Set<string>();
    for (let i = 0; i < shipped.stationsLength(); i++) {
      const license = shipped.stations(i)?.license();
      // "cc-by-nc-4.0" -> https://creativecommons.org/licenses/by-nc/4.0/
      const [, kind, version] =
        license?.type()?.match(/^cc-(.+)-([\d.]+)$/) ?? [];
      const uri = `https://creativecommons.org/licenses/${kind}/${version}/`;
      if (kind && license?.url() !== uri) {
        wrong.add(
          `${shipped.stations(i)?.source()?.name()}: ${license?.url()}`,
        );
      }
    }
    expect([...wrong]).toEqual([]);
  });

  // The builder bakes the notice into the file, so a reader in any language
  // gets it without a table of its own.
  test("every station in the shipped database carries its notice", () => {
    for (let i = 0; i < shipped.stationsLength(); i++) {
      const t = shipped.stations(i)!;
      const license = t.license();
      expect(t.attribution()).toBe(
        attributionWithCredit(creditOf(t.source()?.name()!), {
          type: license!.type()!,
          url: license!.url()!,
        }),
      );
    }
  });

  // What a CC BY redistributor has to pass on (section 3(a)(1)): who made it,
  // the licence and its URI, and that it was modified.
  test("a CC BY station gets a complete notice", () => {
    const notice = attributionWithCredit(creditOf("TICON-4"), ccBy);
    expect(notice.startsWith(`${PROJECT_CREDIT}. `)).toBe(true);
    expect(notice).toContain("Hart-Davis");
    expect(notice).toContain("https://doi.org/10.17882/109129");
    expect(notice).toContain(
      "Licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)",
    );
    expect(notice).toContain(`Modified: see ${MODIFICATIONS_URL}`);
  });

  test("a CC BY-NC station names its own licence", () => {
    const notice = attributionWithCredit(creditOf("TICON-4"), ccByNc);
    expect(notice).toContain(
      "Licensed CC BY-NC 4.0 (https://creativecommons.org/licenses/by-nc/4.0/)",
    );
    expect(notice).not.toContain("CC BY 4.0 (");
  });

  // Public domain imposes no notice, so nothing is put on the consumer.
  test("a source and licence requiring no notice give the project line alone", () => {
    expect(
      attributionWithCredit(
        creditOf("US National Oceanic and Atmospheric Administration"),
        publicDomain,
      ),
    ).toBe(PROJECT_CREDIT);
  });

  test("gives the project line alone without a source credit", () => {
    expect(attributionWithCredit(null, undefined)).toBe(PROJECT_CREDIT);
    expect(attributionWithCredit(undefined, undefined)).toBe(PROJECT_CREDIT);
  });
});
