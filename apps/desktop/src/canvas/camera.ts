export const MIN_CANVAS_ZOOM = 0.1;
export const MAX_CANVAS_ZOOM = 4;
export const WHEEL_ZOOM_FACTOR = 1.1;
export const FINE_WHEEL_ZOOM_FACTOR = 1.01;

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Camera extends Point {
  scale: number;
}

export interface ContentBounds extends Point, Size {}

export interface CanvasLayerTransform extends Point {
  scaleX: number;
  scaleY: number;
  rotation: QuarterTurn;
}

export interface CanvasSceneFitState {
  rows: number;
  columns: number;
  guides: unknown;
  rotation: QuarterTurn;
  pageWidth?: number;
  pageHeight?: number;
}

export function shouldFitCameraAfterSceneChange(
  current: CanvasSceneFitState,
  previous: CanvasSceneFitState,
): boolean {
  return current.rows !== previous.rows ||
    current.columns !== previous.columns ||
    current.guides !== previous.guides ||
    current.pageWidth !== previous.pageWidth ||
    current.pageHeight !== previous.pageHeight;
}

export function canvasRenderPixelRatio(devicePixelRatio: number): number {
  const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
    ? devicePixelRatio
    : 1;
  return Math.max(2, ratio);
}

export function clampZoom(scale: number): number {
  return Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, scale));
}

export function zoomCameraAtPoint(
  camera: Camera,
  pointer: Point,
  factor: number,
): Camera {
  return setCameraZoomAtPoint(camera, pointer, camera.scale * factor);
}

export function setCameraZoomAtPoint(
  camera: Camera,
  pointer: Point,
  requestedScale: number,
): Camera {
  const scale = clampZoom(requestedScale);
  const worldX = (pointer.x - camera.x) / camera.scale;
  const worldY = (pointer.y - camera.y) / camera.scale;

  return {
    scale,
    x: pointer.x - worldX * scale,
    y: pointer.y - worldY * scale,
  };
}

export function panCameraBy(camera: Camera, delta: Point): Camera {
  return {
    ...camera,
    x: camera.x + delta.x,
    y: camera.y + delta.y,
  };
}

export function isCanvasPanGesture(button: number): boolean {
  return button === 0;
}

export function isCanvasMagnifierShortcut(
  code: string,
  pointerInside: boolean,
  canvasHasFocus: boolean,
): boolean {
  return code === "Space" && (pointerInside || canvasHasFocus);
}

export function canvasCursor(
  magnifierActive: boolean,
  gestureActive: boolean,
): "crosshair" | "grab" | "grabbing" {
  if (gestureActive) return "grabbing";
  return magnifierActive ? "crosshair" : "grab";
}

export function canvasLayerTransform(
  camera: Camera,
  content: Size,
  rotation: QuarterTurn,
): CanvasLayerTransform {
  const offsets: Record<QuarterTurn, Point> = {
    0: { x: 0, y: 0 },
    90: { x: content.height, y: 0 },
    180: { x: content.width, y: content.height },
    270: { x: 0, y: content.width },
  };
  const offset = offsets[rotation];
  return {
    x: camera.x + offset.x * camera.scale,
    y: camera.y + offset.y * camera.scale,
    scaleX: camera.scale,
    scaleY: camera.scale,
    rotation,
  };
}

export function canvasPointToWorld(
  point: Point,
  camera: Camera,
  content: Size,
  rotation: QuarterTurn,
): Point {
  const x = (point.x - camera.x) / camera.scale;
  const y = (point.y - camera.y) / camera.scale;
  if (rotation === 90) return { x: y, y: content.height - x };
  if (rotation === 180) return { x: content.width - x, y: content.height - y };
  if (rotation === 270) return { x: content.width - y, y: x };
  return { x, y };
}

export function wheelPanDelta(
  deltaX: number,
  deltaY: number,
  horizontal: boolean,
): Point {
  if (horizontal) {
    return { x: -(deltaX || deltaY), y: 0 };
  }
  return { x: -deltaX, y: -deltaY };
}

export function wheelZoomFactor(deltaY: number, fineAdjustment: boolean): number {
  if (deltaY === 0) return 1;
  const factor = fineAdjustment ? FINE_WHEEL_ZOOM_FACTOR : WHEEL_ZOOM_FACTOR;
  return deltaY < 0 ? factor : 1 / factor;
}

export function fitCameraToContent(
  viewport: Size,
  content: ContentBounds,
  padding = 32,
): Camera {
  const availableWidth = Math.max(1, viewport.width - padding * 2);
  const availableHeight = Math.max(1, viewport.height - padding * 2);
  const scale = clampZoom(
    Math.min(availableWidth / content.width, availableHeight / content.height),
  );

  return {
    scale,
    x: (viewport.width - content.width * scale) / 2 - content.x * scale,
    y: (viewport.height - content.height * scale) / 2 - content.y * scale,
  };
}
import type { QuarterTurn } from "@pdf2plt/core";
