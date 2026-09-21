import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { FIXTURES_DIR, refreshSnapshot, verifySnapshot } from "../import.ts";
import * as validation from "../validate.ts";

const point = (minutes: number, level: number, high = true) => ({
  time: new Date(Date.UTC(2020, 0, 1, 0, minutes)),
  level,
  high,
});

describe("validation snapshot refresh", () => {
  it("preserves pinned comparisons when refreshing source metadata", async () => {
    const parent = await mkdtemp(join(tmpdir(), "kartverket-validation-"));
    const directory = join(parent, "fixtures");
    try {
      await cp(FIXTURES_DIR, directory, { recursive: true });
      const { manifest, contents } = await verifySnapshot(directory);
      const fetcher: typeof fetch = async (input) => {
        const entry = manifest.files.find(({ url }) => url === String(input));
        if (!entry || entry.path.startsWith("validation/"))
          throw new Error("Unexpected source request");
        return new Response(contents.get(entry.path));
      };
      const refreshed = await refreshSnapshot(directory, fetcher);
      expect(
        refreshed.manifest.files.filter(({ path }) =>
          path.startsWith("validation/"),
        ),
      ).toEqual(
        manifest.files.filter(({ path }) => path.startsWith("validation/")),
      );
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
  it("leaves the snapshot intact after a partially successful validation refresh", async () => {
    const parent = await mkdtemp(join(tmpdir(), "kartverket-validation-"));
    const directory = join(parent, "fixtures");
    try {
      await cp(FIXTURES_DIR, directory, { recursive: true });
      const before = await readFile(join(directory, "manifest.json"), "utf8");
      const fetcher = vi.fn<typeof fetch>(async (input) => {
        const url = new URL(String(input));
        if (url.searchParams.get("datatype") === "tab")
          throw new Error("network unavailable");
        const points = Array.from(
          { length: 73 },
          (_, hour) =>
            `<waterlevel value="0" time="${new Date(Date.UTC(2020, 0, 1, hour)).toISOString()}" flag="pre"/>`,
        ).join("");
        return new Response(xml(points).replace('code="TOS"', 'code="AES"'));
      });
      await expect(refreshSnapshot(directory, fetcher, true)).rejects.toThrow(
        /network unavailable/,
      );
      expect(await readFile(join(directory, "manifest.json"), "utf8")).toBe(
        before,
      );
      await expect(verifySnapshot(directory)).resolves.toHaveProperty(
        "stations.length",
        33,
      );
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("rejects a manifest that omits one required prediction response", async () => {
    const parent = await mkdtemp(join(tmpdir(), "kartverket-validation-"));
    const directory = join(parent, "fixtures");
    try {
      await cp(FIXTURES_DIR, directory, { recursive: true });
      const { manifest } = await verifySnapshot(directory);
      manifest.files = manifest.files.filter(
        ({ path }) => path !== "validation/stations/AES-2020-01-01-pre.xml",
      );
      await writeFile(
        join(directory, "manifest.json"),
        JSON.stringify(manifest),
      );
      await expect(verifySnapshot(directory)).rejects.toThrow(
        /complete response set/,
      );
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});

const xml = (
  points = '<waterlevel value="12.5" time="2020-01-01T00:00:00+00:00" flag="pre"/><waterlevel value="-1.0" time="2020-01-01T01:00:00+00:00" flag="pre"/>',
) =>
  `<tide><stationdata><location code="TOS"><data type="prediction" unit="cm" reflevelcode="MSL">${points}</data></location></stationdata></tide>`;
const window = { start: "2020-01-01T00:00:00Z", end: "2020-01-01T01:00:00Z" };

describe("provider response validation", () => {
  it("parses exact UTC timestamps, centimetres, and all hourly endpoints", () => {
    const parsed = validation.parsePredictions(xml(), "TOS", "pre", window);
    expect(parsed.map(({ level }) => level)).toEqual([0.125, -0.01]);
    expect(parsed[0]!.time.toISOString()).toBe("2020-01-01T00:00:00.000Z");
    expect(() =>
      validation.parsePredictions(
        xml().replace(/<waterlevel[^>]+\/>/, ""),
        "TOS",
        "pre",
        window,
      ),
    ).toThrow(/timeline/i);
  });

  it("rejects error responses, unsafe XML, wrong station, datum, units, and nonfinite heights", () => {
    for (const bad of [
      xml().replace('code="TOS"', 'code="SVG"'),
      xml().replace('unit="cm"', 'unit="m"'),
      xml().replace('reflevelcode="MSL"', 'reflevelcode="CD"'),
      xml().replace('value="12.5"', 'value="NaN"'),
      xml().replace("+00:00", ""),
      "<tide><error>Bad request</error></tide>",
      "<!DOCTYPE tide><tide/>",
    ]) {
      expect(() =>
        validation.parsePredictions(bad, "TOS", "pre", window),
      ).toThrow();
    }
  });

  it("parses high and low events without rounding their times", () => {
    const response = xml(
      '<waterlevel value="20" time="2020-01-01T00:05:00+00:00" flag="high"/><waterlevel value="-20" time="2020-01-01T00:55:00+00:00" flag="low"/>',
    );
    expect(
      validation
        .parsePredictions(response, "TOS", "tab", window)
        .map(({ high }) => high),
    ).toEqual([true, false]);
    expect(() =>
      validation.parsePredictions(
        response.replace('flag="high"', 'flag="pre"'),
        "TOS",
        "tab",
        window,
      ),
    ).toThrow(/flag/i);
  });
});

describe("provider comparison metrics", () => {
  it("computes signed-error RMSE and nearest-rank absolute percentiles", () => {
    expect(validation.rmse([-3, 4])).toBeCloseTo(Math.sqrt(12.5));
    expect(validation.percentile([3, 1, 2, 4], 0.95)).toBe(4);
    expect(validation.maximumAbsoluteError([-0.04, 0.02])).toBe(0.04);
    expect(() => validation.rmse([])).toThrow(/empty/i);
    expect(() => validation.rmse([NaN])).toThrow(/finite/i);
  });

  it("enforces each inclusive series threshold independently", () => {
    expect(() => validation.assertSeries([{ error: 0.02 }])).not.toThrow();
    expect(() => validation.assertSeries([{ error: 0.0201 }])).toThrow(
      /RMSE.*0.02 m/,
    );
    expect(() => validation.assertSeries([{ error: 0.051 }])).toThrow(
      /maximum.*0.05 m/,
    );
    expect(() =>
      validation.assertSeries(
        Array.from({ length: 100 }, (_, i) => ({ error: i < 6 ? 0.031 : 0 })),
      ),
    ).toThrow(/p95.*0.03 m/);
    expect(() =>
      validation.assertSeries(
        Array.from({ length: 100 }, (_, i) => ({
          error: i < 5 ? 0.05 : i < 10 ? 0.03 : 0,
        })),
      ),
    ).not.toThrow();
    expect(() => validation.assertSeries([])).toThrow(/empty/i);
  });

  it("compares heights at the provider timestamp and rejects incomplete timelines", () => {
    expect(
      validation
        .compareSeries(
          [point(0, 1), point(60, 2)],
          [point(0, 1.01), point(60, 1.98)],
        )
        .map(({ error }) => error),
    ).toEqual([1.01 - 1, 1.98 - 2]);
    expect(() =>
      validation.compareSeries([point(0, 1)], [point(1, 1)]),
    ).toThrow(/timestamp/i);
    expect(() => validation.compareSeries([point(0, 1)], [])).toThrow(/count/i);
  });

  it("matches each extreme once, preserving high/low and all events", () => {
    expect(
      validation
        .matchExtremes(
          [point(0, 1), point(360, -1, false)],
          [point(4, 1.02), point(359, -1.01, false)],
        )
        .map(({ timeErrorMinutes }) => timeErrorMinutes),
    ).toEqual([4, 1]);
    expect(() =>
      validation.matchExtremes([point(0, 1)], [point(0, 1, false)]),
    ).toThrow(/high\/low/i);
    expect(() =>
      validation.matchExtremes([point(0, 1), point(720, 1)], [point(0, 1)]),
    ).toThrow(/count/i);
    expect(() => validation.matchExtremes([], [])).toThrow(/empty/i);
  });

  it("matches boundary events from padded predictions without hiding interior extras", () => {
    expect(
      validation
        .matchExtremes(
          [point(0, 1), point(60, -1, false)],
          [point(-8, -1, false), point(-1, 1), point(61, -1, false)],
          window,
        )
        .map((e) => e.timeErrorMinutes),
    ).toEqual([1, 1]);
    expect(() =>
      validation.matchExtremes(
        [point(0, 1), point(60, -1, false)],
        [point(-1, 1), point(30, 0), point(61, -1, false)],
        window,
      ),
    ).toThrow(/count/i);
  });

  it("enforces inclusive extreme height and time limits", () => {
    expect(() =>
      validation.assertExtreme({ timeErrorMinutes: 5, heightError: -0.05 }),
    ).not.toThrow();
    expect(() =>
      validation.assertExtreme({ timeErrorMinutes: 5.1, heightError: 0 }),
    ).toThrow(/5 minutes/);
    expect(() =>
      validation.assertExtreme({ timeErrorMinutes: 0, heightError: -0.051 }),
    ).toThrow(/0.05 m/);
    expect(() =>
      validation.assertExtreme({ timeErrorMinutes: NaN, heightError: 0 }),
    ).toThrow(/finite/i);
  });
});
