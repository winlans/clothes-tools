import type { LayoutGrid } from "../layout/automatic-layout";
import type { PageSizePt } from "../pdf/document";
import { Pdf2PltError } from "../pdf/errors";
import type { GuideDirection } from "./detection";

export interface GuideCoordinates extends Record<GuideDirection, number> {
  outerLeft?: number;
  outerRight?: number;
  outerTop?: number;
  outerBottom?: number;
}

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
  const outerLeft = guides?.outerLeft ?? 0;
  const outerRight = guides?.outerRight ?? pageSize.width;
  const outerTop = guides?.outerTop ?? 0;
  const outerBottom = guides?.outerBottom ?? pageSize.height;
  if (!(0 <= left && left < right && right <= pageSize.width + 0.05)) {
    throw new Pdf2PltError("invalid-guide-crop", "左右拼接线不能形成有效裁切范围。");
  }
  if (!(0 <= top && top < bottom && bottom <= pageSize.height + 0.05)) {
    throw new Pdf2PltError("invalid-guide-crop", "上下拼接线不能形成有效裁切范围。");
  }
  if (!(0 <= outerLeft && outerLeft < outerRight && outerRight <= pageSize.width + 0.05)) {
    throw new Pdf2PltError("invalid-guide-crop", "左右外边界不能形成有效裁切范围。");
  }
  if (!(0 <= outerTop && outerTop < outerBottom && outerBottom <= pageSize.height + 0.05)) {
    throw new Pdf2PltError("invalid-guide-crop", "上下外边界不能形成有效裁切范围。");
  }
  const columns = buildSegments(
    layout.columns,
    Math.min(outerRight, pageSize.width),
    left,
    Math.min(right, pageSize.width),
  );
  const rows = buildSegments(
    layout.rows,
    Math.min(outerBottom, pageSize.height),
    top,
    Math.min(bottom, pageSize.height),
  );
  const firstColumn = columns[0];
  if (firstColumn) {
    firstColumn.sourceStart = outerLeft;
    firstColumn.size = firstColumn.sourceEnd - outerLeft;
  }
  const firstRow = rows[0];
  if (firstRow) {
    firstRow.sourceStart = outerTop;
    firstRow.size = firstRow.sourceEnd - outerTop;
  }
  let outputStart = 0;
  for (const column of columns) {
    column.outputStart = outputStart;
    outputStart += column.size;
  }
  outputStart = 0;
  for (const row of rows) {
    row.outputStart = outputStart;
    outputStart += row.size;
  }
  if (columns.some((column) => column.size <= 0)) {
    throw new Pdf2PltError("invalid-guide-crop", "外边界与左右拼接线形成了空裁切列。");
  }
  if (rows.some((row) => row.size <= 0)) {
    throw new Pdf2PltError("invalid-guide-crop", "外边界与上下拼接线形成了空裁切行。");
  }
  return {
    width: columns.reduce((sum, segment) => sum + segment.size, 0),
    height: rows.reduce((sum, segment) => sum + segment.size, 0),
    columns,
    rows,
  };
}
