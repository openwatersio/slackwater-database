// Smoke-tests the built artifacts (not src), so a broken published package can't
// slip through. Runs after build. Imports the Node, browser, and worker ESM
// entries, checks a reference and a subordinate station resolve their
// prediction data, and asserts the browser/worker bundles respect their
// runtime constraints (no node:fs; the worker additionally may not fetch or
// touch import.meta.url during module evaluation — Cloudflare Workers allow
// neither).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const dist = new URL("../dist/", import.meta.url);

// The browser bundle fetches the database file relative to the module. Node's
// fetch can't read file: URLs, so serve it from disk here; in a real browser
// the bundler serves the asset.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith("file:")) {
    return new Response(readFileSync(fileURLToPath(url)));
  }
  return realFetch(url, init);
};

function check(db, label) {
  const ref = db.stations.find(
    (s) => s.type === "reference" && s.harmonic_constituents.length > 0,
  );
  assert.ok(ref, `${label}: a reference station with harmonics`);
  assert.ok(
    ref.harmonic_constituents.length > 0,
    `${label}: reference harmonics`,
  );
  assert.ok(Object.keys(ref.datums).length > 0, `${label}: reference datums`);

  const sub = db.stations.find((s) => s.type === "subordinate" && s.offsets);
  assert.ok(sub, `${label}: a subordinate station`);
  assert.ok(
    sub.harmonic_constituents.length > 0,
    `${label}: subordinate resolves reference harmonics`,
  );

  assert.ok(db.search("seattle")[0]?.name, `${label}: search`);
  assert.ok(
    db.nearest({ latitude: 47.6, longitude: -122.3 }),
    `${label}: nearest`,
  );
  assert.ok(db.datums.length > 0, `${label}: datums export`);
}

check(await import(new URL("node/index.js", dist)), "node ESM");
check(await import(new URL("browser/index.js", dist)), "browser ESM");

// require() of the ESM entry works only while its module graph is synchronous;
// this fails with ERR_REQUIRE_ASYNC_MODULE if top-level await sneaks back into
// the Node bundle (the browser source keeps its fetch await to itself).
const require = createRequire(import.meta.url);
check(require(fileURLToPath(new URL("node/index.js", dist))), "node require");

// The worker bundle must start with no fetch and no filesystem, like a
// Cloudflare Worker's global scope: poison fetch for the duration of its
// import to prove startup never calls it.
globalThis.fetch = () => {
  throw new Error("worker bundle called fetch during module evaluation");
};
check(await import(new URL("worker/index.js", dist)), "worker ESM");
globalThis.fetch = realFetch;

for (const bundle of ["browser", "worker"]) {
  const src = readFileSync(
    fileURLToPath(new URL(`${bundle}/index.js`, dist)),
    "utf8",
  );
  assert.ok(
    !/["']node:fs["']|require\(["']fs["']\)/.test(src),
    `${bundle} bundle must not reference node:fs`,
  );
}
assert.ok(
  !readFileSync(
    fileURLToPath(new URL("worker/index.js", dist)),
    "utf8",
  ).includes("import.meta.url"),
  "worker bundle must not use import.meta.url",
);

console.log("smoke: node ESM + node require + browser ESM + worker ESM OK");
