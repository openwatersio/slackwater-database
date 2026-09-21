#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { save } from "@neaps/stations";
import {
  buildStation,
  parseConstituents,
  parseLocationLevels,
  parseStationList,
} from "./kartverket.ts";

export interface SnapshotManifest {
  retrievedAt: string;
  files: Array<{ path: string; url: string; sha256: string }>;
}

const API_URL = "https://vannstand.kartverket.no/tideapi.php";
const SOURCE_DIR = dirname(fileURLToPath(import.meta.url));
export const FIXTURES_DIR = join(SOURCE_DIR, "fixtures");
const EXPECTED_STATION_COUNT = 33;

const sha256 = (content: string) =>
  createHash("sha256").update(content).digest("hex");

export function sourceUrl(parameters: Record<string, string>) {
  const url = new URL(API_URL);
  for (const [name, value] of Object.entries(parameters)) {
    url.searchParams.set(name, value);
  }
  return url.toString();
}

const stationListUrl = () => sourceUrl({ tide_request: "stationlist" });
const constituentsUrl = (code: string) =>
  sourceUrl({ stationcode: code, tide_request: "constituents" });
const stationLevelsUrl = (code: string) =>
  sourceUrl({
    stationcode: code,
    refcode: "cd",
    lang: "en",
    tide_request: "stationlevels",
  });

function snapshotManifest(value: unknown): SnapshotManifest {
  if (
    !value ||
    typeof value !== "object" ||
    typeof (value as SnapshotManifest).retrievedAt !== "string" ||
    !Array.isArray((value as SnapshotManifest).files)
  ) {
    throw new Error("Invalid snapshot manifest");
  }

  const manifest = value as SnapshotManifest;
  for (const file of manifest.files) {
    if (
      !file ||
      typeof file.path !== "string" ||
      typeof file.url !== "string" ||
      typeof file.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(file.sha256)
    ) {
      throw new Error("Invalid snapshot manifest file entry");
    }
    if (
      isAbsolute(file.path) ||
      normalize(file.path).replaceAll("\\", "/") !== file.path ||
      file.path.startsWith("../")
    ) {
      throw new Error(`Unsafe snapshot path: ${file.path}`);
    }
  }
  return manifest;
}

export async function verifySnapshot(fixtures = FIXTURES_DIR) {
  const manifest = snapshotManifest(
    JSON.parse(await readFile(join(fixtures, "manifest.json"), "utf8")),
  );
  const paths = manifest.files.map((file) => file.path);
  if (paths.join("\n") !== [...paths].sort().join("\n")) {
    throw new Error("Snapshot manifest files are not sorted");
  }

  const contents = new Map<string, string>();
  for (const file of manifest.files) {
    const content = await readFile(join(fixtures, file.path), "utf8");
    if (sha256(content) !== file.sha256) {
      throw new Error(`Snapshot checksum mismatch: ${file.path}`);
    }
    contents.set(file.path, content);
  }

  const stationList = contents.get("stationlist.xml");
  if (!stationList) throw new Error("Snapshot is missing stationlist.xml");
  const stations = parseStationList(stationList).stations.sort((a, b) =>
    a.code.localeCompare(b.code),
  );
  const codes = stations.map((station) => station.code);
  if (
    stations.length !== EXPECTED_STATION_COUNT ||
    new Set(codes).size !== EXPECTED_STATION_COUNT
  ) {
    throw new Error(
      `Expected ${EXPECTED_STATION_COUNT} unique station codes, got ${new Set(codes).size}`,
    );
  }

  const hasValidation = paths.some((path) => path.startsWith("validation/"));
  const { validationRequests, parsePredictions } =
    await import("./validate.ts");
  const requests = hasValidation ? validationRequests(codes) : [];
  const expected = [
    "stationlist.xml",
    ...codes.map((code) => `constituents/${code}.xml`),
    ...codes.map((code) => `stationlevels/${code}.xml`),
    ...requests.map(({ path }) => path),
  ].sort();
  if (paths.join("\n") !== expected.join("\n")) {
    throw new Error(
      "Snapshot manifest does not contain the complete response set",
    );
  }

  for (const request of requests) {
    if (
      manifest.files.find(({ path }) => path === request.path)?.url !==
      request.url
    ) {
      throw new Error(`Unexpected validation request URL: ${request.path}`);
    }
    parsePredictions(
      contents.get(request.path)!,
      request.code,
      request.datatype,
      request.window,
    );
  }

  for (const station of stations) {
    const constituentPath = `constituents/${station.code}.xml`;
    const levelPath = `stationlevels/${station.code}.xml`;
    const constituents = parseConstituents(contents.get(constituentPath)!);
    const levels = parseLocationLevels(contents.get(levelPath)!);
    if (!Object.hasOwn(levels.datums, "MSL")) {
      throw new Error(`Snapshot station ${station.code} is missing MSL`);
    }
    buildStation({ station, constituents, levels });
  }

  return { manifest, stations, contents };
}

async function fetchResponse(fetcher: typeof globalThis.fetch, url: string) {
  const response = await fetcher(url);
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}): ${url}`);
  }
  return response.text();
}

export async function refreshSnapshot(
  fixtures = FIXTURES_DIR,
  fetcher: typeof globalThis.fetch = globalThis.fetch,
  validationOnly = false,
) {
  const suffix = `${process.pid}-${randomUUID()}`;
  const staging = `${fixtures}.tmp-${suffix}`;
  const backup = `${fixtures}.backup-${suffix}`;
  const entries: SnapshotManifest["files"] = [];

  try {
    if (validationOnly) {
      const { manifest, stations } = await verifySnapshot(fixtures);
      const { validationRequests, parsePredictions } =
        await import("./validate.ts");
      await cp(fixtures, staging, { recursive: true });
      await mkdir(join(staging, "validation", "stations"), { recursive: true });
      entries.push(
        ...manifest.files.filter(({ path }) => !path.startsWith("validation/")),
      );
      for (const request of validationRequests(
        stations.map(({ code }) => code),
      )) {
        const xml = await fetchResponse(fetcher, request.url);
        parsePredictions(xml, request.code, request.datatype, request.window);
        await writeFile(join(staging, request.path), xml);
        entries.push({
          path: request.path,
          url: request.url,
          sha256: sha256(xml),
        });
      }
    } else {
      await mkdir(join(staging, "constituents"), { recursive: true });
      await mkdir(join(staging, "stationlevels"), { recursive: true });

      const stationUrl = stationListUrl();
      const stationXml = await fetchResponse(fetcher, stationUrl);
      const stations = parseStationList(stationXml).stations.sort((a, b) =>
        a.code.localeCompare(b.code),
      );
      const unsafeStation = stations.find(
        ({ code }) => !/^[A-Z]{3}$/.test(code),
      );
      if (unsafeStation) {
        throw new Error(`Unsafe station code: ${unsafeStation.code}`);
      }
      if (
        stations.length !== EXPECTED_STATION_COUNT ||
        new Set(stations.map(({ code }) => code)).size !==
          EXPECTED_STATION_COUNT
      ) {
        throw new Error(
          `Expected ${EXPECTED_STATION_COUNT} unique station codes, got ${stations.length}`,
        );
      }
      await writeFile(join(staging, "stationlist.xml"), stationXml);
      entries.push({
        path: "stationlist.xml",
        url: stationUrl,
        sha256: sha256(stationXml),
      });

      for (const { code } of stations) {
        const constituentUrl = constituentsUrl(code);
        const constituentXml = await fetchResponse(fetcher, constituentUrl);
        parseConstituents(constituentXml);
        await writeFile(
          join(staging, "constituents", `${code}.xml`),
          constituentXml,
        );
        entries.push({
          path: `constituents/${code}.xml`,
          url: constituentUrl,
          sha256: sha256(constituentXml),
        });

        const levelUrl = stationLevelsUrl(code);
        const levelXml = await fetchResponse(fetcher, levelUrl);
        parseLocationLevels(levelXml);
        await writeFile(
          join(staging, "stationlevels", `${code}.xml`),
          levelXml,
        );
        entries.push({
          path: `stationlevels/${code}.xml`,
          url: levelUrl,
          sha256: sha256(levelXml),
        });
      }
      if (existsSync(join(fixtures, "validation"))) {
        const { manifest } = await verifySnapshot(fixtures);
        await cp(join(fixtures, "validation"), join(staging, "validation"), {
          recursive: true,
        });
        entries.push(
          ...manifest.files.filter(({ path }) =>
            path.startsWith("validation/"),
          ),
        );
      }
    }

    const manifest: SnapshotManifest = {
      retrievedAt: new Date().toISOString(),
      files: entries.sort((a, b) => a.path.localeCompare(b.path)),
    };
    await writeFile(
      join(staging, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    await verifySnapshot(staging);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }

  let backedUp = false;
  try {
    await rename(fixtures, backup);
    backedUp = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  try {
    await rename(staging, fixtures);
  } catch (error) {
    if (backedUp) await rename(backup, fixtures);
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  if (backedUp) await rm(backup, { recursive: true });

  return verifySnapshot(fixtures);
}

async function importSnapshot() {
  const { stations } = await verifySnapshot();
  for (const station of stations) {
    const constituents = parseConstituents(
      await readFile(
        join(FIXTURES_DIR, "constituents", `${station.code}.xml`),
        "utf8",
      ),
    );
    const levels = parseLocationLevels(
      await readFile(
        join(FIXTURES_DIR, "stationlevels", `${station.code}.xml`),
        "utf8",
      ),
    );
    await save("kartverket", buildStation({ station, constituents, levels }));
  }
  console.log(`Imported ${stations.length} Kartverket stations.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const action = process.argv.includes("--refresh")
    ? refreshSnapshot().then(({ stations }) =>
        console.log(`Refreshed ${stations.length} Kartverket stations.`),
      )
    : importSnapshot();
  action.catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
