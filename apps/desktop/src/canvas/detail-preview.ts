import type { QuarterTurn } from "@pdf2plt/core";

import { canvasPointToWorld, type Camera, type Point, type Size } from "./camera";

export const BASE_PREVIEW_LONG_EDGE = 1600;
export const MAX_DETAIL_PREVIEW_LONG_EDGE = 4096;
const DETAIL_PREVIEW_TIERS = [2400, 3200, MAX_DETAIL_PREVIEW_LONG_EDGE] as const;

export interface DetailPreviewPageFrame extends Point, Size {
  pageNumber: number;
}

export function detailPreviewLongEdge(
  page: Size,
  scale: number,
  renderPixelRatio: number,
): number | undefined {
  const required = Math.max(page.width, page.height) * scale * renderPixelRatio;
  if (!Number.isFinite(required) || required <= BASE_PREVIEW_LONG_EDGE) return undefined;
  return DETAIL_PREVIEW_TIERS.find((tier) => required <= tier) ??
    MAX_DETAIL_PREVIEW_LONG_EDGE;
}

export function visibleDetailPreviewPages(
  camera: Camera,
  viewport: Size,
  content: Size,
  rotation: QuarterTurn,
  pages: readonly DetailPreviewPageFrame[],
  marginPixels = 64,
): number[] {
  const corners = [
    { x: 0, y: 0 },
    { x: viewport.width, y: 0 },
    { x: 0, y: viewport.height },
    { x: viewport.width, y: viewport.height },
  ].map((point) => canvasPointToWorld(point, camera, content, rotation));
  const margin = Math.max(0, marginPixels) / camera.scale;
  const left = Math.min(...corners.map((point) => point.x)) - margin;
  const top = Math.min(...corners.map((point) => point.y)) - margin;
  const right = Math.max(...corners.map((point) => point.x)) + margin;
  const bottom = Math.max(...corners.map((point) => point.y)) + margin;
  return pages.flatMap((page) => {
    const intersects = page.x < right && page.x + page.width > left &&
      page.y < bottom && page.y + page.height > top;
    return intersects ? [page.pageNumber] : [];
  });
}
