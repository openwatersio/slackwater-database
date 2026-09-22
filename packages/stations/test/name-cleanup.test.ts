import { describe, test, expect } from "vitest";
import { cleanName } from "../name-cleanup.js";

describe("cleanName", () => {
  describe("underscore replacement", () => {
    test("replaces underscores with spaces", () => {
      expect(cleanName("San_Francisco", "United States").name).toBe(
        "San Francisco",
      );
    });

    test("handles multiple underscores", () => {
      expect(cleanName("North_Calcasieu_Lake", "United States").name).toBe(
        "North Calcasieu Lake",
      );
    });
  });

  describe("metadata suffix stripping", () => {
    test("strips TG suffix", () => {
      expect(cleanName("BrestTG", "France").name).toBe("Brest");
      expect(cleanName("AlboranTG", "Spain").name).toBe("Alboran");
    });

    test("strips TG with interval suffix", () => {
      expect(cleanName("BrestTG_60minute", "France").name).toBe("Brest");
      expect(cleanName("AjaccioTG_60minute", "France").name).toBe("Ajaccio");
    });

    test("strips interval suffix without TG", () => {
      expect(cleanName("Skagsudde_60minute", "Sweden").name).toBe("Skagsudde");
    });

    test("strips various interval suffixes", () => {
      expect(cleanName("BaieDuLazaretTG_10minute", "France").name).toBe(
        "Baie-du-Lazaret",
      );
      expect(cleanName("BayonnePontBlancTG_05minute", "France").name).toBe(
        "Bayonne Pont Blanc",
      );
      expect(cleanName("BenodetVigicruesTG_06minute", "France").name).toBe(
        "Benodet Vigicrues",
      );
    });

    test("strips _NAVD88 suffix", () => {
      expect(cleanName("Haldeman_NAVD88", "United States").name).toBe(
        "Haldeman",
      );
      const mbts = cleanName("MBTS_NAVD88", "United States");
      expect(mbts.name).toBe("MBTS");
      expect(mbts.isOpaque).toBe(true);
    });

    test("strips _T suffix on codes", () => {
      expect(cleanName("S197_T", "United States").name).toBe("S197");
      expect(cleanName("G93_T", "United States").name).toBe("G93");
    });

    test("strips _H suffix on codes", () => {
      expect(cleanName("G58_H_NAVD88", "United States").name).toBe("G58");
    });

    test("strips combined _T_NAVD88", () => {
      expect(cleanName("G57_T_NAVD88", "United States").name).toBe("G57");
      expect(cleanName("Gordy_T_NAVD88", "United States").name).toBe("Gordy");
    });
  });

  describe("region extraction", () => {
    test("extracts US state codes", () => {
      const result = cleanName("San_Francisco_CA", "United States");
      expect(result.name).toBe("San Francisco");
      expect(result.region).toBe("CA");
    });

    test("normalizes mixed-case state codes", () => {
      const result = cleanName("Milwaukee_Wi", "United States");
      expect(result.name).toBe("Milwaukee");
      expect(result.region).toBe("WI");
    });

    test("extracts Canadian province codes", () => {
      const result = cleanName("Ramsay_Island_BC", "Canada");
      expect(result.name).toBe("Ramsay Island");
      expect(result.region).toBe("BC");
    });

    test("does not extract region from non-US/CA countries", () => {
      const result = cleanName("Hiva_Oa", "France");
      expect(result.name).toBe("Hiva Oa");
      expect(result.region).toBeUndefined();
    });

    test("does not extract invalid state codes", () => {
      const result = cleanName("Nosy_Be", "Madagascar");
      expect(result.name).toBe("Nosy Be");
      expect(result.region).toBeUndefined();
    });

    test("handles trailing state code with verbose name", () => {
      const result = cleanName(
        "Abercorn_Creek_At_Mouth_Near_Savannah_Ga",
        "United States",
      );
      expect(result.name).toBe("Abercorn Creek at Mouth near Savannah");
      expect(result.region).toBe("GA");
    });

    test("extracts DC", () => {
      const result = cleanName(
        "Anacostia_River_Nr_Buzzard_Point_At_Washington_Dc",
        "United States",
      );
      expect(result.region).toBe("DC");
    });
  });

  describe("PascalCase splitting", () => {
    test("splits PascalCase words", () => {
      expect(cleanName("PortTudy", "France").name).toBe("Port Tudy");
    });

    test("splits complex PascalCase", () => {
      expect(cleanName("SchoonhovenTG", "Netherlands").name).toBe(
        "Schoonhoven",
      );
    });

    test("does not split already-spaced names", () => {
      expect(cleanName("Fort_Denison", "Australia").name).toBe("Fort Denison");
    });

    test("handles PascalCase with prepositions", () => {
      expect(cleanName("AiguillonSurMerTG_60minute", "France").name).toBe(
        "Aiguillon-sur-Mer",
      );
    });
  });

  describe("trailing version digits", () => {
    test("strips trailing single digit from place names", () => {
      expect(cleanName("Alicante2TG", "Spain").name).toBe("Alicante");
      expect(cleanName("Almeria3TG", "Spain").name).toBe("Almeria");
      expect(cleanName("Skagsudde2", "Sweden").name).toBe("Skagsudde");
    });

    test("does not strip digits from codes", () => {
      expect(cleanName("S197", "United States").name).toBe("S197");
      const crms = cleanName("CRMS0572", "United States");
      expect(crms.name).toBe("CRMS0572");
    });
  });

  describe("title case", () => {
    test("lowercases small words mid-phrase", () => {
      const result = cleanName("Mouth_Of_The_Black_River_Mi", "United States");
      expect(result.name).toBe("Mouth of the Black River");
      expect(result.region).toBe("MI");
    });

    test("capitalizes first word even if small", () => {
      // "at" would be lowercase mid-phrase, but capitalized at start
      expect(cleanName("At_The_Harbor", "United States").name).toBe(
        "At the Harbor",
      );
    });

    test("handles 'near' as small word", () => {
      const result = cleanName(
        "Skull_Creek_Near_Hilton_Head_Sc",
        "United States",
      );
      expect(result.name).toBe("Skull Creek near Hilton Head");
      expect(result.region).toBe("SC");
    });
  });

  describe("network prefix stripping", () => {
    test("strips RMN_ prefix", () => {
      expect(cleanName("RMN_Anzio", "Italy").name).toBe("Anzio");
      expect(cleanName("RMN_LaSpezia", "Italy").name).toBe("La Spezia");
    });

    test("strips RMN_ with PascalCase", () => {
      expect(cleanName("RMN_ReggioCalabria", "Italy").name).toBe(
        "Reggio Calabria",
      );
      expect(cleanName("RMN_IsoleTremiti", "Italy").name).toBe("Isole Tremiti");
    });

    test("strips IOC_ prefix", () => {
      expect(cleanName("IOC_ista", "Turkey").name).toBe("Ista");
    });
  });

  describe("French hyphenation", () => {
    test("hyphenates prepositions between capitalized words", () => {
      expect(cleanName("Aiguillon_Sur_Mer", "France").name).toBe(
        "Aiguillon-sur-Mer",
      );
    });

    test("hyphenates du", () => {
      expect(cleanName("BaieDuLazaretTG_10minute", "France").name).toBe(
        "Baie-du-Lazaret",
      );
    });

    test("does not hyphenate when at start of name", () => {
      expect(cleanName("Le_Havre", "France").name).toBe("Le Havre");
    });

    test("leaves Spanish names alone", () => {
      expect(cleanName("Bahia_De_Chame", "Panama").name).toBe("Bahia de Chame");
      expect(cleanName("Isla_De_Guanaja", "Honduras").name).toBe(
        "Isla de Guanaja",
      );
    });

    test("leaves American names alone", () => {
      expect(cleanName("Havre_De_Grace", "United States").name).toBe(
        "Havre de Grace",
      );
      expect(cleanName("Bayou_La_Batre", "United States").name).toBe(
        "Bayou la Batre",
      );
    });

    test("hyphenates canonical French territory country names", () => {
      expect(
        cleanName("Port_De_Crozet", "French Southern and Antarctic Lands").name,
      ).toBe("Port-de-Crozet");
      expect(cleanName("Baie_De_Marigot", "Saint Barthélemy").name).toBe(
        "Baie-de-Marigot",
      );
    });
  });

  describe("bracketed qualifiers", () => {
    test("capitalizes the word inside the bracket", () => {
      expect(cleanName("Apia_(Observatory)", "Samoa").name).toBe(
        "Apia (Observatory)",
      );
      expect(
        cleanName("Ferry_Reach_(Biological_Station)", "Bermuda").name,
      ).toBe("Ferry Reach (Biological Station)");
    });

    test("keeps an acronym inside a bracket", () => {
      expect(
        cleanName("Annapolis_(US_Naval_Academy)", "United States").name,
      ).toBe("Annapolis (US Naval Academy)");
    });

    test("keeps a dotted acronym inside a bracket", () => {
      expect(cleanName("Wake_Island_(U.S.)", "United States").name).toBe(
        "Wake Island (U.S.)",
      );
    });

    test("keeps small words lowercase before a closing bracket", () => {
      expect(
        cleanName("Mills Point (south of), Wicomico Riv., Md.", "United States")
          .name,
      ).toBe("Mills Point (South of), Wicomico Riv., Md.");
    });

    test("keeps an ampersand acronym uppercase inside a bracket", () => {
      expect(
        cleanName("Apalachicola River (A&N RR bridge)", "United States").name,
      ).toBe("Apalachicola River (A&N RR Bridge)");
    });
  });

  describe("possessives", () => {
    test("keeps the s after an apostrophe lowercase", () => {
      expect(cleanName("Marthas_Vineyard", "United States").name).toBe(
        "Marthas Vineyard",
      );
      expect(cleanName("Martha's_Vineyard", "United States").name).toBe(
        "Martha's Vineyard",
      );
      expect(cleanName("Peter's_Ditch", "United States").name).toBe(
        "Peter's Ditch",
      );
    });

    test("still capitalizes a real hyphenated compound", () => {
      expect(cleanName("Winston-Salem", "United States").name).toBe(
        "Winston-Salem",
      );
    });
  });

  describe("Mc and Mac surnames", () => {
    test("does not split a Mc name", () => {
      expect(cleanName("Fort_McHenry_Marsh", "United States").name).toBe(
        "Fort McHenry Marsh",
      );
      expect(cleanName("McClellanville", "United States").name).toBe(
        "McClellanville",
      );
    });

    test("does not split a Mac name", () => {
      expect(cleanName("MacLeod_Harbor", "United States").name).toBe(
        "MacLeod Harbor",
      );
    });

    test("still splits PascalCase", () => {
      expect(cleanName("PortAngeles", "United States").name).toBe(
        "Port Angeles",
      );
    });
  });

  describe("D' apostrophe", () => {
    test("handles D + vowel pattern", () => {
      expect(cleanName("DumontDUrville", "France").name).toBe(
        "Dumont d'Urville",
      );
    });
  });

  describe("opaque code detection", () => {
    test("detects CRMS codes", () => {
      expect(cleanName("CRMS0572", "United States").isOpaque).toBe(true);
    });

    test("detects S-number codes", () => {
      expect(cleanName("S197_T", "United States").isOpaque).toBe(true);
    });

    test("detects G-number codes", () => {
      expect(cleanName("G57_T_NAVD88", "United States").isOpaque).toBe(true);
    });

    test("does not flag normal names", () => {
      expect(cleanName("Brest", "France").isOpaque).toBe(false);
      expect(cleanName("San_Francisco_CA", "United States").isOpaque).toBe(
        false,
      );
    });

    test("detects PTM codes", () => {
      expect(cleanName("PTM3066", "United States").isOpaque).toBe(true);
    });

    test("flags MBTS as opaque", () => {
      expect(cleanName("MBTS_NAVD88", "United States").isOpaque).toBe(true);
    });
  });

  describe("idempotency", () => {
    test("already-clean names are unchanged", () => {
      expect(cleanName("San Francisco", "United States").name).toBe(
        "San Francisco",
      );
      expect(cleanName("Brest", "France").name).toBe("Brest");
      expect(cleanName("Isle Au Haut", "United States").name).toBe(
        "Isle Au Haut",
      );
    });
  });

  describe("preserves original", () => {
    test("returns original name", () => {
      expect(cleanName("BrestTG_60minute", "France").original).toBe(
        "BrestTG_60minute",
      );
    });
  });

  describe("real-world samples", () => {
    test("Copano_Bay", () => {
      expect(cleanName("Copano_Bay", "United States").name).toBe("Copano Bay");
    });

    test("Flores_Lajes", () => {
      expect(cleanName("Flores_Lajes", "Portugal").name).toBe("Flores Lajes");
    });

    test("Pt_La_Rue", () => {
      expect(cleanName("Pt_La_Rue", "Seychelles").name).toBe("Pt la Rue");
    });

    test("Rak_zuid", () => {
      expect(cleanName("Rak_zuid", "Netherlands").name).toBe("Rak Zuid");
    });

    test("Vieux_Quebec", () => {
      expect(cleanName("Vieux_Quebec", "Canada").name).toBe("Vieux Quebec");
    });

    test("Weipa_Humbug_Point", () => {
      expect(cleanName("Weipa_Humbug_Point", "Australia").name).toBe(
        "Weipa Humbug Point",
      );
    });

    test("BiscayneBay_S123_T", () => {
      const result = cleanName("BiscayneBay_S123_T", "United States");
      expect(result.name).toBe("Biscayne Bay S123");
    });

    test("Faka_Union_Boundary_At_Channel_Marker_6_Fl", () => {
      const result = cleanName(
        "Faka_Union_Boundary_At_Channel_Marker_6_Fl",
        "United States",
      );
      expect(result.name).toBe("Faka Union Boundary at Channel Marker 6");
      expect(result.region).toBe("FL");
    });

    test("Saint_Marks_River_at_San_Marcosde_Apalachee_StatePark", () => {
      const result = cleanName(
        "Saint_Marks_River_at_San_Marcosde_Apalachee_StatePark",
        "United States",
      );
      expect(result.name).toBe(
        "Saint Marks River at San Marcosde Apalachee State Park",
      );
    });

    test("LauwersoogTG", () => {
      expect(cleanName("LauwersoogTG", "Netherlands").name).toBe("Lauwersoog");
    });

    test("Rigolets_At_Hwy_90_Near_Slidell_La", () => {
      const result = cleanName(
        "Rigolets_At_Hwy_90_Near_Slidell_La",
        "United States",
      );
      expect(result.name).toBe("Rigolets at Hwy 90 near Slidell");
      expect(result.region).toBe("LA");
    });

    test("Lake_Rudee_Near_Bells_Road_At_Virginia_Beach_Va", () => {
      const result = cleanName(
        "Lake_Rudee_Near_Bells_Road_At_Virginia_Beach_Va",
        "United States",
      );
      expect(result.name).toBe("Lake Rudee near Bells Road at Virginia Beach");
      expect(result.region).toBe("VA");
    });

    test("HendersonCreek_SouthWestFlorida_HC1_T", () => {
      const result = cleanName(
        "HendersonCreek_SouthWestFlorida_HC1_T",
        "United States",
      );
      expect(result.name).toBe("Henderson Creek South West Florida HC1");
    });
  });
});
