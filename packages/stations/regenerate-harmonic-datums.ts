import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import type { StationData } from "@slackwater/database";
import { computeDatums, toFixed, type Datums } from "@slackwater/datums";
import {
  HARMONIC_KEYS,
  HARMONIC_REDUCTION_NOTICE,
  OBSERVED_KEYS,
  storedDatumNotice,
} from "../../sources/ticon/datums.ts";
import { DATA_DIR, pruneDatums } from "./station.ts";

export type HarmonicDatumSource =
  "ticon" | "smhi" | "wsv" | "dmi" | "linz" | "jhod" | "jma";
const SOURCES: HarmonicDatumSource[] = [
  "dmi",
  "jhod",
  "jma",
  "linz",
  "smhi",
  "ticon",
  "wsv",
];
// Water-levels lake fits reduce their datums as TICON's records do.
const TICON_DATUMS: HarmonicDatumSource[] = ["smhi", "ticon", "wsv"];
// Written by the water-levels import, so a checkout that hasn't run it has no
// directory.
const LAKE_FITS: HarmonicDatumSource[] = ["smhi", "wsv"];

export function mergeHarmonicDatums(
  source: HarmonicDatumSource,
  station: StationData,
  computed: Datums,
): Datums {
  if (!SOURCES.includes(source))
    throw new Error(`Unsupported source: ${source}`);
  const requireDatum = (key: string) => {
    const value = station.datums?.[key];
    if (value === undefined || !Number.isFinite(value))
      throw new Error(`${source}/${station.source.id}: missing finite ${key}`);
    return value;
  };
  const msl = requireDatum("MSL");
  if (source === "jma" && msl !== 0)
    throw new Error(`jma/${station.source.id}: expected MSL = 0`);
  if (TICON_DATUMS.includes(source)) {
    if (
      !storedDatumNotice(station) ||
      (station.datum_frame === "constituent" && msl !== 0)
    )
      throw new Error(
        `${source}/${station.source.id}: unsupported datum provenance`,
      );
    if (station.datums_source === "observed") {
      const means = Object.fromEntries(
        OBSERVED_KEYS.map((key) => [key, requireDatum(key)]),
      );
      return pruneDatums(station.country, {
        ...means,
        ...Object.fromEntries(
          HARMONIC_KEYS.filter((key) => computed[key] !== undefined).map(
            (key) => [key, toFixed(computed[key]! + msl, 3)],
          ),
        ),
      });
    }
  }
  const shifted = Object.fromEntries(
    Object.entries(computed).map(([key, value]) => {
      if (!Number.isFinite(value))
        throw new Error(`Non-finite computed datum: ${key}`);
      return [key, toFixed(value + (source === "dmi" ? 0 : msl), 3)];
    }),
  );
  shifted["MSL"] = msl;
  if (source === "jma") shifted["CD"] = requireDatum("CD");
  if (source === "dmi") {
    if (msl !== 0)
      throw new Error(`dmi/${station.source.id}: expected MSL = 0`);
    shifted["LAT"] = requireDatum("LAT");
    shifted["MLWS"] = requireDatum("MLWS");
    if (
      !station.harmonic_constituents.some(
        (c) => /^(sa|ssa)$/i.test(c.name) && c.amplitude > 0,
      )
    )
      delete shifted["HAT"];
  } else if (source === "linz" || source === "jhod") {
    const zero = source === "linz" ? "CD" : "NLLW";
    if (requireDatum(zero) !== 0)
      throw new Error(`${source}/${station.source.id}: expected ${zero} = 0`);
    shifted[zero] = station.datums[zero]!;
  }
  return pruneDatums(station.country, shifted);
}

export function parseShard(value: string | undefined): [number, number] {
  if (value === undefined) return [0, 1];
  if (!/^\d+\/\d+$/.test(value))
    throw new Error("SHARD must be i/n with 0 <= i < n");
  const [index, count] = value.split("/").map(Number) as [number, number];
  if (
    !Number.isSafeInteger(index) ||
    !Number.isSafeInteger(count) ||
    count <= 0 ||
    index >= count
  )
    throw new Error("SHARD must be i/n with 0 <= i < n");
  return [index, count];
}

export async function regenerateDirectory(
  root: string,
  [index, count]: [number, number] = [0, 1],
): Promise<number> {
  const files = (
    await Promise.all(
      SOURCES.map(async (source) =>
        (
          await readdir(join(root, source)).catch((err) => {
            if (err.code === "ENOENT" && LAKE_FITS.includes(source)) return [];
            throw err;
          })
        )
          .filter((name) => name.endsWith(".json"))
          .sort()
          .map((name) => ({ source, path: join(root, source, name) })),
      ),
    )
  )
    .flat()
    .filter((_, i) => i % count === index);
  const records: {
    source: HarmonicDatumSource;
    path: string;
    station: StationData;
  }[] = [];
  for (const file of files) {
    const station = JSON.parse(
      await readFile(file.path, "utf8"),
    ) as StationData;
    if (station.type !== "reference" || !station.harmonic_constituents?.length)
      throw new Error(`${file.path}: expected a harmonic reference station`);
    mergeHarmonicDatums(file.source, station, {});
    records.push({ ...file, station });
  }
  let changed = 0;
  for (const { source, path, station } of records) {
    const { datums: computed } = computeDatums(
      station.harmonic_constituents,
      {},
      source === "dmi" ? { offset: false } : {},
    );
    const datums = mergeHarmonicDatums(source, station, computed);
    const disclaimers =
      TICON_DATUMS.includes(source) &&
      !station.disclaimers?.includes(HARMONIC_REDUCTION_NOTICE)
        ? `${station.disclaimers} ${HARMONIC_REDUCTION_NOTICE}`
        : station.disclaimers;
    if (
      isDeepStrictEqual(datums, station.datums) &&
      disclaimers === station.disclaimers
    )
      continue;
    await writeFile(
      path,
      JSON.stringify(
        {
          ...station,
          datums,
          ...(disclaimers !== undefined ? { disclaimers } : {}),
        },
        null,
        2,
      ) + "\n",
    );
    changed++;
  }
  return changed;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 2)
    throw new Error("Usage: regenerate-harmonic-datums.ts");
  console.log(
    `Regenerated ${await regenerateDirectory(DATA_DIR, parseShard(process.env["SHARD"]))} datum records.`,
  );
}
