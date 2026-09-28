import { describe, expect, it } from "vitest";
import { chsInputs } from "../chs-input.ts";

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
});
