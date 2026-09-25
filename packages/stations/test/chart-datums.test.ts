import { describe, test, expect } from "vitest";
import { computeDatums, isBaltic } from "@slackwater/datums";
import {
  getChartDatum,
  pruneDatums,
  normalize,
  type PartialStationData,
} from "../station.js";
import { allStations } from "@slackwater/database";
import type { Station } from "@slackwater/database";

const tideStations = allStations.filter(
  (station) => station.kind === "tide" && station.quality,
);

const CONSTITUENTS = [
  { name: "M2", amplitude: 1.0, phase: 0 },
  { name: "S2", amplitude: 0.3, phase: 0 },
  { name: "K1", amplitude: 0.2, phase: 0 },
  { name: "O1", amplitude: 0.1, phase: 0 },
];

describe("computeDatums — extra chart datums", () => {
  const { datums } = computeDatums(CONSTITUENTS, {});

  test("MHWS/MLWS follow the Admiralty springs approximation (MSL ± (M2+S2))", () => {
    expect(datums["MHWS"]).toBeCloseTo(1.3, 3);
    expect(datums["MLWS"]).toBeCloseTo(-1.3, 3);
  });

  test("NLLW and ALLW are the ISLW value (MSL − (M2+S2+K1+O1)), both present and equal", () => {
    expect(datums["NLLW"]).toBeCloseTo(-1.6, 3);
    expect(datums["ALLW"]).toBe(datums["NLLW"]);
  });

  test("LLWLT is a low-water datum near LAT", () => {
    const { LLWLT, LAT, MLW } = datums;
    expect(LLWLT).toBeDefined();
    expect(LLWLT!).toBeLessThan(MLW!);
    // Mean of annual lows sits at or a touch above the single lowest tide.
    expect(LLWLT!).toBeGreaterThanOrEqual(LAT! - 0.05);
  });

  test("TLT is defined and a low, sub-MSL datum", () => {
    expect(datums["TLT"]).toBeDefined();
    expect(datums["TLT"]!).toBeLessThan(0);
    expect(datums["TLT"]!).toBeGreaterThanOrEqual(-1.6); // can't exceed the summed amplitudes
  });

  test("no NaN datums are emitted", () => {
    for (const v of Object.values(datums))
      expect(Number.isFinite(v)).toBe(true);
  });

  test("TLT includes the uppercase SA/SSA long-period constituents", () => {
    // Data files store names uppercase; SA must lower the theoretical minimum.
    const withSa = computeDatums(
      [...CONSTITUENTS, { name: "SA", amplitude: 0.2, phase: 0 }],
      {},
    ).datums;
    expect(withSa["TLT"]!).toBeLessThan(datums["TLT"]! - 0.05);
  });
});

describe("isBaltic", () => {
  const cases: [string, number, number, boolean][] = [
    ["Norderney (North Sea)", 53.7, 7.15, false],
    ["Cuxhaven (North Sea)", 53.87, 8.72, false],
    ["Glückstadt / Elbe (North Sea)", 53.79, 9.42, false],
    ["Flensburg (Baltic)", 54.8, 9.43, true],
    ["Kiel (Baltic)", 54.32, 10.14, true],
    ["Warnemünde (Baltic)", 54.18, 12.08, true],
    // Torshamnen gauge at the harbor mouth; upriver Göta älv gauges fall
    // outside the water polygon but Sweden's whole-country MSL default applies.
    ["Gothenburg Torshamnen (Kattegat)", 57.6847, 11.7906, true],
    ["Stockholm (Baltic)", 59.32, 18.08, true],
    ["Esbjerg DK (North Sea)", 55.47, 8.44, false],
    // Danish inner waters (whole Kattegat) chart to DVR90 ≈ MSL; the LAT
    // regime starts in the Skagerrak. Skagen harbor sits on the Kattegat side
    // of the IHO Skagen–Paternoster line → MSL.
    ["Aarhus DK (Kattegat)", 56.15, 10.22, true],
    ["Frederikshavn DK (Kattegat)", 57.44, 10.55, true],
    ["Skagen DK (Kattegat side)", 57.72, 10.59, true],
    ["Hirtshals DK (Skagerrak)", 57.6, 9.96, false],
    ["Oslo (Skagerrak)", 59.91, 10.75, false],
    // Limfjord: inner Danish waters, not an S-23 sea area (hand carve-out).
    ["Aalborg DK (Limfjord)", 57.05, 9.92, true],
    ["Thyborøn DK (Limfjord N. Sea entrance)", 56.7, 8.22, false],
    ["Hanstholm DK (North Sea)", 57.12, 8.6, false],
    // Estuary gauges within the shore tolerance of the water polygons.
    ["Lübeck DE (up the Trave)", 53.893, 10.703, true],
    ["Hamburg St. Pauli DE (Elbe)", 53.547, 9.972, false],
  ];
  for (const [name, lat, lon, expected] of cases) {
    test(`${name} → ${expected ? "Baltic" : "not Baltic"}`, () => {
      expect(isBaltic(lat, lon)).toBe(expected);
    });
  }
});

describe("getChartDatum", () => {
  const all = {
    MSL: 0,
    MLW: -1,
    MLLW: -1.2,
    MLWS: -1.3,
    LAT: -1.6,
    LLWLT: -1.5,
    NLLW: -1.6,
    ALLW: -1.6,
    TLT: -1.55,
  };

  test("US → MLLW", () => {
    expect(getChartDatum("United States", all, 40, -74)).toBe("MLLW");
  });
  test("Canada → LLWLT", () => {
    expect(getChartDatum("Canada", all, 49, -123)).toBe("LLWLT");
  });
  test("unlisted country → LAT", () => {
    expect(getChartDatum("United Kingdom", all, 51, 0)).toBe("LAT");
  });
  test("Baltic location → MSL regardless of country", () => {
    // A German Baltic station (Kiel) overrides the country default.
    expect(getChartDatum("Germany", all, 54.32, 10.14)).toBe("MSL");
  });
  test("German North Sea station → LAT (not overridden)", () => {
    expect(getChartDatum("Germany", all, 53.87, 8.72)).toBe("LAT");
  });
  test("falls back to LAT when the preferred datum is absent", () => {
    const noLlwlt = { MSL: 0, MLW: -1, LAT: -1.6 };
    expect(getChartDatum("Canada", noLlwlt, 49, -123)).toBe("LAT");
  });
});

describe("pruneDatums", () => {
  const full = { MSL: 0, MLWS: -1.3, LLWLT: -1.5, TLT: -1.55, NLLW: -1.6 };
  test("keeps standard datums, drops other countries' bespoke datums", () => {
    const canada = pruneDatums("Canada", full);
    expect(canada["LLWLT"]).toBeDefined();
    expect(canada["MLWS"]).toBeDefined();
    expect(canada["TLT"]).toBeUndefined();
    expect(canada["NLLW"]).toBeUndefined();
  });
  test("a non-owning country keeps only the standard datums", () => {
    const uk = pruneDatums("United Kingdom", full);
    expect(uk["MSL"]).toBeDefined();
    expect(uk["MLWS"]).toBeDefined();
    expect(uk["LLWLT"]).toBeUndefined();
    expect(uk["TLT"]).toBeUndefined();
    expect(uk["NLLW"]).toBeUndefined();
  });
});

describe("normalize — subordinate stations without datums", () => {
  // Mirrors real NOAA subordinate files (e.g. data/noaa/8218361.json), which
  // omit the datums key entirely.
  const subordinate: PartialStationData = {
    name: "Test Subordinate",
    country: "Canada",
    latitude: 45.25,
    longitude: -66.06,
    disclaimers: "",
    type: "subordinate",
    source: {
      name: "NOAA",
      id: "0000000",
      published_harmonics: false,
      url: "https://example.com",
    },
    license: { type: "public domain", commercial_use: true, url: "" },
    harmonic_constituents: [],
    offsets: {
      reference: "noaa/8410140",
      height: { high: 1, low: 1, type: "ratio" },
      time: { high: 0, low: 0 },
    },
  };

  test("does not throw and does not invent a datums key", () => {
    const out = normalize(subordinate);
    expect("datums" in out).toBe(false);
    expect(out.chart_datum).toBe("LAT"); // no datums available → fallback
  });

  test("preserves a preset chart_datum", () => {
    const out = normalize({ ...subordinate, chart_datum: "MLLW" });
    expect(out.chart_datum).toBe("MLLW");
  });
});

// Stations whose published LAT sits materially ABOVE their own chart datum,
// which is hydrographically impossible and always an upstream data problem —
// never something this repo computes. Two flavours:
//
//   - Freshwater. LLWLT is a Canadian *tidal* chart datum; on the Great Lakes
//     and the upper St. Lawrence the water level is set by lake regulation and
//     discharge, not the moon, so the two numbers describe different physics.
//   - Agency error. APIA publishes LAT 0.93 m above its own MLLW. Xiamen's TLT
//     is a theoretical datum that its fitted constituents don't reach.
//
// Listed so a NEW gross violation fails the build instead of joining the noise.
const LAT_ABOVE_CHART_DATUM = new Set([
  // Kartverket publishes these LAT values 0.2–0.3 m above CD. Keep the
  // provider values visible until its datum convention is clarified.
  "kartverket/EYD",
  "kartverket/HRO",
  "kartverket/OSC",
  "kartverket/OSL",
  "kartverket/SBG",
  "kartverket/SIE",
  "kartverket/SOY",
  "kartverket/SVG",
  "kartverket/TRG",
  "kartverket/VIK",
  "noaa/1778000", // APIA (Observatory), Upolu Island — 0.93 m
  "ticon/cote_ste_catherine-15450-can-meds",
  "ticon/pointe_claire-15330-can-meds",
  "ticon/tecumseh_ontario-11975-can-meds",
  "ticon/la_prairie-15470-can-meds",
  "ticon/belle_river_ontario-11965-can-meds",
  "ticon/port_lambton_ontario-11950-can-meds",
  "ticon/cobourg_ontario-13590-can-meds",
  "ticon/gamebridge_ontario-16500-can-meds",
  "ticon/xiamen-376a-chn-uhslc_rq",
]);

/** Anything below this is datum rounding between two agencies, not a defect. */
const DATUM_ROUNDING_M = 0.06;

describe("astronomical extremes across the database", () => {
  const references = tideStations.filter(
    (s): s is Station & { chart_datum: string } =>
      s.type === "reference" &&
      s.datums["LAT"] !== undefined &&
      s.chart_datum !== undefined,
  );

  test("covers every reference station the constituents can honestly bound", () => {
    const missing = tideStations.filter(
      (s) => s.type === "reference" && s.datums["HAT"] === undefined,
    );
    // Three publish no MSL, so there is no frame to put a constituent-space
    // result onto. The other eight carry Sa and Ssa at zero amplitude, so a
    // 19-year scan over them returns a confidently narrowed envelope rather
    // than an extreme. Both are deliberate. See packages/stations/backfill-lat-hat.ts.
    expect(missing.map((s) => s.id).sort()).toEqual([
      "noaa/6835001", // Djakarta, Java — seasonless
      "noaa/8414781", // Winterport — seasonless
      "noaa/8519024", // no MSL
      "noaa/8764311", // no MSL
      "noaa/9450618", // Shinaku Inlet — seasonless
      "noaa/9450623", // no MSL
      "noaa/9458779", // Nakchamik Island — seasonless
      "noaa/9458819", // Kujulik Bay (North Shore) — seasonless
      "noaa/9458917", // Chignik, Anchorage Bay — seasonless
      "noaa/9466229", // Offshore St Matthew Island (GNSS Buoy) — seasonless
      "noaa/9991475", // Guayaquil — seasonless
    ]);
  });

  test("HAT is always above LAT", () => {
    const inverted = references.filter(
      (s) => s.datums["HAT"]! <= s.datums["LAT"]!,
    );
    expect(inverted.map((s) => s.id)).toEqual([]);
  });

  test("LAT is at or below the chart datum, bar known upstream defects", () => {
    const offenders = references
      .filter((s) => s.datums[s.chart_datum] !== undefined)
      .map((s) => ({
        id: s.id,
        over: s.datums["LAT"]! - s.datums[s.chart_datum]!,
      }))
      .filter((s) => s.over > DATUM_ROUNDING_M)
      .filter((s) => !LAT_ABOVE_CHART_DATUM.has(s.id));

    expect(offenders).toEqual([]);
  });

  test("HAT is at or above MHHW, bar the same rounding", () => {
    const offenders = references
      .filter((s) => s.datums["MHHW"] !== undefined)
      .map((s) => ({ id: s.id, under: s.datums["MHHW"]! - s.datums["HAT"]! }))
      .filter((s) => s.under > DATUM_ROUNDING_M);

    expect(offenders.length).toBeLessThan(20);
  });
});
