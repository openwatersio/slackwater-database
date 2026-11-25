import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { countryByNameOrCode, countryForRecord } from "./country.ts";

export async function backfillCountryCodes(root: string): Promise<number> {
  async function walk(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    return (
      await Promise.all(
        entries.map((entry) =>
          entry.isDirectory()
            ? walk(join(directory, entry.name))
            : entry.name.endsWith(".json") && !entry.name.endsWith(".geo.json")
              ? [join(directory, entry.name)]
              : [],
        ),
      )
    ).flat();
  }
  const changes: { path: string; text: string }[] = [];
  for (const path of (await walk(root)).sort()) {
    const text = await readFile(path, "utf8");
    const record = JSON.parse(text);
    const code = countryForRecord(record)?.iso2;
    if (!code)
      throw new Error(`${path}: no ISO country code for ${record.country}`);
    const namedCode = countryByNameOrCode(record.country)?.iso2;
    if (namedCode && namedCode !== code)
      throw new Error(`${path}: country label and country_code do not match`);
    if (record.country_code !== undefined) continue;
    // Keep every published digit and all other source bytes unchanged.
    const updated = text.replace(
      /^  "country": /m,
      `  "country_code": "${code}",\n  "country": `,
    );
    if (updated === text)
      throw new Error(`${path}: expected an indented country field`);
    changes.push({ path, text: updated });
  }
  for (const change of changes) await writeFile(change.path, change.text);
  return changes.length;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 2)
    throw new Error("Usage: backfill-country-codes.ts");
  console.log(
    `Backfilled ${await backfillCountryCodes(fileURLToPath(new URL("../../data", import.meta.url)))} country identities.`,
  );
}
