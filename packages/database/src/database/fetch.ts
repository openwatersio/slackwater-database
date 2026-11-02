/** Fetch the whole file; individual field reads later use the in-memory bytes. */
export async function fetchDatabase(source: string | URL): Promise<Uint8Array> {
  const response = await fetch(source);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch station database ${source}: ${response.status}`,
    );
  }
  return new Uint8Array(await response.arrayBuffer());
}
