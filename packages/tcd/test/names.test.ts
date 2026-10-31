import { describe, test, expect } from "vitest";
import { loadStations, type Station } from "@slackwater/database";

import {
  buildConstituentList,
  buildStationNames,
  generateHarmonicsTxt,
  noteLines,
} from "../build.ts";

const { accepted: stations } = await loadStations();

test("exports every harmonic reference license with its required notice", () => {
  const references = stations.filter(
    (s) => s.type === "reference" && s.harmonic_constituents.length > 0,
  );
  const representatives = [
    ...new Map(references.map((s) => [s.license.type, s])).values(),
  ];
  const harmonics = generateHarmonicsTxt(
    representatives,
    buildStationNames(representatives),
    ["M2"],
  );
  expect(
    [...harmonics.matchAll(/^# restriction: (.+)$/gm)].map((m) => m[1]).sort(),
  ).toEqual(["CC BY 4.0", "CC BY-NC 4.0", "Japan GSTU 2.0", "Public Domain"]);
  const jhod = references.find((s) => s.id === "jhod/0154")!;
  const notes = [...harmonics.matchAll(/^# note: (.*)$/gm)]
    .map((m) => m[1])
    .join(" ");
  expect(notes).toContain(jhod.attribution);
});

test("keeps distinct XTide names for the Coast Guard and JMA Yokohama gauges", () => {
  const names = buildStationNames(stations);
  expect(names.get("jhod/0062")).toBe("Yokohamashinko, Kanagawa, Japan");
  expect(names.get("ticon/yokohama-ma16-jpn-jodc_jma")).toBe(
    "Yokohama, Kanagawa, Japan",
  );
});

function station(fields: Partial<Station>): Station {
  return {
    id: "test/1",
    type: "subordinate",
    kind: "tide",
    source: { id: "1" },
    ...fields,
  } as Station;
}

describe("build_tide_db byte limits", () => {
  test("drops trailing name parts when multi-byte characters exceed 63 bytes", () => {
    // 43 characters but 68 bytes, so a character count would let it through
    const s = station({
      name: "ø".repeat(25),
      region: "Nordland",
      country: "Norway",
    });
    const name = buildStationNames([s]).get(s.id)!;
    expect(name).toBe(`${"ø".repeat(25)}, Nordland`);
    expect(Buffer.byteLength(name)).toBeLessThanOrEqual(63);
  });

  test("wraps note lines by bytes", () => {
    // 179 characters but 299 bytes
    const disclaimers = Array(60).fill("©©").join(" ");
    const lines = noteLines(disclaimers);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(Buffer.byteLength(line)).toBeLessThanOrEqual(254);
      // build_tide_db files any other comment line under Comments
      expect(line).toMatch(/^# note: /);
    }
    expect(lines.map((l) => l.slice("# note: ".length)).join(" ")).toBe(
      disclaimers,
    );
  });
});

test("zero-only terms use no TCD constituent slot; small measured terms still do", () => {
  const s = station({
    type: "reference",
    harmonic_constituents: [
      { name: "M2", amplitude: 0, phase: 15 },
      { name: "S2", amplitude: 0.001, phase: 0 },
    ],
  });
  expect(buildConstituentList([s])).toEqual(["S2"]);
  const other = station({
    type: "reference",
    harmonic_constituents: [{ name: "M2", amplitude: 0.002, phase: 0 }],
  });
  expect(buildConstituentList([s, other])).toEqual(["M2", "S2"]);
});
