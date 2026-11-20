import evidence from "./noaa-virgin-islands.json" with { type: "json" };

import ticon from "./ticon-saint-helena.json" with { type: "json" };

export type CountrySource = { name?: string; id?: string };

const stations = new Map(evidence.records.map((record) => [record.id, record]));

export function sourceCountryInput(input: string, source?: CountrySource) {
  const series =
    input === ticon.originalCountry && source?.name === ticon.sourceName
      ? ticon.records.find((record) => record.id === source.id)
      : undefined;
  if (series)
    return {
      input: series.countryCode,
      namespace: "iso-alpha3" as const,
      mapping: {
        sourceName: ticon.sourceName,
        stationId: series.id,
        entity: ticon.entity,
        issue: ticon.issue,
        dataset: ticon.dataset,
        datasetSha256: ticon.datasetSha256,
      },
    };
  const station =
    source?.name === evidence.sourceName && source.id
      ? stations.get(source.id)
      : undefined;
  if (input !== evidence.originalCountry || !station)
    return { input, namespace: "name" as const };
  return {
    input: evidence.lookupCountry,
    namespace: "name" as const,
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
      lookupNamespace: ReturnType<typeof sourceCountryInput>["namespace"];
      records: number;
      sourceMappings: NonNullable<
        ReturnType<typeof sourceCountryInput>["mapping"]
      >[];
    }
  >();
  for (const record of records) {
    const normalized = sourceCountryInput(record.country, record.source);
    const key = JSON.stringify([
      record.country,
      normalized.input,
      normalized.namespace,
    ]);
    let group = groups.get(key);
    if (!group) {
      group = {
        input: record.country,
        lookupInput: normalized.input,
        lookupNamespace: normalized.namespace,
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
