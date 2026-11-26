import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function countryDependencyUrl(manifest, lock) {
  const declared = manifest.devDependencies["@openwaters/c5y-n8r"];
  if (
    !/^git\+https:\/\/github\.com\/openwatersio\/c5y-n8r\.git#[0-9a-f]{40}$/.test(
      declared,
    )
  ) {
    throw new Error("Expected an immutable HTTPS c5y-n8r commit");
  }
  const resolved = lock.packages["node_modules/@openwaters/c5y-n8r"].resolved;
  const npmCanonical = declared.replace(
    "git+https://github.com/",
    "git+ssh://git@github.com/",
  );
  if (resolved !== declared && resolved !== npmCanonical) {
    throw new Error("Locked country dependency must match the declared commit");
  }
  return resolved;
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  const manifest = JSON.parse(
    await readFile(
      new URL("../../packages/database/package.json", import.meta.url),
      "utf8",
    ),
  );
  const lock = JSON.parse(
    await readFile(new URL("../../package-lock.json", import.meta.url), "utf8"),
  );
  console.log(countryDependencyUrl(manifest, lock));
}
