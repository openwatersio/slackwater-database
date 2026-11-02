import { expect, test } from "vitest";
import {
  declaration,
  declaredOriginator,
  fold,
  currentProvider,
  type UhslcMetadata,
} from "../provenance.ts";

const meta = (
  data_source: string,
  originator_number: string,
): UhslcMetadata => ({
  station: "",
  latitude: 0,
  longitude: 0,
  data_source,
  originator_number,
  last_updated: "",
});

test("a TICON NOAA relay names its station in its id", () => {
  expect(declaredOriginator("ticon/aberdeen-9441187-usa-noaa")).toBe(
    "noaa/9441187",
  );
});

test("a TICON Norwegian Hydrographic Service relay names its Kartverket code", () => {
  expect(declaredOriginator("ticon/bergen-bgo-nor-nhs")).toBe("kartverket/BGO");
});

test("UHSLC's Norwegian Hydrographic Service gauges match Kartverket by name", () => {
  const pinned = {
    "823A": {
      ...meta("Norwegian Hydrographic Services (NHS)", ""),
      station: "Ny-Alesund",
    },
    "999A": {
      ...meta("Norwegian Hydrographic Services", ""),
      station: "Nowhere",
    },
  };
  expect(declaredOriginator("ticon/nylesund-823a-nor-uhslc_rq", pinned)).toBe(
    "kartverket/NYA",
  );
  expect(
    declaredOriginator("ticon/nowhere-999a-nor-uhslc_rq", pinned),
  ).toBeUndefined();
});

test("folds Norwegian letters that have no decomposition", () => {
  expect(fold("Vardø")).toBe(fold("Vardo"));
  expect(fold("Rørvik")).toBe("rorvik");
  expect(fold("Måløy")).toBe("maloy");
  expect(fold("Ny-Ålesund")).toBe("nyalesund");
});

test("a CMEMS code matches no Kartverket gauge", () => {
  // A CMEMS code is cut from the place name, not Kartverket's.
  expect(declaredOriginator("ticon/oslotg-osl-nor-cmems")).toBeUndefined();
});

test("JODC's Coast Guard codes resolve through the reviewed JHOD crosswalk", () => {
  expect(declaration("ticon/sasebo-hd19-jpn-jodc_jcg")).toEqual({
    id: "jhod/0154",
    unambiguous: true,
  });
  expect(declaredOriginator("ticon/izuhara-hd23-jpn-jodc_jcg")).toBe(
    "jhod/0158",
  );
  expect(declaredOriginator("ticon/unknown-hd99-jpn-jodc_jcg")).toBeUndefined();
  expect(
    declaredOriginator("ticon/yokohama-ma16-jpn-jodc_jma"),
  ).toBeUndefined();
  const pinned = {
    "345A": meta("Japan Oceanographic Data Center", "HD28"),
    "357A": meta("Japan Oceanographic Data Center", "HD10"),
    "999A": meta("Unrelated provider", "HD28"),
  };
  expect(
    declaredOriginator("ticon/nakano_shima-345a-jpn-uhslc_rq", pinned),
  ).toBe("jhod/0179");
  expect(declaredOriginator("ticon/miyakejima-357a-jpn-uhslc_rq", pinned)).toBe(
    "jhod/0057",
  );
  expect(
    declaredOriginator("ticon/other-999a-jpn-uhslc_rq", pinned),
  ).toBeUndefined();
});

test("UHSLC metadata names an originator only through a known provider", () => {
  const pinned = {
    "073A": meta("Land Information New Zealand", "073"),
    // UHSLC 071 is also La Libertad, Ecuador: the number alone is not enough.
    "071B": meta("Instituto Oceanografico de la Armada", "071"),
    "259B": meta("National Ocean Service (NOS)", "2695535"),
    // A NOAA number under UHSLC as provider declares nothing: UHSLC may not
    // be relaying NOAA's gauge.
    "104C": meta("UH Sea Level Center", "2431000"),
    // Bluff passed from the navy to LINZ, its current operator.
    "072A": meta("Land Information New Zealand", "072"),
  };
  expect(declaredOriginator("ticon/tauranga-073a-nzl-uhslc_rq", pinned)).toBe(
    "linz/073",
  );
  expect(
    declaredOriginator("ticon/la_libertad-071b-ecu-uhslc_rq", pinned),
  ).toBeUndefined();
  expect(declaredOriginator("ticon/bermuda-259b-gbr-uhslc_rq", pinned)).toBe(
    "noaa/2695535",
  );
  expect(
    declaredOriginator("ticon/diego_garcia-104c-gbr-uhslc_rq", pinned),
  ).toBeUndefined();
  expect(declaredOriginator("ticon/bluff-072a-nzl-uhslc_rq", pinned)).toBe(
    "linz/072",
  );
  expect(
    declaredOriginator("ticon/wellington-071-nzl-uhslc_fd", pinned),
  ).toBeUndefined();
});

test("the current period's provider is the operator", () => {
  expect(
    currentProvider(
      "UH Sea Level Center\nHonolulu\nFor the pre-1999 data:\nNational Ocean Service (NOS)\nSilver Spring",
    ),
  ).toBe("UH Sea Level Center");
  expect(
    currentProvider(
      "For 1984-1988:\nRoyal New Zealand Navy\nTakapuna\nFor 1997-:\nLand Information New Zealand",
    ),
  ).toBe("Land Information New Zealand");
  // Where every period has a heading, the last is current.
  expect(
    currentProvider(
      "for the 1985-1987 data:\nA\nStreet\nfor the 1988-1992 data:\nB",
    ),
  ).toBe("B");
  // A collaborator is not a provider.
  expect(
    currentProvider(
      "Servicio Hidrografico\nIn collaboration with the\nNational Ocean Service (NOS)",
    ),
  ).toBe("Servicio Hidrografico");
});

test("a NOAA number from NOAA, or in the relay's id, is unambiguous", () => {
  const pinned = {
    "750A": meta("National Ocean Service (NOS)", "8658120"),
    "073A": meta("Land Information New Zealand", "073"),
  };
  expect(declaration("ticon/wilmington_nc-750a-usa-uhslc_rq", pinned)).toEqual({
    id: "noaa/8658120",
    unambiguous: true,
  });
  expect(declaration("ticon/tauranga-073a-nzl-uhslc_rq", pinned)).toEqual({
    id: "linz/073",
    unambiguous: false,
  });
  expect(declaration("ticon/bergen-bgo-nor-nhs")?.unambiguous).toBe(true);
});

test("JMA MA codes identify JMA gauges without joining Coast Guard gauges", () => {
  expect(declaredOriginator("ticon/wakkanai-ma01-jpn-jodc_jma")).toBe("jma/WN");
  expect(declaredOriginator("ticon/unknown-ma99-jpn-jodc_jma")).toBeUndefined();
  expect(
    declaredOriginator("ticon/wakkanai-ma01-jpn-jodc_jcg"),
  ).toBeUndefined();
});

test("UHSLC declares JMA's two-character gauge codes", () => {
  expect(
    declaredOriginator("ticon/wakkanai-360a-jpn-uhslc_rq", {
      "360A": meta("Japan Meteorological Agency", "WN"),
    }),
  ).toBe("jma/WN");
  expect(
    declaredOriginator("ticon/abashiri-347a-jpn-uhslc_rq", {
      "347A": meta("Japan Oceanographic Data Center", "AS"),
    }),
  ).toBe("jma/AS");
  expect(
    declaredOriginator("ticon/wakkanai-360a-jpn-uhslc_rq", {
      "360A": meta("Other agency", "WN"),
    }),
  ).toBeUndefined();
});
