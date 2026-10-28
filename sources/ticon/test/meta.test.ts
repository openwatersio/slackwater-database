import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  checkCorrections,
  correctPosition,
  matchMetadata,
  POSITION_CORRECTIONS,
  type Position,
  type TiconMetaRow,
} from "../meta.ts";

function row(
  key: string,
  name: string,
  lat: number | string,
  lon: number | string,
): TiconMetaRow {
  return {
    "FILE NAME": key,
    "SITE NAME": name,
    LATITUDE: `  ${lat}`,
    LONGITUDE: `  ${lon}`,
  };
}

const NORTH: Position = { lat: 54.0, lon: -1.0 };
const SOUTH: Position = { lat: 50.0, lon: -4.0 };
const EAST: Position = { lat: 51.0, lon: 1.0 };

function names(matched: Record<string, TiconMetaRow>) {
  return Object.fromEntries(
    Object.entries(matched).map(([id, r]) => [id, r["SITE NAME"]]),
  );
}

describe("matchMetadata", () => {
  it("keeps rows whose position matches their key", () => {
    const matched = matchMetadata(
      [row("north", "North", 54.0, -1.0), row("east", "East", 51.00001, 1.0)],
      new Map([
        ["north", NORTH],
        ["east", EAST],
      ]),
    );
    expect(names(matched)).toEqual({ north: "North", east: "East" });
  });

  it("gives two swapped rows back to the gauges they describe", () => {
    const matched = matchMetadata(
      [
        row("north", "South", SOUTH.lat, SOUTH.lon),
        row("south", "North", NORTH.lat, NORTH.lon),
        row("east", "East", EAST.lat, EAST.lon),
      ],
      new Map([
        ["north", NORTH],
        ["south", SOUTH],
        ["east", EAST],
      ]),
    );
    expect(names(matched)).toEqual({
      north: "North",
      south: "South",
      east: "East",
    });
  });

  it("does not take a correctly filed row at the same position", () => {
    // A relay of the north gauge under its own key, as CMEMS relays the CCO
    // gauges, sits at the north position too but belongs to its own key.
    const matched = matchMetadata(
      [
        row("north", "South", SOUTH.lat, SOUTH.lon),
        row("south", "North", NORTH.lat, NORTH.lon),
        row("north_relay", "NorthTG", NORTH.lat, NORTH.lon),
      ],
      new Map([
        ["north", NORTH],
        ["south", SOUTH],
        ["north_relay", NORTH],
      ]),
    );
    expect(names(matched)).toEqual({
      north: "North",
      south: "South",
      north_relay: "NorthTG",
    });
  });

  it("keeps a row whose coordinates don't parse", () => {
    const matched = matchMetadata(
      [row("north", "North", "smhi@smhi.se", "")],
      new Map([["north", NORTH]]),
    );
    expect(names(matched)).toEqual({ north: "North" });
  });

  it("throws when no misfiled row sits at a gauge's position", () => {
    expect(() =>
      matchMetadata(
        [row("north", "South", SOUTH.lat, SOUTH.lon)],
        new Map([["north", NORTH]]),
      ),
    ).toThrow(/north: meta.csv row "South" is .* km from the gauge/);
  });

  it("throws when two misfiled rows sit at a gauge's position", () => {
    expect(() =>
      matchMetadata(
        [
          row("north", "East", EAST.lat, EAST.lon),
          row("south", "North", NORTH.lat, NORTH.lon),
          row("east", "North again", NORTH.lat, NORTH.lon),
        ],
        new Map([
          ["north", NORTH],
          ["south", SOUTH],
          ["east", EAST],
        ]),
      ),
    ).toThrow(/2 misfiled rows sit at its position/);
  });

  it("throws when the one misfiled row at a gauge's position is already taken", () => {
    expect(() =>
      matchMetadata(
        [
          row("north", "South", SOUTH.lat, SOUTH.lon),
          row("north_twin", "East", EAST.lat, EAST.lon),
          row("south", "North", NORTH.lat, NORTH.lon),
        ],
        new Map([
          ["north", NORTH],
          ["north_twin", NORTH],
          ["south", SOUTH],
        ]),
      ),
    ).toThrow(
      'north_twin: the misfiled meta.csv row "North" at its position is already taken by north',
    );
  });
});

describe("correctPosition", () => {
  const AMMASSALIK = "ammassalik-297a-dnk-uhslc_rq";

  it("keeps TICON's position for a gauge with no correction", () => {
    expect(correctPosition("north", NORTH)).toBe(NORTH);
  });

  it("moves a corrected gauge to UHSLC's position", () => {
    expect(correctPosition(AMMASSALIK, { lat: 65.6, lon: -37 })).toEqual({
      lat: 65.615,
      lon: -37.625,
    });
  });

  it("throws when TICON moves a corrected gauge", () => {
    expect(() =>
      correctPosition(AMMASSALIK, { lat: 65.61, lon: -37.6 }),
    ).toThrow(
      `${AMMASSALIK}: TICON now places the gauge at 65.61, -37.6, not 65.6, -37`,
    );
  });

  it("takes each correction from UHSLC's metadata for the same series", () => {
    const uhslc: Record<string, { latitude: number; longitude: number }> =
      JSON.parse(
        readFileSync(
          new URL("../uhslc-metadata.json", import.meta.url),
          "utf8",
        ),
      );
    for (const [id, { corrected }] of Object.entries(POSITION_CORRECTIONS)) {
      const series = id.match(/-(\d+[a-z])-[a-z]{3}-uhslc_rq$/)?.[1];
      const station = uhslc[series!.toUpperCase()];
      // A refresh of uhslc-metadata.json that moves one of these lands here:
      // check the new position against the station list its comment cites.
      const message = `${id}: UHSLC's position differs from POSITION_CORRECTIONS in meta.ts`;
      expect(station, message).toBeDefined();
      expect(corrected, message).toEqual({
        lat: station!.latitude,
        lon: station!.longitude,
      });
    }
  });
});

describe("checkCorrections", () => {
  const published = new Map(
    Object.entries(POSITION_CORRECTIONS).map(([id, c]) => [id, c.published]),
  );

  it("passes when TICON publishes every corrected gauge where expected", () => {
    expect(() => checkCorrections(published)).not.toThrow();
  });

  it("throws when TICON no longer publishes a corrected gauge", () => {
    const renamed = new Map(published);
    renamed.delete("macae-719a-bra-uhslc_rq");
    expect(() => checkCorrections(renamed)).toThrow(
      "macae-719a-bra-uhslc_rq: TICON no longer publishes this gauge",
    );
  });

  it("throws when TICON moves a corrected gauge", () => {
    const moved = new Map(published);
    moved.set("alotau-069a-png-uhslc_rq", { lat: -10.3, lon: 150.45 });
    expect(() => checkCorrections(moved)).toThrow(
      "alotau-069a-png-uhslc_rq: TICON now places the gauge at -10.3, 150.45",
    );
  });
});
