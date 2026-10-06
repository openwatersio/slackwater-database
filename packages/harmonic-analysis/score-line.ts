#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as engine from "@slackwater/engine";
import { ensureGeslaData, parseGeslaSamples } from "@slackwater/datums";
import type { HarmonicConstituent } from "./index.ts";

/**
 * Test which spectral line a published constituent describes. Predict a raw
 * record from a station's other constituents, then measure how much of the
 * residual variance the constituent removes when placed on a candidate line,
 * as a share of its own variance there (about A²/2): +1 means its amplitude and
 * phase match signal on that line, -1 means it is unrelated, and -3 means it is
 * anti-phase. See sources/ticon/README.md#constituent-names.
 */

type Astro = ReturnType<typeof engine.astro>;

export interface Line {
  value(astro: Astro): number;
  correction(astro: Astro): { f: number; u: number };
}

export interface LevelSample {
  time: Date;
  level: number;
}

const DEG = Math.PI / 180;

/**
 * The line at a six-digit Doodson number such as "245.555", plus a phase
 * constant in degrees, taking its nodal correction from `nodal`.
 */
export function doodsonLine(doodson: string, phase: number, nodal: Line): Line {
  const digits = doodson.replace(".", "");
  if (!/^\d{6}$/.test(digits))
    throw new Error(`Not a Doodson number: ${doodson}`);
  const [tau, s, h, p, np, pp] = [...digits].map(
    (d, i) => Number(d) - (i === 0 ? 0 : 5),
  ) as [number, number, number, number, number, number];
  return {
    value: (a) =>
      tau * a["T+h-s"].value +
      s * a.s.value +
      h * a.h.value +
      p * a.p.value -
      np * a.N.value + // N' = -N, as in the engine's V0
      pp * a.pp.value +
      phase,
    correction: (a) => nodal.correction(a),
  };
}

const variance = (xs: number[]) => {
  const mean = xs.reduce((sum, x) => sum + x, 0) / xs.length;
  return xs.reduce((sum, x) => sum + (x - mean) ** 2, 0) / xs.length;
};

/**
 * Returns a function that scores `name` on any candidate line against the
 * residual of the station's other constituents.
 */
export function lineScorer(
  samples: LevelSample[],
  constituents: HarmonicConstituent[],
  name: string,
): (line: Line) => number {
  const target = constituents.find((c) => c.name === name);
  if (!target?.amplitude) throw new Error(`${name} has no amplitude here`);
  const others = constituents.flatMap((c) => {
    const model = engine.constituents[c.name];
    return c !== target && model ? [{ ...c, model }] : [];
  });

  const astros = samples.map(({ time }) => engine.astro(time));
  const residual = samples.map(({ level }, i) => {
    const a = astros[i]!;
    return others.reduce((r, { amplitude, phase, model }) => {
      const { f, u } = model.correction(a);
      return r - amplitude * f * Math.cos((model.value(a) + u - phase) * DEG);
    }, level);
  });
  const before = variance(residual);

  return (line) => {
    const term = astros.map((a) => {
      const { f, u } = line.correction(a);
      const arg = (line.value(a) + u - target.phase) * DEG;
      return target.amplitude * f * Math.cos(arg);
    });
    const after = variance(residual.map((r, i) => r - term[i]!));
    return (before - after) / variance(term);
  };
}

// node packages/harmonic-analysis/score-line.ts <ticon-id> <constituent> [245.555+90 ...] [--sweep] [--nodal=NAME] [--without=NAME ...]
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const sweep = args.includes("--sweep");
  const option = (key: string) =>
    args.filter((a) => a.startsWith(`--${key}=`)).map((a) => a.split("=")[1]!);
  const without = option("without");
  const [id, name, ...specs] = args.filter((a) => !a.startsWith("--"));
  if (!id || !name)
    throw new Error(
      "usage: score-line.ts <ticon-id> <constituent> [245.555+90 ...] [--sweep] [--nodal=NAME] [--without=NAME ...]",
    );
  // The importer re-fits these from re-zoned records, so their constants are not TICON's.
  if (/-(wsv|rws)$/.test(id))
    throw new Error(`${id} stores a re-fit, not TICON's constants`);

  const station = JSON.parse(
    await readFile(
      new URL(`../../data/ticon/${id}.json`, import.meta.url),
      "utf8",
    ),
  ) as { harmonic_constituents: HarmonicConstituent[] };
  const model = engine.constituents[name];
  const nodal = engine.constituents[option("nodal")[0] ?? name];
  if (!model || !nodal)
    throw new Error(`The engine has no ${name} or --nodal constituent`);

  const text = await readFile(join(await ensureGeslaData(), id), "utf8");
  // Hourly samples keep minute-resolution records tractable without changing the score.
  const samples = parseGeslaSamples(text).filter(
    ({ time }) => time.getTime() % 3_600_000 === 0,
  );
  const score = lineScorer(
    samples,
    station.harmonic_constituents.filter((c) => !without.includes(c.name)),
    name,
  );

  console.log(
    `${name} on the engine's ${model.name}: ${score(model).toFixed(2)}`,
  );
  for (const spec of specs) {
    const [doodson, offset] = spec.split(/(?=[+-])/);
    if (sweep) {
      const best = Array.from({ length: 24 }, (_, i) => i * 15)
        .map((phase) => ({
          phase,
          s: score(doodsonLine(doodson!, phase, nodal)),
        }))
        .reduce((a, b) => (b.s > a.s ? b : a));
      console.log(
        `${name} on ${doodson}: best at +${best.phase}°, ${best.s.toFixed(2)}`,
      );
    } else {
      const line = doodsonLine(doodson!, Number(offset ?? 0), nodal);
      console.log(`${name} on ${spec}: ${score(line).toFixed(2)}`);
    }
  }
}
