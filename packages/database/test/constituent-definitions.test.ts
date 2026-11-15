import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { buildDatabase } from "../src/database/builder.ts";
import { loadStations } from "../src/load-stations.ts";
import type {
  ConstituentDefinition,
  DatabaseConstituents,
  StationInput,
} from "../src/types.ts";

const station = (
  id: string,
  source: string,
  names: string[],
  extra: Partial<StationInput> = {},
): StationInput => ({
  id,
  name: id,
  latitude: 0,
  longitude: 0,
  country: "Canada",
  country_code: "CA",
  timezone: "Etc/UTC",
  continent: "Americas",
  type: "reference",
  source: {
    name: source,
    id,
    published_harmonics: true,
    url: "https://example.com",
  },
  license: {
    type: "public domain",
    commercial_use: true,
    url: "https://example.com",
  },
  harmonic_constituents: names.map((name) => ({
    name,
    amplitude: 1,
    phase: 0,
  })),
  datums: {},
  ...extra,
});

const M2: ConstituentDefinition = {
  name: "M2",
  speed: 28.9841042,
  coefficients: [2, 0, 0, 0, 0, 0, 0],
};
const K2: ConstituentDefinition = {
  name: "K2",
  speed: 30.0821373,
  coefficients: [2, 2, 0, 0, 0, 0, 0],
};
const S2: ConstituentDefinition = {
  name: "S2",
  speed: 30,
  coefficients: [2, 2, -2, 0, 0, 0, 0],
};
const SA: ConstituentDefinition = {
  name: "Sa",
  speed: 0.0410686,
  coefficients: [0, 0, 1, 0, 0, 0, 0],
  aliases: ["SA"],
};
const MKS2: ConstituentDefinition = {
  name: "MKS2",
  speed: 29.0662415,
  coefficients: [2, 0, 2, 0, 0, 0, 0],
  members: [
    ["M2", 1],
    ["K2", 1],
    ["S2", -1],
  ],
};
// Kartverket's SA, on h − p′ rather than h.
const SA_KV: ConstituentDefinition = {
  name: "SA",
  speed: 0.04106668,
  coefficients: [0, 0, 1, 0, 0, -1, 0],
};

const shared = { definitions: [M2, K2, S2, SA, MKS2] };
const build = (
  stations: StationInput[],
  constituents: DatabaseConstituents = shared,
) =>
  buildDatabase(stations, {
    credits: new Map(stations.map((s) => [s.source!.name, null])),
    constituents,
  });
const names = (definitions: ConstituentDefinition[] | undefined) =>
  definitions?.map((d) => d.name).sort();

describe("constituent definitions", () => {
  test("a station reads its names' definitions and every member they lead to", async () => {
    const db = await loadStations(
      build([station("t/a", "Ticon", ["MKS2", "SA"])]),
    );
    const definitions = db.byId("t/a")!.constituent_definitions;
    // K2 and S2 are stored by no station; MKS2's members bring them in.
    expect(names(definitions)).toEqual(["K2", "M2", "MKS2", "S2", "Sa"]);
    expect(definitions!.find((d) => d.name === "MKS2")).toEqual(MKS2);
    expect(definitions!.find((d) => d.name === "Sa")).toEqual(SA);
  });

  test("a source's own definition replaces the shared one under any spelling, for its stations only", async () => {
    const constituents = {
      ...shared,
      sources: new Map([["Kartverket", { constituent_definitions: [SA_KV] }]]),
    };
    const db = await loadStations(
      build(
        [
          station("k/a", "Kartverket", ["SA", "M2"]),
          station("t/a", "Ticon", ["SA", "M2"]),
        ],
        constituents,
      ),
    );
    expect(db.byId("k/a")!.constituent_definitions).toEqual(
      expect.arrayContaining([SA_KV, M2]),
    );
    expect(names(db.byId("k/a")!.constituent_definitions)).toEqual([
      "M2",
      "SA",
    ]);
    expect(db.byId("t/a")!.constituent_definitions).toEqual(
      expect.arrayContaining([SA, M2]),
    );
  });

  test("a subordinate reads its reference's definitions and nodal formulas", async () => {
    const constituents = {
      ...shared,
      sources: new Map([
        [
          "Kartverket",
          {
            node_corrections: "schureman" as const,
            constituent_definitions: [SA_KV],
          },
        ],
      ]),
    };
    const db = await loadStations(
      build(
        [
          station("k/ref", "Kartverket", ["SA"]),
          station("n/sub", "NOAA", [], {
            type: "subordinate",
            offsets: {
              reference: "k/ref",
              height: { high: 1, low: 1, type: "ratio" },
              time: { high: 0, low: 0 },
            },
          }),
        ],
        constituents,
      ),
    );
    const sub = db.byId("n/sub")!;
    expect(sub.constituent_definitions).toEqual([SA_KV]);
    expect(sub.node_corrections).toBe("schureman");
  });

  test("node corrections read as IHO unless the source says Schureman", async () => {
    const db = await loadStations(
      build([station("a/1", "A", ["M2"]), station("b/1", "B", ["M2"])], {
        ...shared,
        sources: new Map([["B", { node_corrections: "schureman" }]]),
      }),
    );
    expect(db.byId("a/1")!.node_corrections).toBe("iho");
    expect(db.byId("b/1")!.node_corrections).toBe("schureman");
  });

  test("a file written before definitions has none to read", async () => {
    const db = await loadStations(
      new Uint8Array(
        readFileSync(
          new URL("fixtures/pre-minor-current.tcdb", import.meta.url),
        ),
      ),
    );
    const first = db.all.find((s) => s.harmonic_constituents.length)!;
    expect(first.constituent_definitions).toBeUndefined();
    expect(first.node_corrections).toBe("iho");
  });

  test("a file written before definitions rebuilds without them", async () => {
    const db = await loadStations(
      new Uint8Array(
        readFileSync(
          new URL("fixtures/pre-minor-current.tcdb", import.meta.url),
        ),
      ),
    );
    const rebuilt = await loadStations(
      buildDatabase(db.all, {
        credits: new Map(db.all.map((s) => [s.source!.name, null])),
        constituents: db.constituents,
      }),
    );
    expect(rebuilt.constituents.definitions).toEqual([]);
    const first = rebuilt.all.find((s) => s.harmonic_constituents.length)!;
    expect(first.constituent_definitions).toBeUndefined();
  });

  test("a rebuild with the file's constituents keeps each source's own definitions and formulas", async () => {
    const original = await loadStations(
      build(
        [
          station("k/a", "Kartverket", ["SA", "M2"]),
          station("t/a", "Ticon", ["SA", "MKS2"]),
        ],
        {
          ...shared,
          sources: new Map([
            [
              "Kartverket",
              {
                node_corrections: "schureman" as const,
                constituent_definitions: [SA_KV],
              },
            ],
          ]),
        },
      ),
    );
    const rebuild = (ids: string[]) =>
      buildDatabase(
        original.all.filter((s) => ids.includes(s.id)),
        {
          credits: new Map([
            ["Kartverket", null],
            ["Ticon", null],
          ]),
          constituents: original.constituents,
        },
      );
    const both = await loadStations(rebuild(["k/a", "t/a"]));
    for (const id of ["k/a", "t/a"]) {
      expect(both.byId(id)!.constituent_definitions).toEqual(
        original.byId(id)!.constituent_definitions,
      );
      expect(both.byId(id)!.node_corrections).toBe(
        original.byId(id)!.node_corrections,
      );
    }
  });

  test("a read station rebuilds with constituents removed or added", async () => {
    const constituents = {
      ...shared,
      sources: new Map([["Kartverket", { constituent_definitions: [SA_KV] }]]),
    };
    const db = await loadStations(
      build([station("k/a", "Kartverket", ["SA", "MKS2"])], constituents),
    );
    const read = db.byId("k/a")!;
    const edit = (names: string[]) => ({
      ...read,
      harmonic_constituents: names.map((name) => ({
        name,
        amplitude: 1,
        phase: 0,
      })),
    });
    for (const names of [["SA"], ["SA", "MKS2", "K2"]])
      expect(() =>
        buildDatabase([edit(names)], {
          credits: new Map([["Kartverket", null]]),
          constituents: db.constituents,
        }),
      ).not.toThrow();
    // A compound gained over members the station already stores.
    const members = await loadStations(
      build([station("k/c", "Kartverket", ["M2", "K2", "S2"])], constituents),
    );
    expect(() =>
      buildDatabase(
        [
          {
            ...members.byId("k/c")!,
            harmonic_constituents: ["M2", "K2", "S2", "MKS2"].map((name) => ({
              name,
              amplitude: 1,
              phase: 0,
            })),
          },
        ],
        {
          credits: new Map([["Kartverket", null]]),
          constituents: members.constituents,
        },
      ),
    ).not.toThrow();
    // A factor a 32-bit float rounds reads back equal to the one given.
    const third: ConstituentDefinition = {
      name: "MX3",
      speed: 1,
      coefficients: null,
      members: [["M2", 0.1]],
    };
    const withThird = {
      ...shared,
      sources: new Map([
        ["Kartverket", { constituent_definitions: [SA_KV, third] }],
      ]),
    };
    const thirdDb = await loadStations(
      build([station("k/b", "Kartverket", ["MX3"])], withThird),
    );
    expect(() =>
      buildDatabase(thirdDb.all, {
        credits: new Map([["Kartverket", null]]),
        constituents: withThird,
      }),
    ).not.toThrow();
    // Definitions read back in another key order are the same definitions.
    const reordered = {
      ...shared,
      sources: new Map([
        [
          "Kartverket",
          {
            constituent_definitions: [
              {
                coefficients: SA_KV.coefficients,
                speed: SA_KV.speed,
                name: "SA",
              },
            ],
          },
        ],
      ]),
    };
    expect(() =>
      buildDatabase([read], {
        credits: new Map([["Kartverket", null]]),
        constituents: reordered,
      }),
    ).not.toThrow();
  });

  test("editing a station's definitions changes no other station's", async () => {
    const db = await loadStations(
      build([station("a/1", "A", ["M2"]), station("a/2", "A", ["M2"])]),
    );
    db.byId("a/1")!.constituent_definitions![0]!.coefficients![6] = 2;
    expect(db.byId("a/2")!.constituent_definitions![0]).toEqual(M2);
    expect(db.byId("a/1")!.constituent_definitions![0]).toEqual(M2);
  });

  describe("a subordinate", () => {
    const kartverket = {
      ...shared,
      sources: new Map([
        [
          "Kartverket",
          {
            node_corrections: "schureman" as const,
            constituent_definitions: [SA_KV],
          },
        ],
      ]),
    };
    const pair = [
      station("k/ref", "Kartverket", ["SA"]),
      station("n/sub", "NOAA", [], {
        type: "subordinate",
        offsets: {
          reference: "k/ref",
          height: { high: 1, low: 1, type: "ratio" },
          time: { high: 0, low: 0 },
        },
      }),
    ];
    const credits = new Map([
      ["Kartverket", null],
      ["NOAA", null],
    ]);

    test("whose reference is in the file isn't checked against its own source", async () => {
      const db = await loadStations(build(pair, kartverket));
      // Read back, n/sub carries Kartverket's SA, which NOAA doesn't define.
      expect(() =>
        buildDatabase(db.all, { credits, constituents: db.constituents }),
      ).not.toThrow();
    });

    test("whose reference is left out can't move onto its own source's definitions", async () => {
      const db = await loadStations(build(pair, kartverket));
      expect(() =>
        buildDatabase([db.byId("n/sub")!], {
          credits,
          constituents: db.constituents,
        }),
      ).toThrow("n/sub: its reference k/ref is left out");
    });
  });

  describe("the builder refuses", () => {
    test("definitions that lead back to themselves through members", () => {
      expect(() =>
        build([station("a/1", "A", ["M2"])], {
          definitions: [
            { name: "M2", speed: 0, coefficients: null, members: [["MX", 1]] },
            { name: "MX", speed: 0, coefficients: null, members: [["M2", 1]] },
          ],
        }),
      ).toThrow("is cyclic through its members");
    });

    test("a member factor a 32-bit float can't hold", () => {
      expect(() =>
        build([station("a/1", "A", ["MKS2"])], {
          definitions: [M2, K2, S2, { ...MKS2, members: [["M2", 1e40]] }],
        }),
      ).toThrow("MKS2 has a malformed member");
    });

    test("a stored name nothing defines", () => {
      expect(() => build([station("a/1", "A", ["M4"])])).toThrow(
        "a/1: no definition for constituent M4",
      );
    });

    test("a member nothing defines", () => {
      expect(() =>
        build([station("a/1", "A", ["MKS2"])], { definitions: [M2, MKS2] }),
      ).toThrow("MKS2 names member K2, which nothing defines");
    });

    test("a name or alias defined twice in one set", () => {
      expect(() =>
        build([station("a/1", "A", ["M2"])], {
          definitions: [M2, { ...S2, aliases: ["M2"] }],
        }),
      ).toThrow("shared definitions: M2 is defined twice");
    });

    test("malformed coefficients", () => {
      expect(() =>
        build([station("a/1", "A", ["M2"])], {
          definitions: [{ ...M2, coefficients: [2, 0, 0] as never }],
        }),
      ).toThrow("M2 needs 7 integer coefficients or null");
    });

    test("an unknown nodal correction scheme", () => {
      expect(() =>
        build([station("a/1", "A", ["M2"])], {
          ...shared,
          sources: new Map([["A", { node_corrections: "doodson" as never }]]),
        }),
      ).toThrow("A: unknown node_corrections doodson");
    });

    test("two of a source's definitions replacing one shared definition", () => {
      expect(() =>
        build([station("k/a", "Kartverket", ["SA", "Sa"])], {
          ...shared,
          sources: new Map([
            [
              "Kartverket",
              { constituent_definitions: [SA_KV, { ...SA_KV, name: "Sa" }] },
            ],
          ]),
        }),
      ).toThrow("Kartverket: Sa and SA both replace the shared Sa");
    });

    test("a read station that the given constituents would predict differently", async () => {
      const db = await loadStations(
        build([station("k/a", "Kartverket", ["SA"])], {
          ...shared,
          sources: new Map([
            ["Kartverket", { constituent_definitions: [SA_KV] }],
          ]),
        }),
      );
      expect(() =>
        buildDatabase(db.all, {
          credits: new Map([["Kartverket", null]]),
          constituents: shared,
        }),
      ).toThrow("k/a: these constituents give it other definitions");
      expect(() =>
        buildDatabase(db.all, {
          credits: new Map([["Kartverket", null]]),
          constituents: db.constituents,
        }),
      ).not.toThrow();
    });

    test("a read station rebuilt with no definitions when its source used Schureman's formulas", async () => {
      const db = await loadStations(
        build([station("k/a", "Kartverket", ["M2"])], {
          ...shared,
          sources: new Map([["Kartverket", { node_corrections: "schureman" }]]),
        }),
      );
      expect(() =>
        buildDatabase(db.all, {
          credits: new Map([["Kartverket", null]]),
          constituents: { definitions: [] },
        }),
      ).toThrow("k/a: these constituents give it other definitions");
    });

    test("a read station whose source replaced a shared line it stores under the shared spelling", async () => {
      const db = await loadStations(
        build([station("k/a", "Kartverket", ["Sa"])], {
          ...shared,
          sources: new Map([
            ["Kartverket", { constituent_definitions: [SA_KV] }],
          ]),
        }),
      );
      expect(db.byId("k/a")!.constituent_definitions).toEqual([SA_KV]);
      expect(() =>
        buildDatabase(db.all, {
          credits: new Map([["Kartverket", null]]),
          constituents: shared,
        }),
      ).toThrow("k/a: these constituents give it other definitions");
    });

    test("one of a source's definitions replacing two shared definitions", () => {
      expect(() =>
        build([station("k/a", "Kartverket", ["M2"])], {
          ...shared,
          sources: new Map([
            [
              "Kartverket",
              { constituent_definitions: [{ ...M2, aliases: ["K2"] }] },
            ],
          ]),
        }),
      ).toThrow("Kartverket: M2 replaces both the shared M2 and K2");
    });

    test("a definition with a key it doesn't know", () => {
      expect(() =>
        build([station("a/1", "A", ["M2"])], {
          definitions: [{ ...M2, member: [["S2", 1]] } as never],
        }),
      ).toThrow("M2 has an unknown key member");
    });

    test("a member factor that isn't a number", () => {
      expect(() =>
        build([station("a/1", "A", ["MKS2"])], {
          definitions: [
            M2,
            K2,
            S2,
            { ...MKS2, members: [["M2", "1" as never]] },
          ],
        }),
      ).toThrow("MKS2 has a malformed member");
    });

    test("a build with no definitions given", () => {
      expect(() =>
        (buildDatabase as Function)([], { credits: new Map() }),
      ).toThrow(/needs constituents/);
    });
  });
});
