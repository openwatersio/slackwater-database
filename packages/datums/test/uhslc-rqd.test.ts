import { describe, test, expect } from "vitest";
import { parseRqdId, parseRqdSamples } from "../uhslc-rqd.js";

describe("parseRqdId", () => {
  test("maps a TICON uhslc_rq id to its UHSLC id and version", () => {
    expect(parseRqdId("christmas-011b-aus-uhslc_rq")).toEqual({
      uhslcId: 11,
      version: "B",
    });
    expect(parseRqdId("abashiri-347a-jpn-uhslc_rq")).toEqual({
      uhslcId: 347,
      version: "A",
    });
  });

  test("ignores other sources", () => {
    expect(parseRqdId("abashiri-347-jpn-uhslc_fd")).toBeUndefined();
    expect(parseRqdId("aberdeen-abe-gbr-bodc")).toBeUndefined();
  });
});

describe("parseRqdSamples", () => {
  test("reads ERDDAP csv in millimetres as metres and skips gaps", () => {
    const csv = [
      "time,sea_level",
      "UTC,millimeters",
      "2024-12-31T21:00:00Z,1234",
      "2024-12-31T22:00:00Z,NaN",
      "2024-12-31T23:00:00Z,-56",
      "",
    ].join("\n");
    expect(parseRqdSamples(csv)).toEqual([
      { time: new Date("2024-12-31T21:00:00Z"), level: 1.234 },
      { time: new Date("2024-12-31T23:00:00Z"), level: -0.056 },
    ]);
  });
});
