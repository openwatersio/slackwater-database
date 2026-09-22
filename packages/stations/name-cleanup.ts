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

// Long all-caps words are recased below, so known acronyms must opt out.
const PRESERVED_CAPS = new Set(
  "NNE NE ENE ESE SE SSE SSW SW WSW WNW NW NNW US BC USCG LB ICW ICWW RR NM MBTS MARAD GPS GNSS API CBS OPW USCGS NOAA AFB CBBT AWG NERR HBR HVN NMCI MRMS ANVSA LAWMA COCO VALI COX WC SA".split(
    " ",
  ),
);

// Network prefixes to strip (the remainder is the actual place name)
const NETWORK_PREFIXES = ["RMN_", "IOC_"];

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
  if (country === "United States" || country === "Canada") {
    const regionMatch = name.match(/_([A-Za-z]{2})$/);
    if (regionMatch?.[1]) {
      const code = regionMatch[1].toUpperCase();
      const validCodes = country === "United States" ? US_STATES : CA_PROVINCES;
      if (validCodes.has(code)) {
        region = code;
        name = name.slice(0, -3); // remove _XX
      }
    }
  }

  // Step 3: Replace underscores with spaces
  name = name.replace(/_/g, " ");

  // A few sources append an already-known state or province with a space.
  const spacedRegion = name.match(/ ([A-Za-z]{2})$/)?.[1]?.toUpperCase();
  const expectedRegion = existingRegionCode?.toUpperCase().split("-").at(-1);
  const validRegions =
    country === "United States"
      ? US_STATES
      : country === "Canada"
        ? CA_PROVINCES
        : undefined;
  if (
    spacedRegion &&
    spacedRegion === expectedRegion &&
    validRegions?.has(spacedRegion)
  ) {
    region = spacedRegion;
    name = name.slice(0, -3);
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
  name = toTitleCase(name, country);

  // Step 7: Post-processing — French-style hyphenation for small prepositions
  // "Boulogne sur Mer" → "Boulogne-sur-Mer", "Aiguillon sur Mer" → "Aiguillon-sur-Mer"
  //
  // French place names hyphenate; Spanish and English ones sharing the same
  // prepositions do not. Applied by country, because the prepositions alone
  // cannot tell them apart — "de" and "la" turned "Bahia de Chame" into
  // "Bahia-de-Chame" and Alabama's "Bayou la Batre" into "Bayou-la-Batre",
  // and NOAA spells "Havre de Grace" with spaces too.
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

function toTitleCase(str: string, country: string): string {
  const words = str.split(/\s+/);
  const shouting = !/[a-z]/.test(str);
  const allCaps = words.map((word) => {
    const letters = word.replace(/[^A-Za-z]/g, "");
    return letters.length > 1 && letters === letters.toUpperCase();
  });

  return words
    .map((word, i) => {
      const bare = word.replace(/[)\]},]+$/, "");
      if (
        i === words.length - 1 &&
        word === word.toUpperCase() &&
        (US_STATES.has(bare) || CA_PROVINCES.has(bare))
      ) {
        return word;
      }
      if (
        i > 0 &&
        SMALL_WORDS.has(bare.toLowerCase()) &&
        !(country === "United States" && bare.toLowerCase() === "la")
      ) {
        return word.toLowerCase();
      }
      return capitalize(
        word,
        shouting ||
          word.replace(/[^A-Za-z]/g, "").length >= 4 ||
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
  // Preserve the interior capital of a Mc/Mac surname. The PascalCase split
  // above already leaves "McHenry" whole; without this it arrives here and
  // comes back "Mchenry".
  if (/^(?:Mc|Mac)[A-Z][a-z]/.test(word)) {
    return word;
  }
  // Preserve code-like words (uppercase letters + digits: CRMS0572, HC1, S197)
  if (/^[A-Z]+\d+[A-Z]?$/i.test(word) && word === word.toUpperCase()) {
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
