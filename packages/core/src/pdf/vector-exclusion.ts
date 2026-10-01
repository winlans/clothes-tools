import type { PageSizePt } from "./document";

export interface VectorPoint {
  x: number;
  y: number;
}

export interface VectorBrushStroke {
  operation: "add" | "subtract";
  radiusPt: number;
  points: VectorPoint[];
}

export interface VectorObjectExclusionRule {
  id: string;
  sourcePageNumber: number;
  scope: "all-pages" | "current-page";
  strokes: VectorBrushStroke[];
  objectKinds?: VectorPaintKind[];
}

export type VectorPaintKind = "path" | "text" | "shade";

export interface VectorObjectMatch {
  objectId: number;
  kind: VectorPaintKind;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface VectorSelectionPreview {
  pageNumber: number;
  selectedObjects: VectorObjectMatch[];
  overlaySvg: string;
}

export interface VectorRenderOptions {
  objectExclusions?: readonly VectorObjectExclusionRule[];
}

type MuPdfModule = (typeof import("mupdf"))["default"];
type Matrix = [number, number, number, number, number, number];
type Device = InstanceType<MuPdfModule["Device"]>;
type Path = InstanceType<MuPdfModule["Path"]>;
type StrokeState = InstanceType<MuPdfModule["StrokeState"]>;
type Color = Parameters<Device["fillPath"]>[4];

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Polyline {
  points: VectorPoint[];
  closed: boolean;
}

interface Candidate {
  objectId: number;
  kind: VectorPaintKind;
  bounds: Rect;
  polylines?: Polyline[];
  filled?: boolean;
  strokeRadius?: number;
}

export type VectorDeviceMode = "exclude" | "overlay" | "inspect";

export interface VectorExclusionDevice {
  device: Device;
  selectedObjects: VectorObjectMatch[];
  destroy(): void;
}

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const GEOMETRY_TOLERANCE_PT = 0.35;
const BACKGROUND_AREA_FRACTION = 0.9;
const NEAR_WHITE_COMPONENT = 0.98;
const EPSILON = 1e-7;

function transformPoint(matrix: Matrix, point: VectorPoint): VectorPoint {
  return {
    x: matrix[0] * point.x + matrix[2] * point.y + matrix[4],
    y: matrix[1] * point.x + matrix[3] * point.y + matrix[5],
  };
}

function transformRect(rect: readonly number[], matrix: Matrix): Rect {
  const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = rect;
  const corners = [
    transformPoint(matrix, { x: x0, y: y0 }),
    transformPoint(matrix, { x: x1, y: y0 }),
    transformPoint(matrix, { x: x1, y: y1 }),
    transformPoint(matrix, { x: x0, y: y1 }),
  ];
  return boundsForPoints(corners);
}

function boundsForPoints(points: readonly VectorPoint[]): Rect {
  if (points.length === 0) return { x0: 0, y0: 0, x1: 0, y1: 0 };
  return {
    x0: Math.min(...points.map((point) => point.x)),
    y0: Math.min(...points.map((point) => point.y)),
    x1: Math.max(...points.map((point) => point.x)),
    y1: Math.max(...points.map((point) => point.y)),
  };
}

function mergeBounds(rects: readonly Rect[]): Rect {
  if (rects.length === 0) return { x0: 0, y0: 0, x1: 0, y1: 0 };
  return {
    x0: Math.min(...rects.map((rect) => rect.x0)),
    y0: Math.min(...rects.map((rect) => rect.y0)),
    x1: Math.max(...rects.map((rect) => rect.x1)),
    y1: Math.max(...rects.map((rect) => rect.y1)),
  };
}

function rectArea(rect: Rect): number {
  return Math.max(0, rect.x1 - rect.x0) * Math.max(0, rect.y1 - rect.y0);
}

function pointDistanceToSegment(point: VectorPoint, start: VectorPoint, end: VectorPoint): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const squaredLength = dx * dx + dy * dy;
  if (squaredLength <= EPSILON) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1,
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / squaredLength,
  ));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function orientation(a: VectorPoint, b: VectorPoint, c: VectorPoint): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsIntersect(
  a: VectorPoint,
  b: VectorPoint,
  c: VectorPoint,
  d: VectorPoint,
): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  return (
    ((abC > EPSILON && abD < -EPSILON) || (abC < -EPSILON && abD > EPSILON)) &&
    ((cdA > EPSILON && cdB < -EPSILON) || (cdA < -EPSILON && cdB > EPSILON))
  );
}

function segmentDistance(
  a: VectorPoint,
  b: VectorPoint,
  c: VectorPoint,
  d: VectorPoint,
): number {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(
    pointDistanceToSegment(a, c, d),
    pointDistanceToSegment(b, c, d),
    pointDistanceToSegment(c, a, b),
    pointDistanceToSegment(d, a, b),
  );
}

function pointInPolygon(point: VectorPoint, polygon: readonly VectorPoint[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const a = polygon[index];
    const b = polygon[previous];
    if (!a || !b) continue;
    if (
      Math.abs(orientation(a, b, point)) <= EPSILON &&
      point.x >= Math.min(a.x, b.x) - EPSILON &&
      point.x <= Math.max(a.x, b.x) + EPSILON &&
      point.y >= Math.min(a.y, b.y) - EPSILON &&
      point.y <= Math.max(a.y, b.y) + EPSILON
    ) return true;
    if (
      (a.y > point.y) !== (b.y > point.y) &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    ) inside = !inside;
  }
  return inside;
}

function strokeSegments(stroke: VectorBrushStroke): Array<[VectorPoint, VectorPoint]> {
  if (stroke.points.length === 0) return [];
  if (stroke.points.length === 1) {
    const point = stroke.points[0]!;
    return [[point, point]];
  }
  return stroke.points.slice(1).map((point, index) => [stroke.points[index]!, point]);
}

function strokeTouchesRect(stroke: VectorBrushStroke, rect: Rect): boolean {
  const expanded = {
    x0: rect.x0 - stroke.radiusPt,
    y0: rect.y0 - stroke.radiusPt,
    x1: rect.x1 + stroke.radiusPt,
    y1: rect.y1 + stroke.radiusPt,
  };
  const inside = (point: VectorPoint) =>
    point.x >= expanded.x0 && point.x <= expanded.x1 &&
    point.y >= expanded.y0 && point.y <= expanded.y1;
  const edges: Array<[VectorPoint, VectorPoint]> = [
    [{ x: expanded.x0, y: expanded.y0 }, { x: expanded.x1, y: expanded.y0 }],
    [{ x: expanded.x1, y: expanded.y0 }, { x: expanded.x1, y: expanded.y1 }],
    [{ x: expanded.x1, y: expanded.y1 }, { x: expanded.x0, y: expanded.y1 }],
    [{ x: expanded.x0, y: expanded.y1 }, { x: expanded.x0, y: expanded.y0 }],
  ];
  return strokeSegments(stroke).some(([start, end]) =>
    inside(start) || inside(end) || edges.some(([a, b]) => segmentsIntersect(start, end, a, b))
  );
}

function strokeTouchesCandidate(stroke: VectorBrushStroke, candidate: Candidate): boolean {
  if (!strokeTouchesRect(stroke, candidate.bounds)) return false;
  if (!candidate.polylines?.length) return true;
  const threshold = stroke.radiusPt + (candidate.strokeRadius ?? 0);
  const brushSegments = strokeSegments(stroke);
  for (const polyline of candidate.polylines) {
    if (candidate.filled && polyline.closed && stroke.points.some((point) =>
      pointInPolygon(point, polyline.points)
    )) return true;
    for (let index = 1; index < polyline.points.length; index += 1) {
      const start = polyline.points[index - 1];
      const end = polyline.points[index];
      if (!start || !end) continue;
      if (brushSegments.some(([brushStart, brushEnd]) =>
        segmentDistance(start, end, brushStart, brushEnd) <= threshold
      )) return true;
    }
  }
  return false;
}

function ruleApplies(rule: VectorObjectExclusionRule, pageNumber: number): boolean {
  return rule.scope === "all-pages" || rule.sourcePageNumber === pageNumber;
}

function candidateSelected(
  candidate: Candidate,
  pageNumber: number,
  rules: readonly VectorObjectExclusionRule[],
): boolean {
  return rules.some((rule) => {
    if (!ruleApplies(rule, pageNumber)) return false;
    if (rule.objectKinds?.length && !rule.objectKinds.includes(candidate.kind)) return false;
    const added = rule.strokes.some((stroke) =>
      stroke.operation === "add" && strokeTouchesCandidate(stroke, candidate)
    );
    if (!added) return false;
    return !rule.strokes.some((stroke) =>
      stroke.operation === "subtract" && strokeTouchesCandidate(stroke, candidate)
    );
  });
}

function flattenCubic(
  start: VectorPoint,
  control1: VectorPoint,
  control2: VectorPoint,
  end: VectorPoint,
  output: VectorPoint[],
  depth = 0,
): void {
  const distance = (point: VectorPoint) => pointDistanceToSegment(point, start, end);
  if (
    depth >= 16 ||
    Math.max(distance(control1), distance(control2)) <= GEOMETRY_TOLERANCE_PT
  ) {
    output.push(end);
    return;
  }
  const midpoint = (a: VectorPoint, b: VectorPoint): VectorPoint => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  });
  const a = midpoint(start, control1);
  const b = midpoint(control1, control2);
  const c = midpoint(control2, end);
  const d = midpoint(a, b);
  const e = midpoint(b, c);
  const f = midpoint(d, e);
  flattenCubic(start, a, d, f, output, depth + 1);
  flattenCubic(f, e, c, end, output, depth + 1);
}

function pathPolylines(path: Path, matrix: Matrix): Polyline[] {
  const polylines: Polyline[] = [];
  let current: VectorPoint = { x: 0, y: 0 };
  let subpathStart: VectorPoint = { x: 0, y: 0 };
  let active: Polyline | undefined;
  path.walk({
    moveTo(x, y) {
      current = { x, y };
      subpathStart = current;
      active = { points: [transformPoint(matrix, current)], closed: false };
      polylines.push(active);
    },
    lineTo(x, y) {
      current = { x, y };
      active?.points.push(transformPoint(matrix, current));
    },
    curveTo(x1, y1, x2, y2, x3, y3) {
      const output = active?.points;
      if (output) {
        flattenCubic(
          transformPoint(matrix, current),
          transformPoint(matrix, { x: x1, y: y1 }),
          transformPoint(matrix, { x: x2, y: y2 }),
          transformPoint(matrix, { x: x3, y: y3 }),
          output,
        );
      }
      current = { x: x3, y: y3 };
    },
    closePath() {
      active?.points.push(transformPoint(matrix, subpathStart));
      if (active) active.closed = true;
      current = subpathStart;
    },
  });
  return polylines.filter((polyline) => polyline.points.length >= 2);
}

function pathCandidate(
  objectId: number,
  path: Path,
  matrix: Matrix,
  filled: boolean,
  stroke?: StrokeState,
): Candidate | undefined {
  const polylines = pathPolylines(path, matrix);
  if (polylines.length === 0) return undefined;
  const bounds = mergeBounds(polylines.map((polyline) => boundsForPoints(polyline.points)));
  const matrixScale = (Math.hypot(matrix[0], matrix[1]) + Math.hypot(matrix[2], matrix[3])) / 2;
  return {
    objectId,
    kind: "path",
    bounds,
    polylines,
    filled,
    ...(stroke ? { strokeRadius: (stroke.getLineWidth() * matrixScale) / 2 } : {}),
  };
}

function matchFromCandidate(candidate: Candidate): VectorObjectMatch {
  return {
    objectId: candidate.objectId,
    kind: candidate.kind,
    bounds: {
      x: candidate.bounds.x0,
      y: candidate.bounds.y0,
      width: candidate.bounds.x1 - candidate.bounds.x0,
      height: candidate.bounds.y1 - candidate.bounds.y0,
    },
  };
}

function isPageBackground(candidate: Candidate, pageArea: number): boolean {
  return candidate.kind === "path" && candidate.filled === true &&
    rectArea(candidate.bounds) >= pageArea * BACKGROUND_AREA_FRACTION;
}

function isInvisibleBackgroundFill(
  colorspace: InstanceType<MuPdfModule["ColorSpace"]>,
  color: Color,
  alpha: number,
): boolean {
  if (alpha <= EPSILON) return true;
  const components = color as readonly number[];
  if (colorspace.isGray()) {
    return (components[0] ?? 0) >= NEAR_WHITE_COMPONENT;
  }
  if (colorspace.isRGB() || colorspace.getType() === "BGR") {
    return [0, 1, 2].every(
      (index) => (components[index] ?? 0) >= NEAR_WHITE_COMPONENT,
    );
  }
  if (colorspace.isCMYK()) {
    return [0, 1, 2, 3].every(
      (index) => (components[index] ?? 1) <= 1 - NEAR_WHITE_COMPONENT,
    );
  }
  return false;
}

export function createVectorExclusionDevice(
  mupdf: MuPdfModule,
  target: Device | undefined,
  pageNumber: number,
  pageSize: PageSizePt,
  rules: readonly VectorObjectExclusionRule[],
  mode: VectorDeviceMode,
  pageToDevice: Matrix = IDENTITY,
): VectorExclusionDevice {
  const selectedObjects: VectorObjectMatch[] = [];
  const emptyStroke = new mupdf.StrokeState({
    lineCap: "Butt",
    lineJoin: "Miter",
    lineWidth: 0,
    miterLimit: 10,
  });
  let nextObjectId = 1;
  const red: Color = [1, 0.08, 0.08];
  const ruleScale = (
    Math.hypot(pageToDevice[0], pageToDevice[1]) +
    Math.hypot(pageToDevice[2], pageToDevice[3])
  ) / 2;
  const deviceRules = rules.map((rule) => ({
    ...rule,
    strokes: rule.strokes.map((stroke) => ({
      ...stroke,
      radiusPt: stroke.radiusPt * ruleScale,
      points: stroke.points.map((point) => transformPoint(pageToDevice, point)),
    })),
  }));
  const devicePageArea = rectArea(transformRect(
    [0, 0, pageSize.width, pageSize.height],
    pageToDevice,
  ));

  const inspect = (
    candidate: Candidate | undefined,
    invisibleBackgroundFill = false,
  ): boolean => {
    if (
      !candidate ||
      isPageBackground(candidate, devicePageArea) ||
      invisibleBackgroundFill
    ) return false;
    const selected = candidateSelected(candidate, pageNumber, deviceRules);
    if (selected) selectedObjects.push(matchFromCandidate(candidate));
    return selected;
  };
  const shouldForward = (selected: boolean) =>
    mode === "inspect" ? false : mode === "overlay" ? selected : !selected;

  const device = new mupdf.Device({
    fillPath(path, evenOdd, ctm, colorspace, color, alpha) {
      const selected = inspect(
        pathCandidate(nextObjectId++, path, ctm, true),
        isInvisibleBackgroundFill(colorspace, color as Color, alpha),
      );
      if (!target || !shouldForward(selected)) return;
      target.fillPath(
        path,
        evenOdd,
        ctm,
        mode === "overlay" ? mupdf.ColorSpace.DeviceRGB : colorspace,
        mode === "overlay" ? red : color as Color,
        mode === "overlay" ? 0.9 : alpha,
      );
    },
    strokePath(path, stroke, ctm, colorspace, color, alpha) {
      const selected = inspect(pathCandidate(nextObjectId++, path, ctm, false, stroke));
      if (!target || !shouldForward(selected)) return;
      target.strokePath(
        path,
        stroke,
        ctm,
        mode === "overlay" ? mupdf.ColorSpace.DeviceRGB : colorspace,
        mode === "overlay" ? red : color as Color,
        mode === "overlay" ? 0.95 : alpha,
      );
    },
    clipPath(path, evenOdd, ctm) {
      target?.clipPath(path, evenOdd, ctm);
    },
    clipStrokePath(path, stroke, ctm) {
      target?.clipStrokePath(path, stroke, ctm);
    },
    fillText(text, ctm, colorspace, color, alpha) {
      const objectId = nextObjectId++;
      const bounds = transformRect(text.getBounds(emptyStroke, IDENTITY), ctm);
      const selected = inspect({ objectId, kind: "text", bounds });
      if (!target || !shouldForward(selected)) return;
      target.fillText(
        text,
        ctm,
        mode === "overlay" ? mupdf.ColorSpace.DeviceRGB : colorspace,
        mode === "overlay" ? red : color as Color,
        mode === "overlay" ? 0.95 : alpha,
      );
    },
    strokeText(text, stroke, ctm, colorspace, color, alpha) {
      const objectId = nextObjectId++;
      const bounds = transformRect(text.getBounds(stroke, IDENTITY), ctm);
      const selected = inspect({ objectId, kind: "text", bounds });
      if (!target || !shouldForward(selected)) return;
      target.strokeText(
        text,
        stroke,
        ctm,
        mode === "overlay" ? mupdf.ColorSpace.DeviceRGB : colorspace,
        mode === "overlay" ? red : color as Color,
        mode === "overlay" ? 0.95 : alpha,
      );
    },
    clipText(text, ctm) {
      target?.clipText(text, ctm);
    },
    clipStrokeText(text, stroke, ctm) {
      target?.clipStrokeText(text, stroke, ctm);
    },
    ignoreText(text, ctm) {
      target?.ignoreText(text, ctm);
    },
    fillShade(shade, ctm, alpha) {
      const selected = inspect({
        objectId: nextObjectId++,
        kind: "shade",
        bounds: transformRect(shade.getBounds(), ctm),
      });
      if (target && shouldForward(selected)) target.fillShade(shade, ctm, alpha);
    },
    fillImage(image, ctm, alpha) {
      target?.fillImage(image, ctm, alpha);
    },
    fillImageMask(image, ctm, colorspace, color, alpha) {
      target?.fillImageMask(image, ctm, colorspace, color as Color, alpha);
    },
    clipImageMask(image, ctm) {
      target?.clipImageMask(image, ctm);
    },
    popClip() {
      target?.popClip();
    },
    beginMask(area, luminosity, colorspace, color) {
      target?.beginMask(area, luminosity, colorspace, color as Color);
    },
    endMask() {
      target?.endMask();
    },
    beginGroup(area, colorspace, isolated, knockout, blendmode, alpha) {
      target?.beginGroup(
        area,
        colorspace,
        isolated,
        knockout,
        blendmode,
        mode === "overlay" ? 1 : alpha,
      );
    },
    endGroup() {
      target?.endGroup();
    },
    beginTile(area, view, xstep, ystep, ctm, id, documentId) {
      return target?.beginTile(area, view, xstep, ystep, ctm, id, documentId) ?? 0;
    },
    endTile() {
      target?.endTile();
    },
    beginLayer(name) {
      target?.beginLayer(name);
    },
    endLayer() {
      target?.endLayer();
    },
  });

  return {
    device,
    selectedObjects,
    destroy() {
      device.close();
      device.destroy();
      emptyStroke.destroy();
    },
  };
}
