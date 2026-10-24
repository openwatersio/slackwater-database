import { expect, test } from "vitest";
import { parseTiconSamples } from "../samples.ts";
const text =
  "# TIME ZONE HOURS 0\n2020/01/15 12:00:00 5 1 1\n2020/07/15 12:00:00 6 1 1\n";
test.each([
  ["gauge-deu-wsv", ["2020-01-15T11:00:00.000Z", "2020-07-15T10:00:00.000Z"]],
  ["gauge-nld-rws", ["2020-01-15T12:00:00.000Z", "2020-07-15T11:00:00.000Z"]],
  [
    "gauge-nld-rws_hist",
    ["2020-01-15T12:00:00.000Z", "2020-07-15T12:00:00.000Z"],
  ],
  [
    "hong_kong-329-hkg-uhslc_fd",
    ["2020-01-15T13:00:00.000Z", "2020-07-15T13:00:00.000Z"],
  ],
  [
    "gauge-hkg-uhslc_fd",
    ["2020-01-15T12:00:00.000Z", "2020-07-15T12:00:00.000Z"],
  ],
])("aligns %s samples with its UTC harmonic phases", (id, expected) => {
  expect(
    parseTiconSamples(id as string, text).map((p) => p.time.toISOString()),
  ).toEqual(expected);
});
