import type { GuideCoordinates } from "../guides/crop";

interface Point {
  x: number;
  y: number;
}

interface Segment {
  start: Point;
  end: Point;
}

type Matrix = readonly [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const COORDINATE_GUIDE_ELEMENT = "path|line|polyline|polygon|rect";

function attribute(element: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return element.match(new RegExp(`\\b${escaped}\\s*=\\s*(["'])(.*?)\\1`, "i"))?.[2];
}

function numbers(value: string): number[] {
  return [...value.matchAll(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi)]
    .map((match) => Number(match[0]));
}

function elementMatrix(element: string): Matrix {
  const transform = attribute(element, "transform");
  const values = transform?.match(/matrix\s*\(([^)]+)\)/i)?.[1];
  const parsed = values ? numbers(values) : [];
  return parsed.length === 6 && parsed.every(Number.isFinite)
    ? parsed as unknown as Matrix
    : IDENTITY;
}

function transformPoint(point: Point, matrix: Matrix): Point {
  return {
    x: matrix[0] * point.x + matrix[2] * point.y + matrix[4],
    y: matrix[1] * point.x + matrix[3] * point.y + matrix[5],
  };
}

function pathSegments(path: string): Segment[] | undefined {
  const tokens = path.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? [];
  const segments: Segment[] = [];
  let index = 0;
  let command = "";
  let current: Point = { x: 0, y: 0 };
  let subpathStart: Point = { ...current };
  const isCommand = (token: string | undefined) => Boolean(token && /^[a-zA-Z]$/.test(token));
  const read = (): number | undefined => {
    const token = tokens[index];
    if (token === undefined || isCommand(token)) return undefined;
    index += 1;
    const value = Number(token);
    return Number.isFinite(value) ? value : undefined;
  };

  while (index < tokens.length) {
    if (isCommand(tokens[index])) command = tokens[index++] ?? "";
    if (!/[mMlLhHvVzZ]/.test(command)) return undefined;
    const relative = command === command.toLowerCase();
    const upper = command.toUpperCase();
    if (upper === "Z") {
      segments.push({ start: current, end: subpathStart });
      current = { ...subpathStart };
      command = "";
      continue;
    }
    if (upper === "H" || upper === "V") {
      const value = read();
      if (value === undefined) return undefined;
      const next = upper === "H"
        ? { x: relative ? current.x + value : value, y: current.y }
        : { x: current.x, y: relative ? current.y + value : value };
      segments.push({ start: current, end: next });
      current = next;
      continue;
    }
    const first = read();
    const second = read();
    if (first === undefined || second === undefined) return undefined;
    const next = {
      x: relative ? current.x + first : first,
      y: relative ? current.y + second : second,
    };
    if (upper === "M") {
      current = next;
      subpathStart = { ...next };
      command = relative ? "l" : "L";
    } else {
      segments.push({ start: current, end: next });
      current = next;
    }
  }
  return segments;
}

function elementSegments(element: string): Segment[] | undefined {
  const name = element.match(/^<([a-z]+)/i)?.[1]?.toLowerCase();
  if (!name) return undefined;
  if (name === "path") {
    const path = attribute(element, "d");
    return path ? pathSegments(path) : undefined;
  }
  if (name === "line") {
    const x1 = Number(attribute(element, "x1") ?? 0);
    const y1 = Number(attribute(element, "y1") ?? 0);
    const x2 = Number(attribute(element, "x2") ?? 0);
    const y2 = Number(attribute(element, "y2") ?? 0);
    return [x1, y1, x2, y2].every(Number.isFinite)
      ? [{ start: { x: x1, y: y1 }, end: { x: x2, y: y2 } }]
      : undefined;
  }
  if (name === "polyline" || name === "polygon") {
    const values = numbers(attribute(element, "points") ?? "");
    if (values.length < 4 || values.length % 2 !== 0) return undefined;
    const points = Array.from({ length: values.length / 2 }, (_, index) => ({
      x: values[index * 2] ?? 0,
      y: values[index * 2 + 1] ?? 0,
    }));
    const segments = points.slice(1).map((point, index) => ({
      start: points[index] ?? point,
      end: point,
    }));
    if (name === "polygon" && points[0] && points.at(-1)) {
      segments.push({ start: points.at(-1)!, end: points[0] });
    }
    return segments;
  }
  if (name === "rect") {
    const x = Number(attribute(element, "x") ?? 0);
    const y = Number(attribute(element, "y") ?? 0);
    const width = Number(attribute(element, "width"));
    const height = Number(attribute(element, "height"));
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
      return undefined;
    }
    const points = [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ];
    return points.map((point, index) => ({
      start: point,
      end: points[(index + 1) % points.length] ?? point,
    }));
  }
  return undefined;
}

function hasVisibleStroke(element: string): boolean {
  const stroke = strokePaint(element);
  return Boolean(stroke && stroke !== "none");
}

function strokePaint(element: string): string | undefined {
  return (attribute(element, "stroke") ??
    attribute(element, "style")?.match(/(?:^|;)\s*stroke\s*:\s*([^;]+)/i)?.[1]
  )?.trim().toLowerCase();
}

function isCoordinateGuideElement(
  element: string,
  guides: GuideCoordinates,
  tolerancePt: number,
): boolean {
  if (!hasVisibleStroke(element)) return false;
  const segments = elementSegments(element);
  if (!segments?.length) return false;
  const matrix = elementMatrix(element);
  const vertical = [guides.left, guides.right];
  const horizontal = [guides.top, guides.bottom];
  return segments.every((segment) => {
    const start = transformPoint(segment.start, matrix);
    const end = transformPoint(segment.end, matrix);
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length < 0.5) return false;
    return vertical.some((coordinate) =>
      Math.abs(start.x - coordinate) <= tolerancePt &&
      Math.abs(end.x - coordinate) <= tolerancePt
    ) || horizontal.some((coordinate) =>
      Math.abs(start.y - coordinate) <= tolerancePt &&
      Math.abs(end.y - coordinate) <= tolerancePt
    );
  });
}

function isPeripheralGuideContinuation(
  element: string,
  guides: GuideCoordinates,
  tolerancePt: number,
): boolean {
  const segments = elementSegments(element);
  if (!segments?.length) return false;
  const matrix = elementMatrix(element);
  const pageWidth = guides.left + guides.right;
  const pageHeight = guides.top + guides.bottom;
  return segments.every((segment) => {
    const start = transformPoint(segment.start, matrix);
    const end = transformPoint(segment.end, matrix);
    const horizontal = Math.abs(start.y - end.y) <= tolerancePt;
    const vertical = Math.abs(start.x - end.x) <= tolerancePt;
    if (horizontal) {
      const atPageEdge = Math.abs(start.y) <= tolerancePt ||
        Math.abs(start.y - pageHeight) <= tolerancePt;
      const inCorner = Math.max(start.x, end.x) <= guides.left + tolerancePt ||
        Math.min(start.x, end.x) >= guides.right - tolerancePt;
      return atPageEdge && inCorner;
    }
    if (vertical) {
      const atPageEdge = Math.abs(start.x) <= tolerancePt ||
        Math.abs(start.x - pageWidth) <= tolerancePt;
      const inCorner = Math.max(start.y, end.y) <= guides.top + tolerancePt ||
        Math.min(start.y, end.y) >= guides.bottom - tolerancePt;
      return atPageEdge && inCorner;
    }
    return false;
  });
}

export function removeCoordinateGuideElements(
  svg: string,
  guides: GuideCoordinates | undefined,
  tolerancePt = 1.5,
): string {
  if (!guides) return svg;
  const paired = new RegExp(
    `<(${COORDINATE_GUIDE_ELEMENT})\\b[^>]*>\\s*</\\1>`,
    "gi",
  );
  const selfClosing = new RegExp(`<(${COORDINATE_GUIDE_ELEMENT})\\b[^>]*/>`, "gi");
  const allElements = [
    ...svg.matchAll(new RegExp(`<(${COORDINATE_GUIDE_ELEMENT})\\b[^>]*/>`, "gi")),
  ].map((match) => match[0]);
  const guidePaints = new Set(
    allElements
      .filter((element) => isCoordinateGuideElement(element, guides, tolerancePt))
      .map(strokePaint)
      .filter((paint): paint is string => Boolean(paint)),
  );
  const shouldRemove = (element: string) =>
    isCoordinateGuideElement(element, guides, tolerancePt) ||
    (guidePaints.has(strokePaint(element) ?? "") &&
      isPeripheralGuideContinuation(element, guides, tolerancePt));
  return svg
    .replace(paired, (element) =>
      shouldRemove(element) ? "" : element
    )
    .replace(selfClosing, (element) =>
      shouldRemove(element) ? "" : element
    );
}
