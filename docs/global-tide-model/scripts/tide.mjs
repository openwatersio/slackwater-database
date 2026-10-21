// Attach a tide station and its predicted range to each at-rest episode, and
// for episodes of 6 h or more fit depth = a + gain·η(t − lag) + drift·t
// against the nearest tide reference station's prediction η.
//
// Range and fit both come from the nearest accepted tide reference station
// with harmonics: current stations predict speed, and a subordinate has no
// harmonics of its own.
//
// Usage: node tide.mjs <out_dir>   (reads episodes.csv, minutes.csv; writes episodes_tide.csv)
// Needs a built database: npm run build.
import { createReadStream, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../../..", import.meta.url));
const [out] = process.argv.slice(2);
const db = await import(join(repo, "packages/database/dist/node/index.js"));
const { useStation } = await import(
  join(repo, "node_modules/@slackwater/engine/dist/index.js")
);

const MAX_KM = 50;
const MIN_FIT_H = 6;
const MIN_FIT_POINTS = 60;

// RFC 4180 fields, as Python's csv module writes them.
function parseCsvLine(line) {
  const fields = [];
  let field = "",
    quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') ((field += '"'), i++);
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") (fields.push(field), (field = ""));
    else field += ch;
  }
  fields.push(field);
  return fields;
}

function readCsv(path) {
  const [head, ...lines] = readFileSync(path, "utf8").trim().split(/\r?\n/);
  const keys = parseCsvLine(head);
  return lines.map((l) =>
    Object.fromEntries(parseCsvLine(l).map((v, i) => [keys[i], v])),
  );
}

const csvField = (v) => {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

// Least squares of y on the given columns; returns coefficients and the
// residual sum of squares.
function leastSquares(y, columns) {
  const m = columns.length;
  const A = columns.map((a) =>
    columns.map((b) => a.reduce((s, v, i) => s + v * b[i], 0)),
  );
  const rhs = columns.map((a) => a.reduce((s, v, i) => s + v * y[i], 0));
  for (let i = 0; i < m; i++)
    for (let j = i + 1; j < m; j++) {
      const f = A[j][i] / A[i][i];
      for (let k = i; k < m; k++) A[j][k] -= f * A[i][k];
      rhs[j] -= f * rhs[i];
    }
  const c = new Array(m).fill(0);
  for (let i = m - 1; i >= 0; i--) {
    let s = rhs[i];
    for (let k = i + 1; k < m; k++) s -= A[i][k] * c[k];
    c[i] = s / A[i][i];
  }
  let ssr = 0;
  y.forEach((v, i) => {
    const r = v - columns.reduce((s, col, k) => s + c[k] * col[i], 0);
    ssr += r * r;
  });
  return { c, ssr };
}

const isTideReference = (s) => s.kind === "tide" && s.type === "reference";

const episodes = readCsv(join(out, "episodes.csv"));
const wanted = new Set(episodes.map((e) => e.vessel));
// Streamed line by line: the file can outgrow V8's maximum string length.
// extract.py writes it sorted by vessel and minute.
const byVessel = new Map();
let header;
for await (const line of createInterface({
  input: createReadStream(join(out, "minutes.csv")),
  crlfDelay: Infinity,
})) {
  const fields = parseCsvLine(line);
  if (!header) {
    header = Object.fromEntries(fields.map((k, i) => [k, i]));
    continue;
  }
  const vessel = fields[header.vessel];
  if (!wanted.has(vessel)) continue;
  if (!byVessel.has(vessel)) byVessel.set(vessel, []);
  byVessel
    .get(vessel)
    .push([Number(fields[header.minute]) * 60, Number(fields[header.depth])]);
}

// First index with time >= t, by binary search.
function lowerBound(pts, t) {
  let lo = 0,
    hi = pts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pts[mid][0] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const extraKeys = [
  "tide_station_km",
  "ref_station",
  "ref_km",
  "country",
  "continent",
  "range_m",
  "gain",
  "lag_min",
  "tide_r2",
  "rms_m",
];
const rows = [];
for (const e of episodes) {
  const position = { lon: Number(e.lon), lat: Number(e.lat) };
  const nearest = (filter) =>
    db.near({ ...position, maxDistance: MAX_KM, maxResults: 1, filter })[0];
  const row = { ...e, ...Object.fromEntries(extraKeys.map((k) => [k, ""])) };

  // Accepted stations only: near() applies the quality filter by default.
  const anyTide = nearest((s) => s.kind === "tide");
  if (anyTide) row.tide_station_km = anyTide[1].toFixed(1);

  const ref = nearest(
    (s) => isTideReference(s) && s.harmonic_constituents?.length,
  );
  if (!ref) {
    rows.push(row);
    continue;
  }
  const [station, km] = ref;
  const startS = Number(e.start),
    endS = Number(e.end);
  const mid = (startS + endS) / 2;
  const from = Math.min(startS, mid - 12.5 * 3600) - 3 * 3600,
    to = Math.max(endS, mid + 12.5 * 3600) + 3 * 3600;
  const tl = useStation(station).getTimelinePrediction({
    start: new Date(from * 1000),
    end: new Date(to * 1000),
    timeFidelity: 60,
  }).timeline;
  const level = (t) =>
    tl[Math.min(tl.length - 1, Math.max(0, Math.round((t - from) / 60)))].level;

  // The range is the station's predicted range over the 25 hours around the
  // episode: one measure for every source, at that point in the spring–neap
  // cycle.
  let hi = -Infinity,
    lo = Infinity;
  for (let t = mid - 12.5 * 3600; t <= mid + 12.5 * 3600; t += 60) {
    const v = level(t);
    if (v > hi) hi = v;
    if (v < lo) lo = v;
  }
  Object.assign(row, {
    ref_station: station.id,
    ref_km: km.toFixed(1),
    country: station.country_code ?? station.country ?? "",
    continent: station.continent ?? "",
    range_m: (hi - lo).toFixed(2),
  });

  const all = byVessel.get(e.vessel) ?? [];
  const pts = all.slice(lowerBound(all, startS), lowerBound(all, endS));
  if (Number(e.duration_h) >= MIN_FIT_H && pts.length >= MIN_FIT_POINTS) {
    const y = pts.map((p) => p[1]);
    const ones = pts.map(() => 1);
    const days = pts.map(([t]) => (t - startS) / 86400);
    // The tide term's share of what intercept and drift leave unexplained, so
    // a drifting depth with no tide in it scores zero.
    const base = leastSquares(y, [ones, days]);
    let best;
    for (let lag = -180; lag <= 180; lag += 5) {
      const fit = leastSquares(y, [
        ones,
        pts.map(([t]) => level(t - lag * 60)),
        days,
      ]);
      if (Number.isFinite(fit.ssr) && (!best || fit.ssr < best.ssr))
        best = { ...fit, lag };
    }
    if (best && base.ssr > 0)
      Object.assign(row, {
        gain: best.c[1].toFixed(3),
        lag_min: best.lag,
        tide_r2: Math.max(0, 1 - best.ssr / base.ssr).toFixed(3),
        rms_m: Math.sqrt(best.ssr / pts.length).toFixed(3),
      });
  }
  rows.push(row);
}

const episodeKeys = parseCsvLine(
  readFileSync(join(out, "episodes.csv"), "utf8").split(/\r?\n/)[0],
);
const keys = [...episodeKeys, ...extraKeys];
writeFileSync(
  join(out, "episodes_tide.csv"),
  [
    keys.map(csvField).join(","),
    ...rows.map((r) => keys.map((k) => csvField(r[k])).join(",")),
  ].join("\n") + "\n",
);
console.error(
  `${rows.length} episodes, ${rows.filter((r) => r.tide_station_km).length} within ${MAX_KM} km of a tide station, ${rows.filter((r) => r.ref_station).length} of a tide reference station, ${rows.filter((r) => r.tide_r2).length} fitted`,
);
