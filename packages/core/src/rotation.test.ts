import { describe, expect, it } from "vitest";

import { rotateQuarterTurn, rotatedSize } from "./rotation";

describe("quarter-turn rotation", () => {
  it("moves clockwise and counter-clockwise in 90-degree steps", () => {
    expect(rotateQuarterTurn(0, 1)).toBe(90);
    expect(rotateQuarterTurn(270, 1)).toBe(0);
    expect(rotateQuarterTurn(0, -1)).toBe(270);
    expect(rotateQuarterTurn(90, -1)).toBe(0);
  });

  it("swaps output dimensions for 90 and 270 degrees", () => {
    expect(rotatedSize({ width: 400, height: 600 }, 90))
      .toEqual({ width: 600, height: 400 });
    expect(rotatedSize({ width: 400, height: 600 }, 180))
      .toEqual({ width: 400, height: 600 });
  });
});
