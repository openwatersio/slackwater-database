import { cp, mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  verifySnapshot,
  importSnapshot,
  FIXTURES_DIR,
  refreshSnapshot,
} from "../import.ts";
import { createHash } from "node:crypto";
import { createTidePredictor } from "@slackwater/engine";
import { DATA_DIR } from "@slackwater/stations";
import type { StationData } from "@slackwater/database";
import { validate } from "../validate.ts";
import { parsePredictions } from "../jma.ts";
it("verifies all pinned constants and seasonal predictions", async () => {
  expect((await verifySnapshot()).harmonics).toHaveLength(70);
  expect(await validate()).toHaveLength(24);
});
// Uno and Takamatsu carry 18 to 19 mm of MP1. Read against the engine's MP1
// phase constant, their four pinned weeks differ from JMA's predictions by
// about 12 mm RMS; with MP1 turned back 90°, as engines before beta.14 read
// it, by about 25 mm.
async function pinnedRms(id: string, mp1Turn: number) {
  const { contents } = await verifySnapshot();
  const station = JSON.parse(
    await readFile(join(DATA_DIR, "jma", `${id}.json`), "utf8"),
  ) as StationData;
  const predictor = createTidePredictor(
    station.harmonic_constituents.map((c) =>
      c.name === "MP1" ? { ...c, phase: c.phase + mp1Turn } : c,
    ),
  );
  const errors = [...contents]
    .filter(
      ([path]) =>
        path.startsWith(`${id}-`) && path.endsWith("-predictions.html"),
    )
    .flatMap(([, html]) => parsePredictions(html))
    .map(
      (p) =>
        predictor.getWaterLevelAtTime({ time: p.time }).level -
        station.datums["CD"]! -
        p.level,
    );
  expect(errors).toHaveLength(4 * 168);
  return Math.sqrt(errors.reduce((s, e) => s + e * e, 0) / errors.length);
}
it.each(["UN", "TA"])(
  "%s matches JMA's predictions only with MP1 on the engine's phase constant",
  async (id) => {
    expect(await pinnedRms(id, 0)).toBeLessThan(0.016);
    expect(await pinnedRms(id, -90)).toBeGreaterThan(0.016);
  },
);
it("preserves data when a page changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "jma-test-"));
  try {
    await cp(FIXTURES_DIR, join(root, "fixtures"), { recursive: true });
    await writeFile(join(root, "fixtures", "WN-constants.html"), "corrupt");
    await mkdir(join(root, "data", "jma"), { recursive: true });
    await writeFile(join(root, "data", "jma", "WN.json"), "previous");
    await expect(
      importSnapshot(join(root, "fixtures"), join(root, "data")),
    ).rejects.toThrow(/checksum/i);
    expect(await readFile(join(root, "data", "jma", "WN.json"), "utf8")).toBe(
      "previous",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("refuses unreviewed withdrawals and concurrent refreshes", async () => {
  const root = await mkdtemp(join(tmpdir(), "jma-test-"));
  try {
    await mkdir(join(root, "jma"));
    await writeFile(join(root, "jma", "ZZ.json"), "preserve");
    await expect(importSnapshot(FIXTURES_DIR, root)).rejects.toThrow(
      /withdrawal/i,
    );
    await mkdir(join(root, "fixtures.lock"));
    await expect(refreshSnapshot(join(root, "fixtures"))).rejects.toThrow(
      /locked/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("refreshes a complete offline response set and rejects error pages without replacing fixtures", async () => {
  const root = await mkdtemp(join(tmpdir(), "jma-refresh-test-"));
  try {
    await cp(FIXTURES_DIR, join(root, "fixtures"), { recursive: true });
    const manifest = JSON.parse(
      await readFile(join(FIXTURES_DIR, "manifest.json"), "utf8"),
    ) as { files: { path: string; url: string }[] };
    const responses = new Map(
      await Promise.all(
        manifest.files.map(
          async (f) =>
            [
              f.url,
              await readFile(join(FIXTURES_DIR, f.path), "utf8"),
            ] as const,
        ),
      ),
    );
    await refreshSnapshot(
      join(root, "fixtures"),
      async (url) =>
        new Response(responses.get(String(url)) ?? "missing", { status: 200 }),
    );
    expect(
      (await verifySnapshot(join(root, "fixtures"))).harmonics,
    ).toHaveLength(70);
    const before = await readFile(
      join(root, "fixtures", "manifest.json"),
      "utf8",
    );
    await expect(
      refreshSnapshot(
        join(root, "fixtures"),
        async () => new Response("error page"),
      ),
    ).rejects.toThrow();
    expect(
      await readFile(join(root, "fixtures", "manifest.json"), "utf8"),
    ).toBe(before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("detects drift in a station outside the four prediction examples", async () => {
  const root = await mkdtemp(join(tmpdir(), "jma-drift-"));
  try {
    await cp(
      new URL("../../../data/jma/", import.meta.url),
      join(root, "jma"),
      { recursive: true },
    );
    const path = join(root, "jma", "KS.json");
    const station = JSON.parse(await readFile(path, "utf8"));
    station.harmonic_constituents[0].amplitude += 0.1;
    await writeFile(path, JSON.stringify(station));
    await expect(validate(FIXTURES_DIR, root)).rejects.toThrow(
      /record differs.*KS/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("verifies an older pinned prediction year independently of the refresh target year", async () => {
  const root = await mkdtemp(join(tmpdir(), "jma-old-year-"));
  try {
    await cp(FIXTURES_DIR, root, { recursive: true });
    const path = join(root, "manifest.json");
    const manifest = JSON.parse(await readFile(path, "utf8"));
    manifest.files.find((f: { path: string }) => f.path === "index.html").url =
      manifest.files
        .find((f: { path: string }) => f.path === "index.html")
        .url.replace("2026", "2025");
    for (const file of manifest.files)
      if (file.path.endsWith("-predictions.html")) {
        const body = (await readFile(join(root, file.path), "utf8")).replaceAll(
          "2026",
          "2025",
        );
        await writeFile(join(root, file.path), body);
        file.sha256 = createHash("sha256").update(body).digest("hex");
      }
    await writeFile(path, JSON.stringify(manifest));
    expect((await verifySnapshot(root)).harmonics).toHaveLength(70);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("preserves the request error if the output lock was removed externally", async () => {
  const root = await mkdtemp(join(tmpdir(), "jma-lock-error-"));
  const fixtures = join(root, "fixtures");
  try {
    await expect(
      refreshSnapshot(fixtures, async () => {
        await rm(`${fixtures}.lock`, { recursive: true });
        throw new Error("original request failure");
      }),
    ).rejects.toThrow("original request failure");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
