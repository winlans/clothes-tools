import type { QuarterTurn } from "@pdf2plt/core";
import type { Camera, Point, Size } from "./camera";

export const MAGNIFIER_WIDTH = 320;
export const MAGNIFIER_HEIGHT = 220;
export const MAGNIFIER_SCALE = 2.5;
export const MAGNIFIER_PADDING = 8;
export const MIN_MAGNIFIER_SCALE = 1.5;
export const MAX_MAGNIFIER_SCALE = 8;
export const MAGNIFIER_SCALE_STEP = 0.5;
export const FINE_MAGNIFIER_SCALE_STEP = 0.1;
export const MAGNIFIER_MIN_RENDER_INTERVAL_MS = 80;

export interface MagnifierRect extends Point, Size {}

export interface MagnifierFrame {
  lens: MagnifierRect;
  source: MagnifierRect;
}

export interface MagnifierPageFrame extends MagnifierRect {
  pageNumber: number;
  sourceX: number;
  sourceY: number;
}

export interface MagnifierRenderTile {
  pageNumber: number;
  source: MagnifierRect;
  target: MagnifierRect;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

export function shouldRenderMagnifierAt(
  previous: Point | undefined,
  next: Point | undefined,
  force = false,
): boolean {
  if (force) return Boolean(next ?? previous);
  if (!next) return false;
  return !previous || next.x !== previous.x || next.y !== previous.y;
}

export function magnifierRenderDelay(
  lastStartedAt: number,
  now: number,
  minimumInterval = MAGNIFIER_MIN_RENDER_INTERVAL_MS,
): number {
  if (!Number.isFinite(lastStartedAt)) return 0;
  return Math.max(0, minimumInterval - Math.max(0, now - lastStartedAt));
}

export function adjustMagnifierScale(
  current: number,
  deltaY: number,
  fineAdjustment: boolean,
): number {
  if (deltaY === 0) return current;
  const step = fineAdjustment ? FINE_MAGNIFIER_SCALE_STEP : MAGNIFIER_SCALE_STEP;
  const next = current + (deltaY < 0 ? step : -step);
  return Number(clamp(next, MIN_MAGNIFIER_SCALE, MAX_MAGNIFIER_SCALE).toFixed(2));
}

export function calculateMagnifierFrame(
  pointer: Point,
  viewport: Size,
  requestedSize: Size = { width: MAGNIFIER_WIDTH, height: MAGNIFIER_HEIGHT },
  scale = MAGNIFIER_SCALE,
  padding = MAGNIFIER_PADDING,
): MagnifierFrame {
  const safeScale = Number.isFinite(scale) && scale > 1 ? scale : MAGNIFIER_SCALE;
  const safePadding = Math.max(0, padding);
  const availableWidth = Math.max(1, viewport.width - safePadding * 2);
  const availableHeight = Math.max(1, viewport.height - safePadding * 2);
  const lensWidth = Math.min(Math.max(1, requestedSize.width), availableWidth);
  const lensHeight = Math.min(Math.max(1, requestedSize.height), availableHeight);
  const sourceWidth = Math.min(viewport.width, lensWidth / safeScale);
  const sourceHeight = Math.min(viewport.height, lensHeight / safeScale);

  return {
    lens: {
      x: clamp(
        pointer.x - lensWidth / 2,
        safePadding,
        Math.max(safePadding, viewport.width - safePadding - lensWidth),
      ),
      y: clamp(
        pointer.y - lensHeight / 2,
        safePadding,
        Math.max(safePadding, viewport.height - safePadding - lensHeight),
      ),
      width: lensWidth,
      height: lensHeight,
    },
    source: {
      x: clamp(pointer.x - sourceWidth / 2, 0, Math.max(0, viewport.width - sourceWidth)),
      y: clamp(pointer.y - sourceHeight / 2, 0, Math.max(0, viewport.height - sourceHeight)),
      width: sourceWidth,
      height: sourceHeight,
    },
  };
}

export function calculateMagnifierTiles(
  source: MagnifierRect,
  magnification: number,
  camera: Camera,
  content: Size,
  pages: readonly MagnifierPageFrame[],
  rotation: QuarterTurn,
): MagnifierRenderTile[] {
  const displayLeft = (source.x - camera.x) / camera.scale;
  const displayTop = (source.y - camera.y) / camera.scale;
  const displayRight = (source.x + source.width - camera.x) / camera.scale;
  const displayBottom = (source.y + source.height - camera.y) / camera.scale;
  let worldLeft = displayLeft;
  let worldRight = displayRight;
  let worldTop = displayTop;
  let worldBottom = displayBottom;
  if (rotation === 90) {
    worldLeft = displayTop;
    worldRight = displayBottom;
    worldTop = content.height - displayRight;
    worldBottom = content.height - displayLeft;
  } else if (rotation === 180) {
    worldLeft = content.width - displayRight;
    worldRight = content.width - displayLeft;
    worldTop = content.height - displayBottom;
    worldBottom = content.height - displayTop;
  } else if (rotation === 270) {
    worldLeft = content.width - displayBottom;
    worldRight = content.width - displayTop;
    worldTop = displayLeft;
    worldBottom = displayRight;
  }

  return pages.flatMap((page) => {
    const x = Math.max(worldLeft, page.x);
    const y = Math.max(worldTop, page.y);
    const right = Math.min(worldRight, page.x + page.width);
    const bottom = Math.min(worldBottom, page.y + page.height);
    if (right <= x || bottom <= y) return [];
    const width = right - x;
    const height = bottom - y;
    let displayX = x;
    let displayY = y;
    let displayWidth = width;
    let displayHeight = height;
    if (rotation === 90) {
      displayX = content.height - y - height;
      displayY = x;
      displayWidth = height;
      displayHeight = width;
    } else if (rotation === 180) {
      displayX = content.width - x - width;
      displayY = content.height - y - height;
    } else if (rotation === 270) {
      displayX = y;
      displayY = content.width - x - width;
      displayWidth = height;
      displayHeight = width;
    }
    return [{
      pageNumber: page.pageNumber,
      source: {
        x: page.sourceX + x - page.x,
        y: page.sourceY + y - page.y,
        width,
        height,
      },
      target: {
        x: (camera.x + displayX * camera.scale - source.x) * magnification,
        y: (camera.y + displayY * camera.scale - source.y) * magnification,
        width: displayWidth * camera.scale * magnification,
        height: displayHeight * camera.scale * magnification,
      },
    }];
  });
}
