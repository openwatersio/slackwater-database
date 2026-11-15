import { describe, expect, test } from "vitest";
import {
  defineConstituents,
  constituents as catalog,
} from "@slackwater/engine";
import type { StationInput } from "@slackwater/database";
import { databaseConstituents } from "../constituent-definitions.ts";
import {
  definitionIndex,
  stationDefinitions,
} from "../../database/src/constituent-definitions.ts";
import type { SourceMetadata } from "../sources.ts";

const station = (id: string, source: string, names: string[]) =>
  ({
    id,
    source: { name: source, id, published_harmonics: true, url: "" },
    harmonic_constituents: names.map((name) => ({
      name,
      amplitude: 1,
      phase: 0,
    })),
  }) as StationInput;
const metadata =
  (extra: Partial<SourceMetadata> = {}) =>
  (name: string): SourceMetadata => ({
    name,
    authoritative: false,
    credit: null,
    ...extra,
  });

describe("databaseConstituents", () => {
  // The file stores a factor as a 32-bit float, and a shared line must equal the catalog's.
  test("every catalog member factor survives a 32-bit float", () => {
    for (const line of Object.values(catalog))
      for (const { factor } of line.members)
        expect(Math.fround(factor)).toBe(factor);
  });

  test("stores each catalog line once, with the file's other spellings as aliases", () => {
    const { definitions } = databaseConstituents(
      [station("a/1", "A", ["MM", "M2"]), station("b/1", "B", ["Mm"])],
      metadata(),
    );
    const mm = definitions.find((d) => d.name === "Mm")!;
    expect(mm.aliases).toEqual(["MM"]);
    expect(mm.speed).toBe(catalog["Mm"]!.speed);
    expect(definitions.filter((d) => d.name === "Mm")).toHaveLength(1);
  });

  test("adds the members a compound names, and the engine accepts the result", () => {
    const { definitions } = databaseConstituents(
      [station("a/1", "A", ["MKS2"])],
      metadata(),
    );
    expect(definitions.map((d) => d.name).sort()).toEqual([
      "K2",
      "M2",
      "MKS2",
      "S2",
    ]);
    expect(() => defineConstituents(definitions, catalog)).not.toThrow();
  });

  test("passes a source's own definitions and nodal formulas through, without a shared copy", () => {
    const SA = {
      name: "SA",
      speed: 0.04106668,
      coefficients: [0, 0, 1, 0, 0, -1, 0] as [
        number,
        number,
        number,
        number,
        number,
        number,
        number,
      ],
    };
    const result = databaseConstituents(
      [station("k/1", "K", ["SA", "M2"])],
      metadata({
        node_corrections: "schureman",
        constituent_definitions: [SA],
      }),
    );
    expect(result.sources?.get("K")).toEqual({
      node_corrections: "schureman",
      constituent_definitions: [SA],
    });
    expect(result.definitions.map((d) => d.name)).toEqual(["M2"]);
  });

  test("refuses a name neither the source nor the catalog defines", () => {
    expect(() =>
      databaseConstituents([station("a/1", "A", ["NOPE"])], metadata()),
    ).toThrow("a/1: no definition for constituent NOPE");
  });

  test("refuses a station whose definitions the engine would refuse", () => {
    // Two spellings of one catalog line, each defined by the source.
    const definition = (name: string) => ({
      name,
      speed: catalog["Sa"]!.speed,
      coefficients: [0, 0, 1, 0, 0, 0, 0] as [
        number,
        number,
        number,
        number,
        number,
        number,
        number,
      ],
    });
    expect(() =>
      databaseConstituents(
        [station("a/1", "A", ["SA", "Sa"])],
        metadata({
          constituent_definitions: [definition("SA"), definition("Sa")],
        }),
      ),
    ).toThrow("a/1: the engine refuses its constituent definitions");
  });
});

test("a source's own definition replaces the catalog line under any of its spellings", () => {
  const SA = {
    name: "SA",
    speed: 0.04106668,
    coefficients: [0, 0, 1, 0, 0, -1, 0] as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ],
  };
  // No station in the file spells it "SA", yet the shared line still lists the alias.
  const { definitions } = databaseConstituents(
    [station("k/1", "K", ["Sa"]), station("t/1", "T", ["Sa"])],
    (name) => ({
      name,
      authoritative: false,
      credit: null,
      ...(name === "K" ? { constituent_definitions: [SA] } : {}),
    }),
  );
  const sa = definitions.find((d) => d.name === "Sa")!;
  expect(sa.aliases).toContain("SA");
  expect(
    stationDefinitions(
      ["Sa"],
      definitionIndex([SA], "K"),
      definitionIndex(definitions, "shared"),
    ),
  ).toEqual([SA]);
});
