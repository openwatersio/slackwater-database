import { describe, test, expect } from "vitest";
import { readFile } from "fs/promises";
import { join } from "path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { loadStations } from "@slackwater/database";

import {
  MIN_TIDAL_RANGE,
  OBSERVED_BOUND_ALLOWANCE,
  hasObservedMeanDatums,
  MIN_DEDUP_DISTANCE,
  MIN_AMPLITUDE_RATIO,
  SEASONAL_OUTLIER_RADIUS,
  SEASONAL_OUTLIER_MIN_SA,
  SEASONAL_OUTLIER_RATIO,
  NULL_ISLAND_RADIUS,
  gaugeKey,
  coordinatePrecision,
  distance,
  authoritativeDuplicateWinner,
  SEASONAL_DOMINANCE_RATIO,
  seasonalPeak,
  PRINCIPAL_TIDAL_CONSTITUENTS,
  exceeds,
} from "../filtering.js";
import { readStationFiles, storedQuality } from "../station-files.ts";
import { sourceMetadata } from "../sources.ts";

const {
  accepted: stations,
  all: allStations,
  byId,
  near,
  stationRoutes,
} = await loadStations();

const quality = [...storedQuality(readStationFiles()).values()];

const ROOT = new URL("../../..", import.meta.url).pathname;
const float32DifferenceMargin = (a: number, b: number) =>
  Math.max(
    1e-6,
    2 ** (Math.floor(Math.log2(Math.max(Math.abs(a), Math.abs(b)))) - 23),
  );

test("retains a 5 cm gate boundary after float32 storage", () => {
  const low = Math.fround(0.1),
    bound = Math.fround(0.15);
  expect(low).toBeGreaterThanOrEqual(
    bound - OBSERVED_BOUND_ALLOWANCE - float32DifferenceMargin(low, bound),
  );
});
const SCHEMA_PATH = join(ROOT, "schemas", "station.schema.json");

const schema = JSON.parse(await readFile(SCHEMA_PATH, "utf-8"));
const ajv = new (Ajv2020 as any)({ allErrors: true, strict: false });
(addFormats as any)(ajv);
const validate = ajv.compile(schema);
const tideStations = stations.filter(
  (station) => station.kind === "tide" && station.quality,
);
const allTideStations = allStations.filter(
  (station) => station.kind === "tide" && station.quality,
);

test("observed TICON datum periods contain whole years of complete UTC months", () => {
  const invalid = allTideStations
    .filter((s) => s.id.startsWith("ticon/") && s.datums_source === "observed")
    .filter((s) => {
      if (!s.datum_epoch || !s.datum_coverage) return true;
      const start = new Date(s.datum_epoch.start),
        end = new Date(s.datum_epoch.end);
      end.setUTCDate(end.getUTCDate() + 1);
      const months =
        (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
        end.getUTCMonth() -
        start.getUTCMonth();
      return (
        start.getUTCDate() !== 1 ||
        end.getUTCDate() !== 1 ||
        months < 12 ||
        months % 12 !== 0 ||
        s.datum_coverage.months !== months ||
        s.datum_coverage.observed_hours + s.datum_coverage.inferred_hours !==
          (+end - +start) / 3600000
      );
    });
  expect(invalid.map((s) => s.id)).toEqual([]);
});

tideStations.forEach((station) => {
  describe(station.id, () => {
    test("is valid", async () => {
      // Validate against the on-disk JSON, not the in-memory station. Subordinate
      // stations are enriched at runtime with datums/harmonic_constituents from
      // their reference station, but the schema describes the source file format.
      const raw = JSON.parse(
        await readFile(join(ROOT, "data", `${station.id}.json`), "utf-8"),
      );
      const valid = validate({ id: station.id, ...raw });
      if (!valid)
        throw new Error(
          ajv.errorsText(validate.errors) +
            `\n${JSON.stringify(validate.errors, null, 2)}`,
        );
    });

    test("has chart_datum", () => {
      const chartDatum = station.chart_datum;
      expect(
        chartDatum,
        `Station ${station.id} is missing chart_datum`,
      ).toBeDefined();
      if (!chartDatum) return;

      const { datums } =
        (station.type === "reference"
          ? station
          : tideStations.find((s) => s.id === station.offsets!.reference)) ||
        {};

      // 3 NOAA stations have empty datums, so we skip the check for those
      if (datums && Object.keys(datums).length > 0) {
        expect(
          datums[chartDatum],
          `Station ${station.id} missing chart_datum ${chartDatum}`,
        ).toBeDefined();
      }
    });

    test("has logically ordered datums", () => {
      const datums = station.datums;
      if (!datums || Object.keys(datums).length === 0) return;

      // MHHW/MHW and MLW/MLLW are diurnal-pair averages that converge at weakly
      // diurnal stations, so their relative ordering is not enforced here.
      // MSL and MTL can appear in either order depending on tidal asymmetry,
      // so they are checked independently against their shared bounds.
      const CHAINS = [
        ["MHW", "MSL", "MLW", "LAT"],
        ["MHW", "MTL", "MLW"],
      ] as const;
      for (const chain of CHAINS) {
        for (let i = 0; i < chain.length - 1; i++) {
          const higher = chain[i]!;
          const lower = chain[i + 1]!;
          const h = datums[higher],
            l = datums[lower];
          if (h === undefined || l === undefined) continue;
          const allowance =
            hasObservedMeanDatums(
              station.offsets?.reference
                ? byId(station.offsets.reference)!
                : station,
            ) && lower === "LAT"
              ? OBSERVED_BOUND_ALLOWANCE + float32DifferenceMargin(h, l)
              : 0;
          expect(
            h,
            `Station ${station.id}: ${higher} (${h.toFixed(3)}m) should be >= ${lower} (${l.toFixed(3)}m)`,
          ).toBeGreaterThanOrEqual(l - allowance);
        }
      }
    });

    if (station.type === "subordinate") {
      test("has valid reference station", () => {
        const id = station.offsets!.reference;
        const reference = tideStations.find((s) => s.id === id);
        expect(reference, `Unknown reference station: ${id}`).toBeDefined();
      });
    }

    if (station.id.startsWith("ticon/")) {
      test("has no exact duplicate coordinates with other TICON stations", () => {
        const nearby = near({
          latitude: station.latitude,
          longitude: station.longitude,
          maxDistance: 0.001, // 1 meter
          maxResults: Infinity,
          filter: (s) => s.id.startsWith("ticon/") && s.id !== station.id,
        });

        if (nearby.length > 0) {
          const [other, dist] = nearby[0]!;
          throw new Error(
            `This TICON station has duplicate/very close coordinates with ${other.id}: ` +
              `${(dist * 1000).toFixed(0)}m apart. ` +
              `Run npm run stations to re-filter.`,
          );
        }
      });

      test("is not too close to NOAA stations", () => {
        const MIN_DISTANCE = MIN_DEDUP_DISTANCE; // stations within this range are always deduped

        const nearby = near({
          latitude: station.latitude,
          longitude: station.longitude,
          maxDistance: MIN_DISTANCE,
          maxResults: Infinity,
          filter: (s) => s.kind === "tide" && s.id.startsWith("noaa/"),
        });

        if (nearby.length > 0) {
          const [noaa, dist] = nearby[0]!;
          throw new Error(
            `This TICON station is ${(dist * 1000).toFixed(0)}m from NOAA station ${noaa.id}. ` +
              `Minimum distance is ${MIN_DISTANCE * 1000}m. ` +
              `Run npm run stations to re-filter.`,
          );
        }
      });

      test("maintains minimum distance from other TICON stations", () => {
        const MIN_DISTANCE = 0.05; // 50 meters (in km)

        const nearby = near({
          latitude: station.latitude,
          longitude: station.longitude,
          maxDistance: MIN_DISTANCE,
          maxResults: Infinity,
          filter: (s) => s.id.startsWith("ticon/") && s.id !== station.id,
        });

        if (nearby.length > 0) {
          const [other, dist] = nearby[0]!;
          throw new Error(
            `This TICON station is only ${(dist * 1000).toFixed(0)}m from ${other.id} ` +
              `(minimum: ${MIN_DISTANCE * 1000}m). ` +
              `Run npm run stations to re-filter.`,
          );
        }
      });

      test("has tidal range >= 2cm (MHW - MLW)", () => {
        if (!station.datums) return;
        const mhw = station.datums["MHW"];
        const mlw = station.datums["MLW"];
        if (mhw === undefined || mlw === undefined) return;
        const range = mhw - mlw;
        // Two rounded float32 levels can lose up to one ULP of their larger
        // magnitude when subtracted, especially in a high-elevation gauge frame.
        const rounding = float32DifferenceMargin(mhw, mlw);
        expect(
          range,
          `Station ${station.id} has negligible tidal range: ${(range * 100).toFixed(1)}cm (MHW-MLW). ` +
            `Run npm run stations to re-filter.`,
        ).toBeGreaterThanOrEqual(MIN_TIDAL_RANGE - rounding);
      });
    }
  });
});

describe("seasonal-contamination gate", () => {
  const getAmp = (
    s: { harmonic_constituents?: { name: string; amplitude: number }[] },
    name: string,
  ) => s.harmonic_constituents?.find((c) => c.name === name)?.amplitude;
  const median = (v: number[]): number => {
    const a = [...v].sort((x, y) => x - y);
    const m = a.length >> 1;
    return a.length % 2 ? a[m]! : (a[m - 1]! + a[m]!) / 2;
  };

  // A short/gappy/datum-shifted record whose harmonic fit dumps spurious energy
  // into the annual (SA) band inflates the predicted extreme range. Cape Dor is
  // the canonical case (openwatersio/slackwater-database#93): SA 2.077m vs 0.090m at
  // Spencers Island 7km away in the same tidal regime.
  test("rejects known contaminated records", () => {
    const byId = new Map(quality.map((r) => [r.id, r]));
    expect(byId.get("ticon/cape_dor-240-can-meds")?.accepted).toBe(false);
    expect(byId.get("ticon/cape_dor-240-can-meds")?.reason).toBe("seasonal");
    expect(byId.get("ticon/mazatlan_flotador-16-mex-unam")?.accepted).toBe(
      false,
    );
    // The seasonal gate runs before dedup, so this is the reason of record —
    // assert it so a regression can't quietly downgrade it back to "duplicate".
    expect(byId.get("ticon/mazatlan_flotador-16-mex-unam")?.reason).toBe(
      "seasonal",
    );
  });

  // Shipped-data invariant: no published TICON station has an SA amplitude that
  // grossly outstrips same-regime (similar-M2) neighbours within the radius.
  test("no published station is a same-regime SA outlier", () => {
    const refs = allTideStations.filter(
      (s) => (s.type ?? "reference") === "reference",
    );
    for (const station of tideStations) {
      if (!station.id.startsWith("ticon/")) continue;
      if ((station.type ?? "reference") !== "reference") continue;
      const sa = getAmp(station, "SA");
      if (sa === undefined || sa < SEASONAL_OUTLIER_MIN_SA) continue;
      const m2 = getAmp(station, "M2");
      if (m2 === undefined || m2 <= 0) continue;

      const neighbourSA: number[] = [];
      for (const other of refs) {
        if (other.id === station.id) continue;
        const osa = getAmp(other, "SA");
        if (osa === undefined || osa <= 0) continue;
        const om2 = getAmp(other, "M2");
        if (om2 === undefined || om2 <= 0) continue;
        if (Math.min(m2, om2) / Math.max(m2, om2) < MIN_AMPLITUDE_RATIO)
          continue;
        if (
          distance(
            station.latitude,
            station.longitude,
            other.latitude,
            other.longitude,
          ) <= SEASONAL_OUTLIER_RADIUS
        )
          neighbourSA.push(osa);
      }
      if (neighbourSA.length === 0) continue;
      const med = median(neighbourSA);
      if (med <= 0) continue;
      expect(
        sa / med,
        `Station ${station.id}: SA ${sa.toFixed(3)}m is ${(sa / med).toFixed(1)}x the ` +
          `median SA of its same-regime neighbours (${med.toFixed(3)}m). ` +
          `Run npm run stations to re-filter.`,
      ).toBeLessThan(SEASONAL_OUTLIER_RATIO);
    }
  });
});

describe("gauge deduplication", () => {
  test("keeps NOAA-derived lake gauges without a direct replacement", () => {
    for (const id of [
      "ticon/alpena_mi-9075065-usa-noaa",
      "ticon/calumet_harbor_il-9087044-usa-noaa",
    ]) {
      const station = allTideStations.find((s) => s.id === id);
      expect(station?.quality?.accepted, id).toBe(true);
      expect(station?.quality?.seasonal_dominant, id).toBe(true);
    }
  });

  test("only supersedes NOAA-derived rows with a direct harmonic replacement", () => {
    for (const q of quality.filter((q) => q.reason === "superseded")) {
      if (!q.id.endsWith("-noaa")) continue;
      const code = q.id.split("-").at(-3);
      const replacement = allTideStations.find((s) => s.id === `noaa/${code}`);
      expect(replacement?.harmonic_constituents?.length, q.id).toBeGreaterThan(
        0,
      );
    }
  });

  test("prefers a direct authoritative gauge over a duplicate TICON record", () => {
    const record = (id: string, name: string) => ({ id, source: { name } });
    const ticon = (id: string) => record(id, "TICON-4");
    expect(
      authoritativeDuplicateWinner(
        record(
          "kartverket/TOS",
          "Kartverket / Norwegian Mapping Authority, Hydrographic Service",
        ),
        ticon("ticon/tromso-123-nor-nhs"),
      ),
    ).toBe("kartverket/TOS");
    expect(
      authoritativeDuplicateWinner(
        ticon("ticon/wellington-071-nzl-uhslc_fd"),
        record("linz/071", "Toitū Te Whenua Land Information New Zealand"),
      ),
    ).toBe("linz/071");
    expect(
      authoritativeDuplicateWinner(ticon("ticon/a"), ticon("ticon/b")),
    ).toBeUndefined();
  });

  test("does not prefer NOAA's subordinate outside its jurisdiction", () => {
    const noaa = (country: string) => ({
      id: "noaa/sub",
      type: "subordinate",
      country,
      source: { name: "US National Oceanic and Atmospheric Administration" },
    });
    const relay = { id: "ticon/relay", source: { name: "TICON-4" } };
    expect(authoritativeDuplicateWinner(noaa("Mexico"), relay)).toBeUndefined();
    expect(authoritativeDuplicateWinner(noaa("Puerto Rico"), relay)).toBe(
      "noaa/sub",
    );
  });

  test("keeps a local analysis over NOAA's subordinate predicted from San Diego", () => {
    // TWC0379 predicts Manzanillo from San Diego, 1,986 km away, and runs about
    // 110 minutes from the 19-year UHSLC analysis at the gauge.
    expect(quality.find((r) => r.id === "noaa/TWC0379")).toMatchObject({
      accepted: false,
      redundant: expect.stringMatching(/^ticon\/manzanillo-395/),
    });
  });

  test("supersedes a relay only by an operator record that passes its checks", () => {
    const byId = new Map(quality.map((r) => [r.id, r]));
    const relays = quality.filter(
      (r) => r.reason === "superseded" && !r.id.endsWith("-rws_hist"),
    );
    expect(relays.length).toBeGreaterThan(0);
    for (const r of relays) {
      const direct = (r.issues ?? [])
        .join(" ")
        .match(/Superseded by (\S+),/)?.[1];
      expect(direct, r.id).toBeDefined();
      const operator = allTideStations.find((s) => s.id === direct)!;
      const relay = allTideStations.find((s) => s.id === r.id)!;
      expect(
        distance(
          relay.latitude,
          relay.longitude,
          operator.latitude,
          operator.longitude,
        ),
        r.id,
      ).toBeLessThanOrEqual(10);
      const verdict = byId.get(direct!);
      expect(verdict?.accepted || verdict?.reason === "duplicate", r.id).toBe(
        true,
      );
    }
    // Snow Hill's small cross-method bound mismatch does not disqualify its operator.
    expect(byId.get("noaa/8571359")?.accepted).toBe(true);
    expect(byId.get("ticon/snow_hill-8571359-usa-noaa")?.redundant).toBe(
      "noaa/8571359",
    );
  });

  test("supersedes UHSLC's copy of a Kartverket gauge", () => {
    // UHSLC names the Norwegian Hydrographic Service as originator of 823A,
    // and the fast-delivery series shares its gauge.
    expect(
      quality.find((r) => r.id === "ticon/nylesund-823-nor-uhslc_fd"),
    ).toMatchObject({ accepted: false, reason: "superseded" });
  });

  test("publishes the longer UHSLC series of a gauge", () => {
    // Research quality covers 19 years to April 2011, fast delivery 3.9 years
    // to the same date.
    expect(
      quality.find((r) => r.id === "ticon/acapulco_gro-316-mex-uhslc_fd"),
    ).toMatchObject({
      accepted: false,
      redundant: "ticon/acapulco_gro-316a-mex-uhslc_rq",
    });
  });

  test("NOAA's jurisdiction names countries its records use", () => {
    const countries = new Set(
      allTideStations
        .filter((s) => s.id.startsWith("noaa/"))
        .map((s) => s.country),
    );
    const { jurisdiction } = sourceMetadata(
      "US National Oceanic and Atmospheric Administration",
    );
    for (const country of jurisdiction ?? [])
      expect(countries.has(country), country).toBe(true);
  });

  test("rejects Harris County's records for their clock error", () => {
    const hct = quality.filter((r) => r.id.endsWith("-hct"));
    expect(hct).toHaveLength(17);
    expect(hct.every((r) => !r.accepted && r.reason === "timing")).toBe(true);
  });

  test("points every duplicate at a published record", () => {
    const accepted = new Set(
      quality.filter((r) => r.accepted).map((r) => r.id),
    );
    const unpublished = quality.filter(
      (r) => r.redundant && !accepted.has(r.redundant),
    );
    expect(unpublished.map((r) => `${r.id} → ${r.redundant}`)).toEqual([]);
  });

  test("accepts every LINZ port over the TICON relay of the same gauge", () => {
    const linz = quality.filter((r) => r.id.startsWith("linz/"));
    expect(linz).toHaveLength(56);
    expect(linz.every((r) => r.accepted && r.factors?.source === 1)).toBe(true);
    expect(
      quality.find((r) => r.id === "ticon/wellington-071-nzl-uhslc_fd"),
    ).toMatchObject({ accepted: false, redundant: "linz/071" });
  });

  test("accepts all Kartverket gauges over co-located TICON records", () => {
    const kartverket = quality.filter((r) => r.id.startsWith("kartverket/"));
    expect(kartverket).toHaveLength(33);
    expect(kartverket.every((r) => r.accepted && r.factors?.source === 1)).toBe(
      true,
    );
    expect(
      quality.find((r) => r.id === "ticon/tromso-tos-nor-nhs"),
    ).toMatchObject({
      accepted: false,
      redundant: "kartverket/TOS",
    });
  });

  test("keeps established Japanese gauge names and primary paths", () => {
    for (const [id, name, path] of [
      ["0056", "Kozushima", "/tides/jp/kozushima/"],
      ["0163", "Oita", "/tides/jp/oita/"],
      ["0173", "Odomari", "/tides/jp/odomari/"],
      ["0059", "Hachijyojima", "/tides/jp/hachijyojima/"],
      ["0117", "Kure", "/tides/jp/kure-hiroshima-bay/"],
      ["0062", "Yokohamashinko", "/tides/jp/yokohamashinko/"],
    ]) {
      const station = tideStations.find((s) => s.id === `jhod/${id}`);
      expect(station?.name).toBe(name);
      expect(
        stationRoutes("tide").find((r) => r.stationIds.includes(`jhod/${id}`))
          ?.path,
      ).toBe(path);
    }
  });

  test("prefers JHOD's constants to Coast Guard relays while keeping the separate JMA gauge", () => {
    const jhod = quality.filter((r) => r.id.startsWith("jhod/"));
    expect(jhod).toHaveLength(20);
    expect(jhod.every((r) => r.accepted && r.factors?.source === 1)).toBe(true);
    expect(
      quality.find((r) => r.id === "ticon/izuhara-hd23-jpn-jodc_jcg"),
    ).toMatchObject({
      accepted: false,
      reason: "superseded",
      redundant: "jhod/0158",
    });
    expect(
      quality.find((r) => r.id === "ticon/nakano_shima-345a-jpn-uhslc_rq"),
    ).toMatchObject({
      accepted: false,
      reason: "superseded",
      redundant: "jhod/0179",
    });
    expect(
      quality.find((r) => r.id === "ticon/yokohama-ma16-jpn-jodc_jma")
        ?.accepted,
    ).toBe(true);
  });

  // A single physical gauge is often split across TICON records that share a
  // station code but differ by segment letter or provider (fast-delivery vs
  // research-quality, or two data centres). Coordinate drift pushes them past
  // the spatial dedup radius, so they used to survive as duplicates
  // (openwatersio/slackwater-database#112). No two published TICON stations should now
  // share a gauge key.
  test("no two published TICON stations share a gauge key", () => {
    const seen = new Map<string, string>();
    for (const station of tideStations) {
      if (!station.id.startsWith("ticon/")) continue;
      const key = gaugeKey(station.source.id);
      const prior = seen.get(key);
      expect(
        prior,
        `Stations ${prior} and ${station.id} share gauge key "${key}". ` +
          `Run npm run stations to re-filter.`,
      ).toBeUndefined();
      seen.set(key, station.id);
    }
  });

  test("collapses Las Palmas UHSLC segments to one record", () => {
    const byId = new Map(quality.map((r) => [r.id, r]));
    // The fast-delivery record is kept; the research-quality segments are dropped.
    expect(byId.get("ticon/las_palmas-217-esp-uhslc_fd")?.accepted).toBe(true);
    for (const seg of ["a", "b", "c", "d"]) {
      const r = byId.get(`ticon/las_palmas-217${seg}-esp-uhslc_rq`);
      expect(r?.accepted, `217${seg} should be a duplicate`).toBe(false);
      expect(r?.reason).toBe("duplicate");
      expect(r?.redundant).toBe("ticon/las_palmas-217-esp-uhslc_fd");
    }
  });

  test("gaugeKey strips segment letters and source suffixes", () => {
    expect(gaugeKey("las_palmas-217-esp-uhslc_fd")).toBe("las_palmas-217-esp");
    expect(gaugeKey("las_palmas-217a-esp-uhslc_rq")).toBe("las_palmas-217-esp");
    expect(gaugeKey("aberdeen-abe-gbr-cmems")).toBe("aberdeen-abe-gbr");
    // Non-numeric codes keep any trailing letters (they are not segment markers).
    expect(gaugeKey("cape_ferguson-h033007a-aus-bom")).toBe(
      "cape_ferguson-h033007a-aus",
    );
  });

  test("Roseau's mislabelled fast-delivery record has its UHSLC gauge key", () => {
    expect(gaugeKey("roseau-786-dom-uhslc_fd")).toBe("roseau-786-dma");
    expect(gaugeKey("roseau-786a-dma-uhslc_rq")).toBe("roseau-786-dma");
  });
});

describe("coordinate-precision tiebreak", () => {
  test("coordinatePrecision counts the limiting decimal places", () => {
    expect(coordinatePrecision(28.148, -15.407)).toBe(3);
    expect(coordinatePrecision(28.1, -15.4)).toBe(1);
    // Limited by the coarser of the two coordinates.
    expect(coordinatePrecision(38.016389, -121.5)).toBe(1);
  });

  // When duplicate records tie on score, the survivor should be the one with the
  // more precise coordinates, so the kept station carries the better location.
  test("keeps the more precisely located record of a tied duplicate pair", () => {
    const byId = new Map(quality.map((r) => [r.id, r]));
    const kept = byId.get("ticon/burnie-60910-aus-bom");
    const dropped = byId.get("ticon/burnie-344a-aus-uhslc_rq");
    expect(kept?.accepted).toBe(true);
    expect(dropped?.accepted).toBe(false);
    expect(dropped?.redundant).toBe("ticon/burnie-60910-aus-bom");

    const keptStation = tideStations.find(
      (s) => s.id === "ticon/burnie-60910-aus-bom",
    )!;
    const droppedStation = allTideStations.find(
      (s) => s.id === "ticon/burnie-344a-aus-uhslc_rq",
    )!;
    expect(
      coordinatePrecision(keptStation.latitude, keptStation.longitude),
    ).toBeGreaterThanOrEqual(
      coordinatePrecision(droppedStation.latitude, droppedStation.longitude),
    );
  });
});

describe("coordinate gate", () => {
  // Records that fail to geolocate upstream default to (0, 0) — Null Island in
  // the Gulf of Guinea — where they cannot be deduplicated against the real
  // gauge (openwatersio/slackwater-database#112, the Nonopapa case).
  test("no published station sits on Null Island", () => {
    for (const station of tideStations) {
      const onNullIsland =
        Math.abs(station.latitude) < NULL_ISLAND_RADIUS &&
        Math.abs(station.longitude) < NULL_ISLAND_RADIUS;
      expect(
        onNullIsland,
        `Station ${station.id} is on Null Island (${station.latitude}, ${station.longitude}). ` +
          `Run npm run stations to re-filter.`,
      ).toBe(false);
    }
  });
});

describe("subordinate offset dedup", () => {
  const byId = new Map(quality.map((r) => [r.id, r]));

  // Two subordinate stations can share (coarse or placeholder) coordinates yet
  // predict different tides through different offsets. Suwarrow Island is
  // mislocated on Hao Island's exact coordinates but carries a +64 min vs
  // −315 min offset, so proximity alone must not merge them
  // (openwatersio/slackwater-database#112 follow-up).
  test("keeps distinct subordinate stations that share coordinates", () => {
    for (const id of [
      "noaa/TPT2829", // Suwarrow vs Hao (TPT2837)
      "noaa/TPT2837",
      "noaa/8724370", // Sawyer Key outside vs inside (8724369)
      "noaa/8724369",
      "noaa/TEC3447", // South Newport Cut vs North Newport River (TEC3445)
      "noaa/TEC3445",
    ]) {
      expect(byId.get(id)?.accepted, `${id} should be kept`).toBe(true);
    }
  });

  // A genuine subordinate duplicate — same name, same reference, offsets within
  // tolerance — must still be merged.
  test("still merges near-identical subordinate duplicates", () => {
    const dup = byId.get("noaa/8724224"); // Little Torch Key (dup of 8724223)
    expect(dup?.accepted).toBe(false);
    expect(dup?.reason).toBe("duplicate");
    expect(dup?.redundant).toBe("noaa/8724223");
  });
});

test("Does not have duplicate source IDs", () => {
  const seen = new Map();
  tideStations.forEach((station) => {
    const dup = seen.get(station.source.id);
    if (dup) {
      throw new Error(
        `Stations ${station.id} and ${dup.id} have the same source id ${station.source.id}`,
      );
    }
    seen.set(station.source.id, station);
  });
});

describe("seasonal dominance", () => {
  const labelled = quality.filter(
    (q) => (q as { seasonal_dominant?: boolean }).seasonal_dominant,
  );

  test("labels the stations whose yearly swing exceeds their daily one", () => {
    // Every one is a lake, a river reach or a lagoon. The count is here rather
    // than a floor so that a release which quietly moves the rule has to say so:
    // the whole point of the label is that two consumers describe the same water
    // the same way, which a drifting population defeats.
    expect(labelled.length).toBe(999);
  });

  test("labels independently of the rejection verdict", () => {
    expect(labelled.filter((q) => q.accepted)).toHaveLength(505);
    expect(labelled.filter((q) => !q.accepted)).toHaveLength(494);
  });

  test("is a different question from the contamination gate", () => {
    // `reason: "seasonal"` and `seasonal_dominant` share a word and mean
    // opposite things. The gate asks whether a station's SA is anomalous
    // against its NEIGHBOURS, which catches a bad harmonic fit and rejects it.
    // The label asks whether SA dominates the station's OWN tidal terms, which
    // catches water that has no real tide and keeps it.
    //
    // The two overlap without either implying the other, and this pins that:
    // the gate rejects 6 stations, exactly 5 of which are also labelled. A
    // change that collapsed the two concepts would move both numbers.
    const contaminated = quality.filter(
      (q) => (q as { reason?: string }).reason === "seasonal",
    );
    expect(contaminated.length).toBe(6);
    expect(
      contaminated.filter(
        (q) => (q as { seasonal_dominant?: boolean }).seasonal_dominant,
      ).length,
    ).toBe(5);
  });

  test("leaves no subordinate behind its labelled reference", () => {
    // A subordinate predicts from its reference's constituents, so it carries
    // its reference's label. evaluate-quality.test.ts covers how.
    const labelledIds = new Set(labelled.map((q) => q.id));
    const orphans = allTideStations.filter(
      (s) =>
        s.type === "subordinate" &&
        s.offsets?.reference &&
        labelledIds.has(s.offsets.reference) &&
        !s.quality?.seasonal_dominant,
    );
    expect(orphans.map((s) => s.id)).toEqual([]);
  });

  test("agrees with the constituents it is derived from", () => {
    // Recomputed from the data rather than trusted, both ways: a label the
    // constituents do not support, and a station the label misses, because the
    // label is the only thing standing between a consumer and a tide table
    // drawn over Lake Ontario.
    const verdicts = new Map(
      quality.map((q) => [
        q.id,
        Boolean((q as { seasonal_dominant?: boolean }).seasonal_dominant),
      ]),
    );
    const disagreements: string[] = [];
    for (const station of allTideStations) {
      if (!station.harmonic_constituents?.length) continue;
      const amp = (name: string) =>
        Math.abs(
          station.harmonic_constituents!.find((c) => c.name === name)
            ?.amplitude ?? 0,
        );
      const seasonal = seasonalPeak(station.harmonic_constituents);
      const tidal = PRINCIPAL_TIDAL_CONSTITUENTS.map(amp).reduce(
        (a, b) => a + b,
        0,
      );
      const dominant = exceeds(seasonal, tidal * SEASONAL_DOMINANCE_RATIO);
      if (dominant !== verdicts.get(station.id)) {
        disagreements.push(`${station.id}: constituents say ${dominant}`);
      }
    }
    expect(disagreements).toEqual([]);
  });

  test("reaches the reader through the database, not just the station files", () => {
    // Cobourg on Lake Ontario: SA 0.289 m against a principal tide of
    // 0.004 m, and it passes the 2 cm range floor by 5 mm, so nothing else
    // in the pass catches it.
    const cobourg = allTideStations.find(
      (s) => s.id === "ticon/cobourg_ontario-13590-can-meds",
    );
    expect(cobourg?.quality?.seasonal_dominant).toBe(true);
    expect(cobourg?.quality?.accepted).toBe(true);
    expect(cobourg?.quality?.issues?.join(" ")).toContain("yearly swing");

    // Seattle is the control: a real tide, no label, and the field reads back
    // undefined rather than false so it behaves like every other optional.
    const seattle = allTideStations.find((s) => s.id === "noaa/9447130");
    expect(seattle?.quality?.seasonal_dominant).toBeUndefined();
  });
});

describe("station slugs", () => {
  // These Channel Coastal Observatory slugs were assigned while TICON's
  // meta.csv rows sat on their neighbors' records: brighton held Hastings Pier.
  test.each([
    ["brighton", "ticon/brighton-btn-gbr-cco"],
    ["hastings-pier", "ticon/hastings_pier-hgp-gbr-cco"],
    ["teignmouth-pier", "ticon/teignmouth_pier-tnp-gbr-cco"],
    ["port-isaac", "ticon/port_isaac-pti-gbr-cco"],
    ["severn-bridge", "ticon/severn_bridge-ssc-gbr-cco"],
    ["scarborough", "ticon/scarborough-sca-gbr-cco"],
    ["west-bay-harbour", "ticon/west_bay_harbour-wbh-gbr-cco"],
  ])("gb/%s publishes the gauge it names", (slug, id) => {
    const file = readStationFiles().find(
      (f) => f.kind === "tide" && f.country === "GB" && f.slug === slug,
    );
    expect(file?.sources).toContain(id);
  });
});

describe("CMEMS precedence", () => {
  test.each([
    ["ticon/otranto-otr-ita-ispra", "ticon/rmn_otranto-rmn-ita-cmems"],
    ["ticon/arun_platform-arn-gbr-cco", "ticon/arunplatformtg-aru-gbr-cmems"],
    ["ticon/lymington-lym-gbr-cco", "ticon/lymingtontg-lym-gbr-cmems"],
  ])("%s beats its CMEMS copy at an equal score", (agency, copy) => {
    const byId = new Map(quality.map((r) => [r.id, r]));
    expect(byId.get(agency)?.accepted).toBe(true);
    expect(byId.get(copy)).toMatchObject({
      accepted: false,
      redundant: agency,
    });
    expect(byId.get(agency)?.score).toBe(byId.get(copy)?.score);
  });

  test("a better-scored CMEMS record still wins", () => {
    // 19 years against 13 months of the same gauge.
    const byId = new Map(quality.map((r) => [r.id, r]));
    expect(byId.get("ticon/arklowharbour-ark-irl-cmems")?.accepted).toBe(true);
    expect(
      byId.get("ticon/arklow_harbour_opw_station-ark-irl-mi_c"),
    ).toMatchObject({
      accepted: false,
      redundant: "ticon/arklowharbour-ark-irl-cmems",
    });
  });
});
