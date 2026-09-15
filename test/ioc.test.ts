import { describe, test, expect } from "vitest";
import { parseIocSamples } from "../tools/ioc.js";

describe("parseIocSamples", () => {
  test("drops QC-nulled NA rows and parses stime as UTC", () => {
    const samples = parseIocSamples(
      [
        "total_days\tcurrent_page\ttotal_pages\tnext_page\tprev_page",
        "365\t1\t1\t\t",
        "slevel\tstime\tsensor",
        "1.25\t2025-07-14 00:10:00\trad",
        "NA\t2025-07-14 00:20:00\trad",
        "-0.5\t2025-07-14 00:30:00\trad",
        "",
      ].join("\n"),
    );
    expect(samples).toHaveLength(2);
    expect(samples[0]!.time.toISOString()).toBe("2025-07-14T00:10:00.000Z");
    expect(samples[0]!.level).toBe(1.25);
    expect(samples[1]!.level).toBe(-0.5);
  });
});
