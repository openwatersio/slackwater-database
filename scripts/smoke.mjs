// Smoke-tests the built artifacts (not src), so a broken published package can't
// slip through. Runs after build. Imports the Node ESM entry and the browser
// ESM entry, checks a reference and a subordinate station resolve their
// prediction data, and asserts the browser bundle contains no node:fs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

const browserSrc = readFileSync(
  fileURLToPath(new URL("browser/index.js", dist)),
  "utf8",
);
assert.ok(
  !/["']node:fs["']|require\(["']fs["']\)/.test(browserSrc),
  "browser bundle must not reference node:fs",
);

console.log("smoke: node ESM + browser ESM OK");
