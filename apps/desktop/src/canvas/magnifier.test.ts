import { describe, expect, it } from "vitest";

import {
  adjustMagnifierScale,
  calculateMagnifierFrame,
  calculateMagnifierTiles,
  magnifierRenderDelay,
  MAX_MAGNIFIER_SCALE,
  MIN_MAGNIFIER_SCALE,
  shouldRenderMagnifierAt,
} from "./magnifier";

describe("canvas magnifier", () => {
  it("centres a rectangular lens over a magnified source region", () => {
    expect(calculateMagnifierFrame(
      { x: 500, y: 350 },
      { width: 1000, height: 700 },
      { width: 300, height: 200 },
      2,
      10,
    )).toEqual({
      lens: { x: 350, y: 250, width: 300, height: 200 },
      source: { x: 425, y: 300, width: 150, height: 100 },
    });
  });

  it("keeps the lens and sampled area inside the viewport at an edge", () => {
    expect(calculateMagnifierFrame(
      { x: 5, y: 5 },
      { width: 500, height: 300 },
      { width: 300, height: 200 },
      2,
      10,
    )).toEqual({
      lens: { x: 10, y: 10, width: 300, height: 200 },
      source: { x: 0, y: 0, width: 150, height: 100 },
    });
  });

  it("uses the wheel to adjust magnification with bounded normal and fine steps", () => {
    expect(adjustMagnifierScale(2.5, -100, false)).toBe(3);
    expect(adjustMagnifierScale(2.5, 100, false)).toBe(2);
    expect(adjustMagnifierScale(2.5, -100, true)).toBe(2.6);
    expect(adjustMagnifierScale(MAX_MAGNIFIER_SCALE, -100, false))
      .toBe(MAX_MAGNIFIER_SCALE);
    expect(adjustMagnifierScale(MIN_MAGNIFIER_SCALE, 100, false))
      .toBe(MIN_MAGNIFIER_SCALE);
  });

  it("does not rerender while Space repeats unless the pointer or scale changes", () => {
    const pointer = { x: 120, y: 80 };
    expect(shouldRenderMagnifierAt(undefined, pointer)).toBe(true);
    expect(shouldRenderMagnifierAt(pointer, { ...pointer })).toBe(false);
    expect(shouldRenderMagnifierAt(pointer, { x: 121, y: 80 })).toBe(true);
    expect(shouldRenderMagnifierAt(pointer, pointer, true)).toBe(true);
  });

  it("limits continuous pointer-move rendering to one request per interval", () => {
    expect(magnifierRenderDelay(Number.NEGATIVE_INFINITY, 1_000)).toBe(0);
    expect(magnifierRenderDelay(1_000, 1_016)).toBe(64);
    expect(magnifierRenderDelay(1_000, 1_080)).toBe(0);
    expect(magnifierRenderDelay(1_000, 1_200)).toBe(0);
  });

  it("rerenders intersecting PDF regions in stitched order after a whole-canvas rotation", () => {
    const pages = [
      { pageNumber: 1, x: 0, y: 0, width: 100, height: 100, sourceX: 0, sourceY: 0 },
      { pageNumber: 2, x: 100, y: 0, width: 100, height: 100, sourceX: 0, sourceY: 0 },
    ];
    const source = { x: 75, y: 25, width: 50, height: 50 };
    const camera = { x: 0, y: 0, scale: 1 };

    expect(calculateMagnifierTiles(
      source,
      2,
      camera,
      { width: 200, height: 100 },
      pages,
      0,
    )).toEqual([
      {
        pageNumber: 1,
        source: { x: 75, y: 25, width: 25, height: 50 },
        target: { x: 0, y: 0, width: 50, height: 100 },
      },
      {
        pageNumber: 2,
        source: { x: 0, y: 25, width: 25, height: 50 },
        target: { x: 50, y: 0, width: 50, height: 100 },
      },
    ]);

    expect(calculateMagnifierTiles(
      { x: 25, y: 75, width: 50, height: 50 },
      2,
      camera,
      { width: 200, height: 100 },
      pages,
      90,
    )).toEqual([
      {
        pageNumber: 1,
        source: { x: 75, y: 25, width: 25, height: 50 },
        target: { x: 0, y: 0, width: 100, height: 50 },
      },
      {
        pageNumber: 2,
        source: { x: 0, y: 25, width: 25, height: 50 },
        target: { x: 0, y: 50, width: 100, height: 50 },
      },
    ]);
  });
});
