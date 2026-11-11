import { describe, expect, test } from "vitest";
import type { StationQuality } from "@slackwater/database";
import {
  planMerges,
  selectMerges,
  SEPARATE_TWINS,
  separatedTwins,
  staleSeparations,
  type MergeGroup,
} from "../merges.ts";
import type { ResolvedStation } from "../metadata.ts";

const NOAA = "US National Oceanic and Atmospheric Administration";
const station = (
  id: string,
  latitude: number,
  m2: number,
  name = "Bermuda",
): ResolvedStation =>
  ({
    id,
    name,
    latitude,
    longitude: -64.7,
    type: "reference",
    source: {
      name: id.startsWith("noaa/") ? NOAA : "TICON-4",
      id: id.split("/")[1],
    },
    harmonic_constituents: [{ name: "M2", amplitude: m2, phase: 0 }],
  }) as ResolvedStation;
const accepted = (id: string, score = 50): StationQuality =>
  ({ id, accepted: true, score }) as StationQuality;
const duplicate = (id: string, redundant: string): StationQuality =>
  ({
    id,
    accepted: false,
    score: 0,
    reason: "duplicate",
    redundant,
  }) as StationQuality;

// St George's and Ferry Reach are two NOAA gauges 0.75 km apart. Quality pairs
// the Ferry Reach relay with St George's; its own id names Ferry Reach.
const stations = [
  station("noaa/2695540", 32.3734, 0.367),
  station("noaa/2695535", 32.3666, 0.355),
  station("ticon/bermuda-259-gbr-uhslc_fd", 32.3735, 0.366),
  station("ticon/ferry_reach-2695535-usa-noaa", 32.3734, 0.365),
];
const routes = {
  tide: [
    { slug: "st-georges-island", station_ids: ["noaa/2695540"] },
    { slug: "ferry-reach", station_ids: ["noaa/2695535"] },
    { slug: "bermuda", station_ids: ["ticon/bermuda-259-gbr-uhslc_fd"] },
    {
      slug: "ferry-reach-ticon",
      station_ids: ["ticon/ferry_reach-2695535-usa-noaa"],
    },
  ],
  current: [],
};
const quality = new Map(
  [
    accepted("noaa/2695540"),
    accepted("noaa/2695535"),
    duplicate("ticon/bermuda-259-gbr-uhslc_fd", "noaa/2695540"),
    duplicate("ticon/ferry_reach-2695535-usa-noaa", "noaa/2695540"),
  ].map((q) => [q.id, q]),
);

describe("planMerges", () => {
  const plan = planMerges(stations, routes, quality);

  test("keeps the published slug that names the authoritative primary", () => {
    const group = plan.groups.find(({ primary }) => primary === "noaa/2695540");
    expect(group?.survivor).toBe("bermuda");
    expect(group?.slugs).toEqual(["bermuda", "st-georges-island"]);
  });

  test("the surviving URL names the primary record, not the shortest slug", () => {
    const named = [
      station("noaa/9461380", 51.86, 0.3, "Sweeper Cove"),
      station("ticon/adak-040-usa-uhslc_fd", 51.86, 0.3, "Adak"),
    ];
    const plan = planMerges(
      named,
      {
        tide: [
          { slug: "sweeper-cove", station_ids: ["noaa/9461380"] },
          { slug: "adak", station_ids: ["ticon/adak-040-usa-uhslc_fd"] },
        ],
        current: [],
      },
      new Map([
        ["noaa/9461380", accepted("noaa/9461380")],
        [
          "ticon/adak-040-usa-uhslc_fd",
          duplicate("ticon/adak-040-usa-uhslc_fd", "noaa/9461380"),
        ],
      ]),
    );
    expect(plan.groups[0]?.slugs).toEqual(["sweeper-cove", "adak"]);
  });

  test("joins a relay superseded by its operator's record", () => {
    // UHSLC's fast-delivery Ny-Ålesund declares nothing itself; quality
    // supersedes it through its research-quality sibling.
    const plan = planMerges(
      [
        station("kartverket/NYA", 78.93, 0.457, "Ny-Ålesund"),
        station("ticon/nylesund-823-nor-uhslc_fd", 78.93, 0.457, "Nylesund"),
      ],
      {
        tide: [
          { slug: "ny-alesund", station_ids: ["kartverket/NYA"] },
          {
            slug: "nylesund",
            station_ids: ["ticon/nylesund-823-nor-uhslc_fd"],
          },
        ],
        current: [],
      },
      new Map<string, StationQuality>([
        ["kartverket/NYA", accepted("kartverket/NYA")],
        [
          "ticon/nylesund-823-nor-uhslc_fd",
          {
            ...duplicate("ticon/nylesund-823-nor-uhslc_fd", "kartverket/NYA"),
            reason: "superseded",
            issues: ["Superseded by kartverket/NYA, its operator's own record"],
          },
        ],
      ]),
    );
    expect(plan.groups[0]?.slugs).toEqual(["ny-alesund", "nylesund"]);
    expect(
      plan.groups[0]?.members.find(({ id }) => id.startsWith("ticon/"))
        ?.evidence,
    ).toBe("provenance");
  });

  test("the shortest slug naming the primary wins", () => {
    const records = [
      station("noaa/8575512", 38.98, 0.13, "Annapolis US Naval Academy"),
      station("ticon/annapolis-8575512-usa-noaa", 38.98, 0.13, "Annapolis"),
    ];
    const plan = planMerges(
      records,
      {
        tide: [
          { slug: "annapolis-us-naval-academy", station_ids: [records[0]!.id] },
          { slug: "annapolis", station_ids: [records[1]!.id] },
        ],
        current: [],
      },
      new Map([[records[0]!.id, accepted(records[0]!.id)]]),
    );
    expect(plan.groups[0]?.slugs).toEqual([
      "annapolis",
      "annapolis-us-naval-academy",
    ]);
  });

  test("a superseded relay pointed past its operator is not provenance", () => {
    // noaa/8735180 lost to its Hydro gauge, so quality points the relay there.
    const records = [
      station("noaa/8735181", 30.25, 0.3, "Dauphin Island Hydro"),
      station("ticon/dauphin_island_al-763-usa-uhslc_fd", 30.25, 0.3),
    ];
    const plan = planMerges(
      records,
      {
        tide: records.map(({ id }) => ({
          slug: id.split("/")[1]!,
          station_ids: [id],
        })),
        current: [],
      },
      new Map<string, StationQuality>([
        ["noaa/8735181", accepted("noaa/8735181")],
        [
          records[1]!.id,
          {
            ...duplicate(records[1]!.id, "noaa/8735181"),
            reason: "superseded",
            issues: ["Superseded by noaa/8735180, its operator's own record"],
          },
        ],
      ]),
      { confident: true },
    );
    expect(plan.groups).toEqual([]);
  });

  test("a member's redirect can be the surviving slug", () => {
    const records = [
      station("noaa/8536110", 38.97, 0.7, "Cape May"),
      station("ticon/cape_may-8536110-usa-noaa", 38.97, 0.7, "Cape May"),
    ];
    const plan = planMerges(
      records,
      {
        tide: [
          {
            slug: "cape-may-ferry-terminal",
            station_ids: [records[0]!.id],
            former_paths: ["/tides/us/nj/cape-may/"],
          },
          { slug: "cape-may-nj-nj", station_ids: [records[1]!.id] },
        ],
        current: [],
      },
      new Map([[records[0]!.id, accepted(records[0]!.id)]]),
    );
    expect(plan.groups[0]?.survivor).toBe("cape-may");
    // The primary's own station file carries the merged station.
    expect(plan.groups[0]?.slugs[0]).toBe("cape-may-ferry-terminal");
  });

  test("records sharing a gauge code whose M2 disagree wait for review", () => {
    const records = [
      station("ticon/fanning-012a-kir-uhslc_rq", 3.9, 0.244, "Fanning"),
      station("ticon/fanning-012b-kir-uhslc_rq", 3.9, 0.125, "Fanning"),
    ];
    const routes = {
      tide: records.map(({ id }) => ({
        slug: id.split("/")[1]!,
        station_ids: [id],
      })),
      current: [],
    };
    const quality = new Map([
      [records[0]!.id, accepted(records[0]!.id)],
      [records[1]!.id, duplicate(records[1]!.id, records[0]!.id)],
    ]);
    expect(
      planMerges(records, routes, quality, { confident: true }).groups,
    ).toEqual([]);
    expect(planMerges(records, routes, quality).groups).toHaveLength(1);
  });

  test("without its name, the URL is the primary's own slug unless that ends in an id", () => {
    const pair = (primary: string, relay: string) =>
      planMerges(
        [
          station("linz/030", -45.8, 0.8, "Port Chalmers"),
          station(
            "ticon/port_chalmers-669a-nzl-uhslc_rq",
            -45.8,
            0.8,
            "Port Chalmers",
          ),
        ],
        {
          tide: [
            { slug: primary, station_ids: ["linz/030"] },
            {
              slug: relay,
              station_ids: ["ticon/port_chalmers-669a-nzl-uhslc_rq"],
            },
          ],
          current: [],
        },
        new Map([
          ["linz/030", accepted("linz/030")],
          [
            "ticon/port_chalmers-669a-nzl-uhslc_rq",
            duplicate("ticon/port_chalmers-669a-nzl-uhslc_rq", "linz/030"),
          ],
        ]),
      ).groups[0]?.survivor;
    expect(pair("port-chalmers-otago", "port-chalmers-dunedin")).toBe(
      "port-chalmers-otago",
    );
    expect(pair("port-chalmers-linz-030", "port-chalmers-otago")).toBe(
      "port-chalmers-otago",
    );
  });

  test("a declared originator outranks an inferred duplicate", () => {
    const group = plan.groups.find(({ primary }) => primary === "noaa/2695535");
    expect(group?.slugs).toEqual(["ferry-reach", "ferry-reach-ticon"]);
    expect(
      group?.members.find(({ id }) => id.includes("ferry_reach"))?.evidence,
    ).toBe("provenance");
  });

  // LINZ's 073 is Tauranga, but a three-digit number has no namespace.
  test("refuses an ambiguous UHSLC originator whose M2 disagrees", () => {
    const far = [
      station("linz/073", -37.65, 0.7),
      station("ticon/tauranga-073a-nzl-uhslc_rq", -37.65, 0.4),
    ];
    const plan = planMerges(
      far,
      {
        tide: [
          { slug: "tauranga", station_ids: ["linz/073"] },
          {
            slug: "tauranga-bay",
            station_ids: ["ticon/tauranga-073a-nzl-uhslc_rq"],
          },
        ],
        current: [],
      },
      new Map([["linz/073", accepted("linz/073")]]),
    );
    expect(plan.refused).toEqual([
      {
        id: "ticon/tauranga-073a-nzl-uhslc_rq",
        target: "linz/073",
        reason: "M2 amplitudes differ",
      },
    ]);
  });

  test("trusts a NOAA number from NOAA despite M2", () => {
    const far = [
      station("noaa/2695535", 32.3666, 0.355),
      station("ticon/bermuda-259b-gbr-uhslc_rq", 32.3666, 0.2),
    ];
    const plan = planMerges(
      far,
      {
        tide: [
          { slug: "ferry-reach", station_ids: ["noaa/2695535"] },
          { slug: "bermuda", station_ids: ["ticon/bermuda-259b-gbr-uhslc_rq"] },
        ],
        current: [],
      },
      new Map([["noaa/2695535", accepted("noaa/2695535")]]),
    );
    expect(plan.refused).toEqual([]);
    expect(plan.groups).toHaveLength(1);
  });

  // TICON's Wilmington relay reads M2 0.577 m against NOAA's 0.651 m: the
  // same gauge over different years.
  test("trusts an originator named in the relay's own id despite M2", () => {
    const far = [...stations];
    far[3] = station("ticon/ferry_reach-2695535-usa-noaa", 32.3734, 0.2);
    const plan = planMerges(far, routes, quality);
    expect(plan.refused.map(({ reason }) => reason)).not.toContain(
      "M2 amplitudes differ",
    );
    expect(
      plan.groups.find(({ primary }) => primary === "noaa/2695535")?.slugs,
    ).toEqual(["ferry-reach", "ferry-reach-ticon"]);
    // Farther off, the id may name a renumbered gauge, so M2 decides.
    far[3] = station("ticon/ferry_reach-2695535-usa-noaa", 32.3966, 0.2);
    expect(planMerges(far, routes, quality).refused).toContainEqual({
      id: "ticon/ferry_reach-2695535-usa-noaa",
      target: "noaa/2695535",
      reason: "M2 amplitudes differ",
    });
  });

  test("records sharing a gauge code join each other past an outlier", () => {
    const records = [
      station("ticon/st_helena-292-shn-uhslc_fd", -15.97, 0.3),
      station("ticon/st_helena-292a-shn-uhslc_rq", -15.92, 0.3),
      station("ticon/st_helena-292b-shn-uhslc_rq", -15.92, 0.3),
    ];
    const plan = planMerges(
      records,
      {
        tide: records.map(({ id }) => ({
          slug: id.split("/")[1]!,
          station_ids: [id],
        })),
        current: [],
      },
      new Map(records.map(({ id }) => [id, accepted(id)])),
      { confident: true },
    );
    expect(
      plan.groups.map(({ members }) => members.map(({ id }) => id)),
    ).toEqual([[records[1]!.id, records[2]!.id]]);
  });

  test("a gauge link outranks a proximity link to another authority", () => {
    const records = [
      station("noaa/1000001", 32.0, 0.3),
      station("noaa/1000002", 32.03, 0.3),
      station("ticon/x-100-usa-uhslc_fd", 32.0, 0.3),
      station("ticon/x-100a-usa-uhslc_rq", 32.03, 0.3),
    ];
    const plan = planMerges(
      records,
      {
        tide: [
          { slug: "a", station_ids: ["noaa/1000001"] },
          { slug: "b", station_ids: ["noaa/1000002", records[3]!.id] },
          { slug: "x", station_ids: [records[2]!.id] },
        ],
        current: [],
      },
      // The proximity link comes first; the gauge link must still win.
      new Map([
        [records[2]!.id, duplicate(records[2]!.id, "noaa/1000001")],
        [records[3]!.id, duplicate(records[3]!.id, records[2]!.id)],
      ]),
    );
    expect(plan.refused.map(({ id }) => id)).toEqual([records[2]!.id]);
  });

  test("refuses a link that would join two authoritative records", () => {
    // One route holding both relays would join St George's and Ferry Reach.
    const shared = {
      tide: [
        routes.tide[0]!,
        routes.tide[1]!,
        {
          slug: "bermuda",
          station_ids: [
            "ticon/bermuda-259-gbr-uhslc_fd",
            "ticon/ferry_reach-2695535-usa-noaa",
          ],
        },
      ],
      current: [],
    };
    const plan = planMerges(stations, shared, quality);
    expect(plan.groups.map(({ slugs }) => slugs)).toEqual([
      ["bermuda", "ferry-reach"],
    ]);
    expect(plan.refused).toEqual([
      {
        id: "ticon/bermuda-259-gbr-uhslc_fd",
        target: "noaa/2695540",
        reason: "would join noaa/2695535 and noaa/2695540",
      },
    ]);
  });

  // Quality rejecting one of two NOAA station numbers as a duplicate does not
  // make them one gauge.
  test("leaves two authoritative records unmerged even when one is rejected", () => {
    const pair = [
      station("noaa/8735180", 30.25, 0.3, "Dauphin Island"),
      station("noaa/8735181", 30.25, 0.3, "Dauphin Island Hydro"),
    ];
    const plan = planMerges(
      pair,
      {
        tide: [
          { slug: "dauphin-island", station_ids: ["noaa/8735180"] },
          { slug: "dauphin-island-hydro", station_ids: ["noaa/8735181"] },
        ],
        current: [],
      },
      new Map([
        ["noaa/8735181", accepted("noaa/8735181")],
        ["noaa/8735180", duplicate("noaa/8735180", "noaa/8735181")],
      ]),
    );
    expect(plan.groups).toEqual([]);
    expect(plan.refused).toHaveLength(1);
  });

  test("a confident plan leaves proximity and far-flung gauge codes for review", () => {
    const records = [
      station("ticon/port_stanley-290-gbr-uhslc_fd", -51.75, 0.5, "Stanley"),
      // A gauge code shared 105 km away is a bad position, not a move.
      station("ticon/port_stanley-290a-gbr-uhslc_rq", -50.8, 0.5, "Stanley"),
      station("ticon/port_stanley-290b-gbr-uhslc_rq", -51.751, 0.5, "Stanley"),
      station("ticon/stanley-stan-gbr-cmems", -51.752, 0.5, "Stanley"),
    ];
    const routes = {
      tide: records.map(({ id }) => ({
        slug: id.split("/")[1]!,
        station_ids: [id],
      })),
      current: [],
    };
    const quality = new Map([
      [records[0]!.id, accepted(records[0]!.id)],
      ...records
        .slice(1)
        .map(({ id }) => [id, duplicate(id, records[0]!.id)] as const),
    ]);
    const slugs = (confident: boolean) =>
      planMerges(records, routes, quality, { confident }).groups.map(
        ({ members }) => members.map(({ id }) => id).sort(),
      );
    expect(slugs(true)).toEqual([[records[0]!.id, records[2]!.id]]);
    expect(slugs(false)[0]).toHaveLength(4);
    const evidence = planMerges(records, routes, quality).groups[0]!.members;
    expect(evidence.find(({ id }) => id.includes("cmems"))?.evidence).toBe(
      "proximity",
    );
    expect(evidence.find(({ id }) => id.includes("290b"))?.evidence).toBe(
      "gauge",
    );
  });
});

describe("CMEMS copies", () => {
  const plan = (copy: ResolvedStation) => {
    const records = [
      station("ticon/bodo-boo-nor-nhs", 67.288, 0.85, "Bodø"),
      copy,
    ];
    return planMerges(
      records,
      {
        tide: records.map(({ id }) => ({
          slug: id.split("/")[1]!,
          station_ids: [id],
        })),
        current: [],
      },
      new Map([[records[0]!.id, accepted(records[0]!.id)]]),
      { confident: true },
    ).groups;
  };

  test("a CMEMS record joins the record of the same name it sits on", () => {
    const groups = plan(
      station("ticon/bodoetg-bod-nor-cmems", 67.2882, 0.85, "Bodo"),
    );
    expect(
      groups[0]?.members.find(({ id }) => id.endsWith("cmems")),
    ).toMatchObject({
      evidence: "copy",
    });
  });

  test("a different name, a distance or a contradicting M2 keeps it apart", () => {
    expect(
      plan(station("ticon/bodoetg-bod-nor-cmems", 67.288, 0.85, "Bodo Havn")),
    ).toEqual([]);
    expect(
      plan(station("ticon/bodoetg-bod-nor-cmems", 67.289, 0.85, "Bodo")),
    ).toEqual([]);
    expect(
      plan(station("ticon/bodoetg-bod-nor-cmems", 67.288, 0.4, "Bodo")),
    ).toEqual([]);
  });
});

describe("CMEMS copy edge cases", () => {
  const run = (records: ResolvedStation[]) =>
    planMerges(
      records,
      {
        tide: records.map(({ id }) => ({
          slug: id.split("/")[1]!,
          station_ids: [id],
        })),
        current: [],
      },
      new Map(records.map(({ id }) => [id, accepted(id)])),
      { confident: true },
    );

  test("two CMEMS records never join each other", () => {
    expect(
      run([
        station("ticon/bodoetg-bod-nor-cmems", 67.288, 0.85, "Bodo"),
        station("ticon/bodoetg2-bod-nor-cmems", 67.288, 0.85, "Bodo"),
      ]).groups,
    ).toEqual([]);
  });

  test("two records of its name nearby leave the choice to a person", () => {
    expect(
      run([
        station("ticon/goteborg-got-swe-cmems", 57.7, 0.15, "Goteborg"),
        station("ticon/goteborg-2111-swe-smhi", 57.7, 0.15, "Göteborg"),
        station("ticon/goteborg-2130-swe-smhi", 57.7001, 0.15, "Göteborg"),
      ]).groups,
    ).toEqual([]);
  });

  test("a copy whose M2 disagrees is listed as refused", () => {
    expect(
      run([
        station("ticon/uddevalla-udd-swe-cmems", 58.35, 0.141, "Uddevalla"),
        station("ticon/uddevalla-2541-swe-smhi", 58.35, 0.008, "Uddevalla"),
      ]).refused,
    ).toEqual([
      {
        id: "ticon/uddevalla-udd-swe-cmems",
        target: "ticon/uddevalla-2541-swe-smhi",
        reason: "M2 differs",
      },
    ]);
  });

  test("matches the spellings CMEMS uses and keeps numbers apart", () => {
    const pair = (copyName: string, name: string) =>
      run([
        station("ticon/x-x-nor-cmems", 60, 0.5, copyName),
        station("ticon/x-1-nor-nhs", 60, 0.5, name),
      ]).groups.length;
    expect(pair("Bodoe", "Bodø")).toBe(1);
    expect(pair("Goteborg", "Göteborg")).toBe(1);
    expect(pair("Buesum", "Büsum")).toBe(1);
    expect(pair("Galway Port 2", "Galway Port")).toBe(0);
  });

  test("a gauge code does not rejoin a pair whose M2 phase disagrees", () => {
    const phased = (id: string, phase: number) => ({
      ...station(id, 54.8, 0.5, "Wladyslawowo"),
      harmonic_constituents: [{ name: "M2", amplitude: 0.5, phase }],
    });
    // The two share the code wla-pol, 0 km apart, 56 minutes out of phase.
    expect(
      run([
        phased("ticon/wladyslawowo-wla-pol-cmems", 30),
        phased("ticon/wladyslawowo-wla-pol-eseas", 2),
      ]).groups,
    ).toEqual([]);
  });

  test("a copy needs an M2 on both sides to compare", () => {
    const bare = {
      ...station("ticon/x-1-nor-nhs", 60, 0.5, "Bodø"),
      harmonic_constituents: [],
    };
    expect(
      run([station("ticon/x-x-nor-cmems", 60, 0.5, "Bodoe"), bare]).refused.map(
        ({ reason }) => reason,
      ),
    ).toEqual(["no M2 to compare"]);
  });

  test("a copy whose M2 phase disagrees is refused", () => {
    // Tenerife's CMEMS record leads da_mm's by 36°, about 75 minutes.
    const phased = (id: string, phase: number) => ({
      ...station(id, 28.48, 0.7, "Tenerife"),
      harmonic_constituents: [{ name: "M2", amplitude: 0.7, phase }],
    });
    expect(
      run([
        phased("ticon/tenerifetg-ten-esp-cmems", 29.2),
        phased("ticon/tenerife-ten-esp-da_mm", 352.8),
      ]).refused.map(({ reason }) => reason),
    ).toEqual(["M2 differs"]);
  });

  test("two records of its name that are one station are one choice", () => {
    const records = [
      station("ticon/bergentg-ber-nor-cmems", 60.4, 0.5, "Bergen"),
      station("ticon/bergen-bgo-nor-nhs", 60.4, 0.5, "Bergen"),
      station("ticon/bergen2-bgo-nor-nhs", 60.4, 0.5, "Bergen"),
    ];
    const plan = planMerges(
      records,
      {
        tide: [
          { slug: "bergen", station_ids: [records[1]!.id, records[2]!.id] },
          { slug: "bergen-cmems", station_ids: [records[0]!.id] },
        ],
        current: [],
      },
      new Map(records.map(({ id }) => [id, accepted(id)])),
      { confident: true },
    );
    expect(plan.groups[0]?.slugs).toEqual(["bergen", "bergen-cmems"]);
  });

  test("joins up to 50 m and no farther", () => {
    // 0.0004° of latitude is about 44 m; 0.0005° about 56 m.
    const near = run([
      station("ticon/bodo-boo-nor-nhs", 67.288, 0.85, "Bodø"),
      station("ticon/bodoetg-bod-nor-cmems", 67.2884, 0.85, "Bodo"),
    ]);
    const far = run([
      station("ticon/bodo-boo-nor-nhs", 67.288, 0.85, "Bodø"),
      station("ticon/bodoetg-bod-nor-cmems", 67.2885, 0.85, "Bodo"),
    ]);
    expect(near.groups).toHaveLength(1);
    expect(far.groups).toEqual([]);
  });
});

describe("selectMerges", () => {
  const group = (survivor: string, ...rest: string[]): MergeGroup => ({
    survivor,
    primary: `noaa/${survivor}`,
    authoritative: true,
    slugs: [survivor, ...rest],
    members: [],
  });

  test("a named review group replaces the confident group within it", () => {
    const picked = group("a", "b", "c");
    expect(
      selectMerges([group("a", "b"), group("x", "y")], [picked], ["a", "a"]),
    ).toEqual([group("x", "y"), picked]);
  });

  test("refuses a station in two merges", () => {
    // The confident plan joined b and d; the review group holds only b.
    expect(() =>
      selectMerges([group("b", "d")], [group("a", "b")], ["a"]),
    ).toThrow(/b is in the merges into b and a/);
  });

  test("refuses a name that is no review group", () => {
    expect(() => selectMerges([], [], ["--dry-run"])).toThrow(
      /no review group/,
    );
  });
});

describe("curated records and their provider twins", () => {
  const CHS = "Canadian Hydrographic Service";
  // A CHS record carries identity only: a name and a position, no harmonics.
  const curated = (
    id: string,
    latitude: number,
    name: string,
    longitude = -124.93,
  ): ResolvedStation =>
    ({
      id,
      name,
      latitude,
      longitude,
      type: "reference",
      source: { name: CHS, id },
      harmonic_constituents: [],
    }) as unknown as ResolvedStation;
  const relay = (id: string, latitude: number, name: string, m2 = 0.9) => ({
    ...station(id, latitude, m2, name),
    longitude: -124.93,
  });
  const run = (
    records: ResolvedStation[],
    confident: boolean,
    slugs: Record<string, string[]> = Object.fromEntries(
      records.map(({ id }) => [id.replace(/^\w+\//, ""), [id]]),
    ),
    separate = new Map<string, string>(),
  ) =>
    planMerges(
      records,
      {
        tide: Object.entries(slugs).map(([slug, station_ids]) => ({
          slug,
          station_ids,
        })),
        current: [],
      },
      new Map(
        records
          .filter(({ id }) => !id.startsWith("chs-"))
          .map(({ id }) => [id, accepted(id)]),
      ),
      { confident, separate },
    );
  // 0.0013° of latitude is about 145 m, 0.009° about 1 km.
  const comox = curated("chs-comox", 49.67, "Comox");
  const twin = relay("ticon/comox_bc-7965-can-meds", 49.6713, "Comox");

  test("a curated record joins the one provider station of its name within 1 km", () => {
    const plan = run([comox, twin], true, {
      comox: ["chs-comox"],
      "comox-bc": [twin.id],
    });
    expect(plan.groups).toHaveLength(1);
    const [group] = plan.groups;
    // The curated record's slug survives and its station file carries both.
    expect(group?.survivor).toBe("comox");
    expect(group?.slugs).toEqual(["comox", "comox-bc"]);
    expect(group?.curated).toBe("chs-comox");
    // The provider record stays, because it carries the harmonics.
    expect(group?.primary).toBe(twin.id);
    expect(group?.members.find(({ id }) => id === twin.id)).toMatchObject({
      evidence: "curated",
      target: "chs-comox",
    });
  });

  test("the curated slug wins over a shorter provider slug", () => {
    const seal = curated("chs-seal-cove-3", 54.3, "Seal Cove");
    const plan = run(
      [seal, relay("ticon/seal_cove_bc-9360-can-meds", 54.301, "Seal Cove")],
      true,
      {
        "seal-cove-prince-rupert-bc": ["chs-seal-cove-3"],
        "seal-cove-bc": ["ticon/seal_cove_bc-9360-can-meds"],
      },
    );
    expect(plan.groups[0]?.survivor).toBe("seal-cove-prince-rupert-bc");
    expect(plan.groups[0]?.slugs[0]).toBe("seal-cove-prince-rupert-bc");
  });

  test("a provider's province suffix and punctuation do not hide the name", () => {
    const plan = run(
      [
        curated("chs-woodward-s-landing", 49.12, "Woodward's Landing"),
        relay(
          "ticon/woodwards_landing_bc-7610-can-meds",
          49.121,
          "Woodwards Landing BC",
        ),
        curated("chs-la-grande-riviere", 48.4, "La Grande Rivière"),
        relay(
          "ticon/la_grande_rivierepq-64680-can-meds",
          48.4,
          "La Grande Riviere Pq",
        ),
      ],
      true,
    );
    expect(plan.groups).toHaveLength(2);
  });

  test("another name or more than 1 km leaves a pair to a person", () => {
    const named = run(
      [
        curated("chs-lax-kw-alaams", 54.56, "Lax Kw'alaams"),
        relay("ticon/port_simpson_bc-9390-can-meds", 54.5606, "Port Simpson"),
      ],
      false,
    );
    expect(named.groups).toEqual([]);
    const far = [
      curated("chs-nain", 56.54, "Nain"),
      relay("ticon/nain-833-can-uhslc_fd", 56.55, "Nain"),
    ];
    expect(run(far, true).groups).toEqual([]);
    expect(run(far, false).groups).toHaveLength(1);
    // Past 5 km a shared name is a namesake, not a review.
    const namesake = [
      curated("chs-mill-cove", 49.12, "Mill Cove"),
      relay("ticon/mill_cove-475-can-uhslc_fd", 49.2, "Mill Cove"),
    ];
    expect(run(namesake, false).groups).toEqual([]);
  });

  test("a MEDS record of its name joins within 25 km, since MEDS numbers the gauge as CHS does", () => {
    // MEDS puts Sand Heads 7594 8.1 km from the position IWLS publishes.
    const sandHeads = curated("chs-sand-heads", 49.1052, "Sand Heads");
    const meds = {
      ...relay("ticon/sand_heads_bc-7594-can-meds", 49.13, "Sand Heads BC"),
      longitude: -124.82,
    };
    const plan = run([sandHeads, meds], true, {
      "sand-heads": [sandHeads.id],
      "sand-heads-bc": [meds.id],
    });
    expect(plan.groups.map(({ survivor, slugs }) => [survivor, slugs])).toEqual(
      [["sand-heads", ["sand-heads", "sand-heads-bc"]]],
    );
    // Past 25 km a shared name is a namesake, or a mis-keyed number.
    const namesake = [
      curated("chs-mill-cove", 49.12, "Mill Cove"),
      relay("ticon/mill_cove-475-can-meds", 49.4, "Mill Cove"),
    ];
    expect(run(namesake, false).groups).toEqual([]);
  });

  test("a MEDS record far off waits for a person when another provider station shares the name", () => {
    const records = [
      curated("chs-forteau-bay", 51.47, "Forteau Bay"),
      relay("ticon/forteau_bay-2590-can-meds", 51.52, "Forteau Bay"),
      relay("ticon/forteau_bay-999-can-uhslc_fd", 51.471, "Forteau Bay"),
    ];
    expect(run(records, true).groups).toEqual([]);
    expect(run(records, false).groups[0]?.members).toHaveLength(3);
  });

  test("never joins a pair listed as separate, in either plan", () => {
    const bamfield = curated("chs-bamfield", 48.836, "Bamfield");
    const uhslc = relay("ticon/bamfield-541-can-uhslc_fd", 48.8395, "Bamfield");
    const separate = new Map([[`${bamfield.id} ${uhslc.id}`, "two gauges"]]);
    for (const confident of [true, false])
      expect(
        run([bamfield, uhslc], confident, undefined, separate).groups,
      ).toEqual([]);
  });

  test("honours SEPARATE_TWINS by default, so naming one review group merges no listed pair", () => {
    const [pair] = [...SEPARATE_TWINS.keys()];
    const [chs, other] = pair!.split(" ") as [string, string];
    const records = [
      curated(chs, 48.836, "Twin"),
      relay(other, 48.8395, "Twin"),
    ];
    const plan = planMerges(
      records,
      {
        tide: records.map(({ id }) => ({ slug: id, station_ids: [id] })),
        current: [],
      },
      new Map([[other, accepted(other)]]),
      { confident: true },
    );
    expect(plan.groups).toEqual([]);
  });

  test("two provider stations of its name leave the choice to a person", () => {
    const records = [
      curated("chs-bamfield", 48.836, "Bamfield"),
      relay("ticon/bamfield-541-can-uhslc_fd", 48.8395, "Bamfield"),
      relay("ticon/bamfield_bc-8545-can-meds", 48.8312, "Bamfield"),
    ];
    expect(run(records, true).groups).toEqual([]);
    expect(run(records, false).groups[0]?.members).toHaveLength(3);
  });

  test("provider stations already one route are one twin", () => {
    const records = [
      curated("chs-halifax", 44.667, "Halifax"),
      relay("ticon/halifax-275-can-uhslc_fd", 44.6745, "Halifax"),
      relay("ticon/halifax-275a-can-uhslc_rq", 44.6745, "Halifax"),
    ];
    const plan = run(records, true, {
      halifax: ["chs-halifax"],
      "halifax-07": [records[1]!.id, records[2]!.id],
    });
    expect(plan.groups[0]?.slugs).toEqual(["halifax", "halifax-07"]);
  });

  test("never joins two curated records", () => {
    const records = [
      curated("chs-esquimalt-harbour", 48.43, "Esquimalt Harbour"),
      curated("chs-esquimalt-harbour-2", 48.4305, "Esquimalt Harbour"),
      relay(
        "ticon/esquimalt_harbour_bc-7109-can-meds",
        48.4302,
        "Esquimalt Harbour",
      ),
    ];
    expect(run(records, true).groups).toEqual([]);
    const review = run(records, false);
    expect(review.groups).toHaveLength(1);
    expect(
      review.groups[0]!.members.filter(({ id }) => id.startsWith("chs-")),
    ).toHaveLength(1);
    expect(review.refused.map(({ reason }) => reason)).toEqual([
      "would join chs-esquimalt-harbour and chs-esquimalt-harbour-2",
    ]);
  });

  test("a proximity link never joins two curated records either", () => {
    const records = [
      curated("chs-a", 48.43, "Alpha"),
      curated("chs-b", 48.44, "Bravo"),
      relay("ticon/alpha-1-can-meds", 48.43, "Alpha"),
      relay("ticon/bravo-2-can-meds", 48.44, "Bravo"),
    ];
    const plan = planMerges(
      records,
      {
        tide: [
          { slug: "alpha", station_ids: ["chs-a", records[2]!.id] },
          { slug: "bravo", station_ids: ["chs-b", records[3]!.id] },
        ],
        current: [],
      },
      new Map([
        [records[2]!.id, accepted(records[2]!.id)],
        [records[3]!.id, duplicate(records[3]!.id, records[2]!.id)],
      ]),
    );
    expect(plan.groups).toEqual([]);
  });
});

describe("separatedTwins", () => {
  const CHS = "Canadian Hydrographic Service";
  const record = (
    id: string,
    latitude: number,
    name: string,
    kind: "tide" | "current" = "tide",
  ) =>
    ({
      id,
      name,
      kind,
      latitude,
      longitude: -124.93,
      source: { name: id.startsWith("chs-") ? CHS : "TICON-4", id },
    }) as unknown as ResolvedStation;
  const comox = record("chs-comox", 49.67, "Comox");
  const twin = record("ticon/comox_bc-7965-can-meds", 49.6713, "Comox");

  test("names a curated record and a provider twin on separate routes", () => {
    expect(
      separatedTwins([comox, twin], {
        tide: [
          { slug: "comox", station_ids: [comox.id] },
          { slug: "comox-bc", station_ids: [twin.id] },
        ],
        current: [],
      }),
    ).toEqual([
      { curated: "chs-comox", twin: twin.id, km: 0.145, kind: "tide" },
    ]);
  });

  test("passes a pair on one route, another kind, another name, or farther than 1 km", () => {
    const routes = (...ids: string[][]) => ({
      tide: ids.map((station_ids, i) => ({ slug: `s${i}`, station_ids })),
      current: [],
    });
    expect(separatedTwins([comox, twin], routes([comox.id, twin.id]))).toEqual(
      [],
    );
    const current = record("ticon/comox-1-can-meds", 49.67, "Comox", "current");
    expect(
      separatedTwins([comox, current], {
        tide: [{ slug: "comox", station_ids: [comox.id] }],
        current: [{ slug: "comox", station_ids: [current.id] }],
      }),
    ).toEqual([]);
    const other = record("ticon/lazo-1-can-meds", 49.67, "Lazo");
    const far = record("ticon/comox-2-can-uhslc_fd", 49.68, "Comox");
    expect(
      separatedTwins(
        [comox, other, far],
        routes([comox.id], [other.id], [far.id]),
      ),
    ).toEqual([]);
  });

  test("names a MEDS record of its name up to 25 km off, and no other provider's past 1 km", () => {
    const sandHeads = record("chs-sand-heads", 49.1052, "Sand Heads");
    const meds = record(
      "ticon/sand_heads_bc-7594-can-meds",
      49.13,
      "Sand Heads BC",
    );
    const uhslc = record(
      "ticon/sand_heads-1-can-uhslc_fd",
      49.13,
      "Sand Heads",
    );
    const farMeds = record("ticon/sand_heads-2-can-meds", 49.4, "Sand Heads");
    expect(
      separatedTwins([sandHeads, meds, uhslc, farMeds], {
        tide: [sandHeads, meds, uhslc, farMeds].map(({ id }) => ({
          slug: id,
          station_ids: [id],
        })),
        current: [],
      }),
    ).toEqual([
      { curated: sandHeads.id, twin: meds.id, km: 2.758, kind: "tide" },
    ]);
  });

  test("two provider records of one name are not its concern", () => {
    const a = record("ticon/comox-1-can-meds", 49.67, "Comox");
    const b = record("ticon/comox-2-can-uhslc_fd", 49.67, "Comox");
    expect(
      separatedTwins([a, b], {
        tide: [
          { slug: "a", station_ids: [a.id] },
          { slug: "b", station_ids: [b.id] },
        ],
        current: [],
      }),
    ).toEqual([]);
  });
});

describe("staleSeparations", () => {
  test("lists each separate pair that shares a route or is no longer routed", () => {
    const separate = new Map([
      ["chs-a ticon/a-1-can-meds", "apart"],
      ["chs-b noaa/2", "apart"],
      ["chs-c ticon/c-3-can-meds", "apart"],
    ]);
    expect(
      staleSeparations(
        {
          tide: [
            { slug: "a", station_ids: ["chs-a"] },
            { slug: "a-1", station_ids: ["ticon/a-1-can-meds"] },
            { slug: "b", station_ids: ["chs-b", "noaa/2"] },
            { slug: "c", station_ids: ["chs-c"] },
          ],
          current: [],
        },
        separate,
      ),
    ).toEqual(["chs-b noaa/2", "chs-c ticon/c-3-can-meds"]);
  });
});

test("a lake fit joins the TICON record of the gauge it names, whatever their M2", () => {
  // Uddevalla: TICON's record has an M2 of 8 mm, the lake fit 141 mm.
  const ticon = station("ticon/uddevalla-2541-swe-smhi", 58.35, 0.008);
  const fit = {
    ...station("smhi/2541", 58.35, 0.141),
    source: {
      name: "Swedish Meteorological and Hydrological Institute",
      id: "2541",
      gauge: "uddevalla-2541-swe-smhi",
    },
  } as ResolvedStation;
  const plan = planMerges(
    [ticon, fit],
    {
      tide: [
        { slug: "uddevalla", station_ids: [ticon.id] },
        { slug: "uddevalla-smhi-2541", station_ids: [fit.id] },
      ],
      current: [],
    },
    new Map([
      [fit.id, accepted(fit.id)],
      [ticon.id, duplicate(ticon.id, fit.id)],
    ]),
    { confident: true },
  );
  expect(plan.groups).toHaveLength(1);
  expect(
    plan.groups[0]!.members.find(({ id }) => id === fit.id)?.evidence,
  ).toBe("provenance");
});
