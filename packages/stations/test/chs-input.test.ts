import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { chsInputs } from "../chs-input.ts";
import { loadGeocoder } from "../geocode.ts";
import { loadWaterBodies } from "../water-bodies.ts";
import { resolveMetadata } from "../metadata.ts";

describe("chsInputs", () => {
  it("builds an identity-only tide input with a timezone and no provider code", () => {
    const [input] = chsInputs([
      {
        id: "chs-abbotts-harbour",
        name: "Abbotts Harbour",
        aliases: [],
        latitude: 43.663818,
        longitude: -65.824022,
      },
    ]);
    expect(input).toEqual({
      id: "chs-abbotts-harbour",
      kind: "tide",
      name: "Abbotts Harbour",
      latitude: 43.663818,
      longitude: -65.824022,
      timezone: "America/Halifax",
      country: "Canada",
      type: "reference",
      harmonic_constituents: [],
      source: {
        name: "Canadian Hydrographic Service",
        id: "chs-abbotts-harbour",
        published_harmonics: false,
        url: "https://github.com/openwatersio/slackwater-database/blob/main/sources/chs/README.md",
      },
      license: {
        type: "MIT",
        commercial_use: true,
        url: "https://github.com/openwatersio/slackwater-database/blob/main/LICENSE",
      },
    });
  });

  it("carries aliases only when there are some", () => {
    const [input] = chsInputs([
      {
        id: "chs-x",
        name: "X",
        aliases: ["ex"],
        latitude: 48.4,
        longitude: -123.4,
      },
    ]);
    expect(input?.aliases).toEqual(["ex"]);
  });

  it("publishes curated names, qualifiers, and coast fallbacks", () => {
    const ids = new Set([
      "chs-cap-aux-meules",
      "chs-charlottetown-nl",
      "chs-come-by-chance",
      "chs-prince-rupert-roro",
    ]);
    const records = JSON.parse(
      readFileSync(
        new URL("../../../sources/chs/stations.json", import.meta.url),
        "utf8",
      ),
    ).filter(({ id }: { id: string }) => ids.has(id));
    const geocoder = { nearest: () => null, near: () => [] };

    expect(
      chsInputs(records).map((station) => {
        const { id, name, context } = resolveMetadata(station, { geocoder });
        return { id, name, context };
      }),
    ).toEqual([
      {
        id: "chs-cap-aux-meules",
        name: "Cap-aux-Meules",
        context: "St. Lawrence",
      },
      {
        id: "chs-charlottetown-nl",
        name: "Charlottetown",
        context: "NL",
      },
      {
        id: "chs-come-by-chance",
        name: "Come by Chance",
        context: "Atlantic Coast",
      },
      {
        id: "chs-prince-rupert-roro",
        name: "Prince Rupert RoRo",
        context: "Pacific Coast",
      },
    ]);
  });

  it("derives a context for every live CHS tide station", async () => {
    const records = JSON.parse(
      readFileSync(
        new URL("../../../sources/chs/stations.json", import.meta.url),
        "utf8",
      ),
    );
    const geocoder = await loadGeocoder();
    const waterBodies = await loadWaterBodies();

    expect(
      chsInputs(records)
        .map((station) =>
          resolveMetadata(station, {
            geocoder,
            waterBodies,
          }),
        )
        .filter((station) => !station.context)
        .map((station) => station.id),
    ).toEqual([]);
  });
});
