import assert from "node:assert/strict";
import { join } from "node:path";
import { evidenceProblems } from "./chs-fit-evidence.ts";
import { evaluateQuality } from "./evaluate-quality.ts";
import { loadProductionCatalogue } from "./load-catalogue.ts";
import { SEPARATE_TWINS, separatedTwins, staleSeparations } from "./merges.ts";
import { cleanName, isRegionContext } from "./name-cleanup.ts";
import { classifyPosition } from "./position-audit.ts";
import {
  filePath,
  planStationFiles,
  publishedPaths,
  pathsChangingHands,
  publishedPathsAt,
  readStationFiles,
  stationFilesAt,
  ROOT,
} from "./station-files.ts";

const files = readStationFiles();

// Every chs_fit is what the results release it cites says of its gate.
assert.deepEqual(
  evidenceProblems(files, join(ROOT, "metadata", "chs-current-validation")),
  [],
  "chs_fit disagrees with its results release; fix the station file, or run npm run refresh:chs-fit -w packages/stations -- <tag> for a release that is not snapshotted",
);

// Quality is evaluated again, not read back, so a code or data change that
// alters a record's evaluation shows as a stale station file.
const quality = new Map((await evaluateQuality()).map((q) => [q.id, q]));
const catalogue = await loadProductionCatalogue(ROOT, files, quality);

// Every route, path, redirect, member and position audit is what the station
// files record, or a code or data change moved one without npm run stations.
const stale = await planStationFiles(
  files,
  catalogue.stations,
  catalogue.routes,
);
assert.deepEqual(
  stale.map(({ file, from }) => from ?? file),
  [],
  "station files are stale; run npm run stations",
);

// Paths that published another gauge and now publish the one they name, with
// that gauge's record. When their slugs were assigned, TICON's meta.csv rows
// were matched to the wrong Channel Coastal Observatory records, so each slug
// took a neighbor's name: /tides/gb/brighton/ showed Hastings Pier (#257).
// Each passes only while it holds the record it names.
const CORRECTED_PATHS = new Map(
  [
    ["brighton", "ticon/brighton-btn-gbr-cco"],
    ["hastings-pier", "ticon/hastings_pier-hgp-gbr-cco"],
    ["teignmouth-pier", "ticon/teignmouth_pier-tnp-gbr-cco"],
    ["port-isaac", "ticon/port_isaac-pti-gbr-cco"],
    ["severn-bridge", "ticon/severn_bridge-ssc-gbr-cco"],
    ["scarborough", "ticon/scarborough-sca-gbr-cco"],
    ["west-bay-harbour", "ticon/west_bay_harbour-wbh-gbr-cco"],
  ].map(([slug, id]) => [`/tides/gb/${slug}/`, id!]),
);
const corrected = (path: string) => {
  const id = CORRECTED_PATHS.get(path);
  return (
    !!id &&
    files.some((file) => filePath(file) === path && file.sources.includes(id))
  );
};

// A published path never disappears and never changes hands: a station that
// moves or is absorbed keeps its old path in some station's redirect_from.
// Checked against PUBLISHED_REF, such as origin/main, when it is set.
const ref = process.env["PUBLISHED_REF"];
if (ref) {
  const now = publishedPaths(files);
  const lost = [...publishedPathsAt(ref)].filter((path) => !now.has(path));
  assert.deepEqual(
    lost,
    [],
    `paths ${ref} publishes no longer resolve; add each to the redirect_from of the station that holds it`,
  );
  const before = stationFilesAt(ref);
  if (before) {
    assert.deepEqual(
      pathsChangingHands(before, files).filter(
        (change) => !corrected(change.split(":")[0]!),
      ),
      [],
      `paths ${ref} publishes now name other water`,
    );
    // A retired id the ref never listed is a typo, not a record that vanished.
    const listed = new Set(
      before.flatMap(({ sources, retired_sources = [] }) => [
        ...sources,
        ...retired_sources,
      ]),
    );
    assert.deepEqual(
      files.flatMap(({ file, retired_sources = [] }) =>
        retired_sources
          .filter((id) => !listed.has(id))
          .map((id) => `${file}: ${id}`),
      ),
      [],
      `station files retire records ${ref} never listed; check each id`,
    );
  }
}

// A CHS station is in Canada: the generalized maritime boundary can hand a
// Gulf Islands gauge to Washington when its station is first written. Saint-
// Pierre, which IWLS serves beside Canada's ports, is the one exception.
assert.deepEqual(
  files.flatMap(({ file, country, sources }) =>
    sources.some((id) => id.startsWith("chs-")) &&
    !["CA", "PM"].includes(country)
      ? [file]
      : [],
  ),
  [],
  "CHS stations filed outside Canada; move each file to stations/<kind>/ca/",
);

// A CHS record and a provider record of its kind and name within 1 km, or a
// MEDS record of its name, which carries the gauge's DFO number, within 25 km,
// are one gauge, and publish as one station (see planMerges). Each pair left
// apart on purpose is in SEPARATE_TWINS with the reason, and leaves the list
// when it merges.
const twins = separatedTwins(catalogue.stations, catalogue.routes).map(
  ({ curated, twin }) => `${curated} ${twin}`,
);
assert.deepEqual(
  twins.filter((pair) => !SEPARATE_TWINS.has(pair)),
  [],
  "CHS stations publish apart from a provider record of their name within 1 km, or a MEDS record of their name within 25 km; merge each pair (npm run merge -w packages/stations) or list it in SEPARATE_TWINS in merges.ts with the reason",
);
assert.deepEqual(
  staleSeparations(catalogue.routes),
  [],
  "SEPARATE_TWINS lists pairs that no longer publish apart; remove them",
);

// A published name is a fixed point of the cleanup, or a regeneration rewrites
// names on its own (#244). A curated name is exempt: it is what the cleanup
// could not produce.
// In a station this repo owns, the name is the owned record's alone.
const curatedNames = new Set(
  files.flatMap(({ name, provider, sources }) =>
    !name ? [] : provider ? sources.slice(0, 1) : sources,
  ),
);
assert.deepEqual(
  catalogue.stations.flatMap((station) => {
    if (!station.name || curatedNames.has(station.id)) return [];
    const again = cleanName(
      station.name,
      station.country,
      station.region_code,
      station.source?.name === "Canadian Hydrographic Service",
    ).name;
    return again === station.name
      ? []
      : [`${station.id}: ${station.name} → ${again}`];
  }),
  [],
  "cleanName rewrites a published name",
);

const routeIds = new Set(
  [...catalogue.routes.tide, ...catalogue.routes.current].flatMap(
    ({ station_ids }) => station_ids,
  ),
);
const routed = catalogue.stations.filter(({ id }) => routeIds.has(id));
assert.deepEqual(
  routed.flatMap(({ id, context }) =>
    context && isRegionContext(context) ? [`${id}: ${context}`] : [],
  ),
  [],
  "routed station contexts name a state or province; use a water qualifier or leave context absent",
);
const verdicts = routed.map((station) => classifyPosition(station).verdict);
console.log(
  `validated ${catalogue.stations.length} stations and ${routeIds.size} routed records in ${files.length} station files; warnings: ${routed.filter(({ locality }) => !locality).length} without locality, ${routed.filter(({ region_code }) => !region_code).length} without region code, ${verdicts.filter((v) => v === "ashore").length} pinned ashore, ${verdicts.filter((v) => v === "unverifiable").length} outside coastline coverage`,
);
if (catalogue.redundantNames.length)
  console.log(
    `${catalogue.redundantNames.length} name corrections match what the cleanup already produces:\n  ${catalogue.redundantNames.join("\n  ")}`,
  );
