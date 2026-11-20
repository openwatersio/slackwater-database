import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import type { ResolvedStation } from "../metadata.ts";
import {
  chsFitProblems,
  curatedRecords,
  mergeStationFiles,
  newlyRetired,
  pathsChangingHands,
  planStationFiles,
  publishedPaths,
  publishedPathsAt,
  readStationFiles,
  renderStationFile,
  storedQuality,
} from "../station-files.ts";

const everett = `# Port Gardner is what boaters call it.
name: Everett
region: US-WA
sources:
  - noaa/9447659
# Written by \`npm run stations\`. Do not edit.
computed:
  sources:
    noaa/9447659:
      position: [47.98, -122.223]
      coastline: clear
`;

function repo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "stations-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const station = (
  id: string,
  latitude: number,
  region_code = "US-WA",
): ResolvedStation =>
  ({
    id,
    name: "Everett",
    latitude,
    longitude: -122.223,
    country: "United States",
    country_code: "US",
    region_code,
  }) as ResolvedStation;

describe("station files", () => {
  test("rendering keeps curated fields and comments", async () => {
    expect(
      await renderStationFile(everett, {
        kind: "tide",
        country: "US",
        region: "US-WA",
        slug: "everett",
        sources: ["noaa/9447659"],
        retired_sources: [],
        redirect_from: [],
        computed: {
          "noaa/9447659": {
            position: [47.98, -122.223],
            coastline: "clear",
          },
        },
      }),
    ).toBe(everett);
  });

  test("a moved position, a dropped record and a new region all show", async () => {
    const root = repo({ "stations/tide/us/everett.yaml": everett });
    const files = readStationFiles(join(root, "stations"));
    expect(files).toMatchObject([
      { kind: "tide", country: "US", slug: "everett", name: "Everett" },
    ]);

    const unchanged = await planStationFiles(
      files,
      [station("noaa/9447659", 47.98)],
      {
        tide: [
          { slug: "everett", station_ids: ["noaa/9447659"], former_paths: [] },
        ],
        current: [],
      },
      root,
    );
    expect(unchanged).toEqual([]);

    const [moved] = await planStationFiles(
      files,
      [station("noaa/9447659", 47.99)],
      {
        tide: [
          { slug: "everett", station_ids: ["noaa/9447659"], former_paths: [] },
        ],
        current: [],
      },
      root,
    );
    expect(moved?.text).toContain("position: [47.99, -122.223]");

    const [retired] = await planStationFiles(
      files,
      [],
      { tide: [], current: [] },
      root,
    );
    expect(retired?.text).toMatch(
      /sources: \[\]\nretired_sources:\n {2}- noaa\/9447659/,
    );
    expect(retired?.text).toContain("name: Everett");
  });

  test("a record's quality evaluation reads back as it was written", async () => {
    const quality = {
      id: "noaa/9447659",
      accepted: false,
      score: 40,
      reason: "datum",
      factors: {
        epoch: 1,
        recency: 0.75,
        source: 1,
        quality: 1,
        amplitude: 1,
        coverage: 0.1,
      },
      issues: ["MLW (3.827) < LAT (3.831)"],
    };
    const text = await renderStationFile(everett, {
      kind: "tide",
      country: "US",
      region: "US-WA",
      slug: "everett",
      sources: ["noaa/9447659"],
      retired_sources: [],
      redirect_from: [],
      computed: {
        "noaa/9447659": {
          position: [47.98, -122.223],
          coastline: "clear",
          quality: {
            accepted: false,
            reason: "datum",
            score: 40,
            factors: quality.factors,
            issues: quality.issues,
          },
        },
      },
    });
    const root = repo({ "stations/tide/us/everett.yaml": text });
    expect(
      storedQuality(readStationFiles(join(root, "stations"))).get(
        "noaa/9447659",
      ),
    ).toEqual(quality);
  });

  test("reads the paths a git ref publishes, names in any script", () => {
    const root = repo({
      "stations/tide/us/everett.yaml": everett,
      "stations/tide/se/sodertalje.yaml":
        "# Södertälje\nname: Södertälje\nsources:\n  - smhi/1\nredirect_from:\n  - /tides/se/e4bron-sodertalje/\n",
      "stations/tide/us/retired.yaml":
        "sources: []\nredirect_from:\n  - /tides/us/gone/\n",
    });
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: root, stdio: "pipe" });
    git("init", "-q");
    git("add", ".");
    const tree = git("write-tree").toString().trim();
    expect([...publishedPathsAt(tree, root)].sort()).toEqual([
      "/tides/se/e4bron-sodertalje/",
      "/tides/se/sodertalje/",
      "/tides/us/gone/",
      "/tides/us/retired/",
      "/tides/us/wa/everett/",
    ]);
  });

  test("a station with a provider owns its one unsupplied record", () => {
    const { registry, corrections } = curatedRecords(
      [
        {
          kind: "tide",
          country: "CA",
          region: "CA-BC",
          slug: "victoria",
          file: "stations/tide/ca/victoria.yaml",
          name: "Victoria",
          position: [48.424, -123.371],
          provider: "chs",
          sources: ["chs-victoria", "ticon/victoria_bc-543a-can-uhslc_rq"],
        },
      ],
      new Set(["ticon/victoria_bc-543a-can-uhslc_rq"]),
    );
    expect(registry.get("chs-victoria")).toMatchObject({
      name: "Victoria",
      provider: "chs",
      kind: "tide",
      location: { countryCode: "CA", regionCode: "CA-BC" },
    });
    expect(corrections.get("ticon/victoria_bc-543a-can-uhslc_rq")).toEqual({
      location: { countryCode: "CA", regionCode: "CA-BC" },
    });
  });

  test("comments beside a record or a redirect survive a rewrite", async () => {
    const text = `sources:
  # The relay names NOAA 9447659 as its originator.
  - ticon/everett-9447659-usa-noaa
  - noaa/9447659
redirect_from:
  # Renamed from the provider's label.
  - /tides/us/wa/everett-marina/
# Written by \`npm run stations\`. Do not edit.
computed:
  sources: {}
`;
    const out = await renderStationFile(text, {
      kind: "tide",
      country: "US",
      region: "US-WA",
      slug: "everett",
      sources: ["noaa/9447659", "ticon/everett-9447659-usa-noaa"],
      retired_sources: [],
      redirect_from: ["/tides/us/wa/everett-marina/"],
      computed: {},
    });
    expect(out).toContain("# The relay names NOAA 9447659 as its originator.");
    expect(out).toContain("# Renamed from the provider's label.");
  });

  test("a returning record leaves retired_sources", async () => {
    const root = repo({
      "stations/tide/us/everett.yaml":
        "sources: []\nretired_sources:\n  - noaa/9447659\n",
    });
    const [planned] = await planStationFiles(
      readStationFiles(join(root, "stations")),
      [station("noaa/9447659", 47.98)],
      {
        tide: [
          { slug: "everett", station_ids: ["noaa/9447659"], former_paths: [] },
        ],
        current: [],
      },
      root,
    );
    expect(planned?.text).toMatch(/sources:\n {2}- noaa\/9447659\n/);
    expect(planned?.text).not.toContain("retired_sources");
  });

  test("a retired station keeps its paths published", () => {
    const retired = {
      kind: "tide" as const,
      country: "US",
      region: "US-WA",
      slug: "everett",
      file: "stations/tide/us/everett.yaml",
      sources: [],
      retired_sources: ["noaa/9447659"],
      redirect_from: ["/tides/us/wa/everett-marina/"],
    };
    expect([...publishedPaths([retired])].sort()).toEqual([
      "/tides/us/wa/everett-marina/",
      "/tides/us/wa/everett/",
    ]);
  });

  test("a path changes hands only to a station sharing none of its records", () => {
    const file = (
      slug: string,
      sources: string[],
      redirect_from: string[] = [],
    ) => ({
      kind: "tide" as const,
      country: "US",
      slug,
      file: `stations/tide/us/${slug}.yaml`,
      sources,
      redirect_from,
    });
    const before = [file("everett", ["noaa/1"]), file("seattle", ["noaa/2"])];
    expect(
      pathsChangingHands(before, [
        file("seattle", ["noaa/1", "noaa/2"], ["/tides/us/everett/"]),
      ]),
    ).toEqual([]);
    expect(pathsChangingHands(before, [file("everett", ["noaa/2"])])).toEqual([
      "/tides/us/everett/: stations/tide/us/everett.yaml -> stations/tide/us/everett.yaml",
    ]);
  });

  test("a merged station keeps the curated fields of the primary record's station", async () => {
    const root = repo({
      "stations/tide/nl/amelander.yaml": "sources:\n  - rws/AWG\n",
      "stations/tide/nl/awg.yaml":
        "# AWG is the platform's code.\nname: AWG\nsources:\n  - ticon/awg\n",
    });
    const [primary, absorbed] = readStationFiles(join(root, "stations"));
    const merged = await mergeStationFiles(
      primary!,
      [absorbed!],
      primary!,
      { country: "NL" },
      root,
    );
    expect(merged.write.text).not.toContain("name: AWG");
    expect(merged.write.text).not.toContain("platform's code");
    expect(merged.conflicts).toEqual([
      "stations/tide/nl/amelander.yaml: dropped name from stations/tide/nl/awg.yaml",
    ]);
  });

  test("a merged station keeps the comments beside absorbed records and redirects", async () => {
    const root = repo({
      "stations/tide/no/bergen.yaml":
        "sources:\n  - ticon/bergen-bgo-nor-nhs\n",
      "stations/tide/no/bergen-kartverket-bgo.yaml":
        "sources:\n  # Kartverket's own gauge.\n  - kartverket/BGO\nredirect_from:\n  - /tides/no/bergen-havn/ # Its old name.\n",
    });
    const files = readStationFiles(join(root, "stations"));
    const survivor = files.find(({ slug }) => slug === "bergen")!;
    const absorbed = files.find(({ slug }) => slug !== "bergen")!;
    const merged = await mergeStationFiles(
      survivor,
      [absorbed],
      absorbed,
      { country: "NO" },
      root,
    );
    expect(merged.write.text).toContain(
      "  # Kartverket's own gauge.\n  - kartverket/BGO\n",
    );
    expect(merged.write.text).toContain(
      "/tides/no/bergen-havn/ # Its old name.",
    );
  });

  test("an owned station tolerates a vanished provider record", () => {
    const { registry } = curatedRecords(
      [
        {
          kind: "tide",
          country: "CA",
          region: "CA-BC",
          slug: "victoria",
          file: "stations/tide/ca/victoria.yaml",
          name: "Victoria",
          position: [48.424, -123.371],
          provider: "chs",
          sources: ["chs-victoria", "ticon/vanished"],
        },
      ],
      new Set(),
    );
    expect([...registry.keys()]).toEqual(["chs-victoria"]);
  });

  test("ignores stray files and refuses a malformed redirect", () => {
    const root = repo({
      "stations/tide/.DS_Store": "",
      "stations/tide/us/everett.yaml": everett,
    });
    expect(readStationFiles(join(root, "stations"))).toHaveLength(1);
    const bad = repo({
      "stations/tide/us/everett.yaml":
        "sources: []\nredirect_from:\n  - /tides/us/everett\n",
    });
    expect(() => readStationFiles(join(bad, "stations"))).toThrow(
      /not a route path/,
    );
    const otherKind = repo({
      "stations/tide/us/everett.yaml":
        "sources: []\nredirect_from:\n  - /currents/us/everett/\n",
    });
    expect(() => readStationFiles(join(otherKind, "stations"))).toThrow(
      /not a route path/,
    );
  });

  test("a retired record keeps its station's geography and curation", () => {
    const { corrections } = curatedRecords(
      [
        {
          kind: "tide",
          country: "US",
          slug: "seattle",
          file: "stations/tide/us/seattle.yaml",
          name: "Seattle",
          sources: ["noaa/9447130"],
          retired_sources: ["ticon/seattle-9447130-usa-noaa"],
        },
      ],
      new Set(["noaa/9447130"]),
    );
    expect(corrections.get("ticon/seattle-9447130-usa-noaa")).toEqual(
      corrections.get("noaa/9447130"),
    );
  });

  test("refuses a record in two stations and a misfiled station", () => {
    const twice = repo({
      "stations/tide/us/everett.yaml": everett,
      "stations/tide/us/marysville.yaml": "sources:\n  - noaa/9447659\n",
    });
    expect(() => readStationFiles(join(twice, "stations"))).toThrow(
      /record noaa\/9447659 is also in/,
    );
    const misfiled = repo({ "stations/tides/us/everett.yaml": everett });
    expect(() => readStationFiles(join(misfiled, "stations"))).toThrow(
      /not a station kind/,
    );
  });

  test("counts only records a run newly retires", () => {
    const files = readStationFiles(
      join(
        repo({
          "stations/tide/us/everett.yaml":
            "sources: []\nretired_sources:\n  - noaa/1\n",
        }),
        "stations",
      ),
    );
    expect(
      newlyRetired(files, [
        {
          file: "stations/tide/us/everett.yaml",
          text: "sources: []\nretired_sources:\n  - noaa/1\n  - noaa/2\n",
        },
      ]),
    ).toEqual(["noaa/2"]);
  });

  test("refuses a redirect two stations hold, or a slug another redirects from", () => {
    const shared = repo({
      "stations/tide/us/everett.yaml":
        "sources: []\nredirect_from:\n  - /tides/us/old/\n",
      "stations/tide/us/marysville.yaml":
        "sources: []\nredirect_from:\n  - /tides/us/old/\n",
    });
    expect(() => readStationFiles(join(shared, "stations"))).toThrow(
      /path \/tides\/us\/old\/ is also in/,
    );
    const taken = repo({
      "stations/tide/us/everett.yaml":
        "sources: []\nredirect_from:\n  - /tides/us/wa/marysville/\n",
      "stations/tide/ca/marysville.yaml": "sources: []\n",
    });
    expect(() => readStationFiles(join(taken, "stations"))).toThrow(
      /slug marysville is also in/,
    );
  });

  test("reads the paths a ref published before station files from its route lock", () => {
    const root = repo({
      "metadata/routes.lock.json": JSON.stringify({
        tide: {
          everett: {
            path: "/tides/us/wa/everett/",
            former_paths: ["/tides/us/everett/"],
          },
        },
        current: {},
      }),
    });
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: root, stdio: "pipe" });
    git("init", "-q");
    git("add", ".");
    const tree = git("write-tree").toString().trim();
    expect([...publishedPathsAt(tree, root)].sort()).toEqual([
      "/tides/us/everett/",
      "/tides/us/wa/everett/",
    ]);
  });

  test("a record's comment follows it into retired_sources", async () => {
    const out = await renderStationFile(
      "sources:\n  - noaa/1\n  # Same gauge as noaa/1, per NOAA.\n  - ticon/foo\n",
      {
        kind: "tide",
        country: "US",
        slug: "everett",
        sources: ["noaa/1"],
        retired_sources: ["ticon/foo"],
        redirect_from: [],
        computed: {},
      },
    );
    expect(out).toMatch(
      /retired_sources:\n {2}# Same gauge as noaa\/1, per NOAA.\n {2}- ticon\/foo/,
    );
  });

  test("refuses an owned record's fields on a station without a provider", () => {
    const root = repo({
      "stations/current/us/boundary-pass.yaml":
        "magnitude_note: 6 kn\nsources:\n  - noaa/PUG1717\n",
    });
    expect(() => readStationFiles(join(root, "stations"))).toThrow(
      /needs provider/,
    );
  });

  test("a provider current's tide pairing applies to every record", () => {
    const root = repo({
      "stations/current/us/richmond.yaml":
        "tide_reference: noaa/9414863\nsources:\n  - noaa/PCT0666\n  - noaa/PCT0667\n",
    });
    const { corrections } = curatedRecords(
      readStationFiles(join(root, "stations")),
      new Set(["noaa/PCT0666", "noaa/PCT0667"]),
    );
    expect(corrections.get("noaa/PCT0666")?.tideReference).toBe("noaa/9414863");
    expect(corrections.get("noaa/PCT0667")?.tideReference).toBe("noaa/9414863");
  });

  test("refuses a tide pairing on a tide station", () => {
    const root = repo({
      "stations/tide/us/richmond.yaml":
        "tide_reference: noaa/9414863\nsources:\n  - noaa/9414863\n",
    });
    expect(() => readStationFiles(join(root, "stations"))).toThrow(
      /tide_reference pairs a current/,
    );
  });

  // A CHS identity record CHS later prunes has no slash and no source either.
  test("an owned station tolerates a vanished CHS record beside it", () => {
    const { registry } = curatedRecords(
      [
        {
          kind: "tide",
          country: "CA",
          region: "CA-BC",
          slug: "victoria",
          file: "stations/tide/ca/victoria.yaml",
          name: "Victoria",
          position: [48.424, -123.371],
          provider: "chs",
          sources: ["chs-victoria", "chs-victoria-harbour"],
        },
      ],
      new Set(),
    );
    expect([...registry.keys()]).toEqual(["chs-victoria"]);
  });
});

describe("chs_fit", () => {
  const evidence = "fit-2026-10-22-8f85912-r2";
  const ok = [
    { tier: "final", days: 60, evidence },
    { tier: "final", days: 210, provisional_slack_minutes: 35, evidence },
    { tier: "bounded", days: 210, slack_bound_minutes: 45, evidence },
    {
      tier: "online",
      miss: { clause: "slack_worst", value: 47.4 },
      miss_context: "rapids",
      evidence,
    },
    {
      tier: "online",
      miss: { clause: "slack_worst", value: 44.5, near_bar: true },
      evidence,
    },
    { tier: "online", miss: { clause: "slack_median", value: null }, evidence },
  ];

  test("accepts each tier's fields", () => {
    for (const fit of ok) expect(chsFitProblems(fit)).toEqual([]);
  });

  test("rejects fields outside a tier", () => {
    const bounded = { tier: "bounded", days: 210, slack_bound_minutes: 45 };
    const miss = { clause: "slack_worst", value: 50 };
    const cases: [object, string][] = [
      [
        { tier: "final", days: 60, slack_bound_minutes: 45, evidence },
        "slack_bound_minutes",
      ],
      [{ tier: "final", days: 60, miss, evidence }, "miss"],
      [{ ...bounded, miss, evidence }, "miss"],
      [{ tier: "online", days: 60, miss, evidence }, "days"],
      [{ tier: "online", evidence }, "miss"],
      [
        { tier: "final", days: 60, provisional_slack_minutes: 35, evidence },
        "provisional_slack_minutes",
      ],
      [{ tier: "bounded", days: 210, evidence }, "slack_bound_minutes"],
      [{ tier: "final", evidence }, "days"],
      [{ tier: "bounded", slack_bound_minutes: 45, evidence }, "days"],
      [
        { tier: "final", days: 60, miss_context: "rapids", evidence },
        "miss_context",
      ],
    ];
    for (const [fit, field] of cases) {
      const problems = chsFitProblems(fit);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain(field);
    }
  });

  test("rejects bad values", () => {
    const final = { tier: "final", days: 210, evidence };
    const bounded = { tier: "bounded", days: 210, evidence };
    const online = {
      tier: "online",
      miss: { clause: "slack_worst", value: 50 },
      evidence,
    };
    const cases: [object, string][] = [
      [{ ...final, days: 90 }, "days"],
      [{ ...final, tier: "fitted" }, "tier"],
      [{ ...bounded, slack_bound_minutes: 30 }, "slack_bound_minutes"],
      [{ ...bounded, slack_bound_minutes: 50 }, "slack_bound_minutes"],
      [{ ...bounded, slack_bound_minutes: 37 }, "slack_bound_minutes"],
      [
        { ...final, provisional_slack_minutes: 50 },
        "provisional_slack_minutes",
      ],
      [
        { ...final, provisional_slack_minutes: 33 },
        "provisional_slack_minutes",
      ],
      [
        {
          ...bounded,
          slack_bound_minutes: 45,
          provisional_slack_minutes: 40,
        },
        "provisional_slack_minutes",
      ],
      [{ ...online, miss: { clause: "slack_max", value: 50 } }, "clause"],
      [{ ...online, miss: { clause: "slack_worst", value: "47" } }, "value"],
      [
        {
          ...online,
          miss: { clause: "slack_worst", value: 50, near_bar: false },
        },
        "near_bar",
      ],
      [{ ...online, miss_context: "river" }, "miss_context"],
      [{ ...final, evidence: "r2" }, "evidence"],
      [{ ...final, evidence: "fit-2026-10-22-8f8591-r2" }, "evidence"],
      [{ ...final, evidence: "fit-2026-10-22-8f85912" }, "evidence"],
      [{ ...final, extra: 1 }, "extra"],
      [{ ...online, miss: { ...online.miss, extra: 1 } }, "extra"],
    ];
    for (const [fit, field] of cases) {
      const problems = chsFitProblems(fit);
      expect(problems, JSON.stringify(fit)).toHaveLength(1);
      expect(problems[0]).toContain(field);
    }
  });

  const fitYaml =
    "provider: chs\ntide_reference: chs-1\nchs_fit:\n  tier: final\n  days: 60\n  evidence: fit-2026-10-22-8f85912-r2\nsources:\n  - chs-gate\n";

  test("chs_fit needs an owned CHS current gate", () => {
    const bad: Record<string, string> = {
      "stations/current/ca/a.yaml": fitYaml.replace("provider: chs\n", ""),
      "stations/tide/ca/b.yaml": fitYaml.replace("tide_reference: chs-1\n", ""),
      "stations/current/ca/c.yaml": fitYaml.replace(
        "sources:",
        "derived:\n  reference: chs-2\n  high_water_lag_minutes: 1\n  low_water_lag_minutes: 1\nsources:",
      ),
    };
    for (const [path, text] of Object.entries(bad)) {
      const root = repo({ [path]: text });
      expect(() => readStationFiles(join(root, "stations"))).toThrow(
        new RegExp(path.replace(/\./g, "\\.")),
      );
    }
  });

  test("npm run stations keeps chs_fit", async () => {
    const text = `# A fitted gate.\n${fitYaml}`;
    const gate = {
      ...station("chs-gate", 48.5, "CA-BC"),
      country: "Canada",
      country_code: "CA",
    } as ResolvedStation;
    const routes = {
      tide: [],
      current: [{ slug: "gate", station_ids: ["chs-gate"], former_paths: [] }],
    };
    // The first run adds the computed block; once written, nothing changes.
    const first = readStationFiles(
      join(repo({ "stations/current/ca/gate.yaml": text }), "stations"),
    );
    expect(first[0]?.chs_fit).toMatchObject({ tier: "final", days: 60 });
    const root = repo({ "stations/current/ca/gate.yaml": text });
    const [planned] = await planStationFiles(first, [gate], routes, root);
    expect(planned?.text).toContain("# A fitted gate.");
    expect(planned?.text).toContain("chs_fit:\n  tier: final\n  days: 60\n");
    const settled = repo({ "stations/current/ca/gate.yaml": planned!.text });
    expect(
      await planStationFiles(
        readStationFiles(join(settled, "stations")),
        [gate],
        routes,
        settled,
      ),
    ).toEqual([]);
  });

  test("merging keeps chs_fit", async () => {
    const root = repo({
      "stations/current/ca/gate.yaml": fitYaml,
      "stations/current/ca/other.yaml": "sources:\n  - noaa/x\n",
    });
    const files = readStationFiles(join(root, "stations"));
    const survivor = files.find(({ slug }) => slug === "gate")!;
    const absorbed = files.find(({ slug }) => slug === "other")!;
    const merged = await mergeStationFiles(
      survivor,
      [absorbed],
      survivor,
      { country: "CA" },
      root,
    );
    expect(merged.write.text).toContain("chs_fit:\n  tier: final");
  });
});
