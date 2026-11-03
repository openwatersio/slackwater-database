// Build and pack @slackwater/database for a consumer to test against before a
// release, and print the tarball's absolute path for `npm install <path>`.
//
//   npm run pack:local [-- <directory>]
//
// The tarball lands in <directory>, by default the repo's tmp/pack. `npm pack`
// runs the package's prepare script, which is the full build.
//
// The package is stamped with the version a release dispatched today would
// publish, as publish.yml derives it, so a consumer that reads the release
// date from the version sees one. package.json is restored afterwards.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = join(import.meta.dirname, "..", "..", "..");
const destination = resolve(process.argv[2] ?? join(root, "tmp", "pack"));
const manifest = join(import.meta.dirname, "..", "package.json");

/** publish.yml's "Set version" step: the floor's last segment becomes the UTC
 *  date, and a prerelease floor must stay a prerelease. */
export function releaseVersion(floor: string, now = new Date()): string {
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  const version = `${floor.slice(0, floor.lastIndexOf("."))}.${date}`;
  if (floor.includes("-") && !version.includes("-"))
    throw new Error(
      `${floor} derives non-prerelease ${version}; a prerelease floor needs a numeric final segment, e.g. 1.0.1-beta.0`,
    );
  return version;
}

if (import.meta.main) {
  mkdirSync(destination, { recursive: true });
  const original = readFileSync(manifest, "utf8");
  const pkg = JSON.parse(original);
  pkg.version = releaseVersion(pkg.version);
  writeFileSync(manifest, JSON.stringify(pkg, null, 2) + "\n");
  let output: string;
  try {
    output = execFileSync(
      "npm",
      ["pack", "--json", "--pack-destination", destination],
      {
        cwd: join(import.meta.dirname, ".."),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "inherit"],
      },
    );
  } finally {
    writeFileSync(manifest, original);
  }
  // prepare's build logs share stdout; the JSON report is the last array.
  const start = output.lastIndexOf("\n[\n") + 1;
  const [{ filename }] = JSON.parse(output.slice(start));
  console.log(join(destination, filename));
}
