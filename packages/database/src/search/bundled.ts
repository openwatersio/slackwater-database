import { createGeoIndex } from "./geo.ts" with { type: "macro" };
import { createTextIndex } from "./text.ts" with { type: "macro" };

export interface SearchIndexData {
  geo: string;
  text: string;
}

// The macros become literals in published bundles. Calling this does not
// initialize either index; source-level tests run the generators directly.
export async function bundledSearchData(): Promise<SearchIndexData> {
  return { geo: await createGeoIndex(), text: await createTextIndex() };
}
