/**
 * Warn, as CI annotations, when the results release the station files cite is
 * more than 45 days old, when a newer release of its recipe stamp exists, when
 * another stamp has newer results, or when the list cannot be read. Always exits 0.
 *   npm run report:chs-fit-age -w packages/stations
 */
import { compareTags, tagStamp } from "./chs-fit-evidence.ts";
import {
  CHS_FIT_EVIDENCE,
  readStationFiles,
  type StationFile,
} from "./station-files.ts";

const REPO = "https://api.github.com/repos/openwatersio/chs-current-validation";
const STALE_DAYS = 45;

/** The newest tag the station files cite in each recipe stamp, oldest stamp first. */
export function newestTags(files: Pick<StationFile, "chs_fit">[]): string[] {
  const newest = new Map<string, string>();
  for (const f of files) {
    const tag = f.chs_fit?.evidence;
    if (!tag) continue;
    const stamp = tagStamp(tag);
    const have = newest.get(stamp);
    if (!have || compareTags(tag, have)! > 0) newest.set(stamp, tag);
  }
  return [...newest.values()].sort();
}

export interface ReleaseInfo {
  tag_name?: unknown;
  published_at?: unknown;
  draft?: unknown;
  prerelease?: unknown;
}

/**
 * The warnings for the newest cited tag against the repository's releases,
 * given today's date. Drafts are ignored; prereleases count and are named.
 */
export function releaseWarnings(
  cited: string,
  releases: ReleaseInfo[],
  now: Date,
): string[] {
  const fits = releases
    .filter(
      (r) =>
        r.draft !== true &&
        typeof r.tag_name === "string" &&
        CHS_FIT_EVIDENCE.test(r.tag_name),
    )
    .map((r) => ({
      tag: r.tag_name as string,
      published: Date.parse(String(r.published_at)),
      kind: r.prerelease === true ? "prerelease" : "release",
    }));
  const warnings: string[] = [];
  const own = fits.find((r) => r.tag === cited);
  if (!own)
    warnings.push(
      `::warning::The CHS current results release the station files cite, ${cited}, is not among the repository's published releases`,
    );
  else if (Number.isNaN(own.published))
    warnings.push(
      `::warning::The CHS current results release ${cited} has no readable published_at`,
    );
  else {
    const days = Math.floor((now.getTime() - own.published) / 86_400_000);
    if (days > STALE_DAYS)
      warnings.push(
        `::warning::The CHS current results release the station files cite, ${cited}, was published ${days} days ago`,
      );
  }
  const newer = fits
    .filter((r) => tagStamp(r.tag) === tagStamp(cited))
    .filter((r) => compareTags(r.tag, cited)! > 0)
    .sort((a, b) => compareTags(b.tag, a.tag)!)[0];
  if (newer)
    warnings.push(
      `::warning::A newer CHS current results ${newer.kind} exists: ${newer.tag}; the station files cite ${cited}`,
    );
  const other = fits
    .filter((r) => tagStamp(r.tag) !== tagStamp(cited))
    .filter((r) => !Number.isNaN(r.published))
    .filter(
      (r) => !own || Number.isNaN(own.published) || r.published > own.published,
    )
    .sort((a, b) => b.published - a.published)[0];
  if (other && own && !Number.isNaN(own.published))
    warnings.push(
      `::warning::A new recipe stamp has results: ${other.tag}${other.kind === "prerelease" ? " (prerelease)" : ""}; moving to it means re-curating every gate`,
    );
  return warnings;
}

async function get(url: string): Promise<unknown> {
  const token = process.env["GITHUB_TOKEN"];
  const response = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
    headers: {
      Accept: "application/vnd.github+json",
      ...(token && { Authorization: `Bearer ${token}` }),
    },
  });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return await response.json();
}

const PAGE = 100;

/**
 * The repository's releases, newest first, read a page at a time until every
 * cited tag has appeared or the list ends. Every release newer than a cited one
 * is then in hand.
 */
export async function listReleases(
  cited: string[],
  get: (url: string) => Promise<unknown>,
): Promise<ReleaseInfo[]> {
  const releases: ReleaseInfo[] = [];
  for (let page = 1; ; page++) {
    const batch = await get(`${REPO}/releases?per_page=${PAGE}&page=${page}`);
    if (!Array.isArray(batch))
      throw new Error("the release list is not an array");
    releases.push(...(batch as ReleaseInfo[]));
    const seen = new Set(releases.map((r) => r.tag_name));
    if (batch.length < PAGE || cited.every((tag) => seen.has(tag)))
      return releases;
  }
}

async function main() {
  const cited = newestTags(readStationFiles());
  if (!cited.length) return;
  const releases = await listReleases(cited, get);
  for (const tag of cited)
    for (const line of releaseWarnings(tag, releases, new Date()))
      console.log(line);
}

if (import.meta.main)
  main().catch((error) =>
    console.log(
      `::warning::Could not check the CHS current results age: ${error instanceof Error ? error.message : String(error)}`,
    ),
  );
