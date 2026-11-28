import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { countryDependencyUrl } from "./country-dependency-url.mjs";

export async function fetchCountryBuildLock(manifest, lock, fetcher = fetch) {
  const commit = countryDependencyUrl(manifest, lock).split("#")[1];
  const comparison = await fetcher(
    `https://api.github.com/repos/openwatersio/c5y-n8r/compare/main...${commit}`,
    {
      signal: AbortSignal.timeout(30_000),
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "openwatersio/slackwater-database",
        ...(process.env.GITHUB_TOKEN
          ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
          : {}),
      },
    },
  );
  if (!comparison.ok)
    throw new Error(`Country ancestry check failed: ${comparison.status}`);
  const { status } = await comparison.json();
  if (status !== "identical" && status !== "behind")
    throw new Error(`Country commit is not on upstream main: ${status}`);
  const response = await fetcher(
    `https://raw.githubusercontent.com/openwatersio/c5y-n8r/${commit}/package-lock.json`,
    {
      signal: AbortSignal.timeout(30_000),
      headers: {
        "User-Agent":
          "openwatersio/slackwater-database country build-lock check",
      },
    },
  );
  if (!response.ok)
    throw new Error(`Country build-lock fetch failed: ${response.status}`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > 2 * 1024 * 1024)
      throw new Error("Country build lock exceeds the size limit");
    chunks.push(chunk);
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  assert.equal(parsed.name, "@openwaters/c5y-n8r");
  assert.equal(parsed.lockfileVersion, 3);
  assert.ok(parsed.packages && typeof parsed.packages === "object");
  const manifestResponse = await fetcher(
    `https://raw.githubusercontent.com/openwatersio/c5y-n8r/${commit}/package.json`,
    { signal: AbortSignal.timeout(30_000) },
  );
  if (!manifestResponse.ok)
    throw new Error(
      `Country manifest fetch failed: ${manifestResponse.status}`,
    );
  const upstream = await manifestResponse.json();
  assert.equal(upstream.name, parsed.name);
  for (const field of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
  ])
    assert.deepEqual(
      upstream[field],
      parsed.packages[""]?.[field],
      `Country build lock does not match ${field}`,
    );
  return parsed;
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  const destination = process.argv[2];
  if (!destination)
    throw new Error("A destination package-lock.json path is required");
  const manifest = JSON.parse(
    await readFile(
      new URL("../../packages/database/package.json", import.meta.url),
      "utf8",
    ),
  );
  const lock = JSON.parse(
    await readFile(new URL("../../package-lock.json", import.meta.url), "utf8"),
  );
  const buildLock = await fetchCountryBuildLock(manifest, lock);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, JSON.stringify(buildLock, null, 2) + "\n");
}
