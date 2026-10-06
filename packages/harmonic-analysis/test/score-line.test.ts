import { describe, test, expect } from "vitest";
import * as engine from "@slackwater/engine";
import { doodsonLine, lineScorer } from "../score-line.ts";

describe("lineScorer", () => {
  const constituents = [
    { name: "M2", amplitude: 1, phase: 110 },
    { name: "MKS2", amplitude: 0.05, phase: 200 },
  ];
  const t0 = Date.UTC(2010, 0, 1);
  const samples = Array.from({ length: 24 * 400 }, (_, h) => {
    const time = new Date(t0 + h * 3600_000);
    const a = engine.astro(time);
    const level = constituents.reduce((sum, { name, amplitude, phase }) => {
      const model = engine.constituents[name]!;
      const { f, u } = model.correction(a);
      const arg = (model.value(a) + u - phase) * (Math.PI / 180);
      return sum + amplitude * f * Math.cos(arg);
    }, 0);
    return { time, level };
  });
  const score = lineScorer(samples, constituents, "MKS2");
  const mks2 = engine.constituents["MKS2"]!;

  test("scores +1 on the line the signal is on", () => {
    expect(score(mks2)).toBeCloseTo(1, 1);
  });

  test("scores -1 on an unrelated line", () => {
    expect(score(doodsonLine("245.555", 0, mks2))).toBeCloseTo(-1, 1);
  });

  test("scores -3 in anti-phase", () => {
    expect(score(doodsonLine("257.555", 180, mks2))).toBeCloseTo(-3, 1);
  });

  test("builds the engine's argument from a Doodson number", () => {
    const a = engine.astro(new Date(t0));
    expect(doodsonLine("257.555", 0, mks2).value(a)).toBeCloseTo(
      mks2.value(a),
      9,
    );
  });

  test("rejects a malformed Doodson number", () => {
    expect(() => doodsonLine("2455", 0, mks2)).toThrow("Not a Doodson number");
  });
});
