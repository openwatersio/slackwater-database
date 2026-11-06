import { expect, test } from "vitest";
import { releaseVersion } from "../scripts/pack-local.ts";

const day = new Date("2026-10-18T23:30:00Z");

test("stamps the version a release dispatched that UTC day would publish", () => {
  expect(releaseVersion("1.0.0-beta.0", day)).toBe("1.0.0-beta.20261018");
  expect(releaseVersion("1.0.1-beta.0", day)).toBe("1.0.1-beta.20261018");
  expect(releaseVersion("1.0.0", day)).toBe("1.0.20261018");
});

test("refuses a prerelease floor that would derive a stable version", () => {
  expect(() => releaseVersion("1.0.0-beta", day)).toThrow(/prerelease/);
});
