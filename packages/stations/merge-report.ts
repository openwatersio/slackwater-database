/**
 * Print, as Markdown, every merge planMerges would make against the committed
 * catalogue: confident merges as one line each, the groups that need a person
 * with their evidence, then the links it refused. With --apply, fold each
 * confident group, and each review group whose surviving slug follows, into
 * its surviving station file; run `npm run stations` afterwards.
 *
 * Usage: npm run report:merges -w packages/stations > merges.md
 *        npm run merge -w packages/stations [-- slug...]
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadProductionCatalogue } from "./load-catalogue.ts";
import { planMerges, selectMerges, type MergeGroup } from "./merges.ts";
import {
  mergeStationFiles,
  readStationFiles,
  type StationFile,
} from "./station-files.ts";

const root = join(import.meta.dirname, "..", "..");
const files = readStationFiles(join(root, "stations"));
const catalogue = await loadProductionCatalogue(root, files);
const quality = new Map(
  catalogue.stations.flatMap(({ quality }) =>
    quality ? [[quality.id, quality] as const] : [],
  ),
);
const plan = planMerges(catalogue.stations, catalogue.routes, quality);
const confident = planMerges(catalogue.stations, catalogue.routes, quality, {
  confident: true,
});

const key = (group: MergeGroup) => [...group.slugs].sort().join(" ");
const settled = new Set(confident.groups.map(key));
const review = plan.groups.filter((group) => !settled.has(key(group)));
const redirects = confident.groups.reduce(
  (n, g) => n + g.slugs.filter((slug) => slug !== g.survivor).length,
  0,
);

const line = (group: MergeGroup) =>
  `- \`${group.survivor}\` ← ${group.slugs
    .filter((slug) => slug !== group.survivor)
    .map((slug) => `\`${slug}\``)
    .join(", ")}`;

const out = [
  "# Station merges",
  "",
  `${confident.groups.length} confident merges absorb ${redirects} stations, whose URLs redirect. ${review.length} groups need review and ${plan.refused.length} links were refused.`,
  "",
  "## Need review",
  "",
  ...review.flatMap((group) => [
    `### \`${group.survivor}\``,
    "",
    "| Record | Published slug | Name | km | Evidence |",
    "|---|---|---|---|---|",
    ...group.members.map(
      (m) =>
        `| ${m.id === group.primary ? `**${m.id}**` : m.id} | ${m.slug} | ${m.name} | ${m.km} | ${m.evidence ? `${m.evidence} of ${m.target}` : ""} |`,
    ),
    "",
  ]),
  "## Refused links",
  "",
  ...plan.refused.map(
    ({ id, target, reason }) => `- ${id} → ${target}: ${reason}`,
  ),
  "",
  "## Confident",
  "",
  "Declared provenance, a Stillwell fit and a TICON record whose series Stillwell matched by hourly levels within 1 cm, a CMEMS copy of the one station of its name within 50 m whose M2 agrees, a gauge code shared within 2 km whose M2 agrees, or a CHS record and the one provider station of its name within 1 km, or 25 km for a MEDS record, unless SEPARATE_TWINS lists the pair. `npm run merge` makes these.",
  "",
  ...confident.groups.map(line),
  "",
];
console.log(out.join("\n"));

const apply = process.argv.indexOf("--apply");
if (apply >= 0) {
  const groups = selectMerges(
    confident.groups,
    review,
    process.argv.slice(apply + 1),
  );
  const bySlug = new Map(
    files
      .filter(({ kind }) => kind === "tide")
      .map((file) => [file.slug, file]),
  );
  const byId = new Map(
    catalogue.stations.map((station) => [station.id, station]),
  );
  // Plan every merge before writing any, so one refused group leaves the
  // station files as they were.
  const conflicts: string[] = [];
  const merges = [];
  for (const group of groups) {
    const files = group.slugs.map((slug) => {
      const file = bySlug.get(slug);
      if (!file)
        throw new Error(`${slug}: no station file; run npm run stations first`);
      return file;
    });
    const [survivor, ...absorbed] = files as [StationFile, ...StationFile[]];
    const primary = byId.get(group.primary)!;
    // An authoritative primary's geography is right; a relay's can be the
    // relaying agency's country, so the station keeps the one it published.
    // A curated station keeps its own, which its file already holds.
    const geography =
      group.authoritative && !group.curated
        ? {
            country: primary.country_code,
            ...(primary.region_code ? { region: primary.region_code } : {}),
          }
        : {
            country: survivor.country,
            ...(survivor.region ? { region: survivor.region } : {}),
          };
    const merged = await mergeStationFiles(
      survivor,
      absorbed,
      files.find(({ sources }) =>
        sources.includes(group.curated ?? group.primary),
      )!,
      geography,
      root,
      group.survivor,
    );
    // A survivor taken from a redirect may land on a path another station's
    // file holds once the station takes its primary's country.
    if (
      existsSync(join(root, merged.write.file)) &&
      !files.some(({ file }) => file === merged.write.file)
    )
      throw new Error(`${merged.write.file} already holds another station`);
    conflicts.push(...merged.conflicts);
    merges.push(merged);
  }
  for (const merged of merges) {
    for (const file of merged.remove) rmSync(join(root, file), { force: true });
    if (merged.write.from)
      rmSync(join(root, merged.write.from), { force: true });
    mkdirSync(dirname(join(root, merged.write.file)), { recursive: true });
    writeFileSync(join(root, merged.write.file), merged.write.text);
  }
  console.error(
    `merged ${merges.length} stations; ${conflicts.length} curated fields dropped:\n${conflicts.join("\n")}`,
  );
}
