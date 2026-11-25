type ResolutionCase = {
  input: string;
  records: number;
  actual: { continent: string | undefined } | null;
  tentative: boolean;
};

export function resolutionCounts(cases: readonly ResolutionCase[]) {
  const resolved = cases.filter((c) => c.actual !== null);
  return {
    resolvedInputs:
      new Set(cases.map((c) => c.input)).size -
      new Set(cases.filter((c) => c.actual === null).map((c) => c.input)).size,
    resolvedGroups: resolved.length,
    resolvedRecords: resolved.reduce((sum, c) => sum + c.records, 0),
    resolvedGroupsWithoutContinent: resolved.filter(
      (c) => !c.actual?.continent?.trim(),
    ).length,
    tentativeResolvedGroups: resolved.filter((c) => c.tentative).length,
    tentativeResolvedRecords: resolved.reduce(
      (sum, c) => sum + (c.tentative ? c.records : 0),
      0,
    ),
  };
}
