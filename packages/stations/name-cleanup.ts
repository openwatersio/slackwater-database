export interface CleanNameResult {
  name: string;
  region?: string | undefined;
  isOpaque: boolean;
  original: string;
}

const US_STATES = new Set([
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
  "DC",
  "PR",
  "VI",
  "GU",
  "AS",
]);

const CA_PROVINCES = new Set([
  "BC",
  "AB",
  "SK",
  "MB",
  "ON",
  "QC",
  "NB",
  "NS",
  "PE",
  "NL",
  "YT",
  "NT",
  "NU",
]);

const SMALL_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "but",
  "or",
  "at",
  "by",
  "for",
  "in",
  "of",
  "on",
  "to",
  "up",
  "near",
  "nr",
  // French/Spanish/Dutch/German prepositions
  "de",
  "du",
  "des",
  "le",
  "la",
  "les",
  "sur",
  "en",
  "ad",
  "van",
  "von",
  "den",
  "der",
  "het",
]);

// Acronyms in fully capitalized names need to opt out of recasing.
const PRESERVED_CAPS = new Set(
  "NNE NE ENE ESE SE SSE SSW SW WSW WNW NW NNW US BC USCG LB ICW ICWW RR MBTS CBBT AWG NERR HBR HVN LAWMA COX WCOCO".split(
    " ",
  ),
);

// Network prefixes to strip (the remainder is the actual place name)
const NETWORK_PREFIXES = ["RMN_", "IOC_"];

/**
 * Abbreviations NOAA writes into station names, spelled out the way a chart
 * says them. Deliberately short: only the noisy ones. A trailing "I." is an
 * island ("Savage I.", "Long I., Rainsford I."); one mid-name may be an
 * initial, so it is left alone.
 */
const EXPAND: [RegExp, string][] = [
  [/\bNAS\b/g, "Naval Air Station"],
  [/\bSt\. Park\b/gi, "State Park"],
  [/\bent\./gi, "Entrance"],
  [/\bI\.(?=$|,)/g, "Island"],
  [/\bIs\./gi, "Islands"],
  [/\bPt\./gi, "Point"],
  [/\bCk\./gi, "Creek"],
];

/** 1 statute mile = 1.609344 km; 1 nautical mile = 1.852 km. */
const NM_PER_MILE = 1.609344 / 1.852;

/**
 * A distance and its unit, in any of the spellings NOAA uses: "7.6 mi.",
 * "0.8mile", "1.0 n.mi.", "0.4 nmi.", "0.3 nautical mile", "3nm.". The
 * leading number is required; it is what separates a measurement from a
 * place called Six Mile Reef or Miles Point.
 */
const DISTANCE =
  /(\d+(?:\.\d+)?)\s*(n\.?\s?mi\.?|nautical\s+miles?|nm\.?|mi\.|miles?)(?![a-z])/gi;

/**
 * State a distance in nautical miles, however the provider wrote it. NOAA
 * mixes units within one dataset ("Cattle Point, 1.2 nm SE of" beside
 * "Browns Point, 1.6 miles North of"), and a consumer listing both wants them
 * to agree. A converted distance gets one decimal, the precision NOAA itself
 * writes; one already nautical keeps its number verbatim rather than being
 * round-tripped.
 */
function toNauticalMiles(name: string): string {
  return name.replace(DISTANCE, (_, value: string, unit: string) =>
    unit[0]!.toLowerCase() === "n"
      ? `${value} nm`
      : `${(Number(value) * NM_PER_MILE).toFixed(1)} nm`,
  );
}

/**
 * Countries whose place names hyphenate a linking preposition
 * ("Boulogne-sur-Mer"). Metropolitan France and the overseas départements and
 * collectivités, where the toponymy is French and the convention holds.
 *
 * Canada is deliberately absent: Québec hyphenates, but the rest does not, and
 * a Québec name arrives hyphenated from its source rather than needing one
 * inferred. Belgium, Switzerland and Luxembourg are absent for the same
 * reason — partly French-speaking, so the country cannot stand in for the
 * language of any one name.
 */
const FRENCH_HYPHENATING_COUNTRIES = new Set([
  "France",
  "French Guiana",
  "French Polynesia",
  "French Southern and Antarctic Lands",
  "Guadeloupe",
  "Martinique",
  "Mayotte",
  "Monaco",
  "New Caledonia",
  "Reunion",
  "Saint Barthélemy",
  "Saint Martin",
  "Saint Pierre and Miquelon",
  "Wallis and Futuna",
]);

/**
 * A source's raw station name reduced to a display name, with any trailing US
 * or Canadian region code lifted out into `region`.
 *
 * Every station goes through this, whichever publisher it came from, so a rule
 * that suits one publisher's spelling has to be harmless to the rest.
 * `country` is what keeps that tractable: it decides which region codes are
 * valid and which naming conventions apply.
 * `existingRegionCode` guards removal of a space-separated trailing code.
 */
export function cleanName(
  raw: string,
  country: string,
  existingRegionCode?: string,
): CleanNameResult {
  const original = raw;
  let name = raw;
  let region: string | undefined;

  // Step 0: Strip network prefixes (RMN_, IOC_)
  for (const prefix of NETWORK_PREFIXES) {
    if (name.startsWith(prefix)) {
      name = name.slice(prefix.length);
      break;
    }
  }

  // Step 1: Strip metadata suffixes
  // Order: _NAVD88, interval suffixes, TG with optional interval, standalone _T
  name = name.replace(/_NAVD88$/i, "");
  name = name.replace(/(?:TG)?_(?:\d+minute|monthly|hourly|daily)$/i, "");
  name = name.replace(/TG$/, "");

  // Strip trailing _T (transducer) and _H (height) gauge markers
  // These are measurement type suffixes, not part of the place name
  name = name.replace(/_[TH]$/, "");

  // Step 2: Extract trailing region codes for US/Canada
  const validRegions =
    country === "United States"
      ? US_STATES
      : country === "Canada"
        ? CA_PROVINCES
        : undefined;
  const regionMatch = name.match(/([_ ])([A-Za-z]{2})$/);
  const expectedRegion = existingRegionCode?.toUpperCase().split("-").at(-1);
  if (
    regionMatch?.[2] &&
    validRegions?.has(regionMatch[2].toUpperCase()) &&
    (regionMatch[1] === "_" ||
      !expectedRegion ||
      !validRegions.has(expectedRegion) ||
      regionMatch[2].toUpperCase() === expectedRegion)
  ) {
    region = regionMatch[2].toUpperCase();
    name = name.slice(0, -3).replace(/[,\s]+$/, "");
  }

  // Step 3: Replace underscores with spaces
  name = name.replace(/_/g, " ");

  // Step 3b: Spell out abbreviations, before title case so the words this
  // writes are cased like any other.
  for (const [pattern, replacement] of EXPAND) {
    name = name.replace(pattern, replacement);
  }

  // Step 4: Split PascalCase
  // Insert space between lowercase→uppercase transitions, except inside a
  // Mc/Mac surname, which is one word however it is cased: "PortAngeles" is
  // PascalCase to split, "McAllister" and "MacLeod" are not.
  name = name.replace(
    /([a-z])([A-Z])/g,
    (match, lower, upper, offset: number, whole: string) =>
      /(?:^|[^A-Za-z])(?:Mc|Mac)$/.test(whole.slice(0, offset + 1))
        ? match
        : `${lower} ${upper}`,
  );
  // Insert space between uppercase run and uppercase+lowercase (e.g., "ABCDef" → "ABC Def")
  name = name.replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");

  // Step 5: Strip trailing version-like single digits (Alicante2 → Alicante)
  // Only strip from the final word when it's a real place name (has vowels, 4+ alpha chars)
  name = name.replace(/(?<=\s|^)([a-zA-Z]{4,})\d$/, "$1");

  // Step 6: Title case
  name = toTitleCase(name, country, validRegions);

  // Step 6b: State distances in nautical miles. After title case, so the
  // lowercase "nm" it writes is the spelling NOAA's own qualifiers use
  // ("3.0 nm NE of") rather than a word to be cased.
  name = toNauticalMiles(name);

  // Step 7: Post-processing — French-style hyphenation for small prepositions
  // "Boulogne sur Mer" → "Boulogne-sur-Mer", "Aiguillon sur Mer" → "Aiguillon-sur-Mer"
  //
  // French place names hyphenate; Spanish and English ones sharing the same
  // prepositions do not. Applied by country, because the prepositions alone
  // cannot tell them apart.
  if (FRENCH_HYPHENATING_COUNTRIES.has(country)) {
    name = frenchHyphenation(name);
  }

  // Handle D' apostrophe: "Dumont d Urville" → "Dumont d'Urville"
  name = name.replace(
    /\bd ([AEIOUY])/gi,
    (_, vowel) => `d'${vowel.toUpperCase()}`,
  );

  // Trim extra whitespace
  name = name.replace(/\s+/g, " ").trim();

  const isOpaque = isOpaqueName(name);

  return { name, region, isOpaque, original };
}

function toTitleCase(
  str: string,
  country: string,
  validRegions?: Set<string>,
): string {
  const words = str.split(/\s+/);
  const shouting = !/[a-z]/.test(str);
  const allCaps = words.map(
    (word) => /^[A-Z]{2,}$/.test(word) && !validRegions?.has(word),
  );

  return words
    .map((word, i) => {
      const bare = word.replace(/[)\]},]+$/, "");
      if (i > 0 && word === word.toUpperCase() && validRegions?.has(bare)) {
        return word;
      }
      if (
        i > 0 &&
        SMALL_WORDS.has(bare.toLowerCase()) &&
        !(shouting && i === words.length - 1 && bare === "IN") &&
        !(
          country === "United States" &&
          bare.toLowerCase() === "la" &&
          words[i - 1]?.toLowerCase() !== "a"
        )
      ) {
        return word.toLowerCase();
      }
      return capitalize(
        word,
        shouting ||
          i === 0 ||
          (allCaps[i] && (allCaps[i - 1] || allCaps[i + 1])),
      );
    })
    .join(" ");
}

function capitalize(word: string, recaseAllCaps = false): string {
  if (!word) return word;
  // Brackets wrap a word without being part of it. Capitalise what is inside
  // them and put them back, or the bracket absorbs the capital the word was
  // owed: "(Observatory)" came back "(observatory)", and "(US" stopped
  // matching the acronym test below because of the leading "(". Brackets
  // only, not punctuation generally — a trailing "." belongs to the word
  // ("U.S.") rather than wrapping it.
  const wrapped = /^([([{]+)?(.+?)([)\]}]+)?$/.exec(word);
  if (wrapped && (wrapped[1] ?? wrapped[3])) {
    return (
      (wrapped[1] ?? "") +
      capitalize(wrapped[2]!, recaseAllCaps) +
      (wrapped[3] ?? "")
    );
  }
  const letters = word.replace(/[^A-Za-z]/g, "");
  if (letters === letters.toUpperCase() && PRESERVED_CAPS.has(letters)) {
    return word;
  }
  if (/^[A-Z]+(?:&[A-Z]+)+$/.test(word)) return word;
  // Preserve isolated acronyms in otherwise human-cased names.
  if (
    !recaseAllCaps &&
    word === word.toUpperCase() &&
    /^[A-Z]+(?:&[A-Z]+)*$/.test(word)
  ) {
    return word;
  }
  // Preserve dotted acronyms ("U.S.", "N.J."), but not abbreviations like
  // "ST.", which title-case as the words they stand for.
  if (/^(?:[A-Z]\.)+$/.test(word)) {
    return word;
  }
  if (recaseAllCaps && /^MC[A-Z]+$/.test(word)) {
    return `Mc${word.charAt(2)}${word.slice(3).toLowerCase()}`;
  }
  // Preserve the interior capital of a Mc/Mac surname. The PascalCase split
  // above already leaves "McHenry" whole; without this it arrives here and
  // comes back "Mchenry".
  if (/^(?:Mc|Mac)[A-Z][a-z]/.test(word)) {
    return word;
  }
  // Preserve code-like words (uppercase letters + digits: CRMS0572, WC-53)
  if (/^[A-Z]+-?\d+[A-Z]?$/i.test(word) && word === word.toUpperCase()) {
    return word;
  }
  // Handle hyphenated or apostrophe-separated words: capitalize each segment
  if (word.includes("-") || word.includes("'")) {
    const parts = word.split(/([-'])/);
    return parts
      .map((seg, i) => {
        // Preserve separators
        if (seg === "-" || seg === "'") return seg;
        if (!seg) return seg;
        // A possessive is not a compound: "Martha's" kept coming back
        // "Martha'S" because the s after the apostrophe was capitalised like
        // the second half of a hyphenated name.
        if (parts[i - 1] === "'" && seg.toLowerCase() === "s") {
          return seg.toLowerCase();
        }
        // Lowercase small words in middle segments (after first separator)
        if (i > 0 && SMALL_WORDS.has(seg.toLowerCase())) {
          return seg.toLowerCase();
        }
        return seg.charAt(0).toUpperCase() + seg.slice(1).toLowerCase();
      })
      .join("");
  }
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * For French/Spanish/Italian place names, connect small prepositions with hyphens.
 * "Boulogne sur Mer" → "Boulogne-sur-Mer"
 */
function frenchHyphenation(name: string): string {
  const frenchPreps = new Set([
    "sur",
    "sous",
    "les",
    "le",
    "la",
    "de",
    "du",
    "des",
    "en",
  ]);
  const words = name.split(" ");
  if (words.length < 3) return name;

  const result: string[] = [];
  let i = 0;
  while (i < words.length) {
    const word = words[i]!;
    const prev = words[i - 1];
    const next = words[i + 1];
    if (
      i > 0 &&
      prev &&
      next &&
      frenchPreps.has(word.toLowerCase()) &&
      // Check that surrounding words are capitalized place name parts (not abbreviations)
      prev.length >= 3 &&
      next.length >= 3 &&
      prev[0] === prev[0]?.toUpperCase() &&
      next[0] === next[0]?.toUpperCase()
    ) {
      // Connect: previous-prep-next
      const prevResult = result.pop()!;
      result.push(`${prevResult}-${word.toLowerCase()}-${next}`);
      i += 2;
    } else {
      result.push(word);
      i++;
    }
  }
  return result.join(" ");
}

/**
 * Detect names that are still opaque codes after cleaning.
 */
function isOpaqueName(name: string): boolean {
  const stripped = name.replace(/\s/g, "");
  // Mostly digits: "S197", "G57"
  if (/^[A-Z]{0,4}\d+[A-Z]?$/i.test(stripped)) return true;
  // Known opaque prefixes
  if (/^CRMS\d/i.test(stripped)) return true;
  if (/^PTM\d/i.test(stripped)) return true;
  // Very short with no vowels
  if (stripped.length <= 4 && !/[aeiou]/i.test(stripped)) return true;
  return false;
}
