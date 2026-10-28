import { describe, expect, it } from "vitest";
import {
  listReleases,
  releaseWarnings,
  newestTags,
} from "../check-chs-fit-age.ts";

const fit = (evidence: string) => ({
  chs_fit: { tier: "online" as const, evidence },
});
const now = new Date("2026-10-26T00:00:00Z");

describe("newestTags", () => {
  it("takes the latest date, then the highest run, per stamp", () => {
    expect(
      newestTags([
        fit("fit-2026-10-22-8f85912-r9"),
        fit("fit-2026-10-22-8f85912-r10"),
        fit("fit-2026-10-23-8f85912-r1"),
        fit("fit-2026-10-20-2222222-r4"),
        {},
      ]),
    ).toEqual(["fit-2026-10-20-2222222-r4", "fit-2026-10-23-8f85912-r1"]);
  });
  it("is empty with no chs_fit", () => {
    expect(newestTags([{}])).toEqual([]);
  });
});

describe("releaseWarnings", () => {
  const tag = "fit-2026-10-22-8f85912-r2";
  const rel = (tag_name: string, published_at: string, extra = {}) => ({
    tag_name,
    published_at,
    ...extra,
  });
  const own = rel(tag, "2026-10-25T00:00:00Z");
  it("is quiet when current", () => {
    expect(releaseWarnings(tag, [own], now)).toEqual([]);
  });
  it("warns past 45 days", () => {
    const [w] = releaseWarnings(tag, [rel(tag, "2026-08-01T00:00:00Z")], now);
    expect(w).toMatch(/86 days ago/);
  });
  it("names both tags when a newer run of the stamp exists", () => {
    const [w] = releaseWarnings(
      tag,
      [own, rel("fit-2026-10-24-8f85912-r3", "2026-10-25T01:00:00Z")],
      now,
    );
    expect(w).toContain(tag);
    expect(w).toContain("fit-2026-10-24-8f85912-r3");
  });
  it("ignores drafts and says prerelease", () => {
    const newer = "fit-2026-10-24-8f85912-r3";
    expect(
      releaseWarnings(
        tag,
        [own, rel(newer, "2026-10-25T01:00:00Z", { draft: true })],
        now,
      ),
    ).toEqual([]);
    const [w] = releaseWarnings(
      tag,
      [own, rel(newer, "2026-10-25T01:00:00Z", { prerelease: true })],
      now,
    );
    expect(w).toContain("prerelease");
  });
  it("is quiet about an older run or a non-fit tag", () => {
    expect(
      releaseWarnings(
        tag,
        [
          own,
          rel("fit-2026-10-01-8f85912-r1", "2026-10-01T00:00:00Z"),
          rel("v1", "2026-10-26T00:00:00Z"),
        ],
        now,
      ),
    ).toEqual([]);
  });
  it("warns separately about a newer recipe stamp", () => {
    const other = "fit-2026-10-25-abcdef0-r1";
    const warnings = releaseWarnings(
      tag,
      [own, rel(other, "2026-10-25T12:00:00Z")],
      now,
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(other);
    expect(warnings[0]).toContain("re-curating");
  });
  it("does not warn about an older recipe stamp", () => {
    expect(
      releaseWarnings(
        tag,
        [own, rel("fit-2026-09-01-abcdef0-r1", "2026-09-01T00:00:00Z")],
        now,
      ),
    ).toEqual([]);
  });
  it("warns when the cited release is not listed", () => {
    expect(releaseWarnings(tag, [], now)).toHaveLength(1);
  });
});

describe("listReleases", () => {
  const cited = "fit-2026-10-22-8f85912-r2";
  const page = (n: number, from: number) =>
    Array.from({ length: n }, (_, i) => ({ tag_name: `v${from + i}` }));
  const pager = (pages: unknown[]) => {
    const urls: string[] = [];
    const get = async (url: string) => {
      urls.push(url);
      return pages[urls.length - 1] ?? [];
    };
    return { urls, get };
  };
  it("reads past the first page to the cited tag", async () => {
    const { urls, get } = pager([
      page(100, 0),
      [...page(10, 100), { tag_name: cited }, ...page(89, 110)],
      page(100, 200),
    ]);
    const releases = await listReleases([cited], get);
    expect(releases).toHaveLength(200);
    expect(urls.map((u) => new URL(u).searchParams.get("page"))).toEqual([
      "1",
      "2",
    ]);
  });
  it("stops at a short page", async () => {
    const { urls, get } = pager([page(100, 0), page(3, 100)]);
    expect(await listReleases([cited], get)).toHaveLength(103);
    expect(urls).toHaveLength(2);
  });
  it("throws on a page that is not a list", async () => {
    const { get } = pager([{ message: "Bad credentials" }]);
    await expect(listReleases([cited], get)).rejects.toThrow(/not an array/);
  });
});
