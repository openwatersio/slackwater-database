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

// Network prefixes to strip (the remainder is the actual place name)
const NETWORK_PREFIXES = ["RMN_", "IOC_"];

/**
 * Deterministic pattern-based name cleanup for TICON station names.
 */
export function cleanName(raw: string, country: string): CleanNameResult {
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

  // Step 4: Split PascalCase
  // Insert space between lowercase→uppercase transitions
  name = name.replace(/([a-z])([A-Z])/g, "$1 $2");
  // Insert space between uppercase run and uppercase+lowercase (e.g., "ABCDef" → "ABC Def")
  name = name.replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");

  // Step 5: Strip trailing version-like single digits (Alicante2 → Alicante)
  // Only strip from the final word when it's a real place name (has vowels, 4+ alpha chars)
  name = name.replace(/(?<=\s|^)([a-zA-Z]{4,})\d$/, "$1");

  // Step 6: Title case
  name = toTitleCase(name);

  // Step 7: Post-processing — French-style hyphenation for small prepositions
  // "Boulogne sur Mer" → "Boulogne-sur-Mer", "Aiguillon sur Mer" → "Aiguillon-sur-Mer"
  name = frenchHyphenation(name);

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

function toTitleCase(str: string): string {
  return str
    .split(/\s+/)
    .map((word, i) => {
      if (i === 0) return capitalize(word);
      if (SMALL_WORDS.has(word.toLowerCase())) return word.toLowerCase();
      return capitalize(word);
    })
    .join(" ");
}

function capitalize(word: string): string {
  if (!word) return word;
  // Preserve all-caps words (acronyms like "NW", "SE", "MBTS")
  if (word === word.toUpperCase() && /^[A-Z]+$/.test(word)) {
    return word;
  }
  // Preserve code-like words (uppercase letters + digits: CRMS0572, HC1, S197)
  if (/^[A-Z]+\d+[A-Z]?$/i.test(word) && word === word.toUpperCase()) {
    return word;
  }
  // Handle hyphenated or apostrophe-separated words: capitalize each segment
  if (word.includes("-") || word.includes("'")) {
    return word
      .split(/([-'])/)
      .map((seg, i) => {
        // Preserve separators
        if (seg === "-" || seg === "'") return seg;
        if (!seg) return seg;
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
