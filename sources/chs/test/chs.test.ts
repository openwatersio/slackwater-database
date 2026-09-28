import { describe, expect, it } from "vitest";
import {
  chsId,
  distanceKm,
  identity,
  reconcile,
  seedStations,
  type ChsStation,
  type IwlsStation,
} from "../chs.ts";

// Synthetic stations only: no real IWLS codes or ids belong in this repo.
function iwls(
  code: string,
  officialName: string,
  latitude: number,
  longitude: number,
  alternativeName: string | null = null,
): IwlsStation {
  return {
    id: `x${code}`,
    code,
    officialName,
    alternativeName,
    latitude,
    longitude,
  };
}

function record(
  id: string,
  name: string,
  latitude: number,
  longitude: number,
): ChsStation {
  return { id, name, aliases: [], latitude, longitude };
}

const none = { ports: [], taken: [] };

describe("chsId", () => {
  it("slugs the name under a chs- prefix, folding accents", () => {
    expect(chsId("Île d'Orléans")).toBe("chs-ile-d-orleans");
  });
  it("never returns a bare prefix", () => {
    expect(chsId("?!")).toBe("chs-station");
  });
});

describe("distanceKm", () => {
  it("measures great-circle distance", () => {
    expect(
      distanceKm(
        { latitude: 49, longitude: -123 },
        { latitude: 49.001, longitude: -123 },
      ),
    ).toBeCloseTo(0.111, 2);
  });
});

describe("identity", () => {
  it("splits alternative names into lowercased aliases without the name itself", () => {
    expect(
      identity(
        iwls(
          "1",
          "Pointe-au-Père",
          48,
          -68,
          "Father Point, pointe-au-père , ,Rimouski",
        ),
      ),
    ).toEqual({
      name: "Pointe-au-Père",
      aliases: ["father point", "rimouski"],
    });
  });
  it("repairs the bilingual Sable Island name in both spellings", () => {
    for (const raw of [
      "Sable Island/Sable, ÃŽle de",
      "Sable Island/Sable, Île de",
    ])
      expect(identity(iwls("2", raw, 43.9, -60))).toEqual({
        name: "Sable Island",
        aliases: ["sable, île de"],
      });
  });
});

describe("reconcile", () => {
  it("keeps a record's id when a station sits within 0.2 km, and updates its name and position", () => {
    const out = reconcile(
      [iwls("1", "Renamed Harbour", 45.0005, -64)],
      [record("chs-old-harbour", "Old Harbour", 45, -64)],
      none,
    );
    expect(out).toEqual([
      {
        id: "chs-old-harbour",
        name: "Renamed Harbour",
        aliases: [],
        latitude: 45.0005,
        longitude: -64,
      },
    ]);
  });

  it("falls back to an exact name match when the station moved further than 0.2 km", () => {
    const out = reconcile(
      [iwls("1", "Moved Cove", 45.01, -64)],
      [record("chs-moved-cove", "Moved Cove", 45, -64)],
      none,
    );
    expect(out.map((s) => s.id)).toEqual(["chs-moved-cove"]);
  });

  it("gives a record to the nearer of two stations and mints the other", () => {
    const out = reconcile(
      [iwls("1", "Twin", 45.0015, -64), iwls("2", "Twin", 45.0001, -64)],
      [record("chs-twin", "Twin", 45, -64)],
      none,
    );
    expect(out.find((s) => s.latitude === 45.0001)?.id).toBe("chs-twin");
    expect(out.find((s) => s.latitude === 45.0015)?.id).toBe("chs-twin-2");
  });

  it("drops a station within 0.2 km of a registry tide port", () => {
    const out = reconcile([iwls("1", "Port Twin", 49.3371, -123.254)], [], {
      ports: [{ latitude: 49.337, longitude: -123.254 }],
      taken: [],
    });
    expect(out).toEqual([]);
  });

  it("keeps a station 1 km from a registry port", () => {
    const out = reconcile([iwls("1", "Nearby Bay", 49.346, -123.254)], [], {
      ports: [{ latitude: 49.337, longitude: -123.254 }],
      taken: [],
    });
    expect(out.map((s) => s.id)).toEqual(["chs-nearby-bay"]);
  });

  it("never mints an id that is taken, including a removed station's tombstoned id", () => {
    const out = reconcile([iwls("1", "Gone Point", 50, -125)], [], {
      ports: [],
      taken: ["chs-gone-point"],
    });
    expect(out.map((s) => s.id)).toEqual(["chs-gone-point-2"]);
  });

  it("removes a record no station matches", () => {
    expect(reconcile([], [record("chs-lost", "Lost", 50, -125)], none)).toEqual(
      [],
    );
  });

  it("mints suffixes in IWLS code order, so a rerun is stable", () => {
    const stations = [
      iwls("20", "Same Name", 46, -60),
      iwls("10", "Same Name", 47, -61),
    ];
    const first = reconcile(stations, [], none);
    expect(first.find((s) => s.latitude === 47)?.id).toBe("chs-same-name");
    expect(reconcile([...stations].reverse(), [], none)).toEqual(first);
  });
});

describe("seedStations", () => {
  it("keeps only reserved ids and drops fields the database derives", () => {
    const app = [
      {
        ...record("chs-kept", "Kept", 45, -64),
        region: "Somewhere, NS",
        timezone: "America/Halifax",
      },
      record("chs-point-atkinson-2", "Point Atkinson", 49.337, -123.254),
    ] as ChsStation[];
    expect(seedStations(app, new Set(["chs-kept"]))).toEqual([
      record("chs-kept", "Kept", 45, -64),
    ]);
  });
});
