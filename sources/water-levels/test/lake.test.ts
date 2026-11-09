import { describe, expect, test, vi } from "vitest";
import * as engine from "@slackwater/engine";
import type { Sample } from "@slackwater/harmonic-analysis";
import type { LakeStation } from "@slackwater/harmonic-analysis/lake";

// One synthetic series: an M2 of `amplitude` at phase 40°, every hour
// from 2018 through 2020, so 2020 is held out and the fit takes 2018–2019.
let series: Sample[] = [];
const station = (id: string, preferred = id): LakeStation => ({
  id,
  source: id.split("/")[0]!,
  source_id: id.split("/")[1]!,
  datum: "RH2000",
  first: new Date("2018-01-01"),
  last: new Date("2021-03-01"),
  preferred,
  same_as: [],
  source_qc_start: null,
  epochs: [],
});
const stations = new Map([
  [
    "gesla/kungsvik-2130-swe-smhi",
    station("gesla/kungsvik-2130-swe-smhi", "smhi/2130"),
  ],
  ["gesla/viken-2228-swe-smhi", station("gesla/viken-2228-swe-smhi")],
  ["gesla/a-b-nld-rws", station("gesla/a-b-nld-rws", "rws/a")],
  ["smhi/2130", station("smhi/2130")],
  ["gesla/x-1-swe-smhi", station("gesla/x-1-swe-smhi", "smhi/1")],
  ["gesla/y-2-swe-smhi", station("gesla/y-2-swe-smhi", "dmi/2")],
  ["dmi/2", station("dmi/2")],
  ["gesla/k-k-swe-cmems", station("gesla/k-k-swe-cmems", "smhi/2130")],
]);

vi.mock("@slackwater/harmonic-analysis/lake", async (original) => ({
  ...(await original<object>()),
  lakeStation: async (id: string) => stations.get(id),
  readLakeSamples: async (
    _: string,
    { start, end }: { start: Date; end: Date },
  ) => series.filter((s) => s.t >= +start && s.t < +end),
}));
const { lakeSeries, fitFromLake, varianceDifferenceSE } =
  await import("../lake.ts");
const { scoresWorse } = await import("@slackwater/stations");
type Constituents = Parameters<typeof fitFromLake>[1];
// TICON's record of the gauge, "k", is scored with the constants given.
const fit = (ticon: Constituents, ticonEnd?: Date) =>
  fitFromLake("smhi/2130", ticon, ticonEnd, [{ id: "k", constituents: ticon }]);
const rms = (result: Awaited<ReturnType<typeof fitFromLake>>) => ({
  fit: result!.held_out.rms,
  ticon: result!.held_out.ticon["k"]!.rms,
});

function synthesize(
  amplitude: (t: number) => number,
  endYear = 2021,
): Sample[] {
  const m2 = engine.constituents["M2"]!;
  const out: Sample[] = [];
  for (
    let t = Date.UTC(2018, 0, 1);
    t < Date.UTC(endYear, 0, 1);
    t += 3600000
  ) {
    const a = engine.astro(new Date(t));
    const { f, u } = m2.correction(a);
    out.push({
      t,
      level:
        1 +
        amplitude(t) * f * Math.cos(((m2.value(a) + u - 40) * Math.PI) / 180),
    });
  }
  return out;
}

describe("lakeSeries", () => {
  test("takes the series the lake prefers for a converted contributor's gauge", async () => {
    expect(await lakeSeries("kungsvik-2130-swe-smhi")).toBe("smhi/2130");
  });
  test("takes it from another agency's copy of the gauge", async () => {
    expect(await lakeSeries("k-k-swe-cmems")).toBe("smhi/2130");
  });
  test("has none where the lake prefers GESLA's own record", async () => {
    expect(await lakeSeries("viken-2228-swe-smhi")).toBeUndefined();
  });
  test("refuses a preferred series the lake doesn't list", async () => {
    await expect(lakeSeries("x-1-swe-smhi")).rejects.toThrow(
      "which the lake doesn't list",
    );
  });
  test("has none where the lake prefers another agency's series", async () => {
    expect(await lakeSeries("y-2-swe-smhi")).toBeUndefined();
  });
  test("has none for a contributor not yet converted", async () => {
    expect(await lakeSeries("a-b-nld-rws")).toBeUndefined();
  });
});

describe("fitFromLake", () => {
  test("scores the fit and TICON's constants on the held-out year", async () => {
    series = synthesize(() => 0.5);
    const result = await fit([{ name: "M2", amplitude: 0.5, phase: 60 }]);
    expect(result).toMatchObject({
      fit: { start: "2018-01-01", end: "2019-12-31" },
      held_out: { start: "2020-01-01", end: "2020-12-31", hours: 8714 },
    });
    expect(rms(result).fit).toBeLessThan(0.001);
    expect(rms(result).ticon).toBeGreaterThan(0.1);
    expect(scoresWorse(rms(result).fit, rms(result).ticon)).toBe(false);
    expect(result!.constituents).toEqual([
      { name: "M2", amplitude: 0.5, phase: 40 },
    ]);
    expect(result!.window).toEqual({
      start: new Date(Date.UTC(2001, 0, 1)),
      end: new Date(Date.UTC(2021, 0, 1)),
    });
    expect(result!.held_out.ticon["k"]!.digest).toMatch(/^[0-9a-f]{16}$/);
  });

  test("holds out the year after TICON's record ends", async () => {
    series = synthesize(() => 0.5, 2022);
    stations.get("smhi/2130")!.last = new Date("2021-12-31T23:00:00Z");
    const result = await fit(
      [{ name: "M2", amplitude: 0.5, phase: 40 }],
      // TICON's last day.
      new Date("2020-06-30"),
    );
    stations.get("smhi/2130")!.last = new Date("2021-03-01");
    expect(result?.held_out).toMatchObject({
      start: "2020-07-01",
      end: "2021-06-30",
    });
    expect(result?.fit).toMatchObject({
      start: "2018-01-01",
      end: "2020-06-30",
    });
  });

  test("falls back to the last calendar year without a year after TICON's end", async () => {
    series = synthesize(() => 0.5);
    const result = await fit(
      [{ name: "M2", amplitude: 0.5, phase: 40 }],
      new Date("2021-01-01"),
    );
    expect(result?.held_out.start).toBe("2020-01-01");
  });

  test("scores worse than TICON beyond the tolerance", async () => {
    // The tide the fit years saw is not the held-out year's, which TICON's
    // constants match.
    series = synthesize((t) => (t < Date.UTC(2020, 0, 1) ? 0.4 : 0.5));
    const result = await fit([{ name: "M2", amplitude: 0.5, phase: 40 }]);
    expect(scoresWorse(rms(result).fit, rms(result).ticon)).toBe(true);
    expect(rms(result).ticon).toBeLessThan(0.001);
  });

  test("is no worse when it trails TICON only within the tolerance", async () => {
    series = synthesize((t) => (t < Date.UTC(2020, 0, 1) ? 0.498 : 0.5));
    const result = await fit([{ name: "M2", amplitude: 0.5, phase: 40 }]);
    expect(rms(result).fit).toBeGreaterThan(rms(result).ticon);
    expect(scoresWorse(rms(result).fit, rms(result).ticon)).toBe(false);
  });

  test("sees a tidal error that weather would hide in the plain RMS", async () => {
    // A 30 cm swell with a week's period dwarfs a 1 cm error in M2.
    const weather = (t: number) =>
      0.3 * Math.sin((2 * Math.PI * t) / (7 * 86_400_000));
    series = synthesize((t) => (t < Date.UTC(2020, 0, 1) ? 0.49 : 0.5)).map(
      (s) => ({ t: s.t, level: s.level + weather(s.t) }),
    );
    const result = await fit([{ name: "M2", amplitude: 0.5, phase: 40 }]);
    expect(scoresWorse(rms(result).fit, rms(result).ticon)).toBe(true);
  });

  test("holds out a series' last year when it ends that year", async () => {
    series = synthesize(() => 0.5);
    stations.get("smhi/2130")!.last = new Date("2020-12-31T23:00:00Z");
    const result = await fit([{ name: "M2", amplitude: 0.5, phase: 40 }]);
    stations.get("smhi/2130")!.last = new Date("2021-03-01");
    expect(result?.held_out.start).toBe("2020-01-01");
  });

  test("declines a held-out year whose data only spans it", async () => {
    // January and December: a span of eleven months, but two months of data.
    series = synthesize(() => 0.5).filter(
      (s) => s.t < Date.UTC(2020, 1, 1) || s.t >= Date.UTC(2020, 11, 1),
    );
    expect(
      await fit([{ name: "M2", amplitude: 0.5, phase: 40 }]),
    ).toBeUndefined();
  });

  test("asks for half of a leap year's hours", async () => {
    // 4455 hours of 2020 score 4385: half a 365-day year, not half of 2020.
    series = synthesize(() => 0.5).filter(
      (s) => s.t < Date.UTC(2020, 0, 1) + 4455 * 3600000,
    );
    expect(
      await fit([{ name: "M2", amplitude: 0.5, phase: 40 }]),
    ).toBeUndefined();
  });

  test("declines without enough of the held-out year to score", async () => {
    series = synthesize(() => 0.5).filter((s) => s.t < Date.UTC(2020, 3, 1));
    expect(
      await fit([{ name: "M2", amplitude: 0.5, phase: 40 }]),
    ).toBeUndefined();
  });
});

describe("fitFromLake's held-out year and published constants", () => {
  test("gives way to the year before when the last can't be scored", async () => {
    // Half of 2021's hours are read, but the filter's edge leaves 4381 scored.
    series = synthesize(() => 0.5, 2022).filter(
      (s) => s.t < Date.UTC(2021, 6, 3),
    );
    stations.get("smhi/2130")!.last = new Date("2021-07-02T23:00:00Z");
    const result = await fit([{ name: "M2", amplitude: 0.5, phase: 40 }]);
    stations.get("smhi/2130")!.last = new Date("2021-03-01");
    expect(result?.held_out.start).toBe("2020-01-01");
    expect(result?.fit).toMatchObject({
      start: "2018-01-01",
      end: "2019-12-31",
    });
  });

  test("keeps TICON's long-period constituents, which the score can't see", async () => {
    series = synthesize(() => 0.5);
    const result = await fit([
      { name: "M2", amplitude: 0.5, phase: 60 },
      { name: "SA", amplitude: 0.1, phase: 200 },
    ]);
    expect(result!.constituents).toEqual([
      { name: "M2", amplitude: 0.5, phase: 40 },
      { name: "SA", amplitude: 0.1, phase: 200 },
    ]);
  });

  test("takes its long-period constituents from the record it is given", async () => {
    series = synthesize(() => 0.5);
    const result = await fitFromLake(
      "smhi/2130",
      [
        { name: "M2", amplitude: 0.5, phase: 60 },
        { name: "SA", amplitude: 0.1, phase: 200 },
      ],
      undefined,
      [],
      [{ name: "SA", amplitude: 0.09, phase: 217 }],
    );
    expect(result!.constituents).toContainEqual({
      name: "SA",
      amplitude: 0.09,
      phase: 217,
    });
  });

  test("fits its own long-period constituents where it is given none", async () => {
    series = synthesize(() => 0.5);
    const result = await fitFromLake(
      "smhi/2130",
      [
        { name: "M2", amplitude: 0.5, phase: 40 },
        { name: "SA", amplitude: 0.1, phase: 200 },
      ],
      undefined,
      [],
      null,
    );
    // The series has no annual term, so the fit's SA is about zero.
    expect(
      result!.constituents.find((c) => c.name === "SA")!.amplitude,
    ).toBeLessThan(0.002);
  });

  test("scores the constants as they are published", async () => {
    // An M2 of 0.5004 m is published as 0.5 m, and scored as 0.5 m.
    series = synthesize(() => 0.5004);
    const result = await fit([{ name: "M2", amplitude: 0.5, phase: 40 }]);
    expect(result!.constituents[0]!.amplitude).toBe(0.5);
    expect(rms(result).fit).toBe(rms(result).ticon);
  });
});

describe("varianceDifferenceSE", () => {
  test("is the standard error of the 30-day block means of a² − b²", () => {
    // Two blocks: the first differs by 3 m² an hour, the second by 1.
    const a = new Map<number, number>();
    const b = new Map<number, number>();
    for (let h = 0; h < 1440; h++) {
      a.set(h, 2);
      b.set(h, h < 720 ? 1 : Math.sqrt(3));
    }
    // Block means 3 and 1: sd √2, over √2 blocks.
    expect(varianceDifferenceSE(a, b)).toBeCloseTo(1, 12);
  });

  test("can't be told with fewer than two blocks", () => {
    const a = new Map([[0, 1]]);
    expect(varianceDifferenceSE(a, a)).toBe(Infinity);
  });
});
