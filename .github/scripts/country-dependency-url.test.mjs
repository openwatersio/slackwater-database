import { test } from "node:test";
import assert from "node:assert/strict";
import { countryDependencyUrl } from "./country-dependency-url.mjs";

const url = `git+https://github.com/openwatersio/c5y-n8r.git#${"a".repeat(40)}`;
const manifest = (value = url) => ({
  devDependencies: { "@openwaters/c5y-n8r": value },
});
const lock = (value) => ({
  packages: { "node_modules/@openwaters/c5y-n8r": { resolved: value } },
});

test("only the exact declared HTTPS or npm-canonical SSH commit is exempted", () => {
  for (const resolved of [
    url,
    url.replace("git+https://github.com/", "git+ssh://git@github.com/"),
  ]) {
    assert.equal(countryDependencyUrl(manifest(), lock(resolved)), resolved);
  }
  for (const resolved of [
    url.replace("a".repeat(40), "b".repeat(40)),
    url.replace("github.com", "example.com"),
    url.replace("c5y-n8r", "other"),
    url.replace("git+https:", "http:"),
    url.replace(/#[^#]+$/, "#main"),
  ]) {
    assert.throws(() => countryDependencyUrl(manifest(), lock(resolved)));
  }
  for (const declared of [
    url.replace(/#[^#]+$/, "#main"),
    url.replace("git+https:", "git+ssh:"),
    url.replace("github.com", "example.com"),
  ]) {
    assert.throws(() =>
      countryDependencyUrl(manifest(declared), lock(declared)),
    );
  }
});
