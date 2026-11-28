import { describe, expect, test } from "vitest";
import { parseGeslaSamples } from "../gesla.ts";

describe("parseGeslaSamples", () => {
  test("keeps use_flag=1 rows, drops nulls/flagged, converts to UTC", () => {
    const text = [
      "# SITE NAME Test",
      "# TIME ZONE HOURS 0",
      "# NULL VALUE -99.9999",
      "#",
      "2020/01/01 00:00:00   1.2300 1 1",
      "2020/01/01 01:00:00 -99.9999 5 0", // missing -> excluded
      "2020/01/01 02:00:00   3.4000 3 0", // doubtful -> excluded
      "2020/01/01 03:00:00   2.1000 1 1",
    ].join("\n");

    const samples = parseGeslaSamples(text);
    expect(samples).toHaveLength(2);
    expect(samples[0]!.level).toBe(1.23);
    expect(samples[0]!.time.toISOString()).toBe("2020-01-01T00:00:00.000Z");
    expect(samples[1]!.level).toBe(2.1);
  });
});
