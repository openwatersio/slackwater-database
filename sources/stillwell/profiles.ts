import { foremanCandidates } from "@slackwater/engine";
import type { ErrataDecisions } from "@slackwater/harmonic-analysis/stillwell";

/**
 * What differs between Stillwell sources, as data: which values count as
 * final, the candidate list, the decisions on Stillwell's `kept` errata, and
 * how the records are named and credited. Every source runs the same
 * pipeline (sources/stillwell/README.md).
 */
export interface Profile {
  /** Stillwell's source id, which is also this database's data directory:
   *  records are `<source>/<source id>`, as in Stillwell. */
  source: string;
  /** `source.name` on every record, matching `sources/<source>/metadata.yaml`. */
  name: string;
  /** TICON's suffix for this agency's own relays (filtering.ts
   *  SOURCE_PRIORITY), so a fit ranks as the agency's TICON relay does
   *  wherever the held-out comparison doesn't decide. */
  ticonSuffix: string;
  /**
   * For a source that doesn't finalize its values, when they settle, given
   * the time of the run; absent for one that finalizes. Until Stillwell
   * publishes the source's revision window (stillwell#526), this is this
   * project's own rule.
   */
  settled?: (now: Date) => Date;
  /** Decisions on Stillwell's `kept` errata, by erratum id, with why. */
  errata: Record<string, { decision: "drop" | "keep"; why: string }>;
  /** Where a station's own page is, from its source id. */
  url: (sourceId: string) => string;
}

/**
 * A source that never marks its values final has settled a year once that
 * year ended at least twelve months before the run: values before January 1
 * of last year. PEGELONLINE changed raw values it still labels unchecked
 * months after measuring them (Stillwell erratum
 * `pegelonline-cuxhaven-2025-revised`: 13 May to 24 June 2025 moved 4 to
 * 6 cm), so the year just ended may still change. This project's rule, until
 * Stillwell publishes a measured or stated window.
 */
export const TWELVE_MONTHS_AFTER_YEAR_END = (now: Date) =>
  new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1));

/** TICON's 50 names (TICON-4 user manual, https://doi.org/10.17882/109129). */
const TICON = [
  "M2",
  "N2",
  "S2",
  "K2",
  "2N2",
  "S1",
  "K1",
  "P1",
  "O1",
  "Q1",
  "M1",
  "M4",
  "MM",
  "MF",
  "SA",
  "SSA",
  "T2",
  "J1",
  "L2",
  "R2",
  "2Q1",
  "MSF",
  "MSQM",
  "EP2",
  "M3",
  "MU2",
  "MTM",
  "NU2",
  "LAMBDA2",
  "MN4",
  "MS4",
  "MKS2",
  "N4",
  "M6",
  "M8",
  "S4",
  "OO1",
  "S3",
  "MA2",
  "MB2",
  "T3",
  "R3",
  "RHO1",
  "SGM",
  "3L2",
  "3N2",
  "2SM2",
  "2MS6",
  "2MK5",
  "2MO5",
];
/** NOAA CO-OPS's 37, in the order its harmonic constituents pages list them. */
const NOAA = [
  "M2",
  "S2",
  "N2",
  "K1",
  "M4",
  "O1",
  "M6",
  "MK3",
  "S4",
  "MN4",
  "NU2",
  "S6",
  "MU2",
  "2N2",
  "OO1",
  "LAM2",
  "S1",
  "M1",
  "J1",
  "MM",
  "SSA",
  "SA",
  "MSF",
  "MF",
  "RHO",
  "Q1",
  "T2",
  "R2",
  "2Q1",
  "P1",
  "2SM2",
  "M3",
  "L2",
  "2MK3",
  "K2",
  "M8",
  "MS4",
];

/**
 * The candidate list, in priority order: Foreman's 45 astronomical and 24
 * shallow-water constituents in his order (Foreman 1977, the engine's
 * `foremanCandidates`), then the names of NOAA's 37 and TICON's 50 he lacks,
 * so a fit can be compared with either name for name. Each candidate is
 * tested by the Rayleigh criterion against every one kept before it.
 * Spellings the engine's catalog maps to one line count once, under the
 * first spelling. The catalog has no entry under Foreman's names H1 and H2;
 * it defines those lines as MA2 and MB2 (the same Doodson numbers), which
 * join the list under TICON's names, after the NOAA names.
 */
export function candidateList(
  catalog: Record<string, { name: string } | undefined>,
): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const name of [
    ...foremanCandidates.map((c) => c.name),
    ...NOAA,
    ...TICON,
  ]) {
    const line = catalog[name]?.name;
    if (!line || seen.has(line)) continue;
    seen.add(line);
    names.push(name);
  }
  return names;
}

export const PROFILES: Record<string, Profile> = {
  smhi: {
    source: "smhi",
    name: "SMHI",
    ticonSuffix: "smhi",
    errata: {},
    url: (id) =>
      `https://www.smhi.se/data/oceanografi/ladda-ner-oceanografiska-observationer#param=sealevelrh2000,stations=core,stationid=${id}`,
  },
  pegelonline: {
    source: "pegelonline",
    name: "Wasserstraßen- und Schifffahrtsverwaltung des Bundes",
    ticonSuffix: "wsv",
    settled: TWELVE_MONTHS_AFTER_YEAR_END,
    errata: {
      "pegelonline-download-api-differ": {
        decision: "keep",
        why: "Settled years come from PEGELONLINE's raw-data download, which Stillwell reads in its backfills; the REST API's copy, which differs from it, covers only the months since.",
      },
      "pegelonline-cuxhaven-2025-revised": {
        decision: "keep",
        why: "The store holds the revised values, the WSV's latest.",
      },
      "pegelonline-list-2024-level": {
        decision: "drop",
        why: "List auf Sylt sits 8 to 20 cm low against its neighbors from September 2024 with no change of gauge zero, so neither the level nor the datums can be trusted.",
      },
      "pegelonline-wachendorf-zero-date": {
        decision: "keep",
        why: "Only the date PEGELONLINE gives the zero is in doubt, not the levels.",
      },
      "pegelonline-este-sperrwerk-2025-06-03": {
        decision: "drop",
        why: "A single implausible value.",
      },
      "pegelonline-eichhorst-zero": {
        decision: "drop",
        why: "A zero reading between steady levels.",
      },
      "pegelonline-st-pauli-2026-11-09-dip": {
        decision: "drop",
        why: "A one-minute dip on a steady fall.",
      },
    },
    url: (id) =>
      `https://www.pegelonline.wsv.de/gast/stammdaten?pegelnr=${encodeURIComponent(id)}`,
  },
};

export type { ErrataDecisions };
