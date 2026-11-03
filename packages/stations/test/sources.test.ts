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
