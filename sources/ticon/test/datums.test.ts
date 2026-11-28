import { describe, expect, test } from "vitest";
import { computeDatums, toFixed } from "@slackwater/datums";
import { getChartDatum } from "@slackwater/stations";
import { createTidePredictor } from "@slackwater/engine";
import {
  reduceTiconDatums,
  OBSERVED_OFFSET_NOTICE,
  CONSTITUENT_FRAME_NOTICE,
  cachedDatumNotice,
  restoreCachedCountryDatum,
  OBSERVED_DATUM_NOTICE,
  HARMONIC_DATUM_NOTICE,
  HARMONIC_REDUCTION_NOTICE,
  DATUM_CALCULATOR_NOTICE,
  storedDatumNotice,
} from "../datums.ts";

const constituents = [{ name: "S2", amplitude: 1, phase: 0 }];
test("restores a missing cached China TLT in the stored gauge frame", () => {
  const cached = { MSL: 2.123, LAT: 1.12, MLLW: 1.4 };
  const restored = restoreCachedCountryDatum("CN", cached, constituents);
  const tlt = computeDatums(constituents, {}).datums["TLT"]!;
  expect(restored).toEqual({ ...cached, TLT: toFixed(tlt + cached.MSL, 3) });
  expect(getChartDatum("CN", restored!)).toBe("TLT");
  expect(cached).not.toHaveProperty("TLT");
  expect(restoreCachedCountryDatum("CN", restored!, constituents)).toBe(
    restored,
  );
  expect(restoreCachedCountryDatum("GB", cached, constituents)).toBe(cached);
  expect(
    restoreCachedCountryDatum("CN", { LAT: 1.12 }, constituents),
  ).toBeUndefined();
});

const harmonic = {
  MSL: 0,
  MHHW: 1.2,
  MHW: 1,
  MLW: -1,
  MLLW: -1.2,
  HAT: 1.5,
  LAT: -1.5,
};
const fitEpoch = {
  start: new Date("2000-01-01Z"),
  end: new Date("2010-12-31Z"),
};
const start = Date.UTC(2020, 0, 1);

describe("TICON datum composition", () => {
  test("invalidates legacy reductions without complete period and method provenance", () => {
    expect(cachedDatumNotice({ datums_source: "observed" })).toBeUndefined();
    expect(
      cachedDatumNotice({
        datums_source: "harmonic",
        disclaimers:
          "Datums derived from harmonic prediction; the observation record is too short for an empirical reduction.",
      }),
    ).toBeUndefined();
    expect(
      cachedDatumNotice({
        datums_source: "observed",
        datum_frame: "gauge",
        datum_epoch: { start: "2020-01-01", end: "2020-12-31" },
        datum_coverage: {
          months: 12,
          observed_hours: 8760,
          inferred_hours: 24,
        },
        disclaimers: `No obvious issues ${OBSERVED_DATUM_NOTICE} ${HARMONIC_REDUCTION_NOTICE} ${DATUM_CALCULATOR_NOTICE}`,
      }),
    ).toBe(
      `${OBSERVED_DATUM_NOTICE} ${HARMONIC_REDUCTION_NOTICE} ${DATUM_CALCULATOR_NOTICE}`,
    );
    for (const frame of [OBSERVED_OFFSET_NOTICE, CONSTITUENT_FRAME_NOTICE])
      expect(
        cachedDatumNotice({
          datums_source: "harmonic",
          datum_frame:
            frame === OBSERVED_OFFSET_NOTICE ? "gauge" : "constituent",
          disclaimers: `No obvious issues ${HARMONIC_DATUM_NOTICE} ${frame} ${HARMONIC_REDUCTION_NOTICE} ${DATUM_CALCULATOR_NOTICE}`,
        }),
      ).toBe(
        `${HARMONIC_DATUM_NOTICE} ${frame} ${HARMONIC_REDUCTION_NOTICE} ${DATUM_CALCULATOR_NOTICE}`,
      );
  });
  test("accepts existing frame evidence for migration but rejects its prior harmonic reduction as a current cache", () => {
    const station = {
      datums_source: "harmonic" as const,
      datum_frame: "constituent" as const,
      disclaimers: `${HARMONIC_DATUM_NOTICE} ${CONSTITUENT_FRAME_NOTICE}`,
    };
    expect(storedDatumNotice(station)).toBe(
      `${HARMONIC_DATUM_NOTICE} ${CONSTITUENT_FRAME_NOTICE}`,
    );
    expect(cachedDatumNotice(station)).toBeUndefined();
    expect(
      cachedDatumNotice({
        ...station,
        disclaimers: `${station.disclaimers} ${HARMONIC_REDUCTION_NOTICE}`,
      }),
    ).toBeUndefined();
    expect(
      cachedDatumNotice({
        ...station,
        disclaimers: `${station.disclaimers} ${HARMONIC_REDUCTION_NOTICE} ${DATUM_CALCULATOR_NOTICE}`,
      }),
    ).toBe(
      `${station.disclaimers} ${HARMONIC_REDUCTION_NOTICE} ${DATUM_CALCULATOR_NOTICE}`,
    );
  });
  test("invalidates cached datums whose frame is missing or contradicts their method notice", () => {
    for (const datum_frame of [undefined, "gauge"] as const) {
      expect(
        cachedDatumNotice({
          datums_source: "harmonic",
          ...(datum_frame ? { datum_frame } : {}),
          disclaimers: `${HARMONIC_DATUM_NOTICE} ${CONSTITUENT_FRAME_NOTICE}`,
        }),
      ).toBeUndefined();
    }
  });
  test("invalidates an observed cache that omits or contradicts its inferred-hour coverage", () => {
    for (const datum_coverage of [
      undefined,
      { months: 12, observed_hours: 1, inferred_hours: 0 },
    ]) {
      expect(
        cachedDatumNotice({
          datums_source: "observed",
          datum_frame: "gauge",
          datum_epoch: { start: "2020-01-01", end: "2020-12-31" },
          ...(datum_coverage ? { datum_coverage } : {}),
          disclaimers: OBSERVED_DATUM_NOTICE,
        }),
      ).toBeUndefined();
    }
  });
  test("keeps the observation gauge frame when gaps require the harmonic fallback", () => {
    const samples = Array.from(
      { length: (Date.UTC(2022, 0, 1) - start) / 3600000 },
      (_, h) => ({
        time: new Date(start + h * 3600000),
        level: h % 2 ? 6 : 8,
      }),
    ).filter(
      (p) =>
        !(p.time.getUTCFullYear() === 2020 && p.time.getUTCMonth() === 6) &&
        !(p.time.getUTCFullYear() === 2021 && p.time.getUTCMonth() === 1),
    );
    const result = reduceTiconDatums(samples, constituents, harmonic, fitEpoch);
    expect(result.datums_source).toBe("harmonic");
    expect(result).toHaveProperty("datum_frame", "gauge");
    expect(result.datums).toMatchObject({
      MSL: 7,
      MHHW: 8.2,
      MHW: 8,
      MLW: 6,
      MLLW: 5.8,
      HAT: 8.5,
      LAT: 5.5,
    });
    expect(result.epoch).toEqual({ start: "2000-01-01", end: "2010-12-31" });
    expect(result).not.toHaveProperty("datum_epoch");
    expect(result.datum_notice).toContain(OBSERVED_OFFSET_NOTICE);
    expect(result.datum_notice).toContain(HARMONIC_REDUCTION_NOTICE);
  });

  test("combines one supported empirical mean family with astronomical bounds in the same frame", () => {
    const predictor = createTidePredictor(constituents);
    const samples = Array.from({ length: 24 * 400 }, (_, h) => {
      const time = new Date(start + h * 3600000);
      return { time, level: 7 + predictor.getWaterLevelAtTime({ time }).level };
    });
    const result = reduceTiconDatums(samples, constituents, harmonic, fitEpoch);
    expect(result.datums_source).toBe("observed");
    expect(result.datum_notice).toContain(HARMONIC_REDUCTION_NOTICE);
    expect(result).toHaveProperty("datum_frame", "gauge");
    expect(result.datums["MSL"]).toBeCloseTo(7, 2);
    expect(result.datums["MHW"]).toBeCloseTo(8, 2);
    expect(result.datums["MLW"]).toBeCloseTo(6, 2);
    expect(result.datums["HAT"]).toBeCloseTo(8.5, 2);
    expect(result.datums["LAT"]).toBeCloseTo(5.5, 2);
    expect(result.datums).not.toHaveProperty("LLWLT");
    expect(result.epoch).toEqual({ start: "2000-01-01", end: "2010-12-31" });
    expect(result.datum_epoch).toEqual({
      start: "2020-02-01",
      end: "2021-01-31",
    });
    expect(result.datum_coverage).toEqual({
      months: 12,
      observed_hours: 8784,
      inferred_hours: 0,
    });
    const coarse = reduceTiconDatums(
      samples.filter((_, h) => h % 3 === 0),
      constituents,
      harmonic,
      fitEpoch,
    );
    expect(coarse.datum_coverage).toEqual({
      months: 12,
      observed_hours: 2928,
      inferred_hours: 5856,
    });
  });

  test("stores the inclusive coverage of an observed year with predictable 12-hour gaps", () => {
    const predictor = createTidePredictor(constituents);
    const year = (Date.UTC(2021, 0, 1) - start) / 3600000;
    const samples = Array.from({ length: year }, (_, h) => {
      const time = new Date(start + h * 3600000);
      return { time, level: 7 + predictor.getWaterLevelAtTime({ time }).level };
    }).filter(
      ({ time }) => time.getUTCDate() !== 11 || time.getUTCHours() < 12,
    );

    const result = reduceTiconDatums(samples, constituents, harmonic, fitEpoch);
    expect(result.datums_source).toBe("observed");
    expect(result.datum_epoch).toEqual({
      start: "2020-01-01",
      end: "2020-12-31",
    });
    expect(result.datum_coverage).toEqual({
      months: 12,
      observed_hours: year - 144,
      inferred_hours: 144,
    });
    expect(result.datums["MSL"]).toBeCloseTo(7, 2);
  });

  test("does not invent an observation-frame offset when no record supports one", () => {
    const result = reduceTiconDatums([], constituents, harmonic, fitEpoch);
    expect(result.datums_source).toBe("harmonic");
    expect(result.datums).toEqual(harmonic);
    expect(result).toHaveProperty("datum_frame", "constituent");
    expect(result.datum_notice).toContain(CONSTITUENT_FRAME_NOTICE);
  });
  test("distinguishes a supported zero gauge mean from an unavailable offset", () => {
    const samples = Array.from(
      { length: (Date.UTC(2022, 0, 1) - start) / 3600000 },
      (_, h) => ({
        time: new Date(start + h * 3600000),
        level: h % 2 ? -1 : 1,
      }),
    ).filter(
      (p) =>
        !(p.time.getUTCFullYear() === 2020 && p.time.getUTCMonth() === 6) &&
        !(p.time.getUTCFullYear() === 2021 && p.time.getUTCMonth() === 1),
    );
    const result = reduceTiconDatums(samples, constituents, harmonic, fitEpoch);
    expect(result.datums["MSL"]).toBe(0);
    expect(result).toHaveProperty("datum_frame", "gauge");
    expect(result.datum_notice).toContain(OBSERVED_OFFSET_NOTICE);
    expect(result.datum_notice).not.toContain(CONSTITUENT_FRAME_NOTICE);
  });
});
