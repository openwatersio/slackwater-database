import { LICENSE_NAMES, type StationData } from "@slackwater/database";
import type { PartialStationData } from "@slackwater/stations";
import type { StillwellStation } from "@slackwater/harmonic-analysis/stillwell";
import type { VerificationReport } from "@slackwater/harmonic-analysis/verify-fit";
import type { Profile } from "./profiles.ts";

/**
 * A Stillwell license as this database records it, ranked by how much it
 * asks of a redistributor, so a fit drawing on several inputs takes the most
 * restrictive. `type` must be a license this database's notices
 * (LICENSE_NAMES) and TCD restrictions both know, or one that imposes no
 * notice; the TCD build throws on any other.
 */
interface LicenseTerms {
  type: string;
  url: string;
  rank: number;
}

/** Stillwell's license ids (stations.parquet `license`), mapped. An id not
 *  here stops the import, so a new license is a decision. */
export const LICENSES: Record<string, LicenseTerms> = {
  // No conditions at all: no credit, no notice. Ranked below CC BY.
  "DL-DE-ZERO-2.0": {
    type: "dl-de-zero-2.0",
    url: "https://www.govdata.de/dl-de/zero-2-0",
    rank: 0,
  },
  "CC-BY-4.0": {
    type: "cc-by-4.0",
    url: "https://creativecommons.org/licenses/by/4.0/",
    rank: 1,
  },
};

/** Stillwell's own data is CC BY 4.0 © Open Waters, over each station's terms
 *  (https://openwatersio.github.io/stillwell/docs/guides/terms/). */
export const STILLWELL_LICENSE = "CC-BY-4.0";

/**
 * The license a fit carries: the most restrictive of Stillwell's own and the
 * station's. A station whose terms bar commercial use is refused, since no
 * source this importer runs has one and the record's terms would need a
 * decision first.
 */
export function fitLicense(
  station: Pick<StillwellStation, "id" | "license" | "commercial_use">,
): StationData["license"] {
  const own = station.license && LICENSES[station.license];
  if (!own)
    throw new Error(
      `${station.id}: no mapping for Stillwell license ${station.license}`,
    );
  if (station.commercial_use !== true)
    throw new Error(`${station.id}: its terms don't allow commercial use`);
  const terms = [LICENSES[STILLWELL_LICENSE]!, own].sort(
    (a, b) => b.rank - a.rank,
  )[0]!;
  // The record's notice and the TCD's restriction both name its license.
  if (!LICENSE_NAMES[terms.type])
    throw new Error(
      `${station.id}: ${terms.type} has no notice in LICENSE_NAMES or TCD restriction`,
    );
  return {
    type: terms.type,
    commercial_use: true,
    url: terms.url,
    notes: `Fitted from observations in Stillwell (CC BY 4.0, Open Waters) under the station's own terms (${station.license}); the record takes the more restrictive.`,
  };
}

/** A name a source writes in capitals, as PEGELONLINE does, in title case. */
export function displayName(name: string): string {
  if (name !== name.toUpperCase()) return name;
  return name
    .toLowerCase()
    .replace(/(^|[\s\-/(.])(\p{L})/gu, (_, sep, c) => sep + c.toUpperCase());
}

/** The fit's provenance, kept in the data file only (the database doesn't
 *  carry `source.stillwell`); schemas/station.schema.json describes it. */
export interface StillwellProvenance {
  series: string;
  /** What the fit read: year file versions, epochs, QC start, errata and
   *  the decisions on kept ones, and the settle cutoff where one applies. */
  inputs: VerificationReport["inputs"];
  /** The rule that made the values final: Stillwell's own (`finalizes`), or
   *  this project's settle rule for a source that doesn't finalize. */
  final: "verified" | "settled";
  fit: {
    start: string;
    end: string;
    hours: number;
    rms: number;
    robust: true;
    nodal: "iho";
    engine: string;
    /** Every candidate's verdict: kept, or why not. */
    selection: { name: string; kept: boolean; reason?: string; snr?: number }[];
    /** Each fitted constituent's 95% intervals and SNR, unrounded. */
    constituents: {
      name: string;
      amplitude_interval: number | null;
      phase_interval: number | null;
      snr: number | null;
    }[];
    conditioning: VerificationReport["fit"]["conditioning"];
    yearly: VerificationReport["fit"]["yearly"];
    seasonal: NonNullable<VerificationReport["fit"]["seasonal"]>;
  };
  /** The held-out year: the fit's tidal-band RMS and every scored TICON
   *  record's, with the standard error of each difference (null where the
   *  year can't measure it), a digest of the constants scored, and whether
   *  that record's analysis covered the year. */
  held_out: {
    year: number;
    hours: number;
    rms: number;
    ticon: Record<
      string,
      { rms: number; se: number | null; digest: string; seen: boolean }
    >;
  } | null;
  /** Stillwell's level comparison between this series and each TICON
   *  record's GESLA series: the evidence a merge reads. */
  links: Record<string, { rms_m: number; lag_h: number; months: number } | null>;
}

export interface RecordInputs {
  profile: Profile;
  station: StillwellStation;
  report: VerificationReport;
  constituents: StationData["harmonic_constituents"];
  datums: Pick<
    PartialStationData,
    "datums" | "datums_source" | "datum_frame" | "datum_epoch" | "datum_coverage"
  >;
  datumNotice: string;
  engine: string;
  /** Each scored TICON record's constituentsDigest, by id. */
  digests: Record<string, string>;
  links: StillwellProvenance["links"];
}

/** The data record for one fit, before `normalize`. */
export function buildRecord(input: RecordInputs): PartialStationData {
  const { profile, station, report } = input;
  if (station.lat === null || station.lon === null || !station.country_code)
    throw new Error(`${station.id} has no position or country in Stillwell`);
  const sourceId = encodeURIComponent(station.source_id);
  const heldOut = report.heldOut;
  const provenance: StillwellProvenance = {
    series: station.id,
    inputs: report.inputs,
    final: profile.settled ? "settled" : "verified",
    fit: {
      start: report.fit.start,
      end: report.fit.end,
      hours: report.fit.hours,
      rms: report.fit.rms,
      robust: true,
      nodal: "iho",
      engine: input.engine,
      selection: (report.fit.selection ?? []).map((s) => ({
        name: s.name,
        kept: s.kept,
        ...(s.reason ? { reason: s.reason } : {}),
        ...(s.snr !== undefined ? { snr: s.snr } : {}),
      })),
      constituents: report.fit.constituents.map((c) => ({
        name: c.name,
        amplitude_interval: c.amplitudeInterval,
        phase_interval: c.phaseInterval,
        snr: c.snr,
      })),
      conditioning: report.fit.conditioning,
      yearly: report.fit.yearly,
      seasonal: report.fit.seasonal ?? {},
    },
    held_out: heldOut && {
      year: heldOut.year,
      hours: heldOut.fit.hours,
      rms: heldOut.fit.rms,
      ticon: Object.fromEntries(
        Object.entries(heldOut.others)
          .filter(([id]) => id.startsWith("ticon/") || id.startsWith("refit/"))
          .map(([id, s]) => {
            const ticon = id.replace(/^(ticon|refit)\//, "");
            const digest = input.digests[ticon];
            if (!digest) throw new Error(`no digest for ${ticon}`);
            return [
              ticon,
              { rms: s.rms, se: s.se ?? null, digest, seen: s.seen ?? false },
            ];
          }),
      ),
    },
    links: input.links,
  };
  const seasonalNote = Object.entries(report.fit.seasonal ?? {})
    .map(
      ([name, s]) =>
        `${name} ${s.published ? "published" : "left out"}: ${(s.amplitude * 1000).toFixed(0)} mm against a yearly standard error of ${s.spread ? (s.spread.se * 1000).toFixed(0) : "unmeasured"} mm`,
    )
    .join("; ");
  return {
    name: displayName(station.name ?? station.source_id),
    country: station.country_code,
    country_code: station.country_code,
    latitude: station.lat,
    longitude: station.lon,
    type: "reference",
    source: {
      name: profile.name,
      id: sourceId,
      published_harmonics: false,
      url: profile.url(station.source_id),
      stillwell: provenance,
    } as StationData["source"],
    license: fitLicense(station),
    disclaimers: [
      `Harmonic constants fitted by Slackwater from ${profile.name}'s observed water levels in Stillwell (${station.id}), ${report.fit.start} to ${report.fit.end}, not constants the agency published.`,
      heldOut
        ? `Checked against observations of ${heldOut.year}, which the fit did not see.`
        : "No later year was available to check the fit against.",
      seasonalNote ? `Seasonal terms: ${seasonalNote}.` : "",
      input.datumNotice,
    ]
      .filter(Boolean)
      .join(" "),
    harmonic_constituents: input.constituents,
    ...input.datums,
    epoch: { start: report.fit.start, end: report.fit.end },
  } as PartialStationData;
}
