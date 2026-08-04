import type { LayoutGrid } from "../layout/automatic-layout";
import type { PageSizePt } from "../pdf/document";
import { Pdf2PltError } from "../pdf/errors";
import type { GuideDirection } from "./detection";

export type GuideCoordinates = Record<GuideDirection, number>;

export interface CropAxisSegment {
  outputStart: number;
  sourceStart: number;
  sourceEnd: number;
  size: number;
}

export interface LayoutCropGeometry {
  width: number;
  height: number;
  columns: CropAxisSegment[];
  rows: CropAxisSegment[];
}

function buildSegments(
  count: number,
  fullSize: number,
  innerStart: number,
  innerEnd: number,
): CropAxisSegment[] {
  const segments: CropAxisSegment[] = [];
  let outputStart = 0;
  for (let index = 0; index < count; index += 1) {
    const sourceStart = index === 0 ? 0 : innerStart;
    const sourceEnd = index === count - 1 ? fullSize : innerEnd;
    const size = sourceEnd - sourceStart;
    segments.push({ outputStart, sourceStart, sourceEnd, size });
    outputStart += size;
  }
  return segments;
}

export function createLayoutCropGeometry(
  layout: LayoutGrid,
  pageSize: PageSizePt,
  guides?: GuideCoordinates,
): LayoutCropGeometry {
  const left = guides?.left ?? 0;
  const right = guides?.right ?? pageSize.width;
  const top = guides?.top ?? 0;
  const bottom = guides?.bottom ?? pageSize.height;
  if (!(0 <= left && left < right && right <= pageSize.width + 0.05)) {
    throw new Pdf2PltError("invalid-guide-crop", "左右拼接线不能形成有效裁切范围。");
  }
  if (!(0 <= top && top < bottom && bottom <= pageSize.height + 0.05)) {
    throw new Pdf2PltError("invalid-guide-crop", "上下拼接线不能形成有效裁切范围。");
  }
  const columns = buildSegments(layout.columns, pageSize.width, left, Math.min(right, pageSize.width));
  const rows = buildSegments(layout.rows, pageSize.height, top, Math.min(bottom, pageSize.height));
  return {
    width: columns.reduce((sum, segment) => sum + segment.size, 0),
    height: rows.reduce((sum, segment) => sum + segment.size, 0),
    columns,
    rows,
  };
}
