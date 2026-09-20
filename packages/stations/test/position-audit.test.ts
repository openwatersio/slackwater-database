import { describe, expect, test } from "vitest";
import {
  REPORT_THRESHOLD_M,
  auditProblems,
  classifyPosition,
  diffAuditLock,
  type AuditLock,
} from "../position-audit.ts";

const verified = {
  id: "noaa/9447659",
  latitude: 47.978,
  longitude: -122.223,
  positionVerified: "Published river gauge position",
};
const clear = {
  id: "noaa/9449880",
  latitude: 48.546,
  longitude: -123.013,
};
const ashore = { id: "noaa/8", latitude: 48.515, longitude: -122.62 };
const lock: AuditLock = {
  note: "Position audit lock",
  coastline: "sha256-test",
  thresholdM: 200,
  stations: {
    "noaa/9447659": { position: [47.9, -122.2], verdict: "clear" },
  },
};

describe("position audit", () => {
  test("classifies clear, verified, ashore, and uncovered positions", () => {
    expect(classifyPosition(verified)).toEqual({ verdict: "verified" });
    expect(classifyPosition(clear)).toEqual({ verdict: "clear" });
    const result = classifyPosition(ashore);
    expect(result.verdict).toBe("ashore");
    if (result.verdict === "ashore")
      expect(result.metresInland).toBeGreaterThan(200);
    expect(
      classifyPosition({ id: "outside", latitude: 0, longitude: 0 }),
    ).toEqual({ verdict: "unverifiable" });
  });

  test("reports moved, added, and removed lock entries", () => {
    expect(diffAuditLock(lock, [verified])).toMatchObject({
      moved: [{ id: "noaa/9447659" }],
    });
    expect(diffAuditLock(lock, [verified, clear])).toMatchObject({
      added: ["noaa/9449880"],
      removed: [],
    });
    expect(diffAuditLock(lock, [])).toMatchObject({
      added: [],
      removed: ["noaa/9447659"],
    });
  });

  test("names an unverified ashore station and its distance", () => {
    const pinnedClear: AuditLock = {
      ...lock,
      stations: {
        [ashore.id]: {
          position: [ashore.latitude, ashore.longitude],
          verdict: "clear",
        },
      },
    };
    expect(auditProblems(pinnedClear, [ashore]).join("\n")).toMatch(
      /noaa\/8: \d+ metres inland/,
    );
  });

  test("rejects a stale audit threshold", () => {
    expect(
      auditProblems({ ...lock, thresholdM: REPORT_THRESHOLD_M + 1 }, []),
    ).toEqual([expect.stringMatching(/threshold changed/)]);
  });
});
