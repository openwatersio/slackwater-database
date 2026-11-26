import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchCountryBuildLock } from "./fetch-country-build-lock.mjs";

const commit = "a".repeat(40);
const url = `git+https://github.com/openwatersio/c5y-n8r.git#${commit}`;
const manifest = { devDependencies: { "@openwaters/c5y-n8r": url } };
const lock = {
  packages: { "node_modules/@openwaters/c5y-n8r": { resolved: url } },
};
const buildLock = {
  name: "@openwaters/c5y-n8r",
  lockfileVersion: 3,
  packages: {},
};

test("fetches the build lock only from the exact declared country commit", async () => {
  const result = await fetchCountryBuildLock(
    manifest,
    lock,
    async (target, options) => {
      if (target.startsWith("https://api.github.com/"))
        return Response.json({ status: "behind" });
      assert.equal(
        target,
        `https://raw.githubusercontent.com/openwatersio/c5y-n8r/${commit}/${target.endsWith("package.json") ? "package.json" : "package-lock.json"}`,
      );
      assert.ok(options.signal instanceof AbortSignal);
      return Response.json(buildLock);
    },
  );
  assert.deepEqual(result, buildLock);
});

test("rejects a mismatched pin before fetching", async () => {
  let fetched = false;
  const wrong = {
    packages: {
      "node_modules/@openwaters/c5y-n8r": {
        resolved: url.replace(commit, "b".repeat(40)),
      },
    },
  };
  await assert.rejects(
    fetchCountryBuildLock(manifest, wrong, async () => {
      fetched = true;
      return Response.json(buildLock);
    }),
  );
  assert.equal(fetched, false);
});

test("fails closed on HTTP errors, malformed data, wrong package identity and oversized bodies", async () => {
  for (const response of [
    new Response("unavailable", { status: 503 }),
    new Response("not JSON"),
    Response.json({ ...buildLock, name: "another-package" }),
    new Response("x".repeat(2 * 1024 * 1024 + 1)),
  ])
    await assert.rejects(
      fetchCountryBuildLock(manifest, lock, async (url) =>
        url.startsWith("https://api.github.com/")
          ? Response.json({ status: "behind" })
          : response,
      ),
    );
});

test("rejects commits outside upstream main before fetching their lock", async () => {
  for (const status of ["ahead", "diverged", "unknown"]) {
    let calls = 0;
    await assert.rejects(
      fetchCountryBuildLock(manifest, lock, async () => {
        calls++;
        return Response.json({ status });
      }),
      /not on upstream main/,
    );
    assert.equal(calls, 1);
  }
});

test("accepts an identical upstream commit", async () => {
  assert.deepEqual(
    await fetchCountryBuildLock(manifest, lock, async (url) =>
      Response.json(
        url.startsWith("https://api.github.com/")
          ? { status: "identical" }
          : buildLock,
      ),
    ),
    buildLock,
  );
});

test("rejects a build manifest with dependencies missing from its lock", async () => {
  await assert.rejects(
    fetchCountryBuildLock(manifest, lock, async (url) =>
      Response.json(
        url.startsWith("https://api.github.com/")
          ? { status: "behind" }
          : url.endsWith("package-lock.json")
            ? buildLock
            : {
                ...buildLock,
                dependencies: { unexpected: "https://example.com/a.tgz" },
              },
      ),
    ),
    /does not match dependencies/,
  );
});
