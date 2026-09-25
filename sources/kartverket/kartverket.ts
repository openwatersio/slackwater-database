import { normalize } from "@slackwater/stations";
import type { StationData } from "@slackwater/database";
import { constituents as catalogue } from "@slackwater/engine";
import { XMLParser, XMLValidator } from "fast-xml-parser";

type Attributes = Record<string, string>;
type XmlNode = Record<string, unknown>;

export type KartverketStation = {
  name: string;
  code: string;
  latitude: number;
  longitude: number;
};

export type KartverketConstituent = {
  name: string;
  speed: number;
  doodson: string;
};

export type ParsedConstituents = {
  location: KartverketStation;
  constituents: StationData["harmonic_constituents"];
  epoch?: NonNullable<StationData["epoch"]>;
};

export type ParsedLocationLevels = {
  location: KartverketStation & { place?: string };
  datums: Record<string, number>;
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  processEntities: false,
});
const SPEED_TOLERANCE = 0.0001;
const KARTVERKET_SOURCE =
  "https://www.kartverket.no/en/api-and-data/tides-and-water-level-data";
const KARTVERKET_TERMS =
  "https://www.kartverket.no/en/api-and-data/terms-of-use";
const KARTVERKET_CREDIT =
  "Tide and water-level data © Kartverket / Norwegian Mapping Authority, Hydrographic Service, licensed under CC BY 4.0.";
const DATUMS = new Set([
  "HAT",
  "MHWS",
  "MHW",
  "MHWN",
  "NN2000",
  "MSL",
  "MLWN",
  "MLW",
  "MLWS",
  "LAT",
  "CD",
]);

const overrides = new Map<string, string>([
  ["EPS2|27.4238338|BWBAZZZ", "eps2"],
  ["GAM2|28.91125066|BZXBZZB", "gamma2"],
  ["H1|28.94303758|BZYZZAB", "alpha2"],
  ["H2|29.02517093|BZAZZYZ", "M(KS)2"],
  ["LDA2|29.45562534|BAXAZZB", "lambda2"],
  ["SIG1|12.92713985|AWBZZZY", "sigma1"],
  ["THE1|15.51258972|ABXAZZA", "theta1"],
  ["SA|0.04106668|ZZAZZYZ", "SA_KV"],
  ["S1|15.00000196|AAYZZAA", "S1_KV"],
  ["OQ2|27.35098024|BWZCZZZ", "OQ2_KV"],
]);

export const normalizePhase = (phase: number, speed: number) =>
  (((phase - speed) % 360) + 360) % 360;

export const centimetersToMeters = (value: string) => Number(value) / 100;

const decimal = (value: number) => Number(value.toFixed(8));

function asArray<T>(value: T | T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function attributes(value: XmlNode | undefined): Attributes {
  return Object.fromEntries(
    Object.entries(value ?? {}).flatMap(([key, value]) =>
      key.startsWith("@") && typeof value === "string"
        ? [[key.slice(1), value]]
        : [],
    ),
  );
}

function number(value: string | undefined, name: string): number {
  if (!value?.trim()) throw new Error(`Invalid ${name}: ${value}`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid ${name}: ${value}`);
  return parsed;
}

function location(value: Attributes | undefined): KartverketStation {
  if (!value?.["name"] || !value["code"]) throw new Error("Missing location");
  return {
    name: value["name"],
    code: value["code"],
    latitude: number(value["latitude"], "latitude"),
    longitude: number(value["longitude"], "longitude"),
  };
}

function levelLocation(value: Attributes | undefined) {
  const parsed = location(value);
  return {
    ...parsed,
    ...(value?.["place"] ? { place: value["place"] } : {}),
  };
}

export function parseXml(xml: string): Record<string, unknown> {
  const declaration = /<!\s*(DOCTYPE|ENTITY)\b/i.exec(xml);
  if (declaration)
    throw new Error(`Unsafe XML ${declaration[1]!.toUpperCase()} declaration`);

  const valid = XMLValidator.validate(xml);
  if (valid !== true) throw new Error(`Invalid XML: ${valid.err.msg}`);

  const tide = (parser.parse(xml) as { tide?: XmlNode }).tide;
  if (!tide) throw new Error("Missing tide response");
  if (tide["error"] !== undefined) {
    const error = attributes(tide["error"] as XmlNode | undefined);
    throw new Error(
      error["message"] ?? error["info"] ?? "Kartverket XML error",
    );
  }
  return tide;
}

function tupleKey({ name, speed, doodson }: KartverketConstituent) {
  return `${name.toUpperCase()}|${speed}|${doodson.toUpperCase()}`;
}

function doodsonCoefficients(doodson: string) {
  if (!/^[W-ZA-Z]{7}$/.test(doodson))
    throw new Error(`Invalid Doodson: ${doodson}`);
  return [...doodson].map((letter, index) => {
    const value =
      letter >= "U" && letter <= "Z"
        ? letter.charCodeAt(0) - "Z".charCodeAt(0)
        : letter.charCodeAt(0) - "A".charCodeAt(0) + 1;
    return index === 6 ? -value : value;
  });
}

export function resolveConstituent(tuple: KartverketConstituent): string {
  const override = overrides.get(tupleKey(tuple));
  if (override) return override;

  const unique = [...new Set(Object.values(catalogue))];
  const named = unique.filter(
    (candidate) =>
      Math.abs(candidate.speed - tuple.speed) <= SPEED_TOLERANCE &&
      [candidate.name, ...candidate.aliases].some(
        (name) => name.toLowerCase() === tuple.name.toLowerCase(),
      ),
  );

  if (tuple.doodson.toUpperCase() === "ZZZZZZZ") {
    if (named.length === 1) return named[0]!.name;
  } else {
    const coefficients = doodsonCoefficients(tuple.doodson.toUpperCase());
    const matches = unique.filter(
      (candidate) =>
        Math.abs(candidate.speed - tuple.speed) <= SPEED_TOLERANCE &&
        [candidate.name, ...candidate.aliases].some(
          (name) => name.toLowerCase() === tuple.name.toLowerCase(),
        ) &&
        candidate.coefficients?.every(
          (value, index) => value === coefficients[index],
        ),
    );
    if (matches.length === 1) return matches[0]!.name;
  }

  throw new Error(`Unknown constituent: ${tupleKey(tuple)}`);
}

export function parseStationList(xml: string) {
  const tide = parseXml(xml);
  const stationinfo = tide["stationinfo"] as XmlNode | undefined;
  const stations = asArray(
    (stationinfo?.["location"] ?? stationinfo?.["station"]) as
      XmlNode | XmlNode[] | undefined,
  ).map((station) => location(attributes(station)));
  if (stations.length === 0) throw new Error("Missing stations");
  return { stations };
}

export function parseConstituents(xml: string): ParsedConstituents {
  const tide = parseXml(xml);
  const data = tide["constituents"] as XmlNode | undefined;
  if (!data) throw new Error("Missing constituents");
  const dataAttributes = attributes(data);
  if (dataAttributes["unit"] !== "cm")
    throw new Error(`Unexpected constituent unit: ${dataAttributes["unit"]}`);
  if (dataAttributes["utcoffset"] !== "+01:00")
    throw new Error(`Unexpected UTC offset: ${dataAttributes["utcoffset"]}`);

  const constituents = asArray(
    data["constituent"] as XmlNode | XmlNode[] | undefined,
  ).map((node) => {
    const value = attributes(node);
    if (!value["name"] || !value["doodson"])
      throw new Error("Invalid constituent");
    const speed = number(value["speed"], "constituent speed");
    const amplitude = number(value["amplitude"], "constituent amplitude");
    return {
      name: resolveConstituent({
        name: value["name"],
        speed,
        doodson: value["doodson"],
      }),
      amplitude: decimal(amplitude / 100),
      phase: decimal(
        normalizePhase(number(value["phaseangle"], "constituent phase"), speed),
      ),
    };
  });
  if (constituents.length === 0) throw new Error("Missing constituent values");

  const observations = attributes(data["observations"] as XmlNode | undefined);
  const epoch =
    observations?.["start"] && observations["end"]
      ? {
          start: observations["start"].slice(0, 10),
          end: observations["end"].slice(0, 10),
        }
      : undefined;
  return {
    location: location(attributes(data["location"] as XmlNode | undefined)),
    constituents,
    ...(epoch ? { epoch } : {}),
  };
}

export function parseLocationLevels(xml: string): ParsedLocationLevels {
  const tide = parseXml(xml);
  const data = tide["locationlevel"] as XmlNode | undefined;
  if (!data) throw new Error("Missing location levels");
  const dataAttributes = attributes(data);
  if (dataAttributes["unit"] !== "cm")
    throw new Error(`Unexpected level unit: ${dataAttributes["unit"]}`);
  if (dataAttributes["reflevel"] !== "CD")
    throw new Error(`Unexpected level reflevel: ${dataAttributes["reflevel"]}`);

  const datums = Object.fromEntries(
    asArray(data["reflevel"] as XmlNode | XmlNode[] | undefined)
      .map(attributes)
      .filter((level) => level["code"] && DATUMS.has(level["code"]))
      .map((level) => {
        const value = number(level["value"], "datum value");
        return [level["code"], decimal(value / 100)];
      }),
  );
  return {
    location: levelLocation(
      attributes(data["location"] as XmlNode | undefined),
    ),
    datums,
  };
}

export function buildStation(input: {
  station: KartverketStation;
  constituents: ParsedConstituents;
  levels: ParsedLocationLevels;
}): StationData {
  const levelLocationMatches =
    input.station.code === input.levels.location.code ||
    (input.station.name === input.levels.location.place &&
      input.station.latitude === input.levels.location.latitude &&
      input.station.longitude === input.levels.location.longitude);
  if (
    input.station.code !== input.constituents.location.code ||
    !levelLocationMatches
  ) {
    throw new Error("Mismatched station response codes");
  }

  return normalize({
    name: input.station.name,
    latitude: input.station.latitude,
    longitude: input.station.longitude,
    country: "Norway",
    type: "reference",
    chart_datum: "CD",
    source: {
      name: "Kartverket / Norwegian Mapping Authority, Hydrographic Service",
      id: input.station.code,
      published_harmonics: true,
      url: KARTVERKET_SOURCE,
    },
    license: {
      type: "cc-by-4.0",
      commercial_use: true,
      url: KARTVERKET_TERMS,
    },
    disclaimers: KARTVERKET_CREDIT,
    harmonic_constituents: input.constituents.constituents,
    datums: input.levels.datums,
    ...(input.constituents.epoch ? { epoch: input.constituents.epoch } : {}),
  });
}
