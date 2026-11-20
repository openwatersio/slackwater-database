import evidence from "./noaa-virgin-islands.json" with { type: "json" };

export type CountrySource = { name?: string; id?: string };

const stations = new Map(evidence.records.map((record) => [record.id, record]));

export function sourceCountryInput(input: string, source?: CountrySource) {
  const station =
    source?.name === evidence.sourceName && source.id
      ? stations.get(source.id)
      : undefined;
  if (input !== evidence.originalCountry || !station) return { input };
  return {
    input: evidence.lookupCountry,
    mapping: {
      sourceName: evidence.sourceName,
      stationId: station.id,
      entity: evidence.entity,
      issue: evidence.issue,
      benchmark: station.benchmarkURL,
      metadata: station.source,
    },
  };
}

export function groupCountryInputs(
  records: Iterable<{ country: string; source?: CountrySource }>,
) {
  const groups = new Map<
    string,
    {
      input: string;
      lookupInput: string;
      records: number;
      sourceMappings: NonNullable<
        ReturnType<typeof sourceCountryInput>["mapping"]
      >[];
    }
  >();
  for (const record of records) {
    const normalized = sourceCountryInput(record.country, record.source);
    const key = JSON.stringify([record.country, normalized.input]);
    let group = groups.get(key);
    if (!group) {
      group = {
        input: record.country,
        lookupInput: normalized.input,
        records: 0,
        sourceMappings: [],
      };
      groups.set(key, group);
    }
    group.records++;
    if (normalized.mapping) group.sourceMappings.push(normalized.mapping);
  }
  return [...groups.values()];
}
