import { describe, expect, it } from "vitest";

import {
  fitCameraToContent,
  MAX_CANVAS_ZOOM,
  MIN_CANVAS_ZOOM,
  panCameraBy,
  zoomCameraAtPoint,
} from "./camera";

describe("canvas camera", () => {
  it("fits all content into the viewport without changing content dimensions", () => {
    const camera = fitCameraToContent(
      { width: 1000, height: 700 },
      { x: 0, y: 0, width: 4209.45, height: 3571.653 },
      30,
    );

    expect(camera.scale).toBeCloseTo(640 / 3571.653);
    expect(4209.45 * camera.scale).toBeLessThanOrEqual(940);
    expect(3571.653 * camera.scale).toBeLessThanOrEqual(640);
  });

  it("keeps the world point under the pointer fixed while zooming", () => {
    const pointer = { x: 420, y: 260 };
    const before = { x: 30, y: -20, scale: 0.5 };
    const worldBefore = {
      x: (pointer.x - before.x) / before.scale,
      y: (pointer.y - before.y) / before.scale,
    };
    const after = zoomCameraAtPoint(before, pointer, 1.2);

    expect((pointer.x - after.x) / after.scale).toBeCloseTo(worldBefore.x);
    expect((pointer.y - after.y) / after.scale).toBeCloseTo(worldBefore.y);
  });

  it("limits wheel zoom to 10% through 400%", () => {
    expect(zoomCameraAtPoint({ x: 0, y: 0, scale: 1 }, { x: 0, y: 0 }, 0.001).scale)
      .toBe(MIN_CANVAS_ZOOM);
    expect(zoomCameraAtPoint({ x: 0, y: 0, scale: 1 }, { x: 0, y: 0 }, 100).scale)
      .toBe(MAX_CANVAS_ZOOM);
  });

  it("pans the view without changing its zoom", () => {
    expect(panCameraBy({ x: 12, y: -8, scale: 0.5 }, { x: 40, y: 25 })).toEqual({
      x: 52,
      y: 17,
      scale: 0.5,
    });
  });
});
