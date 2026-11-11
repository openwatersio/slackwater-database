// For each BSH event in the observed window, find the observed extreme
// (15-min running mean to suppress noise; plateau midpoint within 2 cm) and
// compare BSH's and our predicted times with it.
//
// Reads BSH responses from the cache `npm run validate -w sources/bsh` fills,
// and fetches 1-minute levels from Pegelonline, which keeps only about 30 days.
// Usage: node obs.mjs 2026-10-03T00:00:00Z 2026-11-03T00:00:00Z
import { loadStations } from "@slackwater/database";
import { createTidePredictor } from "@slackwater/engine";
import { readFile } from "node:fs/promises";
const [start, end] = process.argv.slice(2);
const cache = new URL("../../../../tmp/bsh/2026/", import.meta.url);
const db = await loadStations();
// The stations the BSH validator pairs with these gauges.
const baseline = JSON.parse(
  await readFile(
    new URL("../../../../sources/bsh/validation.json", import.meta.url),
    "utf8",
  ),
);
const pairs = ["509A", "506P", "508P", "507P"].map((bsh) => {
  const gauge = baseline.gauges.find((g) => g.bshnr === bsh);
  if (!gauge) throw new Error(`${bsh} is not in the BSH baseline`);
  return [bsh, gauge.station];
});
const f = (xs) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return `${m.toFixed(1)}±${Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length).toFixed(1)} (n=${xs.length})`;
};
for (const [bsh, id] of pairs) {
  const s = db.byId(id);
  if (!s) throw new Error(`${id} is not in the database`);
  const j = JSON.parse(await readFile(new URL(`${bsh}.json`, cache), "utf8"));
  const url = `https://www.pegelonline.wsv.de/webservices/rest-api/v2/stations/${j.pegelonline_uuid}/W/measurements.json?start=${start}&end=${end}`;
  const res0 = await fetch(url);
  if (!res0.ok) throw new Error(`${url}: HTTP ${res0.status}`);
  const obsRaw = (await res0.json()).map((o) => ({
    t: Date.parse(o.timestamp),
    h: o.value / 100,
  }));
  const obs = obsRaw.map((o, i) => {
    const w = obsRaw.slice(Math.max(0, i - 7), i + 8);
    return { t: o.t, h: w.reduce((a, b) => a + b.h, 0) / w.length };
  });
  const ev = j.years
    .map((y) => y["2026"])
    .find(Boolean)
    .hwnw_prediction.data.filter((e) => e.height != null)
    .map((e) => ({
      t: Date.parse(e.timestamp.replace(" ", "T")),
      hi: e.type === "HW",
    }));
  const ours = createTidePredictor(
    s.harmonic_constituents,
  ).getExtremesPrediction({
    start: new Date(obs[0].t),
    end: new Date(obs.at(-1).t),
  });
  const res = { HW: { bsh: [], ours: [] }, LW: { bsh: [], ours: [] } };
  for (const e of ev) {
    if (e.t < obs[0].t + 3 * 3600e3 || e.t > obs.at(-1).t - 3 * 3600e3)
      continue;
    const win = obs.filter((o) => Math.abs(o.t - e.t) <= 2.5 * 3600e3);
    if (win.length < 200) continue;
    const ext = win.reduce((a, b) =>
      e.hi ? (b.h > a.h ? b : a) : b.h < a.h ? b : a,
    );
    const plat = win
      .filter((o) => Math.abs(o.h - ext.h) <= 0.02)
      .map((o) => o.t);
    const tObs = plat.reduce((a, b) => a + b, 0) / plat.length;
    const o = ours
      .filter((x) => x.high === e.hi)
      .sort((a, b) => Math.abs(a.time - tObs) - Math.abs(b.time - tObs))[0];
    const k = e.hi ? "HW" : "LW";
    res[k].bsh.push((e.t - tObs) / 60000);
    if (o && Math.abs(o.time - tObs) < 3 * 3600e3)
      res[k].ours.push((o.time.getTime() - tObs) / 60000);
  }
  console.log(
    s.id.slice(0, 34).padEnd(34),
    `HW bsh−obs ${f(res.HW.bsh)} ours−obs ${f(res.HW.ours)} | LW bsh−obs ${f(res.LW.bsh)} ours−obs ${f(res.LW.ours)}`,
  );
}
