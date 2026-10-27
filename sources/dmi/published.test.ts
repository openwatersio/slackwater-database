import { readFileSync, readdirSync } from "node:fs";
import { expect, test } from "vitest";
import { allStations, stationsById, stationRoutes } from "@slackwater/database";

test.each([
  ["2988270", "Tórshavn", "Streymoy"],
  ["2991230", "Paamiut", "Sermersooq"],
  ["2991710", "Upernavik", "Avannaata"],
])(
  "%s has its populated locality and region in the published database",
  (id, locality, region) => {
    const station = stationsById.get(`dmi/${id}`);
    expect(station?.locality).toBe(locality);
    expect(station?.region).toBe(region);
  },
);

test("published records are exactly the accepted members of the full source validation", () => {
  const report = JSON.parse(
    readFileSync(new URL("./validation.json", import.meta.url), "utf8"),
  ) as {
    inventory: number;
    inventoryInputs: { url: string; sha256: string }[];
    stations: { id: string; accepted: boolean; country: string }[];
  };
  expect(report.stations).toHaveLength(report.inventory);
  expect(report.inventoryInputs).toHaveLength(2);
  for (const input of report.inventoryInputs) {
    expect(input.url).toContain("/collections/tidewaterstation/items?");
    expect(input.sha256).toMatch(/^[a-f0-9]{64}$/);
  }
  expect(new Set(report.stations.map((s) => s.id)).size).toBe(report.inventory);
  const accepted = report.stations.filter((s) => s.accepted);
  const files = readdirSync(new URL("../../data/dmi/", import.meta.url)).filter(
    (n) => n.endsWith(".json"),
  );
  expect(files.sort()).toEqual(accepted.map((s) => `${s.id}.json`).sort());
  const decoded = allStations.filter((s) => s.id.startsWith("dmi/"));
  expect(decoded.map((s) => s.id).sort()).toEqual(
    accepted.map((s) => `dmi/${s.id}`).sort(),
  );
  for (const station of decoded) {
    expect(station.license.commercial_use, station.id).toBe(true);
    expect(station.license.type, station.id).toBe("cc-by-4.0");
  }
  expect([...new Set(accepted.map((s) => s.country))].sort()).toEqual([
    "DNK",
    "FRO",
    "GRL",
  ]);
});

test.each([
  ["/tides/dk/brons/", "dmi/26143"],
  ["/tides/dk/hvide-sande-kyst/", "dmi/24342"],
  ["/tides/dk/torsminde-kyst/", "dmi/24122"],
  ["/tides/dk/ferring/", "dmi/24018"],
  ["/tides/dk/havneby/", "dmi/26136"],
  ["/tides/dk/thyboron-kyst/", "dmi/24006"],
])(
  "legacy route %s keeps its DMI member and an accepted record",
  (path, id) => {
    const route = stationRoutes("tide").find(
      (r) => r.path === path || r.formerPaths.includes(path),
    );
    expect(route?.stationIds).toContain(id);
    expect(
      route?.stationIds.some((id) => stationsById.get(id)?.quality?.accepted),
    ).toBe(true);
  },
);

test.each([
  [
    "/tides/dk/gedser/",
    "ticon/gedser-837a-dnk-uhslc_rq",
    "dmi/31616",
    "/tides/dk/gedser-dmi-31616/",
  ],
  [
    "/tides/dk/hornbaek/",
    "ticon/hornbaek-838a-dnk-uhslc_rq",
    "dmi/30017",
    "/tides/dk/hornbaek-dmi-30017/",
  ],
  [
    "/tides/dk/esbjerg/",
    "ticon/esbjerg-esb-dnk-dmi",
    "dmi/25149",
    "/tides/dk/esbjerg-havn/",
  ],
  [
    "/tides/gl/ittoqqortoormiit/",
    "ticon/ittoqqortoormiit-809-dnk-uhslc_fd",
    "dmi/2992600",
    "/tides/gl/ittoqqortoormiit-scoresbysund/",
  ],
  [
    "/tides/gl/maniitsoq/",
    "ticon/maniitsoq-man-grl-gloss",
    "dmi/2991380",
    "/tides/gl/maniitsoq-dmi-2991380/",
  ],
  [
    "/tides/gl/qaqortoq/",
    "ticon/qaqortoq-299-dnk-uhslc_fd",
    "dmi/2991140",
    "/tides/dk/qaqortoq/",
  ],
])(
  "%s shows %s and holds DMI's record of the same gauge",
  (path, lead, dmi, absorbed) => {
    const route = stationRoutes("tide").find((r) => r.path === path);
    expect(route?.stationIds[0]).toBe(lead);
    expect(route?.stationIds).toContain(dmi);
    expect(route?.formerPaths).toContain(absorbed);
  },
);

test.each(["25149", "2991540", "2988270"])(
  "%s retains its prediction data, route and redistribution notice in the database",
  (id) => {
    const original = JSON.parse(
      readFileSync(
        new URL(`../../data/dmi/${id}.json`, import.meta.url),
        "utf8",
      ),
    );
    const station = stationsById.get(`dmi/${id}`)!;
    expect(station).toBeDefined();
    expect(station.quality?.accepted).toBe(true);
    expect(station.source.published_harmonics).toBe(false);
    expect(station.epoch).toBeUndefined();
    expect(station.disclaimers).toContain("2027-01-05 through 2027-12-30 UTC");
    expect(station.datums["HAT"]).toBeUndefined();
    expect(station.attribution).toContain(
      "Danish Meteorological Institute (DMI)",
    );
    expect(station.attribution).toContain(
      "CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)",
    );
    expect(station.attribution).toContain("#modifications-to-source-data");
    expect(
      stationRoutes("tide").some((r) => r.stationIds.includes(station.id)),
    ).toBe(true);
    expect(station.harmonic_constituents).toHaveLength(
      original.harmonic_constituents.length,
    );
    for (const term of original.harmonic_constituents) {
      const decoded = station.harmonic_constituents.find(
        (c) => c.name === term.name,
      )!;
      expect(decoded.amplitude).toBeCloseTo(term.amplitude, 5);
      expect(decoded.phase).toBeCloseTo(term.phase, 4);
    }
    for (const name of ["MSL", "LAT", "MLWS"])
      expect(station.datums[name]).toBeCloseTo(original.datums[name], 5);
  },
);
