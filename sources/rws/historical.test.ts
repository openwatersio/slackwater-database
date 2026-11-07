import { describe, expect, test } from "vitest";
import { kilometres, score } from "./historical.ts";

describe("score", () => {
  test("ignores a difference in mean level", () => {
    const { rms, sd } = score([
      [1, 3],
      [-1, 1],
    ]);
    expect(rms).toBe(0);
    expect(sd).toBe(1);
  });

  test("measures the prediction's error against the provider's series", () => {
    expect(
      score([
        [1, 0.5],
        [-1, -0.5],
      ]).rms,
    ).toBeCloseTo(0.5);
  });
});

test("kilometres measures along the surface", () => {
  expect(kilometres({ lat: 52, lon: 4 }, { lat: 53, lon: 4 })).toBeCloseTo(
    111.19,
    1,
  );
});
