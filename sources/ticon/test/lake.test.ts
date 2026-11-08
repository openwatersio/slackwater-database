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
]);

vi.mock("@slackwater/harmonic-analysis/lake", async (original) => ({
  ...(await original<object>()),
  lakeStation: async (id: string) => stations.get(id),
  readLakeSamples: async (
    _: string,
    { start, end }: { start: Date; end: Date },
  ) => series.filter((s) => s.t >= +start && s.t < +end),
}));
const { lakeSeries, refitFromLake } = await import("../lake.ts");

function synthesize(amplitude: (t: number) => number): Sample[] {
  const m2 = engine.constituents["M2"]!;
  const out: Sample[] = [];
  for (let t = Date.UTC(2018, 0, 1); t < Date.UTC(2021, 0, 1); t += 3600000) {
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
  test("has none where the lake prefers GESLA's own record", async () => {
    expect(await lakeSeries("viken-2228-swe-smhi")).toBeUndefined();
  });
  test("refuses a preferred series the lake doesn't list", async () => {
    await expect(lakeSeries("x-1-swe-smhi")).rejects.toThrow(
      "which the lake doesn't list",
    );
  });
  test("has none for a contributor not yet converted", async () => {
    expect(await lakeSeries("a-b-nld-rws")).toBeUndefined();
  });
});

describe("refitFromLake", () => {
  test("swaps when the re-fit describes the held-out year better", async () => {
    series = synthesize(() => 0.5);
    const result = await refitFromLake("smhi/2130", [
      { name: "M2", amplitude: 0.5, phase: 60 },
    ]);
    expect(result?.refit).toMatchObject({
      series: "smhi/2130",
      fit: { start: "2018-01-01", end: "2019-12-31" },
      held_out: { start: "2020-01-01", end: "2020-12-31", hours: 8714 },
      swapped: true,
    });
    expect(result!.refit.rms.refit).toBeLessThan(0.001);
    expect(result!.refit.rms.published).toBeGreaterThan(0.1);
    expect(result!.constituents).toEqual([
      { name: "M2", amplitude: 0.5, phase: 40 },
    ]);
    expect(result!.samples).toHaveLength(series.length);
  });

  test("keeps TICON's long-period constituents, which the score can't see", async () => {
    series = synthesize(() => 0.5);
    const result = await refitFromLake("smhi/2130", [
      { name: "M2", amplitude: 0.5, phase: 60 },
      { name: "SA", amplitude: 0.1, phase: 200 },
    ]);
    expect(result?.refit.swapped).toBe(true);
    expect(result!.constituents).toEqual([
      { name: "M2", amplitude: 0.5, phase: 40 },
      { name: "SA", amplitude: 0.1, phase: 200 },
    ]);
  });

  test("keeps TICON's constants when the re-fit scores worse beyond the tolerance", async () => {
    // The tide the fit years saw is not the held-out year's, which TICON's
    // constants match.
    series = synthesize((t) => (t < Date.UTC(2020, 0, 1) ? 0.4 : 0.5));
    const result = await refitFromLake("smhi/2130", [
      { name: "M2", amplitude: 0.5, phase: 40 },
    ]);
    expect(result?.refit.swapped).toBe(false);
    expect(result!.refit.rms.published).toBeLessThan(0.001);
  });

  test("swaps when the re-fit is worse only within the tolerance", async () => {
    series = synthesize((t) => (t < Date.UTC(2020, 0, 1) ? 0.498 : 0.5));
    const result = await refitFromLake("smhi/2130", [
      { name: "M2", amplitude: 0.5, phase: 40 },
    ]);
    expect(result!.refit.rms.refit).toBeGreaterThan(
      result!.refit.rms.published,
    );
    expect(result?.refit.swapped).toBe(true);
  });

  test("sees a tidal error that weather would hide in the plain RMS", async () => {
    // A 30 cm swell with a week's period dwarfs a 1 cm error in M2.
    const weather = (t: number) =>
      0.3 * Math.sin((2 * Math.PI * t) / (7 * 86_400_000));
    series = synthesize((t) => (t < Date.UTC(2020, 0, 1) ? 0.49 : 0.5)).map(
      (s) => ({ t: s.t, level: s.level + weather(s.t) }),
    );
    const result = await refitFromLake("smhi/2130", [
      { name: "M2", amplitude: 0.5, phase: 40 },
    ]);
    expect(result?.refit.swapped).toBe(false);
  });

  test("holds out a series' last year when it ends that year", async () => {
    series = synthesize(() => 0.5);
    stations.get("smhi/2130")!.last = new Date("2020-12-31T23:00:00Z");
    const result = await refitFromLake("smhi/2130", [
      { name: "M2", amplitude: 0.5, phase: 40 },
    ]);
    stations.get("smhi/2130")!.last = new Date("2021-03-01");
    expect(result?.refit.held_out.start).toBe("2020-01-01");
  });

  test("declines a held-out year whose data only spans it", async () => {
    // January and December: a span of eleven months, but two months of data.
    series = synthesize(() => 0.5).filter(
      (s) => s.t < Date.UTC(2020, 1, 1) || s.t >= Date.UTC(2020, 11, 1),
    );
    expect(
      await refitFromLake("smhi/2130", [
        { name: "M2", amplitude: 0.5, phase: 40 },
      ]),
    ).toBeUndefined();
  });

  test("declines without enough of the held-out year to score", async () => {
    series = synthesize(() => 0.5).filter((s) => s.t < Date.UTC(2020, 3, 1));
    expect(
      await refitFromLake("smhi/2130", [
        { name: "M2", amplitude: 0.5, phase: 40 },
      ]),
    ).toBeUndefined();
  });
});
