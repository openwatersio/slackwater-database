import type { HarmonicStation, SubordinateStation } from "@neaps/noaa-current";
import { find as findTimezone } from "geo-tz/all";
import type { CurrentData, StationInput } from "@neaps/tide-database";

type NullableDirections = {
  floodDirection: number | null;
  ebbDirection: number | null;
  tideReference?: string;
};
type SourceStation =
  | (Omit<HarmonicStation, "floodDirection" | "ebbDirection"> &
      NullableDirections)
  | (Omit<SubordinateStation, "floodDirection" | "ebbDirection"> &
      NullableDirections);

export interface CurrentBundle {
  stations: SourceStation[];
}

export type CurrentStationInput = StationInput & { routed?: boolean };

export function currentInputs(bundle: CurrentBundle): CurrentStationInput[] {
  return bundle.stations.map((station) => {
    const id = `noaa/${station.id}`;
    const timezone = findTimezone(station.latitude, station.longitude)[0];
    if (!timezone) throw new Error(`${station.id}: no timezone at position`);

    const current: CurrentData = {};
    if (typeof station.floodDirection === "number")
      current.flood_direction = station.floodDirection;
    if (typeof station.ebbDirection === "number")
      current.ebb_direction = station.ebbDirection;
    if (station.tideReference) current.tide_reference = station.tideReference;
    if (station.type === "harmonic") current.mean_flow = station.offset;
    else
      current.offsets = {
        reference: `noaa/${station.reference}`,
        slack_before_flood: minutes(
          station.id,
          "slackBeforeFloodOffset",
          station.slackBeforeFloodOffset,
        ),
        slack_before_ebb: minutes(
          station.id,
          "slackBeforeEbbOffset",
          station.slackBeforeEbbOffset,
        ),
        flood_time: minutes(
          station.id,
          "floodTimeOffset",
          station.floodTimeOffset,
        ),
        ebb_time: minutes(station.id, "ebbTimeOffset", station.ebbTimeOffset),
        flood_speed_ratio: station.floodSpeedRatio,
        ebb_speed_ratio: station.ebbSpeedRatio,
      };

    return {
      id,
      name: station.name,
      kind: "current",
      type: station.type === "harmonic" ? "reference" : "subordinate",
      latitude: station.latitude,
      longitude: station.longitude,
      timezone,
      country: "United States",
      country_code: "US",
      continent: "Americas",
      harmonic_constituents:
        station.type === "harmonic" ? station.constituents : [],
      current,
      source: {
        name: "US National Oceanic and Atmospheric Administration",
        id: station.id,
        published_harmonics: station.type === "harmonic",
        url: `https://tidesandcurrents.noaa.gov/stationhome.html?id=${encodeURIComponent(station.id.split("@")[0]!)}`,
      },
      license: {
        type: "public domain",
        commercial_use: true,
        url: "https://tidesandcurrents.noaa.gov/disclaimers.html",
      },
      ...(station.id.includes("@") ||
      typeof station.floodDirection !== "number" ||
      typeof station.ebbDirection !== "number"
        ? { routed: false }
        : {}),
    };
  });
}

function minutes(id: string, field: string, seconds: number): number {
  if (!Number.isFinite(seconds) || seconds % 60 !== 0)
    throw new Error(
      `${id}: ${field} must contain whole minutes, received ${seconds} seconds`,
    );
  return seconds / 60;
}
