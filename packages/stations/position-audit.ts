import { readFileSync } from "node:fs";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point } from "@turf/helpers";

export const REPORT_THRESHOLD_M = 200;
const EARTH_M = 6_371_000;

interface AuditStation {
  id: string;
  latitude: number;
  longitude: number;
  positionVerified?: string;
}

export type AuditVerdict =
  | { verdict: "verified" }
  | { verdict: "unverifiable" }
  | { verdict: "clear" }
  | { verdict: "ashore"; metresInland: number };

export interface AuditLock {
  note: string;
  coastline: string;
  thresholdM: number;
  stations: Record<string, { position: [number, number] } & AuditVerdict>;
}

const coastline = JSON.parse(
  readFileSync(
    new URL("../../metadata/coastline.geojson", import.meta.url),
    "utf8",
  ),
);
for (const feature of coastline.features)
  feature.bbox = bboxOf(feature.geometry.coordinates);

const coverage = (
  coastline.coverage?.length
    ? coastline.coverage
    : [
        coastline.features.reduce(
          (box: number[], feature: any) =>
            bboxOf(feature.geometry.coordinates, box),
          [Infinity, Infinity, -Infinity, -Infinity],
        ),
      ]
).map(([minLon, minLat, maxLon, maxLat]: number[]) => ({
  minLon,
  minLat,
  maxLon,
  maxLat,
}));

export function classifyPosition(
  station: AuditStation,
  thresholdM = REPORT_THRESHOLD_M,
): AuditVerdict {
  if (station.positionVerified) return { verdict: "verified" };
  if (!withinCoverage(station.latitude, station.longitude))
    return { verdict: "unverifiable" };
  const metresInland = inlandMetres(station.latitude, station.longitude);
  return metresInland <= thresholdM
    ? { verdict: "clear" }
    : { verdict: "ashore", metresInland };
}

export function nearestWater(
  latitude: number,
  longitude: number,
): { latitude: number; longitude: number; metres: number } | null {
  const found = water(latitude, longitude);
  return found
    ? {
        latitude: Number(found.latitude.toFixed(4)),
        longitude: Number(found.longitude.toFixed(4)),
        metres: found.metres,
      }
    : null;
}

export function buildAuditLock(
  stations: AuditStation[],
  coastlineFingerprint: string,
): AuditLock {
  return {
    note: "Audit results pinned per routed station. Regenerate with `npm run metadata:lock`.",
    coastline: coastlineFingerprint,
    thresholdM: REPORT_THRESHOLD_M,
    stations: Object.fromEntries(
      [...stations]
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map((station) => [
          station.id,
          {
            position: [station.latitude, station.longitude],
            ...classifyPosition(station),
          },
        ]),
    ),
  };
}

export function diffAuditLock(
  lock: AuditLock,
  stations: AuditStation[],
): {
  moved: { id: string; was: [number, number]; now: [number, number] }[];
  added: string[];
  removed: string[];
  unchanged: string[];
} {
  const seen = new Set<string>();
  const moved: { id: string; was: [number, number]; now: [number, number] }[] =
    [];
  const added: string[] = [];
  const unchanged: string[] = [];
  for (const station of stations) {
    seen.add(station.id);
    const pinned = lock.stations[station.id];
    if (!pinned) added.push(station.id);
    else if (
      pinned.position[0] === station.latitude &&
      pinned.position[1] === station.longitude
    )
      unchanged.push(station.id);
    else
      moved.push({
        id: station.id,
        was: pinned.position,
        now: [station.latitude, station.longitude],
      });
  }
  return {
    moved,
    added: added.sort(),
    removed: Object.keys(lock.stations)
      .filter((id) => !seen.has(id))
      .sort(),
    unchanged: unchanged.sort(),
  };
}

export function auditProblems(
  lock: AuditLock,
  stations: AuditStation[],
): string[] {
  if (lock.thresholdM !== REPORT_THRESHOLD_M)
    return [
      `position audit threshold changed from ${lock.thresholdM} to ${REPORT_THRESHOLD_M} metres`,
    ];
  const diff = diffAuditLock(lock, stations);
  const problems = [
    ...diff.added.map((id) => `${id}: not in position audit lock`),
    ...diff.moved.map(({ id }) => `${id}: position moved`),
    ...diff.removed.map((id) => `${id}: removed from catalogue`),
  ];
  for (const station of stations) {
    const entry = lock.stations[station.id];
    if (!entry) continue;
    const { position: _, ...pinned } = entry;
    const current = classifyPosition(station);
    if (JSON.stringify(current) === JSON.stringify(pinned)) continue;
    problems.push(
      current.verdict === "ashore"
        ? `${station.id}: ${current.metresInland} metres inland; audit changed`
        : `${station.id}: position audit changed to ${current.verdict}`,
    );
  }
  return problems;
}

function bboxOf(
  coordinates: any,
  box = [Infinity, Infinity, -Infinity, -Infinity],
): number[] {
  if (typeof coordinates[0] === "number") {
    const [longitude, latitude] = coordinates;
    box[0] = Math.min(box[0]!, longitude);
    box[1] = Math.min(box[1]!, latitude);
    box[2] = Math.max(box[2]!, longitude);
    box[3] = Math.max(box[3]!, latitude);
  } else for (const part of coordinates) bboxOf(part, box);
  return box;
}

function withinCoverage(latitude: number, longitude: number): boolean {
  return coverage.some(
    ({ minLat, maxLat, minLon, maxLon }: any) =>
      latitude >= minLat &&
      latitude <= maxLat &&
      longitude >= minLon &&
      longitude <= maxLon,
  );
}

function onLand(latitude: number, longitude: number): boolean {
  const position = point([longitude, latitude]);
  return coastline.features.some((feature: any) => {
    const [minLon, minLat, maxLon, maxLat] = feature.bbox;
    return (
      longitude >= minLon &&
      longitude <= maxLon &&
      latitude >= minLat &&
      latitude <= maxLat &&
      booleanPointInPolygon(position, feature)
    );
  });
}

function water(
  latitude: number,
  longitude: number,
): { latitude: number; longitude: number; metres: number } | null {
  if (!onLand(latitude, longitude)) return { latitude, longitude, metres: 0 };
  for (let radius = 5; radius <= 20_000; radius *= 1.3) {
    const deltaLat = (radius / EARTH_M) * (180 / Math.PI);
    const deltaLon = deltaLat / Math.cos((latitude * Math.PI) / 180);
    for (let bearing = 0; bearing < 360; bearing += 10) {
      const radians = (bearing * Math.PI) / 180;
      const testLat = latitude + deltaLat * Math.cos(radians);
      const testLon = longitude + deltaLon * Math.sin(radians);
      if (!onLand(testLat, testLon))
        return {
          latitude: testLat,
          longitude: testLon,
          metres: Math.round(distance(latitude, longitude, testLat, testLon)),
        };
    }
  }
  return null;
}

function inlandMetres(latitude: number, longitude: number): number {
  return water(latitude, longitude)?.metres ?? Infinity;
}

function distance(aLat: number, aLon: number, bLat: number, bLon: number) {
  const radians = Math.PI / 180;
  const dLat = (bLat - aLat) * radians;
  const dLon = (bLon - aLon) * radians;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * radians) *
      Math.cos(bLat * radians) *
      Math.sin(dLon / 2) ** 2;
  return EARTH_M * 2 * Math.asin(Math.sqrt(h));
}
