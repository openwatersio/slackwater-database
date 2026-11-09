import { afterEach, describe, expect, test, vi } from "vitest";
import {
  checkConstituents,
  checkDatumOrdering,
  checkTidalRange,
  checkSeasonalDominance,
  hasSimilarM2,
  loadAllStations,
  RECENCY_YEAR,
  scoreAmplitude,
  scoreRecency,
  scoreSource,
  tideConflict,
  deduplicateByGauge,
  decideHeldOut,
  scoreCoverage,
} from "../evaluate-quality.ts";
import { constituentsDigest, exceeds, seasonalTerms } from "../filtering.ts";

type Station = Parameters<typeof checkConstituents>[0];
type Constituent = { amplitude: number; phase?: number };

function station(
  constituents: Record<string, number | Constituent>,
  id = "ticon/test",
): Station {
  return {
    id,
    type: "reference",
    harmonic_constituents: Object.entries(constituents).map(([name, c]) =>
      typeof c === "number"
        ? { name, amplitude: c, phase: 10 }
        : { name, amplitude: c.amplitude, phase: c.phase ?? 10 },
    ),
  } as unknown as Station;
}

const BASE = { M2: 0.5, S2: 0.2, K1: 0.1, O1: 0.07 };

describe("observed means and astronomical bounds", () => {
  test.each([undefined, "harmonic"] as const)(
    "uses NOAA's published observed means unless the method is explicitly %s",
    (method) => {
      const s = station(BASE, "noaa/test");
      if (method) s.datums_source = method;
      s.datums = {
        HAT: 1,
        MHHW: 1.018,
        MHW: 0.9,
        MSL: 0,
        MLW: -0.9,
        MLLW: -0.99,
        LAT: -0.885,
      };
      const result = checkDatumOrdering(s, new Map());
      expect(result.fatal).toHaveLength(method ? 2 : 0);
      expect(result.warnings).toHaveLength(method ? 0 : 2);
    },
  );
  test.each([
    [0.05, 0],
    [0.0501, 2],
  ])(
    "applies the cross-period allowance at a %s m disagreement",
    (difference, fatal) => {
      const s = station(BASE);
      s.datums_source = "observed";
      s.datums = {
        HAT: 1,
        MHHW: 1 + difference!,
        MHW: 0.9,
        MSL: 0,
        MLW: -0.9,
        MLLW: -0.99,
        LAT: -0.9 + difference!,
      };
      expect(checkDatumOrdering(s, new Map()).fatal).toHaveLength(fatal!);
    },
  );
  test("rejects a large disagreement between the observation period and its harmonic model", () => {
    const s = station(BASE);
    s.datums_source = "observed";
    s.datums = {
      HAT: 1,
      MHHW: 1.2,
      MHW: 0.9,
      MSL: 0,
      MLW: -0.9,
      MLLW: -0.99,
      LAT: -0.7,
    };
    expect(checkDatumOrdering(s, new Map()).fatal).toHaveLength(2);
  });
  test.each(["observed", "harmonic"] as const)(
    "keeps cross-method bound violations as warnings only for %s means",
    (source) => {
      const s = station(BASE);
      s.datums_source = source;
      s.datums = {
        HAT: 1,
        MHHW: 1.001,
        MHW: 0.9,
        MSL: 0,
        MLW: -0.9,
        MLLW: -0.99,
        LAT: -0.899,
      };
      const result = checkDatumOrdering(s, new Map());
      expect(result.fatal).toHaveLength(source === "observed" ? 0 : 2);
      expect(result.warnings).toHaveLength(source === "observed" ? 2 : 0);
    },
  );
});

describe("checkTidalRange", () => {
  test.each([
    [0.142, 0.122],
    [0.036, 0.016],
    [0.021, 0.001],
  ])("accepts the exact 2 cm boundary at %s minus %s", (high, low) => {
    const s = station(BASE);
    s.datums = { MHW: high, MLW: low };
    expect(checkTidalRange(s, new Map())).toBeNull();
  });

  test("rejects a range below the 2 cm boundary", () => {
    const s = station(BASE);
    s.datums = { MHW: 0.141, MLW: 0.122 };
    expect(checkTidalRange(s, new Map())).toContain("Tidal range");
  });
});

test("DMI prediction fits use a fixed source rank regardless of station ID spelling", () => {
  for (const id of ["25149", "future-dmi"])
    expect(
      scoreSource({
        id: `dmi/${id}`,
        source: { id, name: "Danish Meteorological Institute" },
      } as Station),
    ).toBe(0.495);
});

describe("exceeds", () => {
  test("needs more than the 3 mm fit tolerance", () => {
    expect(exceeds(0.005, 0.002)).toBe(false);
    expect(exceeds(0.0051, 0.002)).toBe(true);
  });
});

describe("seasonalTerms", () => {
  test("puts SA_KV on SA's clock by adding the longitude of perihelion", () => {
    const { annual } = seasonalTerms([
      { name: "SA_KV", amplitude: 0.1, phase: 100 },
    ]);
    expect(annual?.phase).toBeCloseTo(23.4);
  });
});

describe("checkConstituents", () => {
  test("rejects a NOAA constituent published as not determined", () => {
    const s2 = { amplitude: 0, phase: 0 };
    expect(checkConstituents(station({ ...BASE, S2: s2 }, "noaa/1"))).toMatch(
      /not determined by the source: S2/,
    );
  });

  test("accepts a zero amplitude that carries a phase", () => {
    const s2 = { amplitude: 0, phase: 12.3 };
    expect(
      checkConstituents(station({ ...BASE, S2: s2 }, "noaa/1")),
    ).toBeNull();
  });

  test("accepts a zero amplitude at phase 0 outside NOAA", () => {
    // A TICON value below detection can round to phase 0 by chance.
    const s2 = { amplitude: 0, phase: 0 };
    expect(checkConstituents(station({ ...BASE, S2: s2 }))).toBeNull();
  });

  test("rejects a resolved P1 well above a small K1", () => {
    // Radiational forcing brings P1 level with a small K1, not to 4 times it.
    expect(
      checkConstituents(station({ ...BASE, K1: 0.003, P1: 0.013 })),
    ).toMatch(/inconsistent with the gravitational tide/);
  });

  test("ignores P1 above K1 while P1 is too small to be resolved", () => {
    expect(
      checkConstituents(station({ ...BASE, K1: 0.005, P1: 0.009 })),
    ).toBeNull();
  });

  test("ignores P1 above K1 inside the fit tolerance", () => {
    expect(
      checkConstituents(station({ ...BASE, K1: 0.02, P1: 0.023 })),
    ).toBeNull();
  });

  test("rejects P1 above a resolved K1 beyond the fit tolerance", () => {
    expect(
      checkConstituents(station({ ...BASE, K1: 0.02, P1: 0.024 })),
    ).toMatch(/inconsistent with the gravitational tide/);
  });
});

describe("scoreAmplitude", () => {
  test("ignores a child above its parent inside the fit tolerance", () => {
    expect(
      scoreAmplitude(station({ ...BASE, O1: 0.001, Q1: 0.004 })).issues,
    ).toEqual([]);
  });

  test("warns about a child above its parent beyond the fit tolerance", () => {
    expect(
      scoreAmplitude(station({ ...BASE, O1: 0.001, Q1: 0.005 })).issues,
    ).toEqual(["Q1 amplitude (0.0050) exceeds O1 (0.0010)"]);
  });

  test("ignores a parent NOAA did not determine", () => {
    const s2 = { amplitude: 0, phase: 0 };
    expect(
      scoreAmplitude(station({ ...BASE, S2: s2, K2: 0.01 }, "noaa/1")).issues,
    ).toEqual([]);
  });

  test("does not penalise a high form number", () => {
    // A diurnal Louisiana marsh: F is effectively unbounded.
    expect(
      scoreAmplitude(station({ M2: 0, S2: 0, K1: 0.024, O1: 0.023 })).issues,
    ).toEqual([]);
  });

  test("penalises a record with no principal tide at all", () => {
    expect(
      scoreAmplitude(station({ M2: 0, S2: 0, K1: 0, O1: 0 })).issues,
    ).toEqual(["No diurnal or semidiurnal constituents with amplitude > 0"]);
  });
});

describe("checkSeasonalDominance", () => {
  const dominance = (constituents: Record<string, number | Constituent>) =>
    checkSeasonalDominance(station(constituents), new Map());

  // Principal tide M2+S2+K1+O1 = 0.069 m.
  const SMALL = { M2: 0.03, S2: 0.02, K1: 0.01, O1: 0.009 };

  test("compares against the principal tide, not its largest constituent", () => {
    // SA is twice M2 but below the tide's combined daily swing.
    expect(dominance({ ...SMALL, SA: 0.06 })).toBeNull();
  });

  test("does not label a difference inside the fit tolerance", () => {
    expect(dominance({ ...SMALL, SA: 0.072 })).toBeNull();
  });

  test("labels a seasonal band beyond the fit tolerance", () => {
    expect(dominance({ ...SMALL, SA: 0.0721 })).toMatch(
      /Seasonal curve peak \(0\.072m\) exceeds the principal tide M2\+S2\+K1\+O1 \(0\.069m\)/,
    );
  });

  test("measures a subordinate on its reference's constituents", () => {
    const reference = station(
      { M2: 0.002, S2: 0.001, K1: 0.001, O1: 0.001, SA: 0.15 },
      "noaa/ref",
    );
    const subordinate = {
      id: "noaa/sub",
      type: "subordinate",
      harmonic_constituents: [],
      offsets: { reference: "noaa/ref" },
    } as unknown as Station;
    expect(
      checkSeasonalDominance(subordinate, new Map([["noaa/ref", reference]])),
    ).toMatch(/from reference noaa\/ref/);
  });

  test("measures the seasonal curve with its phases", () => {
    // In phase, SA and SSA peak together at 0.08 m, above the 0.069 m tide.
    expect(
      dominance({
        ...SMALL,
        SA: { amplitude: 0.05, phase: 0 },
        SSA: { amplitude: 0.03, phase: 0 },
      }),
    ).toMatch(/Seasonal curve peak \(0\.080m\)/);
    // Out of step, the curve peaks at 0.069 m, level with the tide.
    expect(
      dominance({
        ...SMALL,
        SA: { amplitude: 0.05, phase: 0 },
        SSA: { amplitude: 0.03, phase: 90 },
      }),
    ).toBeNull();
  });

  test("reads the seasonal terms under every source's names", () => {
    // LINZ: Sa and Ssa.
    expect(dominance({ ...SMALL, Sa: 0.08 })).toMatch(/0\.080m/);
    // Kartverket: SA_KV, whose argument is h − p′, with Ssa.
    expect(dominance({ ...SMALL, SA_KV: 0.08 })).toMatch(/0\.080m/);
  });

  test("labels a station with no principal tide", () => {
    expect(dominance({ M2: 0, S2: 0, K1: 0, O1: 0, SA: 0.06 })).toMatch(
      /yearly swing exceeds the daily one/,
    );
  });
});

describe("hasSimilarM2", () => {
  const m2 = (amplitude: number) => station({ M2: amplitude });

  test("treats amplitudes within the fit tolerance as similar", () => {
    expect(hasSimilarM2(m2(0.003), m2(0.005))).toBe(true);
  });

  test("counts exactly 3 mm apart as within the tolerance", () => {
    // 0.012 - 0.009 is 0.003000000000000001 in floating point.
    expect(hasSimilarM2(m2(0.012), m2(0.009))).toBe(true);
  });

  test("takes no evidence from two M2 values inside the tolerance", () => {
    expect(hasSimilarM2(m2(0), m2(0))).toBe(false);
    expect(hasSimilarM2(m2(0.001), m2(0.003))).toBe(false);
  });

  test("uses the ratio once M2 is large", () => {
    expect(hasSimilarM2(m2(0.3), m2(0.32))).toBe(true);
    expect(hasSimilarM2(m2(0.02), m2(0.03))).toBe(false);
  });
});

describe("scoreRecency", () => {
  afterEach(() => vi.useRealTimers());

  test("does not depend on today's date", () => {
    const station = { epoch: { start: "1983-01-01", end: "2001-12-31" } };
    const score = () => scoreRecency(station as never, new Map());
    vi.useFakeTimers({ now: new Date("2026-06-01") });
    const now = score();
    vi.setSystemTime(new Date("2040-06-01"));
    expect(score()).toBe(now);
    expect(now).toBe(1 - (RECENCY_YEAR - 2001) / 100);
  });
});

// CI's filesystem lists files in hash order, a Mac's in name order; quality
// must not depend on which.
test("weighs records in id order whatever the filesystem lists", async () => {
  const ids = (await loadAllStations()).map(({ id }) => id);
  expect(ids).toEqual([...ids].sort());
});

describe("tideConflict", () => {
  test("states a merged record's M2 disagreement as time", () => {
    // Venice: the City of Venice record runs about 46 minutes from ISPRA's.
    const cv = station({ M2: { amplitude: 0.242, phase: 284.3 } });
    const ispra = station({ M2: { amplitude: 0.233, phase: 262.2 } });
    expect(tideConflict(cv, ispra)).toMatch(/by \+9 mm and 46 min later/);
    expect(tideConflict(ispra, cv)).toMatch(/by -9 mm and 46 min earlier/);
  });

  test("passes a pair within one gauge analyzed twice", () => {
    const a = station({ M2: { amplitude: 0.5, phase: 100 } });
    const b = station({ M2: { amplitude: 0.5, phase: 104 } });
    expect(tideConflict(a, b)).toBeNull();
  });

  test("passes millimeter tides whose phase is noise", () => {
    const a = station({ M2: { amplitude: 0.002, phase: 10 } });
    const b = station({ M2: { amplitude: 0.002, phase: 60 } });
    expect(tideConflict(a, b)).toBeNull();
  });
});

test("a superseded research-quality sibling keeps a conflicting fast-delivery relay rejected", () => {
  const rq = {
    ...station(BASE, "ticon/minamitorishima-049a-jpn-uhslc_rq"),
    source: { id: "minamitorishima-049a-jpn-uhslc_rq", name: "TICON-4" },
  } as Station;
  const fd = {
    ...station({ ...BASE, M2: 0.8 }, "ticon/minamitorishima-049-jpn-uhslc_fd"),
    source: { id: "minamitorishima-049-jpn-uhslc_fd", name: "TICON-4" },
  } as Station;
  const direct = station(BASE, "jma/MC");
  const results = new Map([
    [
      rq.id,
      {
        id: rq.id,
        accepted: false,
        reason: "superseded",
        redundant: direct.id,
        score: 0,
        issues: [],
      },
    ],
    [fd.id, { id: fd.id, accepted: true, score: 71, issues: [] }],
    [direct.id, { id: direct.id, accepted: true, score: 75, issues: [] }],
  ]);
  deduplicateByGauge(
    [rq.id, fd.id, direct.id],
    new Map([rq, fd, direct].map((s) => [s.id, s])),
    results as any,
    new Map(),
  );
  expect(results.get(fd.id)).toMatchObject({
    accepted: false,
    reason: "duplicate",
    redundant: direct.id,
  });
  expect(results.get(direct.id)!.accepted).toBe(true);
});

test("a relay with its own UHSLC metadata does not inherit a sibling operator", () => {
  const rq = {
    ...station(BASE, "ticon/bermuda-259b-gbr-uhslc_rq"),
    source: { id: "bermuda-259b-gbr-uhslc_rq", name: "TICON-4" },
  } as Station;
  const fd = {
    ...station({ ...BASE, M2: 0.8 }, "ticon/bermuda-259a-gbr-uhslc_rq"),
    source: { id: "bermuda-259a-gbr-uhslc_rq", name: "TICON-4" },
  } as Station;
  const direct = station(BASE, "jma/MC");
  const results = new Map([
    [
      rq.id,
      {
        id: rq.id,
        accepted: false,
        reason: "superseded",
        redundant: direct.id,
        score: 0,
        issues: [],
      },
    ],
    [fd.id, { id: fd.id, accepted: true, score: 71, issues: [] }],
    [direct.id, { id: direct.id, accepted: true, score: 75, issues: [] }],
  ]);
  deduplicateByGauge(
    [rq.id, fd.id, direct.id],
    new Map([rq, fd, direct].map((s) => [s.id, s])),
    results as any,
    new Map(),
  );
  expect(results.get(fd.id)!.accepted).toBe(true);
  expect(results.get(direct.id)!.accepted).toBe(true);
});

test("refuses a gauge group with conflicting superseded operator targets", () => {
  const ids = [
    "ticon/contradiction-999a-jpn-uhslc_rq",
    "ticon/contradiction-999b-jpn-uhslc_rq",
  ];
  const records = ids.map(
    (id) =>
      ({
        ...station(BASE, id),
        source: { id: id.slice(6), name: "TICON-4" },
      }) as Station,
  );
  const results = new Map(
    ids.map((id, i) => [
      id,
      {
        id,
        accepted: false,
        reason: "superseded",
        redundant: `jma/${i}`,
        score: 0,
        issues: [],
      },
    ]),
  ) as any;
  expect(() =>
    deduplicateByGauge(
      ids,
      new Map(records.map((s) => [s.id, s])),
      results,
      new Map(),
    ),
  ).toThrow(/operator/i);
});

describe("a fit from the water-levels lake", () => {
  const SMHI = "Swedish Meteorological and Hydrological Institute";
  const ticon = {
    ...station(BASE, "ticon/kungsvik-2130-swe-smhi"),
    source: { id: "kungsvik-2130-swe-smhi", name: "TICON-4" },
  } as Station;
  const lake = (rms: { fit: number; ticon: number }) =>
    ({
      ...station(BASE, "smhi/2130"),
      source: {
        id: "2130",
        name: SMHI,
        gauge: "kungsvik-2130-swe-smhi",
        held_out: {
          start: "2025-01-01",
          end: "2025-12-31",
          hours: 8700,
          rms: rms.fit,
          ticon: {
            "kungsvik-2130-swe-smhi": {
              rms: rms.ticon,
              se: 0,
              digest: constituentsDigest(ticon.harmonic_constituents),
            },
          },
        },
      },
    }) as unknown as Station;
  function evaluate(fit: Station, ticonAccepted = true, score = 80) {
    const results = new Map([
      [fit.id, { id: fit.id, accepted: true, score, issues: [] }],
      [
        ticon.id,
        { id: ticon.id, accepted: ticonAccepted, score: 70, issues: [] },
      ],
    ]);
    decideHeldOut(
      [fit.id, ticon.id],
      new Map([fit, ticon].map((s) => [s.id, s])),
      results as any,
    );
    return results;
  }

  test("wins its TICON gauge when it scores no worse, whatever its score", () => {
    // 4.0e-6 m² more residual variance is within a 3 mm error's 4.5e-6.
    const results = evaluate(lake({ fit: 0.05004, ticon: 0.05 }), true, 60);
    expect(results.get("smhi/2130")!.accepted).toBe(true);
    expect(results.get(ticon.id)).toMatchObject({
      reason: "duplicate",
      redundant: "smhi/2130",
    });
  });

  test("loses to the TICON record it scored worse than, whatever its score", () => {
    const results = evaluate(lake({ fit: 0.051, ticon: 0.05 }));
    expect(results.get(ticon.id)!.accepted).toBe(true);
    expect(results.get("smhi/2130")).toMatchObject({
      reason: "duplicate",
      redundant: ticon.id,
    });
  });

  test("beats the TICON record that scored worse, whatever its score", () => {
    const results = evaluate(lake({ fit: 0.05, ticon: 0.051 }), true, 60);
    expect(results.get("smhi/2130")!.accepted).toBe(true);
    expect(results.get(ticon.id)).toMatchObject({
      reason: "duplicate",
      redundant: "smhi/2130",
    });
  });

  test("loses to the best of its gauge's relays when worse than one, and beats them all otherwise", () => {
    const cmems = {
      ...station(BASE, "ticon/kungsvik-kun-swe-cmems"),
      source: { id: "kungsvik-kun-swe-cmems", name: "TICON-4" },
    } as Station;
    const run = (rms: number, cmemsRms: number) => {
      const fit = lake({ fit: rms, ticon: 0.05 });
      fit.source.held_out!.ticon["kungsvik-kun-swe-cmems"] = {
        rms: cmemsRms,
        se: 0,
        digest: constituentsDigest(cmems.harmonic_constituents),
      };
      const results = new Map(
        [fit, ticon, cmems].map((s) => [
          s.id,
          { id: s.id, accepted: true, score: 70, issues: [] },
        ]),
      );
      decideHeldOut(
        [fit.id, ticon.id, cmems.id],
        new Map([fit, ticon, cmems].map((s) => [s.id, s])),
        results as any,
      );
      return results as Map<string, any>;
    };
    const loses = run(0.05, 0.049);
    expect(loses.get("smhi/2130")).toMatchObject({
      reason: "duplicate",
      redundant: cmems.id,
    });
    // TICON's own record scored worse than CMEMS's, so it goes to CMEMS too.
    expect(loses.get(ticon.id)!.redundant).toBe(cmems.id);
    const wins = run(0.05, 0.05);
    expect(wins.get("smhi/2130")!.accepted).toBe(true);
    expect(wins.get(ticon.id)!.redundant).toBe("smhi/2130");
    expect(wins.get(cmems.id)!.redundant).toBe("smhi/2130");
  });

  test("can't lose to a record fitted on its held-out year", () => {
    const fit = lake({ fit: 0.06, ticon: 0.05 });
    const seen = {
      ...ticon,
      epoch: { start: "2010-01-01", end: "2025-06-30" },
    } as Station;
    const results = new Map(
      [fit, seen].map((s) => [
        s.id,
        { id: s.id, accepted: true, score: 70, issues: [] },
      ]),
    );
    decideHeldOut(
      [fit.id, seen.id],
      new Map([fit, seen].map((s) => [s.id, s])),
      results as any,
    );
    expect(results.get(fit.id)!.accepted).toBe(true);
  });

  test("never loses on a difference whose standard error couldn't be measured", () => {
    const fit = lake({ fit: 0.06, ticon: 0.05 });
    // JSON stores an unmeasured (infinite) standard error as null.
    fit.source.held_out!.ticon["kungsvik-2130-swe-smhi"]!.se = null as any;
    expect(evaluate(fit).get("smhi/2130")!.accepted).toBe(true);
  });

  test("doesn't compare a relay the lake files more than 10 km away", () => {
    const fit = {
      ...lake({ fit: 0.051, ticon: 0.05 }),
      latitude: 58,
      longitude: 11,
    } as Station;
    const far = { ...ticon, latitude: 58.2, longitude: 11 } as Station;
    const results = new Map(
      [fit, far].map((s) => [
        s.id,
        { id: s.id, accepted: true, score: 70, issues: [] as string[] },
      ]),
    );
    decideHeldOut(
      [fit.id, far.id],
      new Map([fit, far].map((s) => [s.id, s])),
      results as any,
    );
    expect(results.get(fit.id)!.accepted).toBe(true);
    expect(results.get(far.id)!.accepted).toBe(true);
    expect(results.get(fit.id)!.issues[0]).toMatch(/km away; not compared/);
  });

  test("wins on a difference within twice its standard error", () => {
    const fit = lake({ fit: 0.051, ticon: 0.05 });
    // 1.01e-4 m² more variance, against a standard error of 6e-5 m².
    fit.source.held_out!.ticon["kungsvik-2130-swe-smhi"]!.se = 6e-5;
    expect(evaluate(fit).get("smhi/2130")!.accepted).toBe(true);
  });

  test("decides nothing on scores taken against TICON constants that have changed", () => {
    const fit = lake({ fit: 0.05, ticon: 0.051 });
    fit.source.held_out!.ticon["kungsvik-2130-swe-smhi"]!.digest =
      "0000000000000000";
    const results = evaluate(fit, true, 60);
    expect(results.get(ticon.id)!.accepted).toBe(true);
    expect(results.get("smhi/2130")!.issues[0]).toMatch(
      /re-run the water-levels import/,
    );
  });

  test("stands for the gauge when that TICON record is rejected", () => {
    const results = evaluate(lake({ fit: 0.051, ticon: 0.05 }), false);
    expect(results.get("smhi/2130")!.accepted).toBe(true);
  });

  test("is not another gauge to its TICON record when scoring coverage", () => {
    const fit = { ...lake({ fit: 0, ticon: 0 }), latitude: 58, longitude: 11 };
    const twin = { ...ticon, latitude: 58, longitude: 11 } as Station;
    expect(scoreCoverage(fit, [twin])).toBe(1);
    expect(scoreCoverage(twin, [fit])).toBe(1);
  });

  test("ranks as its agency's TICON relay", () => {
    expect(scoreSource(lake({ fit: 0, ticon: 0 }))).toBe(scoreSource(ticon));
  });

  test("ranks as its agency's relay when built on another agency's copy", () => {
    const fit = lake({ fit: 0, ticon: 0 });
    fit.source.gauge = "kungsvik-k-swe-cmems";
    expect(scoreSource(fit)).toBe(scoreSource(ticon));
  });
});
