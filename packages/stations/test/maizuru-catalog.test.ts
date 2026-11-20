import { expect, test } from "vitest";
import { loadStations } from "@slackwater/database";

test("Maizuru gauges retain separate accepted routes and western context", async () => {
  const db = await loadStations();
  const west = db.byId("ticon/maizuru-hd24-jpn-jodc_jcg");
  const east = db.byId("jma/MZ");
  expect(west?.quality?.accepted).toBe(true);
  expect(east?.quality?.accepted).toBe(true);
  expect(west?.context).toBe("Nishimaizuru");
  expect(west?.context_derived).toBe(false);
  expect(
    db
      .stationRoutes("tide")
      .find((route) => route.stationIds.includes(west!.id))?.slug,
  ).toBe("maizuru");
  expect(
    db
      .stationRoutes("tide")
      .find((route) => route.stationIds.includes(east!.id))?.slug,
  ).toBe("maizuru-kyoto");
});
