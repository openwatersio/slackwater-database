import { countryByNameOrCode, countryForRecord } from "../country.ts";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { backfillCountryCodes } from "../backfill-country-codes.ts";

test("backfill adds only country_code and is repeatable", async () => {
  const root = await mkdtemp(join(tmpdir(), "country-codes-"));
  try {
    await mkdir(join(root, "ticon"));
    const path = join(root, "ticon", "gauge.json");
    const text =
      '{\n  "country": "China",\n  "chart_datum": "TLT",\n  "datums": {"TLT": 0.333000},\n  "latitude": 38.916666666666664\n}\n';
    await writeFile(path, text);
    expect(await backfillCountryCodes(root)).toBe(1);
    const updated = await readFile(path, "utf8");
    expect(updated.replace('  "country_code": "CN",\n', "")).toBe(text);
    expect(await backfillCountryCodes(root)).toBe(0);
    expect(await readFile(path, "utf8")).toBe(updated);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("backfill validates every record before writing any", async () => {
  const root = await mkdtemp(join(tmpdir(), "country-codes-"));
  try {
    const path = join(root, "a.json");
    const text = '{\n  "country": "China"\n}\n';
    await writeFile(path, text);
    await writeFile(join(root, "z.json"), '{\n  "country": "ZZ"\n}\n');
    await expect(backfillCountryCodes(root)).rejects.toThrow(
      /ISO country code/,
    );
    expect(await readFile(path, "utf8")).toBe(text);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("all committed source records carry a stable recognized alpha-2 identity", async () => {
  let count = 0;
  async function check(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await check(path);
      else if (
        entry.name.endsWith(".json") &&
        !entry.name.endsWith(".geo.json")
      ) {
        const record = JSON.parse(await readFile(path, "utf8"));
        expect(record.country_code, path).toMatch(/^[A-Z]{2}$/);
        expect(countryForRecord(record)?.iso2, path).toBe(record.country_code);
        const namedCode = countryByNameOrCode(record.country)?.iso2;
        if (namedCode) expect(namedCode, path).toBe(record.country_code);
        count++;
      }
    }
  }
  await check(new URL("../../../data/", import.meta.url).pathname);
  expect(count).toBeGreaterThan(0);
}, 30_000);

test("backfill rejects a recognized label that contradicts its stored code", async () => {
  const root = await mkdtemp(join(tmpdir(), "country-conflict-"));
  try {
    await writeFile(join(root, "a.json"), '{\n  "country": "China"\n}\n');
    await writeFile(
      join(root, "z.json"),
      '{\n  "country": "Canada",\n  "country_code": "US"\n}\n',
    );
    await expect(backfillCountryCodes(root)).rejects.toThrow(/do not match/);
    expect(await readFile(join(root, "a.json"), "utf8")).not.toContain(
      "country_code",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("backfill retains a coded record whose display label is unfamiliar", async () => {
  const root = await mkdtemp(join(tmpdir(), "country-renamed-"));
  try {
    const path = join(root, "a.json");
    const text = JSON.stringify({
      country: "People's Republic of China",
      country_code: "CN",
    });
    await writeFile(path, text);
    expect(await backfillCountryCodes(root)).toBe(0);
    expect(await readFile(path, "utf8")).toBe(text);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
