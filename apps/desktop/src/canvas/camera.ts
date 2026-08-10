export const MIN_CANVAS_ZOOM = 0.1;
export const MAX_CANVAS_ZOOM = 4;

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

export function isCanvasPanGesture(button: number, spacePressed: boolean): boolean {
  return button === 1 || button === 2 || (button === 0 && spacePressed);
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
