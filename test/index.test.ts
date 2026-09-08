import { describe, test, expect } from "vitest";
import { readFile } from "fs/promises";
import { join } from "path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { stations, allStations } from "../src/index.js";
import { near } from "../src/search/index.js";
import {
  MIN_TIDAL_RANGE,
  MIN_DEDUP_DISTANCE,
  MIN_AMPLITUDE_RATIO,
  SEASONAL_OUTLIER_RADIUS,
  SEASONAL_OUTLIER_MIN_SA,
  SEASONAL_OUTLIER_RATIO,
  NULL_ISLAND_RADIUS,
  gaugeKey,
  coordinatePrecision,
  distance,
} from "../tools/filtering.js";
import quality from "../quality.json" with { type: "json" };

const ROOT = new URL("..", import.meta.url).pathname;
const SCHEMA_PATH = join(ROOT, "schemas", "station.schema.json");

const schema = JSON.parse(await readFile(SCHEMA_PATH, "utf-8"));
const ajv = new (Ajv2020 as any)({ allErrors: true, strict: false });
(addFormats as any)(ajv);
const validate = ajv.compile(schema);

stations.forEach((station) => {
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
      expect(
        station.chart_datum,
        `Station ${station.id} is missing chart_datum`,
      ).toBeDefined();

      const { datums } =
        (station.type === "reference"
          ? station
          : stations.find((s) => s.id === station.offsets!.reference)) || {};

      // 3 NOAA stations have empty datums, so we skip the check for those
      if (datums && Object.keys(datums).length > 0) {
        expect(
          datums[station.chart_datum],
          `Station ${station.id} missing chart_datum ${station.chart_datum}`,
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
          expect(
            h,
            `Station ${station.id}: ${higher} (${h.toFixed(3)}m) should be >= ${lower} (${l.toFixed(3)}m)`,
          ).toBeGreaterThanOrEqual(l);
        }
      }
    });

    if (station.type === "subordinate") {
      test("has valid reference station", () => {
        const id = station.offsets!.reference;
        const reference = stations.find((s) => s.id === id);
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
              `Run tools/evaluate-quality.ts to re-filter.`,
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
          filter: (s) => s.id.startsWith("noaa/"),
        });

        if (nearby.length > 0) {
          const [noaa, dist] = nearby[0]!;
          throw new Error(
            `This TICON station is ${(dist * 1000).toFixed(0)}m from NOAA station ${noaa.id}. ` +
              `Minimum distance is ${MIN_DISTANCE * 1000}m. ` +
              `Run tools/evaluate-quality.ts to re-filter.`,
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
              `Run tools/evaluate-quality.ts to re-filter.`,
          );
        }
      });

      test("has tidal range >= 2cm (MHW - MLW)", () => {
        if (!station.datums) return;
        const mhw = station.datums["MHW"];
        const mlw = station.datums["MLW"];
        if (mhw === undefined || mlw === undefined) return;
        const range = mhw - mlw;
        expect(
          range,
          `Station ${station.id} has negligible tidal range: ${(range * 100).toFixed(1)}cm (MHW-MLW). ` +
            `Run tools/evaluate-quality.ts to re-filter.`,
          // The database stores datums as float32, so a station accepted right
          // at the threshold can read back a hair under it.
        ).toBeGreaterThanOrEqual(MIN_TIDAL_RANGE - 1e-6);
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
  // the canonical case (openwatersio/tide-database#93): SA 2.077m vs 0.090m at
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
    const refs = allStations.filter(
      (s) => (s.type ?? "reference") === "reference",
    );
    for (const station of stations) {
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
          `Run tools/evaluate-quality.ts to re-filter.`,
      ).toBeLessThan(SEASONAL_OUTLIER_RATIO);
    }
  });
});

describe("gauge deduplication", () => {
  // A single physical gauge is often split across TICON records that share a
  // station code but differ by segment letter or provider (fast-delivery vs
  // research-quality, or two data centres). Coordinate drift pushes them past
  // the spatial dedup radius, so they used to survive as duplicates
  // (openwatersio/tide-database#112). No two published TICON stations should now
  // share a gauge key.
  test("no two published TICON stations share a gauge key", () => {
    const seen = new Map<string, string>();
    for (const station of stations) {
      if (!station.id.startsWith("ticon/")) continue;
      const key = gaugeKey(station.source.id);
      const prior = seen.get(key);
      expect(
        prior,
        `Stations ${prior} and ${station.id} share gauge key "${key}". ` +
          `Run tools/evaluate-quality.ts to re-filter.`,
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
    const kept = byId.get("ticon/lymingtontg-lym-gbr-cmems");
    const dropped = byId.get("ticon/lymington-lym-gbr-cco");
    expect(kept?.accepted).toBe(true);
    expect(dropped?.accepted).toBe(false);
    expect(dropped?.redundant).toBe("ticon/lymingtontg-lym-gbr-cmems");

    const keptStation = stations.find(
      (s) => s.id === "ticon/lymingtontg-lym-gbr-cmems",
    )!;
    const droppedStation = allStations.find(
      (s) => s.id === "ticon/lymington-lym-gbr-cco",
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
  // gauge (openwatersio/tide-database#112, the Nonopapa case).
  test("no published station sits on Null Island", () => {
    for (const station of stations) {
      const onNullIsland =
        Math.abs(station.latitude) < NULL_ISLAND_RADIUS &&
        Math.abs(station.longitude) < NULL_ISLAND_RADIUS;
      expect(
        onNullIsland,
        `Station ${station.id} is on Null Island (${station.latitude}, ${station.longitude}). ` +
          `Run tools/evaluate-quality.ts to re-filter.`,
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
  // (openwatersio/tide-database#112 follow-up).
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
  stations.forEach((station) => {
    const dup = seen.get(station.source.id);
    if (dup) {
      throw new Error(
        `Stations ${station.id} and ${dup.id} have the same source id ${station.source.id}`,
      );
    }
    seen.set(station.source.id, station);
  });
});
