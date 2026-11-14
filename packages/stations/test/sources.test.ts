import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { loadSources, sourceMetadata } from "../sources.ts";

test("authority comes from each source's metadata.yaml", () => {
  const authoritative = [...loadSources().values()]
    .filter((source) => source.authoritative)
    .map(({ name }) => name);
  expect(authoritative).toEqual([
    "Japan Coast Guard, Hydrographic and Oceanographic Department",
    "Japan Meteorological Agency",
    "Kartverket / Norwegian Mapping Authority, Hydrographic Service",
    "Toitū Te Whenua Land Information New Zealand",
    "US National Oceanic and Atmospheric Administration",
  ]);
});

test("a jurisdiction must list countries", () => {
  const dir = mkdtempSync(join(tmpdir(), "sources-"));
  mkdirSync(join(dir, "x"));
  writeFileSync(
    join(dir, "x", "metadata.yaml"),
    "name: X\nauthoritative: true\ncredit: null\njurisdiction: United States\n",
  );
  expect(() => loadSources(dir)).toThrow(/jurisdiction must be a list/);
});

test("a source without metadata.yaml is refused", () => {
  expect(() => sourceMetadata("Some Future Source")).toThrow(
    /no sources\/\*\/metadata.yaml declares/,
  );
});

test("constituent definitions and node corrections are checked where they're declared", () => {
  const declare = (body: string) => {
    const dir = mkdtempSync(join(tmpdir(), "sources-"));
    mkdirSync(join(dir, "x"));
    writeFileSync(
      join(dir, "x", "metadata.yaml"),
      `name: X\nauthoritative: false\ncredit: null\n${body}`,
    );
    return () => loadSources(dir);
  };
  expect(declare("node_corrections: doodson\n")).toThrow(
    /node_corrections must be iho or schureman/,
  );
  // coefficients left out, rather than null for a compound.
  expect(
    declare("constituent_definitions:\n  - name: SA\n    speed: 0.04106668\n"),
  ).toThrow(
    /x\/metadata.yaml: constituent_definitions: SA needs 7 integer coefficients or null/,
  );
  expect(declare("constituent_definitions:\n  - 3\n")).toThrow(
    /constituent_definitions: a definition has no name/,
  );
  expect(
    declare(
      "node_corrections: schureman\nconstituent_definitions:\n  - { name: SA, speed: 0.04106668, coefficients: [0, 0, 1, 0, 0, -1, 0] }\n",
    )().get("X"),
  ).toMatchObject({ node_corrections: "schureman" });
});
