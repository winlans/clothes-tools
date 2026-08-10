import { SaxesParser } from "saxes";
import svgPath from "svgpath";

import { Pdf2PltError } from "../pdf/errors";
import type { SvgExportResult } from "../svg/exporter";

const PLOTTER_UNITS_PER_POINT = 1016 / 72;
const POINTS_PER_MM = 72 / 25.4;
const MAX_PD_COORDINATE_PAIRS = 100;
const EPSILON = 1e-7;

export interface PltExportOptions {
  curveToleranceMm: number;
}

export const DEFAULT_PLT_EXPORT_OPTIONS: Readonly<PltExportOptions> = {
  curveToleranceMm: 0.05,
};

export interface PltExportResult {
  plt: string;
  widthPt: number;
  heightPt: number;
  paths: number;
  segments: number;
  omittedImages: number;
  warnings: string[];
}

interface SvgNode {
  name: string;
  attributes: Record<string, string>;
  children: SvgNode[];
}

interface Point {
  x: number;
  y: number;
}

interface Polyline {
  points: Point[];
  closed: boolean;
}

type Matrix = readonly [number, number, number, number, number, number];

interface SvgStyle {
  fill: string;
  stroke: string;
  fillRule: string;
  strokeDasharray: string;
  strokeDashoffset: number;
  display: string;
  visibility: string;
  opacity: number;
  fillOpacity: number;
  strokeOpacity: number;
  color: string;
}

interface WalkState {
  matrix: Matrix;
  style: SvgStyle;
  clips: Point[][][];
}

interface ConversionContext {
  ids: Map<string, SvgNode>;
  tolerancePt: number;
  output: Polyline[];
  warnings: Set<string>;
  omittedImages: number;
  useStack: Set<string>;
}

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const DEFAULT_STYLE: SvgStyle = {
  fill: "black",
  stroke: "none",
  fillRule: "nonzero",
  strokeDasharray: "none",
  strokeDashoffset: 0,
  display: "inline",
  visibility: "visible",
  opacity: 1,
  fillOpacity: 1,
  strokeOpacity: 1,
  color: "black",
};

function localName(name: string): string {
  return name.toLowerCase().split(":").at(-1) ?? name.toLowerCase();
}

function parseSvg(svg: string): SvgNode {
  const documentNode: SvgNode = { name: "#document", attributes: {}, children: [] };
  const stack = [documentNode];
  let parseError: unknown;
  const parser = new SaxesParser({ xmlns: false });
  parser.on("opentag", (tag) => {
    const attributes: Record<string, string> = {};
    for (const [name, value] of Object.entries(tag.attributes)) {
      attributes[name] = value;
    }
    const node: SvgNode = { name: tag.name, attributes, children: [] };
    stack.at(-1)?.children.push(node);
    stack.push(node);
  });
  parser.on("closetag", () => {
    stack.pop();
  });
  parser.on("error", (error) => {
    parseError = error;
  });
  try {
    parser.write(svg).close();
  } catch (error) {
    parseError = error;
  }
  const root = documentNode.children.find((node) => localName(node.name) === "svg");
  if (parseError || !root) {
    throw new Pdf2PltError("invalid-export-svg", "无法解析用于 PLT 导出的 SVG。", {
      cause: parseError,
    });
  }
  return root;
}

function number(value: string | undefined, fallback = 0): number {
  if (!value) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function numbers(value: string | undefined): number[] {
  if (!value) return [];
  return Array.from(value.matchAll(/[+-]?(?:\d*\.\d+|\d+\.?)(?:e[+-]?\d+)?/gi), (match) =>
    Number(match[0]),
  ).filter(Number.isFinite);
}

function multiply(left: Matrix, right: Matrix): Matrix {
  const [a, b, c, d, e, f] = left;
  const [g, h, i, j, k, l] = right;
  return [
    a * g + c * h,
    b * g + d * h,
    a * i + c * j,
    b * i + d * j,
    a * k + c * l + e,
    b * k + d * l + f,
  ];
}

function translate(x: number, y: number): Matrix {
  return [1, 0, 0, 1, x, y];
}

function parseTransform(value: string | undefined): Matrix {
  if (!value) return IDENTITY;
  let result: Matrix = IDENTITY;
  for (const match of value.matchAll(/([a-z]+)\s*\(([^)]*)\)/gi)) {
    const operation = match[1]?.toLowerCase();
    const values = numbers(match[2]);
    let next: Matrix | undefined;
    if (operation === "matrix" && values.length >= 6) {
      next = [values[0]!, values[1]!, values[2]!, values[3]!, values[4]!, values[5]!];
    } else if (operation === "translate") {
      next = translate(values[0] ?? 0, values[1] ?? 0);
    } else if (operation === "scale") {
      const x = values[0] ?? 1;
      next = [x, 0, 0, values[1] ?? x, 0, 0];
    } else if (operation === "rotate") {
      const radians = ((values[0] ?? 0) * Math.PI) / 180;
      const cosine = Math.cos(radians);
      const sine = Math.sin(radians);
      const rotation: Matrix = [cosine, sine, -sine, cosine, 0, 0];
      if (values.length >= 3) {
        next = multiply(
          multiply(translate(values[1]!, values[2]!), rotation),
          translate(-values[1]!, -values[2]!),
        );
      } else {
        next = rotation;
      }
    } else if (operation === "skewx") {
      next = [1, 0, Math.tan(((values[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
    } else if (operation === "skewy") {
      next = [1, Math.tan(((values[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
    }
    if (next) result = multiply(result, next);
  }
  return result;
}

function transformPoint(matrix: Matrix, point: Point): Point {
  return {
    x: matrix[0] * point.x + matrix[2] * point.y + matrix[4],
    y: matrix[1] * point.x + matrix[3] * point.y + matrix[5],
  };
}

function parseStyle(node: SvgNode, inherited: SvgStyle): SvgStyle {
  const declarations: Record<string, string> = {};
  const presentation = [
    "fill",
    "stroke",
    "fill-rule",
    "stroke-dasharray",
    "stroke-dashoffset",
    "display",
    "visibility",
    "opacity",
    "fill-opacity",
    "stroke-opacity",
    "color",
  ];
  for (const property of presentation) {
    const value = node.attributes[property];
    if (value !== undefined) declarations[property] = value;
  }
  for (const declaration of (node.attributes.style ?? "").split(";")) {
    const separator = declaration.indexOf(":");
    if (separator < 0) continue;
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const value = declaration.slice(separator + 1).trim();
    if (property && value) declarations[property] = value;
  }
  const opacity = Math.max(0, Math.min(1, number(declarations.opacity, 1)));
  return {
    fill: declarations.fill ?? inherited.fill,
    stroke: declarations.stroke ?? inherited.stroke,
    fillRule: declarations["fill-rule"] ?? inherited.fillRule,
    strokeDasharray: declarations["stroke-dasharray"] ?? inherited.strokeDasharray,
    strokeDashoffset: number(declarations["stroke-dashoffset"], inherited.strokeDashoffset),
    display: declarations.display ?? inherited.display,
    visibility: declarations.visibility ?? inherited.visibility,
    opacity: inherited.opacity * opacity,
    fillOpacity: inherited.fillOpacity * number(declarations["fill-opacity"], 1),
    strokeOpacity: inherited.strokeOpacity * number(declarations["stroke-opacity"], 1),
    color: declarations.color ?? inherited.color,
  };
}

function isPainted(value: string, opacity: number): boolean {
  const paint = value.trim().toLowerCase();
  return opacity > 0 && paint !== "none" && paint !== "transparent";
}

function distanceToLine(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) < EPSILON && Math.abs(dy) < EPSILON) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  return Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x) /
    Math.hypot(dx, dy);
}

function flattenCubic(
  start: Point,
  control1: Point,
  control2: Point,
  end: Point,
  tolerance: number,
  output: Point[],
  depth = 0,
): void {
  if (
    depth >= 18 ||
    Math.max(distanceToLine(control1, start, end), distanceToLine(control2, start, end)) <=
      tolerance
  ) {
    output.push(end);
    return;
  }
  const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const a = midpoint(start, control1);
  const b = midpoint(control1, control2);
  const c = midpoint(control2, end);
  const d = midpoint(a, b);
  const e = midpoint(b, c);
  const f = midpoint(d, e);
  flattenCubic(start, a, d, f, tolerance, output, depth + 1);
  flattenCubic(f, e, c, end, tolerance, output, depth + 1);
}

function addPoint(polyline: Polyline, point: Point): void {
  const previous = polyline.points.at(-1);
  if (!previous || Math.hypot(previous.x - point.x, previous.y - point.y) > EPSILON) {
    polyline.points.push(point);
  }
}

function pathPolylines(d: string, matrix: Matrix, tolerance: number): Polyline[] {
  const result: Polyline[] = [];
  let current: Point = { x: 0, y: 0 };
  let currentOutput: Polyline | undefined;
  try {
    svgPath(d)
      .abs()
      .unshort()
      .unarc()
      .iterate((segment) => {
        const command = segment[0].toUpperCase();
        if (command === "M") {
          current = { x: segment[1]!, y: segment[2]! };
          currentOutput = { points: [transformPoint(matrix, current)], closed: false };
          result.push(currentOutput);
        } else if (command === "L") {
          current = { x: segment[1]!, y: segment[2]! };
          if (currentOutput) addPoint(currentOutput, transformPoint(matrix, current));
        } else if (command === "H") {
          current = { x: segment[1]!, y: current.y };
          if (currentOutput) addPoint(currentOutput, transformPoint(matrix, current));
        } else if (command === "V") {
          current = { x: current.x, y: segment[1]! };
          if (currentOutput) addPoint(currentOutput, transformPoint(matrix, current));
        } else if (command === "C") {
          const start = transformPoint(matrix, current);
          const control1 = transformPoint(matrix, { x: segment[1]!, y: segment[2]! });
          const control2 = transformPoint(matrix, { x: segment[3]!, y: segment[4]! });
          current = { x: segment[5]!, y: segment[6]! };
          const end = transformPoint(matrix, current);
          if (currentOutput) flattenCubic(start, control1, control2, end, tolerance, currentOutput.points);
        } else if (command === "Q") {
          const startSource = current;
          const control = { x: segment[1]!, y: segment[2]! };
          current = { x: segment[3]!, y: segment[4]! };
          const control1 = {
            x: startSource.x + (2 / 3) * (control.x - startSource.x),
            y: startSource.y + (2 / 3) * (control.y - startSource.y),
          };
          const control2 = {
            x: current.x + (2 / 3) * (control.x - current.x),
            y: current.y + (2 / 3) * (control.y - current.y),
          };
          if (currentOutput) {
            flattenCubic(
              transformPoint(matrix, startSource),
              transformPoint(matrix, control1),
              transformPoint(matrix, control2),
              transformPoint(matrix, current),
              tolerance,
              currentOutput.points,
            );
          }
        } else if (command === "Z" && currentOutput) {
          currentOutput.closed = true;
          const first = currentOutput.points[0];
          if (first) addPoint(currentOutput, first);
        }
      });
  } catch (error) {
    throw new Pdf2PltError("invalid-svg-path", "SVG 中包含无法转换的路径。", { cause: error });
  }
  return result.filter((polyline) => polyline.points.length >= 2);
}

function ellipsePolyline(
  center: Point,
  radiusX: number,
  radiusY: number,
  matrix: Matrix,
  tolerance: number,
): Polyline[] {
  if (radiusX <= 0 || radiusY <= 0) return [];
  const scale = Math.max(Math.hypot(matrix[0], matrix[1]), Math.hypot(matrix[2], matrix[3]));
  const radius = Math.max(radiusX, radiusY) * scale;
  const steps = Math.max(12, Math.min(4096, Math.ceil(Math.PI / Math.acos(Math.max(-1, 1 - tolerance / Math.max(radius, tolerance))))));
  const points: Point[] = [];
  for (let index = 0; index <= steps; index += 1) {
    const angle = (index / steps) * Math.PI * 2;
    points.push(
      transformPoint(matrix, {
        x: center.x + Math.cos(angle) * radiusX,
        y: center.y + Math.sin(angle) * radiusY,
      }),
    );
  }
  return [{ points, closed: true }];
}

function geometryForNode(node: SvgNode, matrix: Matrix, tolerance: number): Polyline[] {
  const name = localName(node.name);
  if (name === "path") return pathPolylines(node.attributes.d ?? "", matrix, tolerance);
  if (name === "line") {
    return [{
      points: [
        transformPoint(matrix, { x: number(node.attributes.x1), y: number(node.attributes.y1) }),
        transformPoint(matrix, { x: number(node.attributes.x2), y: number(node.attributes.y2) }),
      ],
      closed: false,
    }];
  }
  if (name === "polyline" || name === "polygon") {
    const values = numbers(node.attributes.points);
    const points: Point[] = [];
    for (let index = 0; index + 1 < values.length; index += 2) {
      points.push(transformPoint(matrix, { x: values[index]!, y: values[index + 1]! }));
    }
    if (name === "polygon" && points[0]) points.push(points[0]);
    return points.length >= 2 ? [{ points, closed: name === "polygon" }] : [];
  }
  if (name === "rect") {
    const x = number(node.attributes.x);
    const y = number(node.attributes.y);
    const width = number(node.attributes.width);
    const height = number(node.attributes.height);
    if (width <= 0 || height <= 0) return [];
    const source = [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
      { x, y },
    ];
    return [{ points: source.map((point) => transformPoint(matrix, point)), closed: true }];
  }
  if (name === "circle") {
    return ellipsePolyline(
      { x: number(node.attributes.cx), y: number(node.attributes.cy) },
      number(node.attributes.r),
      number(node.attributes.r),
      matrix,
      tolerance,
    );
  }
  if (name === "ellipse") {
    return ellipsePolyline(
      { x: number(node.attributes.cx), y: number(node.attributes.cy) },
      number(node.attributes.rx),
      number(node.attributes.ry),
      matrix,
      tolerance,
    );
  }
  return [];
}

function hrefId(node: SvgNode): string | undefined {
  const href = node.attributes.href ?? node.attributes["xlink:href"];
  return href?.startsWith("#") ? href.slice(1) : undefined;
}

function collectClipGeometry(
  node: SvgNode,
  matrix: Matrix,
  context: ConversionContext,
): Point[][] {
  const name = localName(node.name);
  const transformed = multiply(matrix, parseTransform(node.attributes.transform));
  if (name === "use") {
    const id = hrefId(node);
    const target = id ? context.ids.get(id) : undefined;
    if (!id || !target || context.useStack.has(id)) return [];
    context.useStack.add(id);
    const result = collectClipGeometry(
      target,
      multiply(transformed, translate(number(node.attributes.x), number(node.attributes.y))),
      context,
    );
    context.useStack.delete(id);
    return result;
  }
  const own = geometryForNode(node, transformed, context.tolerancePt)
    .map((polyline) => {
      if (!polyline.closed && polyline.points[0]) polyline.points.push(polyline.points[0]);
      return polyline.points;
    })
    .filter((points) => points.length >= 4);
  for (const child of node.children) own.push(...collectClipGeometry(child, transformed, context));
  return own;
}

function resolveClip(
  value: string | undefined,
  matrix: Matrix,
  context: ConversionContext,
): Point[][] | undefined {
  const id = value?.match(/^url\(\s*#([^\s)]+)\s*\)$/i)?.[1];
  const clip = id ? context.ids.get(id) : undefined;
  if (!clip) return undefined;
  if ((clip.attributes.clipPathUnits ?? "userSpaceOnUse") === "objectBoundingBox") {
    context.warnings.add("PLT 导出暂不支持 objectBoundingBox 裁切，已保留对象原始轮廓。");
    return undefined;
  }
  return collectClipGeometry(clip, matrix, context);
}

function cross(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentIntersectionParameter(a: Point, b: Point, c: Point, d: Point): number | undefined {
  const denominator = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
  if (Math.abs(denominator) < EPSILON) return undefined;
  const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / denominator;
  const u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / denominator;
  return t > EPSILON && t < 1 - EPSILON && u >= -EPSILON && u <= 1 + EPSILON ? t : undefined;
}

function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const a = polygon[index]!;
    const b = polygon[previous]!;
    if (Math.abs(cross(a, b, point)) < EPSILON &&
      point.x >= Math.min(a.x, b.x) - EPSILON && point.x <= Math.max(a.x, b.x) + EPSILON &&
      point.y >= Math.min(a.y, b.y) - EPSILON && point.y <= Math.max(a.y, b.y) + EPSILON) return true;
    if ((a.y > point.y) !== (b.y > point.y) &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function pointInClip(point: Point, polygons: Point[][]): boolean {
  let inside = false;
  for (const polygon of polygons) {
    if (pointInPolygon(point, polygon)) inside = !inside;
  }
  return inside;
}

function interpolate(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function clipPolyline(polyline: Polyline, polygons: Point[][]): Polyline[] {
  if (polygons.length === 0) return [];
  const result: Polyline[] = [];
  let active: Point[] | undefined;
  for (let index = 1; index < polyline.points.length; index += 1) {
    const start = polyline.points[index - 1]!;
    const end = polyline.points[index]!;
    const parameters = [0, 1];
    for (const polygon of polygons) {
      for (let edge = 1; edge < polygon.length; edge += 1) {
        const parameter = segmentIntersectionParameter(start, end, polygon[edge - 1]!, polygon[edge]!);
        if (parameter !== undefined) parameters.push(parameter);
      }
    }
    parameters.sort((a, b) => a - b);
    const unique = parameters.filter((value, parameterIndex) =>
      parameterIndex === 0 || Math.abs(value - parameters[parameterIndex - 1]!) > EPSILON,
    );
    for (let part = 1; part < unique.length; part += 1) {
      const from = unique[part - 1]!;
      const to = unique[part]!;
      if (!pointInClip(interpolate(start, end, (from + to) / 2), polygons)) {
        active = undefined;
        continue;
      }
      const fromPoint = interpolate(start, end, from);
      const toPoint = interpolate(start, end, to);
      if (!active) {
        active = [fromPoint, toPoint];
        result.push({ points: active, closed: false });
      } else {
        addPoint(result.at(-1)!, fromPoint);
        addPoint(result.at(-1)!, toPoint);
      }
    }
  }
  return result.filter((item) => item.points.length >= 2);
}

function applyClips(polylines: Polyline[], clips: Point[][][]): Polyline[] {
  let result = polylines;
  for (const clip of clips) result = result.flatMap((polyline) => clipPolyline(polyline, clip));
  return result;
}

function matrixScale(matrix: Matrix): number {
  return (Math.hypot(matrix[0], matrix[1]) + Math.hypot(matrix[2], matrix[3])) / 2;
}

function dashPolyline(polyline: Polyline, pattern: number[], offset: number): Polyline[] {
  if (pattern.length === 0 || pattern.every((value) => value <= EPSILON)) return [polyline];
  const dashPattern = pattern.length % 2 === 1 ? [...pattern, ...pattern] : pattern;
  const cycle = dashPattern.reduce((sum, value) => sum + value, 0);
  if (cycle <= EPSILON) return [polyline];
  let normalizedOffset = ((offset % cycle) + cycle) % cycle;
  let patternIndex = 0;
  while (normalizedOffset >= dashPattern[patternIndex]! && dashPattern[patternIndex]! > EPSILON) {
    normalizedOffset -= dashPattern[patternIndex]!;
    patternIndex = (patternIndex + 1) % dashPattern.length;
  }
  let remaining = dashPattern[patternIndex]! - normalizedOffset;
  let drawing = patternIndex % 2 === 0;
  const output: Polyline[] = [];
  let active: Polyline | undefined;
  for (let index = 1; index < polyline.points.length; index += 1) {
    let start = polyline.points[index - 1]!;
    const end = polyline.points[index]!;
    let segmentLength = Math.hypot(end.x - start.x, end.y - start.y);
    while (segmentLength > EPSILON) {
      const take = Math.min(segmentLength, remaining);
      const next = interpolate(start, end, take / segmentLength);
      if (drawing) {
        if (!active) {
          active = { points: [start, next], closed: false };
          output.push(active);
        } else {
          addPoint(active, start);
          addPoint(active, next);
        }
      }
      start = next;
      segmentLength -= take;
      remaining -= take;
      if (remaining <= EPSILON) {
        patternIndex = (patternIndex + 1) % dashPattern.length;
        remaining = dashPattern[patternIndex]!;
        drawing = patternIndex % 2 === 0;
        if (!drawing) active = undefined;
      }
    }
  }
  return output;
}

function emitGeometry(node: SvgNode, state: WalkState, context: ConversionContext): void {
  const geometry = geometryForNode(node, state.matrix, context.tolerancePt);
  if (geometry.length === 0) return;
  const fill = state.style.fill === "currentColor" ? state.style.color : state.style.fill;
  const stroke = state.style.stroke === "currentColor" ? state.style.color : state.style.stroke;
  if (isPainted(fill, state.style.opacity * state.style.fillOpacity)) {
    const boundaries = geometry.map((polyline) => {
      const copy = { points: [...polyline.points], closed: true };
      const first = copy.points[0];
      if (first) addPoint(copy, first);
      return copy;
    });
    context.output.push(...applyClips(boundaries, state.clips));
  }
  if (isPainted(stroke, state.style.opacity * state.style.strokeOpacity)) {
    const scale = matrixScale(state.matrix);
    const dashPattern = state.style.strokeDasharray.trim().toLowerCase() === "none"
      ? []
      : numbers(state.style.strokeDasharray).map((value) => Math.max(0, value * scale));
    const stroked = dashPattern.length > 0
      ? geometry.flatMap((polyline) => dashPolyline(polyline, dashPattern, state.style.strokeDashoffset * scale))
      : geometry;
    context.output.push(...applyClips(stroked, state.clips));
  }
}

function walk(node: SvgNode, parent: WalkState, context: ConversionContext, inDefinitions = false): void {
  const name = localName(node.name);
  const matrix = multiply(parent.matrix, parseTransform(node.attributes.transform));
  const style = parseStyle(node, parent.style);
  if (style.display.trim().toLowerCase() === "none" || style.visibility.trim().toLowerCase() === "hidden") return;
  if (name === "defs" || name === "symbol" || name === "clippath" || name === "mask") {
    return;
  }
  let clips = parent.clips;
  const clip = resolveClip(node.attributes["clip-path"], matrix, context);
  if (clip) clips = [...clips, clip];
  const state: WalkState = { matrix, style, clips };

  if (name === "use") {
    const id = hrefId(node);
    const target = id ? context.ids.get(id) : undefined;
    if (!id || !target) {
      context.warnings.add("PLT 导出跳过了无法解析的 SVG 引用。");
      return;
    }
    if (context.useStack.has(id)) {
      context.warnings.add("PLT 导出跳过了循环 SVG 引用。");
      return;
    }
    context.useStack.add(id);
    walk(target, {
      ...state,
      matrix: multiply(matrix, translate(number(node.attributes.x), number(node.attributes.y))),
    }, context, false);
    context.useStack.delete(id);
    return;
  }
  if (name === "image") {
    context.omittedImages += 1;
    context.warnings.add("PLT 仅包含矢量轮廓，位图图像已跳过。");
    return;
  }
  if (name === "text" || name === "tspan") {
    context.warnings.add("PLT 导出跳过了未转为轮廓的文字。");
    return;
  }
  if (name === "foreignobject") {
    context.warnings.add("PLT 导出跳过了 SVG 外部对象。");
    return;
  }
  if (node.attributes.mask || node.attributes.filter) {
    context.warnings.add("PLT 不支持 SVG 蒙版或滤镜，已按基础轮廓导出。");
  }

  emitGeometry(node, state, context);
  if (!inDefinitions) {
    for (const child of node.children) walk(child, state, context, false);
  }
}

interface PlotterPoint {
  x: number;
  y: number;
}

function plotterPath(polyline: Polyline, heightPt: number): PlotterPoint[] {
  const points: PlotterPoint[] = [];
  for (const point of polyline.points) {
    const converted = {
      x: Math.round(point.x * PLOTTER_UNITS_PER_POINT),
      y: Math.round((heightPt - point.y) * PLOTTER_UNITS_PER_POINT),
    };
    const previous = points.at(-1);
    if (!previous || previous.x !== converted.x || previous.y !== converted.y) points.push(converted);
  }
  return points.length >= 2 ? points : [];
}

function canonicalPath(points: PlotterPoint[]): string {
  const forward = points.map((point) => `${point.x},${point.y}`).join(" ");
  const reverse = [...points].reverse().map((point) => `${point.x},${point.y}`).join(" ");
  return forward < reverse ? forward : reverse;
}

function serializeHpgl(paths: PlotterPoint[][]): string {
  const commands = ["IN;", "SP1;", "PA;"];
  for (const path of paths) {
    const first = path[0]!;
    commands.push(`PU${first.x},${first.y};`);
    for (let index = 1; index < path.length; index += MAX_PD_COORDINATE_PAIRS) {
      const coordinates = path
        .slice(index, index + MAX_PD_COORDINATE_PAIRS)
        .map((point) => `${point.x},${point.y}`)
        .join(",");
      commands.push(`PD${coordinates};`);
    }
    commands.push("PU;");
  }
  commands.push("SP0;");
  return `${commands.join("\n")}\n`;
}

export function buildCorelPlt(
  input: SvgExportResult,
  overrides: Partial<PltExportOptions> = {},
): PltExportResult {
  const options = { ...DEFAULT_PLT_EXPORT_OPTIONS, ...overrides };
  if (!Number.isFinite(options.curveToleranceMm) || options.curveToleranceMm <= 0) {
    throw new Pdf2PltError("invalid-plt-tolerance", "PLT 曲线误差必须大于 0 mm。");
  }
  const root = parseSvg(input.svg);
  const ids = new Map<string, SvgNode>();
  const indexIds = (node: SvgNode) => {
    const id = node.attributes.id;
    if (id) ids.set(id, node);
    for (const child of node.children) indexIds(child);
  };
  indexIds(root);
  const context: ConversionContext = {
    ids,
    tolerancePt: options.curveToleranceMm * POINTS_PER_MM,
    output: [],
    warnings: new Set<string>(),
    omittedImages: 0,
    useStack: new Set<string>(),
  };
  const state: WalkState = { matrix: IDENTITY, style: DEFAULT_STYLE, clips: [] };
  walk(root, state, context);

  const seen = new Set<string>();
  const paths: PlotterPoint[][] = [];
  for (const polyline of context.output) {
    const converted = plotterPath(polyline, input.heightPt);
    if (converted.length < 2) continue;
    const key = canonicalPath(converted);
    if (seen.has(key)) continue;
    seen.add(key);
    paths.push(converted);
  }
  const segments = paths.reduce((total, path) => total + path.length - 1, 0);
  return {
    plt: serializeHpgl(paths),
    widthPt: input.widthPt,
    heightPt: input.heightPt,
    paths: paths.length,
    segments,
    omittedImages: context.omittedImages,
    warnings: [...context.warnings],
  };
}
