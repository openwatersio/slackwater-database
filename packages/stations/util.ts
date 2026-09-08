export function indexBy<T>(data: T[], key: keyof T) {
  return Object.fromEntries(
    data.map((r) => {
      return [r[key], r];
    }),
  );
}

export function groupBy<T>(
  data: T[],
  keyFn: (item: T) => string,
): Record<string, T[]> {
  const result: Record<string, T[]> = {};

  for (const item of data) {
    const key = keyFn(item);
    if (!result[key]) {
      result[key] = [];
    }
    result[key].push(item);
  }

  return result;
}

/**
 * Parse a CSV file
 */
export function parseCSV<T>(content: string): T[] {
  const lines = content.trim().split(/[\r\n]+/);
  const headers = (lines.shift() ?? "").split(",");

  return lines.map((line) => {
    const values = line.split(",");
    return Object.fromEntries(
      headers.map((header, index) => [header, values[index]]),
    ) as T;
  });
}
