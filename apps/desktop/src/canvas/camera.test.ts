import { describe, expect, it } from "vitest";

import {
  canvasPointToWorld,
  canvasLayerTransform,
  canvasCursor,
  canvasRenderPixelRatio,
  fitCameraToContent,
  FINE_WHEEL_ZOOM_FACTOR,
  isCanvasPanGesture,
  isCanvasMagnifierShortcut,
  MAX_CANVAS_ZOOM,
  MIN_CANVAS_ZOOM,
  panCameraBy,
  setCameraZoomAtPoint,
  shouldFitCameraAfterSceneChange,
  zoomCameraAtPoint,
  wheelPanDelta,
  wheelZoomFactor,
  WHEEL_ZOOM_FACTOR,
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

  it("sets an exact decimal zoom while keeping the viewport anchor fixed", () => {
    const pointer = { x: 500, y: 350 };
    const before = { x: 80, y: 20, scale: 0.25 };
    const after = setCameraZoomAtPoint(before, pointer, 0.37125);

    expect(after.scale).toBe(0.37125);
    expect((pointer.x - after.x) / after.scale).toBeCloseTo(
      (pointer.x - before.x) / before.scale,
    );
    expect((pointer.y - after.y) / after.scale).toBeCloseTo(
      (pointer.y - before.y) / before.scale,
    );
  });

  it("pans the view without changing its zoom", () => {
    expect(panCameraBy({ x: 12, y: -8, scale: 0.5 }, { x: 40, y: 25 })).toEqual({
      x: 52,
      y: 17,
      scale: 0.5,
    });
  });

  it("uses only the left mouse button to pan the canvas", () => {
    expect(isCanvasPanGesture(0)).toBe(true);
    expect(isCanvasPanGesture(1)).toBe(false);
    expect(isCanvasPanGesture(2)).toBe(false);
  });

  it("activates the magnifier with Space while the canvas is hovered or focused", () => {
    expect(isCanvasMagnifierShortcut("Space", true, false)).toBe(true);
    expect(isCanvasMagnifierShortcut("Space", false, true)).toBe(true);
    expect(isCanvasMagnifierShortcut("Space", false, false)).toBe(false);
    expect(isCanvasMagnifierShortcut("Escape", true, true)).toBe(false);
  });

  it("shows the local-magnifier cursor until another canvas gesture is active", () => {
    expect(canvasCursor(false, false)).toBe("grab");
    expect(canvasCursor(true, false)).toBe("crosshair");
    expect(canvasCursor(true, true)).toBe("grabbing");
  });

  it("rotates one completed canvas layer while mapping pointer positions back", () => {
    expect(canvasLayerTransform(
      { x: 20, y: 30, scale: 0.5 },
      { width: 800, height: 600 },
      90,
    )).toEqual({ x: 320, y: 30, scaleX: 0.5, scaleY: 0.5, rotation: 90 });
    expect(canvasPointToWorld(
      { x: 120, y: 80 },
      { x: 20, y: 30, scale: 0.5 },
      { width: 800, height: 600 },
      90,
    )).toEqual({ x: 100, y: 400 });
    expect(canvasPointToWorld(
      { x: 120, y: 80 },
      { x: 20, y: 30, scale: 0.5 },
      { width: 800, height: 600 },
      270,
    )).toEqual({ x: 700, y: 200 });
  });

  it("keeps the camera zoom and position when only output rotation changes", () => {
    expect(shouldFitCameraAfterSceneChange(
      { rows: 3, columns: 5, guides: "same", rotation: 90 },
      { rows: 3, columns: 5, guides: "same", rotation: 0 },
    )).toBe(false);
    expect(shouldFitCameraAfterSceneChange(
      { rows: 4, columns: 5, guides: "same", rotation: 90 },
      { rows: 3, columns: 5, guides: "same", rotation: 90 },
    )).toBe(true);
  });

  it("uses at least two physical pixels per canvas pixel for stable thin lines", () => {
    expect(canvasRenderPixelRatio(1)).toBe(2);
    expect(canvasRenderPixelRatio(1.5)).toBe(2);
    expect(canvasRenderPixelRatio(2.5)).toBe(2.5);
    expect(canvasRenderPixelRatio(Number.NaN)).toBe(2);
  });

  it("turns a normal wheel into vertical or shift-horizontal panning", () => {
    expect(wheelPanDelta(4, 80, false)).toEqual({ x: -4, y: -80 });
    expect(wheelPanDelta(0, 80, true)).toEqual({ x: -80, y: 0 });
    expect(wheelPanDelta(12, 80, true)).toEqual({ x: -12, y: 0 });
  });

  it("uses Ctrl+wheel for zoom and Shift for fine zoom steps", () => {
    expect(wheelZoomFactor(-100, false)).toBe(WHEEL_ZOOM_FACTOR);
    expect(wheelZoomFactor(100, false)).toBeCloseTo(1 / WHEEL_ZOOM_FACTOR);
    expect(wheelZoomFactor(-100, true)).toBe(FINE_WHEEL_ZOOM_FACTOR);
    expect(wheelZoomFactor(100, true)).toBeCloseTo(1 / FINE_WHEEL_ZOOM_FACTOR);
    expect(wheelZoomFactor(0, true)).toBe(1);
  });
});
