import { createLayoutCropGeometry, type GuideCoordinates } from "../guides/crop";
import type { LayoutGrid } from "../layout/automatic-layout";
import type { PageSizePt } from "../pdf/document";
import { Pdf2PltError } from "../pdf/errors";

export interface SvgPageSource {
  pageNumber: number;
  svg: string;
}

export interface SvgExportOptions {
  removeGuides: boolean;
  removeBackground: boolean;
}

export const DEFAULT_SVG_EXPORT_OPTIONS: Readonly<SvgExportOptions> = {
  removeGuides: true,
  removeBackground: true,
};

export interface SvgExportResult {
  svg: string;
  widthPt: number;
  heightPt: number;
  pageInstances: number;
  visibleObjects: number;
}

function extractSvgBody(svg: string): string {
  const opening = svg.match(/<svg\b[^>]*>/i);
  const closing = svg.toLowerCase().lastIndexOf("</svg>");
  if (!opening || opening.index === undefined || closing < 0) {
    throw new Pdf2PltError("invalid-page-svg", "MuPDF 页面没有生成有效的 SVG。");
  }
  return svg.slice(opening.index + opening[0].length, closing).trim();
}

function removeColorElements(body: string, options: SvgExportOptions): string {
  return body.replace(/<[^>]+\/>/g, (element) => {
    const normalized = element.replace(/\s+/g, "").toLowerCase();
    const red =
      normalized.includes('stroke="#ff0000"') ||
      normalized.includes("stroke='#ff0000'") ||
      normalized.includes("rgb(100%,0%,0%)") ||
      normalized.includes("stroke:red");
    const white =
      normalized.includes('fill="#ffffff"') ||
      normalized.includes("fill='#ffffff'") ||
      normalized.includes("rgb(100%,100%,100%)") ||
      normalized.includes("fill:white");
    if ((options.removeGuides && red) || (options.removeBackground && white)) return "";
    return element;
  });
}

function rewriteIds(body: string, prefix: string): string {
  const idMap = new Map<string, string>();
  for (const match of body.matchAll(/\bid=(['"])([^'"]+)\1/g)) {
    const original = match[2];
    if (original) idMap.set(original, `${prefix}${original}`);
  }
  let rewritten = body;
  for (const [original, replacement] of idMap) {
    const escaped = original.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    rewritten = rewritten
      .replace(new RegExp(`\\bid=(["'])${escaped}\\1`, "g"), `id="${replacement}"`)
      .replace(new RegExp(`url\\(#${escaped}\\)`, "g"), `url(#${replacement})`)
      .replace(
        new RegExp(`\\b((?:xlink:)?href)=(['"])#${escaped}\\2`, "g"),
        `$1="#${replacement}"`,
      );
  }
  return rewritten;
}

function format(value: number): string {
  return Number(value.toFixed(6)).toString();
}

export function buildCombinedSvg(
  pages: readonly SvgPageSource[],
  layout: LayoutGrid,
  pageSize: PageSizePt,
  guides: GuideCoordinates | undefined,
  overrides: Partial<SvgExportOptions> = {},
): SvgExportResult {
  const options = { ...DEFAULT_SVG_EXPORT_OPTIONS, ...overrides };
  const geometry = createLayoutCropGeometry(layout, pageSize, guides);
  const pageByNumber = new Map(pages.map((page) => [page.pageNumber, page.svg]));
  const clips: string[] = [];
  const instances: string[] = [];
  let pageInstances = 0;

  for (let row = 0; row < layout.rows; row += 1) {
    const rowGeometry = geometry.rows[row];
    if (!rowGeometry) continue;
    for (let column = 0; column < layout.columns; column += 1) {
      const cell = layout.cells[row]?.[column];
      if (!cell || cell.kind === "spacer") continue;
      const columnGeometry = geometry.columns[column];
      if (!columnGeometry) continue;
      const source = pageByNumber.get(cell.pageNumber);
      if (!source) {
        throw new Pdf2PltError(
          "missing-page-svg",
          `缺少第 ${cell.pageNumber} 页的矢量 SVG。`,
        );
      }
      pageInstances += 1;
      const prefix = `page${cell.pageNumber}-cell${row}-${column}-`;
      const clipId = `tile-clip-${row}-${column}`;
      const body = rewriteIds(removeColorElements(extractSvgBody(source), options), prefix);
      clips.push(
        `<clipPath id="${clipId}" clipPathUnits="userSpaceOnUse"><rect x="${format(columnGeometry.sourceStart)}" y="${format(rowGeometry.sourceStart)}" width="${format(columnGeometry.size)}" height="${format(rowGeometry.size)}"/></clipPath>`,
      );
      const translateX = columnGeometry.outputStart - columnGeometry.sourceStart;
      const translateY = rowGeometry.outputStart - rowGeometry.sourceStart;
      instances.push(
        `<g data-page="${cell.pageNumber}" transform="translate(${format(translateX)} ${format(translateY)})" clip-path="url(#${clipId})">${body}</g>`,
      );
    }
  }

  const widthMm = (geometry.width * 25.4) / 72;
  const heightMm = (geometry.height * 25.4) / 72;
  const svg = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" width="${widthMm.toFixed(6)}mm" height="${heightMm.toFixed(6)}mm" viewBox="0 0 ${format(geometry.width)} ${format(geometry.height)}">`,
    `<defs>${clips.join("")}</defs>`,
    ...instances,
    "</svg>",
  ].join("\n");
  const visibleObjects = (svg.match(/<(?:path|image|text|use|rect|circle|ellipse|line|polyline|polygon)\b/gi) ?? [])
    .length - clips.length;
  return {
    svg,
    widthPt: geometry.width,
    heightPt: geometry.height,
    pageInstances,
    visibleObjects: Math.max(0, visibleObjects),
  };
}
