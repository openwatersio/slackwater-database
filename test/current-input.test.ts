import { describe, expect, test } from "vitest";
import { currentInputs, type CurrentBundle } from "../tools/current-input.ts";

const harmonic = {
  id: "PUG1701",
  name: "Deception Pass",
  type: "harmonic" as const,
  latitude: 48.4,
  longitude: -122.65,
  floodDirection: 90,
  ebbDirection: 270,
  offset: 0.4,
  constituents: [{ name: "M2", amplitude: 2.1, phase: 42 }],
  tideReference: "noaa/9447905",
};

const subordinate = {
  id: "PUG1702",
  name: "Deception Pass East",
  type: "subordinate" as const,
  latitude: 48.41,
  longitude: -122.64,
  reference: "PUG1701",
  floodDirection: 95,
  ebbDirection: 275,
  slackBeforeFloodOffset: -720,
  slackBeforeEbbOffset: 720,
  floodTimeOffset: 60,
  ebbTimeOffset: -60,
  floodSpeedRatio: 1.2,
  ebbSpeedRatio: 0.8,
};

describe("NOAA current input", () => {
  test("converts harmonic and subordinate records", () => {
    const [reference, reduced] = currentInputs({
      stations: [harmonic, subordinate],
    });

    expect(reference).toMatchObject({
      id: "noaa/PUG1701",
      kind: "current",
      type: "reference",
      country: "United States",
      country_code: "US",
      timezone: "America/Los_Angeles",
      harmonic_constituents: harmonic.constituents,
      current: {
        flood_direction: 90,
        ebb_direction: 270,
        mean_flow: 0.4,
        tide_reference: "noaa/9447905",
      },
      source: {
        name: "US National Oceanic and Atmospheric Administration",
        id: "PUG1701",
        published_harmonics: true,
      },
      license: { type: "public domain", commercial_use: true },
    });
    expect(reduced).toMatchObject({
      id: "noaa/PUG1702",
      type: "subordinate",
      harmonic_constituents: [],
      current: {
        flood_direction: 95,
        ebb_direction: 275,
        offsets: {
          reference: "noaa/PUG1701",
          slack_before_flood: -12,
          slack_before_ebb: 12,
          flood_time: 1,
          ebb_time: -1,
          flood_speed_ratio: 1.2,
          ebb_speed_ratio: 0.8,
        },
      },
    });
  });

  test("rejects a time offset that is not a whole minute", () => {
    const broken: CurrentBundle = {
      stations: [{ ...subordinate, id: "PUG-broken", floodTimeOffset: 61 }],
    };
    expect(() => currentInputs(broken)).toThrow(
      /PUG-broken.*floodTimeOffset.*61/,
    );
  });

  test("keeps non-primary bins for prediction but out of public routes", () => {
    const [result] = currentInputs({
      stations: [{ ...harmonic, id: "PUG1701@7" }],
    });
    expect(result).toMatchObject({ id: "noaa/PUG1701@7", routed: false });
  });

  test("keeps directionless subordinates as references but out of public routes", () => {
    const [result] = currentInputs({
      stations: [{ ...subordinate, id: "ACT3681", ebbDirection: null }],
    });
    expect(result).toMatchObject({ id: "noaa/ACT3681", routed: false });
    expect(result!.current).not.toHaveProperty("ebb_direction");
  });
});
