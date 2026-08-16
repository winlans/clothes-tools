import {
  resolveGuideDetectionOptions,
  type GuideDetectionOptions,
} from "../guides/detection";
import type { GuideCoordinates } from "../guides/crop";
import { Pdf2PltError } from "../pdf/errors";
import { removeCoordinateGuideElements } from "./guide-removal";

export interface SvgPreviewOptions {
  removeGuides: boolean;
  guideDetection?: Partial<GuideDetectionOptions>;
  guides?: GuideCoordinates;
}

const VECTOR_ELEMENT =
  "path|line|polyline|polygon|rect|circle|ellipse|text|use";

function parseSvgColor(value: string): [number, number, number] | undefined {
  const normalized = value.trim().toLowerCase();
  if (normalized === "red") return [255, 0, 0];
  const shortHex = normalized.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
  if (shortHex) {
    return shortHex.slice(1).map((channel) => Number.parseInt(`${channel}${channel}`, 16)) as
      [number, number, number];
  }
  const hex = normalized.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})(?:[0-9a-f]{2})?$/i);
  if (hex) {
    return hex.slice(1, 4).map((channel) => Number.parseInt(channel, 16)) as
      [number, number, number];
  }
  const rgb = normalized.match(/^rgb\(\s*([\d.]+)(%)?[,\s]+([\d.]+)(%)?[,\s]+([\d.]+)(%)?\s*\)$/);
  if (!rgb) return undefined;
  const channels = [1, 3, 5].map((index) => {
    const number = Number(rgb[index]);
    return rgb[index + 1] ? Math.round(number * 2.55) : Math.round(number);
  });
  return channels.every((channel) => channel >= 0 && channel <= 255)
    ? channels as [number, number, number]
    : undefined;
}

function paintValues(element: string): string[] {
  const values: string[] = [];
  for (const match of element.matchAll(/\b(?:stroke|fill)\s*=\s*(["'])(.*?)\1/gi)) {
    if (match[2]) values.push(match[2]);
  }
  for (const match of element.matchAll(/\bstyle\s*=\s*(["'])(.*?)\1/gi)) {
    const style = match[2] ?? "";
    for (const declaration of style.split(";")) {
      const paint = declaration.match(/^\s*(?:stroke|fill)\s*:\s*(.*?)\s*$/i)?.[1];
      if (paint) values.push(paint);
    }
  }
  return values;
}

function isGuideColor(
  color: [number, number, number],
  options: GuideDetectionOptions,
): boolean {
  const [red, green, blue] = color;
  return red >= options.redMin &&
    green <= options.otherMax &&
    blue <= options.otherMax &&
    red - Math.max(green, blue) >= options.redDelta;
}

function isGuideElement(element: string, options: GuideDetectionOptions): boolean {
  return paintValues(element).some((value) => {
    const color = parseSvgColor(value);
    return color ? isGuideColor(color, options) : false;
  });
}

export function prepareSvgPreview(svg: string, options: SvgPreviewOptions): string {
  if (!/<svg\b[^>]*>/i.test(svg) || !/<\/svg>/i.test(svg)) {
    throw new Pdf2PltError("invalid-page-svg", "MuPDF 页面没有生成有效的 SVG。");
  }
  if (!options.removeGuides) return svg;

  const detection = resolveGuideDetectionOptions(options.guideDetection);
  const pairedElement = new RegExp(
    `<(${VECTOR_ELEMENT})\\b[^>]*>\\s*</\\1>`,
    "gi",
  );
  const selfClosingElement = new RegExp(`<(${VECTOR_ELEMENT})\\b[^>]*/>`, "gi");
  const colorFiltered = svg
    .replace(pairedElement, (element) => isGuideElement(element, detection) ? "" : element)
    .replace(selfClosingElement, (element) => isGuideElement(element, detection) ? "" : element);
  return removeCoordinateGuideElements(colorFiltered, options.guides);
}
