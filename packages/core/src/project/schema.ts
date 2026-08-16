import {
  DEFAULT_GUIDE_DETECTION_OPTIONS,
  resolveGuideDetectionOptions,
  type GuideDetectionOptions,
  type GuideStitchingMode,
} from "../guides/detection";
import type { LayoutCell, LayoutGrid } from "../layout/automatic-layout";
import type { PageSizePt } from "../pdf/document";
import { Pdf2PltError } from "../pdf/errors";
import type { GuideCropSettings } from "../guides/settings";
import { resolveGuideGeometry } from "../guides/settings";
import { isQuarterTurn, type QuarterTurn } from "../rotation";
import type {
  VectorBrushStroke,
  VectorObjectExclusionRule,
  VectorPaintKind,
} from "../pdf/vector-exclusion";

export interface ProjectSource {
  absolutePath: string;
  relativePath: string;
  sha256: string;
  pageCount: number;
  pageSizePt: PageSizePt;
}

export interface ProjectGuideSettings extends GuideCropSettings {
  detection: GuideDetectionOptions;
  inputMode?: "edge-insets";
  stitchingMode?: Exclude<GuideStitchingMode, "auto">;
}

export interface ProjectOutputSettings {
  keepGuides: boolean;
  keepBackground: boolean;
  allowUnusedPages: boolean;
  rotation?: QuarterTurn;
  objectExclusions?: VectorObjectExclusionRule[];
}

export interface ProjectView {
  zoom: number;
  panX: number;
  panY: number;
}

export interface PatternLayoutProjectV1 {
  schemaVersion: 1;
  source: ProjectSource;
  layout: LayoutGrid;
  guides: ProjectGuideSettings;
  output: ProjectOutputSettings;
  view: ProjectView;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Pdf2PltError("invalid-project", `${label} 必须是对象。`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Pdf2PltError("invalid-project", `${label} 必须是字符串。`);
  }
  return value;
}

function finite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Pdf2PltError("invalid-project", `${label} 必须是有效数字。`);
  }
  return value;
}

function optionalFinite(value: unknown, label: string): number | undefined {
  return value === undefined || value === null ? undefined : finite(value, label);
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Pdf2PltError("invalid-project", `${label} 必须是布尔值。`);
  }
  return value;
}

function parseObjectExclusions(
  value: unknown,
  pageCount: number,
  pageSize: PageSizePt,
): VectorObjectExclusionRule[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Pdf2PltError("invalid-project", "output.objectExclusions 必须是数组。");
  }
  const ids = new Set<string>();
  return value.map((rawRule, ruleIndex) => {
    const label = `output.objectExclusions[${ruleIndex}]`;
    const rule = record(rawRule, label);
    const id = text(rule.id, `${label}.id`).trim();
    if (!id || ids.has(id)) {
      throw new Pdf2PltError("invalid-project", `${label}.id 必须非空且不能重复。`);
    }
    ids.add(id);
    const sourcePageNumber = finite(rule.sourcePageNumber, `${label}.sourcePageNumber`);
    if (
      !Number.isInteger(sourcePageNumber) ||
      sourcePageNumber < 1 ||
      sourcePageNumber > pageCount
    ) {
      throw new Pdf2PltError(
        "invalid-project",
        `${label}.sourcePageNumber 必须位于 1..${pageCount}。`,
      );
    }
    if (rule.scope !== "all-pages" && rule.scope !== "current-page") {
      throw new Pdf2PltError(
        "invalid-project",
        `${label}.scope 仅支持 all-pages 或 current-page。`,
      );
    }
    if (!Array.isArray(rule.strokes) || rule.strokes.length === 0) {
      throw new Pdf2PltError("invalid-project", `${label}.strokes 至少需要一笔。`);
    }
    let hasAddStroke = false;
    const strokes: VectorBrushStroke[] = rule.strokes.map((rawStroke, strokeIndex) => {
      const strokeLabel = `${label}.strokes[${strokeIndex}]`;
      const stroke = record(rawStroke, strokeLabel);
      if (stroke.operation !== "add" && stroke.operation !== "subtract") {
        throw new Pdf2PltError(
          "invalid-project",
          `${strokeLabel}.operation 仅支持 add 或 subtract。`,
        );
      }
      if (stroke.operation === "add") hasAddStroke = true;
      const radiusPt = finite(stroke.radiusPt, `${strokeLabel}.radiusPt`);
      if (radiusPt <= 0 || radiusPt > Math.max(pageSize.width, pageSize.height) * 2) {
        throw new Pdf2PltError("invalid-project", `${strokeLabel}.radiusPt 超出有效范围。`);
      }
      if (!Array.isArray(stroke.points) || stroke.points.length === 0 || stroke.points.length > 10_000) {
        throw new Pdf2PltError(
          "invalid-project",
          `${strokeLabel}.points 必须包含 1..10000 个坐标。`,
        );
      }
      const points = stroke.points.map((rawPoint, pointIndex) => {
        const pointLabel = `${strokeLabel}.points[${pointIndex}]`;
        const point = record(rawPoint, pointLabel);
        const x = finite(point.x, `${pointLabel}.x`);
        const y = finite(point.y, `${pointLabel}.y`);
        if (x < 0 || x > pageSize.width || y < 0 || y > pageSize.height) {
          throw new Pdf2PltError("invalid-project", `${pointLabel} 必须位于 PDF 页面范围内。`);
        }
        return { x, y };
      });
      return { operation: stroke.operation, radiusPt, points };
    });
    if (!hasAddStroke) {
      throw new Pdf2PltError("invalid-project", `${label}.strokes 至少需要一笔 add。`);
    }
    let objectKinds: VectorPaintKind[] | undefined;
    if (rule.objectKinds !== undefined) {
      if (!Array.isArray(rule.objectKinds) || rule.objectKinds.length === 0) {
        throw new Pdf2PltError(
          "invalid-project",
          `${label}.objectKinds 必须是非空数组。`,
        );
      }
      objectKinds = rule.objectKinds.map((kind, kindIndex) => {
        if (kind !== "path" && kind !== "text" && kind !== "shade") {
          throw new Pdf2PltError(
            "invalid-project",
            `${label}.objectKinds[${kindIndex}] 不是支持的矢量对象类型。`,
          );
        }
        return kind;
      });
      if (new Set(objectKinds).size !== objectKinds.length) {
        throw new Pdf2PltError("invalid-project", `${label}.objectKinds 不能重复。`);
      }
    }
    return {
      id,
      sourcePageNumber,
      scope: rule.scope,
      strokes,
      ...(objectKinds ? { objectKinds } : {}),
    };
  });
}

function parseLayout(value: unknown, pageCount: number): LayoutGrid {
  const source = record(value, "layout");
  const rows = finite(source.rows, "layout.rows");
  const columns = finite(source.columns, "layout.columns");
  if (!Number.isInteger(rows) || rows < 1 || !Number.isInteger(columns) || columns < 1) {
    throw new Pdf2PltError("invalid-project", "layout.rows/columns 必须是正整数。");
  }
  if (source.traversal !== "column-major") {
    throw new Pdf2PltError("invalid-project", "layout.traversal 必须是 column-major。");
  }
  if (!Array.isArray(source.cells) || source.cells.length !== rows) {
    throw new Pdf2PltError("invalid-project", "layout.cells 行数不正确。");
  }
  const pages = new Set<number>();
  const spacers = new Set<string>();
  let spacerNumber = 1;
  const cells: LayoutCell[][] = source.cells.map((rawRow, rowIndex) => {
    if (!Array.isArray(rawRow) || rawRow.length !== columns) {
      throw new Pdf2PltError(
        "invalid-project",
        `layout.cells 第 ${rowIndex + 1} 行列数不正确。`,
      );
    }
    return rawRow.map((rawCell): LayoutCell => {
      if (rawCell === null) return null;
      const cell = record(rawCell, "layout cell");
      if (cell.kind === "page") {
        const pageNumber = finite(cell.pageNumber, "pageNumber");
        if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pageCount) {
          throw new Pdf2PltError("invalid-project", `工程页码 ${pageNumber} 超出 1..${pageCount}。`);
        }
        if (pages.has(pageNumber)) {
          throw new Pdf2PltError("invalid-project", `工程页码 ${pageNumber} 重复。`);
        }
        pages.add(pageNumber);
        return { kind: "page", pageNumber };
      }
      if (cell.kind === "spacer") {
        const spacerId = cell.spacerId === undefined
          ? `project-spacer-${spacerNumber++}`
          : text(cell.spacerId, "spacerId");
        if (!spacerId) throw new Pdf2PltError("invalid-project", "spacerId 不能为空。");
        if (spacers.has(spacerId)) {
          throw new Pdf2PltError("invalid-project", `工程空白块 ${spacerId} 重复。`);
        }
        spacers.add(spacerId);
        return { kind: "spacer", spacerId };
      }
      throw new Pdf2PltError("invalid-project", "layout 包含未知格子类型。");
    });
  });
  return { rows, columns, traversal: "column-major", cells };
}

export function parsePatternLayoutProject(value: string | unknown): PatternLayoutProjectV1 {
  let input = value;
  if (typeof value === "string") {
    try {
      input = JSON.parse(value) as unknown;
    } catch {
      throw new Pdf2PltError("invalid-project", "工程 JSON 格式无效。");
    }
  }
  const root = record(input, "工程");
  if (root.schemaVersion !== 1) {
    throw new Pdf2PltError("unsupported-project", "仅支持 schemaVersion 1 的工程文件。");
  }
  const rawSource = record(root.source, "source");
  const pageCount = finite(rawSource.pageCount, "source.pageCount");
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new Pdf2PltError("invalid-project", "source.pageCount 必须是正整数。");
  }
  const rawSize = record(rawSource.pageSizePt, "source.pageSizePt");
  const pageSizePt = {
    width: finite(rawSize.width, "source.pageSizePt.width"),
    height: finite(rawSize.height, "source.pageSizePt.height"),
  };
  if (pageSizePt.width <= 0 || pageSizePt.height <= 0) {
    throw new Pdf2PltError("invalid-project", "工程页面尺寸必须大于 0。");
  }
  const sha256 = text(rawSource.sha256, "source.sha256").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Pdf2PltError("invalid-project", "source.sha256 必须是 64 位十六进制摘要。");
  }

  const rawGuides = record(root.guides, "guides");
  if (!["auto", "manual", "none"].includes(String(rawGuides.mode))) {
    throw new Pdf2PltError("invalid-project", "guides.mode 必须是 auto、manual 或 none。");
  }
  if (rawGuides.inputMode !== undefined && rawGuides.inputMode !== "edge-insets") {
    throw new Pdf2PltError(
      "invalid-project",
      "guides.inputMode 仅支持 edge-insets。",
    );
  }
  if (
    rawGuides.stitchingMode !== undefined &&
    rawGuides.stitchingMode !== "red-guides" &&
    rawGuides.stitchingMode !== "content-overlap"
  ) {
    throw new Pdf2PltError(
      "invalid-project",
      "guides.stitchingMode 仅支持 red-guides 或 content-overlap。",
    );
  }
  const detection = resolveGuideDetectionOptions(
    record(rawGuides.detection, "guides.detection") as Partial<GuideDetectionOptions>,
  );
  const seamLeft = optionalFinite(rawGuides.seamLeft, "guides.seamLeft");
  const seamRight = optionalFinite(rawGuides.seamRight, "guides.seamRight");
  const seamTop = optionalFinite(rawGuides.seamTop, "guides.seamTop");
  const seamBottom = optionalFinite(rawGuides.seamBottom, "guides.seamBottom");
  const outerRight = optionalFinite(rawGuides.outerRight, "guides.outerRight");
  const outerBottom = optionalFinite(rawGuides.outerBottom, "guides.outerBottom");
  const guides: ProjectGuideSettings = {
    mode: rawGuides.mode as ProjectGuideSettings["mode"],
    ...(rawGuides.inputMode === "edge-insets" ? { inputMode: "edge-insets" as const } : {}),
    ...(rawGuides.stitchingMode === "red-guides" || rawGuides.stitchingMode === "content-overlap"
      ? { stitchingMode: rawGuides.stitchingMode }
      : {}),
    ...(seamLeft !== undefined ? { seamLeft } : {}),
    ...(seamRight !== undefined ? { seamRight } : {}),
    ...(seamTop !== undefined ? { seamTop } : {}),
    ...(seamBottom !== undefined ? { seamBottom } : {}),
    outerLeft: optionalFinite(rawGuides.outerLeft, "guides.outerLeft") ?? 0,
    ...(outerRight !== undefined ? { outerRight } : {}),
    outerTop: optionalFinite(rawGuides.outerTop, "guides.outerTop") ?? 0,
    ...(outerBottom !== undefined ? { outerBottom } : {}),
    detection,
  };
  const rawOutput = record(root.output, "output");
  const rotation = rawOutput.rotation === undefined ? 0 : rawOutput.rotation;
  if (!isQuarterTurn(rotation)) {
    throw new Pdf2PltError("invalid-project", "output.rotation 必须是 0、90、180 或 270。");
  }
  const objectExclusions = parseObjectExclusions(
    rawOutput.objectExclusions,
    pageCount,
    pageSizePt,
  );
  const output: ProjectOutputSettings = {
    keepGuides: booleanValue(rawOutput.keepGuides, "output.keepGuides"),
    keepBackground: booleanValue(rawOutput.keepBackground, "output.keepBackground"),
    allowUnusedPages: booleanValue(rawOutput.allowUnusedPages, "output.allowUnusedPages"),
    rotation,
    ...(objectExclusions.length > 0 ? { objectExclusions } : {}),
  };
  const layout = parseLayout(root.layout, pageCount);
  for (const [name, value, limit] of [
    ["seamLeft", guides.seamLeft, pageSizePt.width],
    ["seamRight", guides.seamRight, pageSizePt.width],
    ["seamTop", guides.seamTop, pageSizePt.height],
    ["seamBottom", guides.seamBottom, pageSizePt.height],
  ] as const) {
    if (value !== undefined && (value < 0 || value > limit + 0.05)) {
      throw new Pdf2PltError("invalid-project", `guides.${name} 必须位于页面范围内。`);
    }
  }
  if (
    guides.seamLeft !== undefined &&
    guides.seamRight !== undefined &&
    guides.seamLeft >= guides.seamRight
  ) {
    throw new Pdf2PltError("invalid-project", "guides 左拼接线必须小于右拼接线。");
  }
  if (
    guides.seamTop !== undefined &&
    guides.seamBottom !== undefined &&
    guides.seamTop >= guides.seamBottom
  ) {
    throw new Pdf2PltError("invalid-project", "guides 上拼接线必须小于下拼接线。");
  }
  resolveGuideGeometry({ ...guides, mode: "none" }, {}, pageSizePt, layout);
  if (guides.mode === "manual") {
    resolveGuideGeometry(guides, {}, pageSizePt, layout);
  }
  if (!output.allowUnusedPages) {
    const usedPages = new Set(
      layout.cells.flat().flatMap((cell) => cell?.kind === "page" ? [cell.pageNumber] : []),
    );
    const missing = Array.from({ length: pageCount }, (_, index) => index + 1).filter(
      (page) => !usedPages.has(page),
    );
    if (missing.length > 0) {
      throw new Pdf2PltError("invalid-project", `工程布局遗漏 PDF 页码：${missing.join(",")}。`);
    }
  }
  const rawView = record(root.view, "view");
  const view: ProjectView = {
    zoom: finite(rawView.zoom, "view.zoom"),
    panX: finite(rawView.panX, "view.panX"),
    panY: finite(rawView.panY, "view.panY"),
  };
  if (view.zoom < 0.1 || view.zoom > 4) {
    throw new Pdf2PltError("invalid-project", "view.zoom 必须在 0.1..4 之间。");
  }
  const absolutePath = text(rawSource.absolutePath, "source.absolutePath");
  const relativePath = text(rawSource.relativePath, "source.relativePath");
  if (!absolutePath && !relativePath) {
    throw new Pdf2PltError("invalid-project", "source 至少需要一个 PDF 路径。");
  }
  return {
    schemaVersion: 1,
    source: {
      absolutePath,
      relativePath,
      sha256,
      pageCount,
      pageSizePt,
    },
    layout,
    guides,
    output,
    view,
  };
}

export function serializePatternLayoutProject(project: PatternLayoutProjectV1): string {
  const normalized = parsePatternLayoutProject(project);
  return `${JSON.stringify(normalized, null, 2)}\n`;
}

export function createRelativeSourcePath(projectPath: string, sourcePath: string): string {
  const normalize = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/g, "");
  const project = normalize(projectPath);
  const source = normalize(sourcePath);
  const projectParts = project.split("/");
  projectParts.pop();
  const sourceParts = source.split("/");
  const projectDrive = projectParts[0]?.match(/^[A-Za-z]:$/)?.[0]?.toLowerCase();
  const sourceDrive = sourceParts[0]?.match(/^[A-Za-z]:$/)?.[0]?.toLowerCase();
  if (projectDrive !== sourceDrive) return source;
  let common = 0;
  while (
    common < projectParts.length &&
    common < sourceParts.length &&
    projectParts[common]?.toLowerCase() === sourceParts[common]?.toLowerCase()
  ) {
    common += 1;
  }
  const relative = [
    ...Array.from({ length: projectParts.length - common }, () => ".."),
    ...sourceParts.slice(common),
  ].join("/");
  return relative.startsWith(".") ? relative : `./${relative}`;
}
