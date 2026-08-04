import {
  buildCombinedSvg,
  createAutomaticLayout,
  flattenLayout,
  getUnusedLayoutPages,
  openMuPdfDocument,
  parsePatternLayoutProject,
  parsePageLayout,
  Pdf2PltError,
  resolveGuideGeometry,
  type GuideCoordinates,
  type GuideDetectionOptions,
  type LayoutCell,
  type LayoutGrid,
  type PageSizePt,
} from "@pdf2plt/core";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import mupdf from "mupdf";

import type { CliOptions, GuideMode, PageOrder } from "./arguments";
import { CliUsageError } from "./errors";

export interface CliOutput {
  log(message: string): void;
  warn(message: string): void;
}

interface ProjectData {
  sourcePath: string;
  sha256: string;
  pageCount: number;
  pageSizePt: PageSizePt;
  layout: LayoutGrid;
  guideMode: GuideMode;
  seams: Partial<GuideCoordinates>;
  detection?: Partial<GuideDetectionOptions>;
  keepGuides: boolean;
  keepBackground: boolean;
  allowUnusedPages: boolean;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readProject(projectPath: string): Promise<ProjectData> {
  let parsed;
  try {
    parsed = parsePatternLayoutProject(await readFile(projectPath, "utf8"));
  } catch (error) {
    if (error instanceof Pdf2PltError) throw error;
    throw new CliUsageError(`无法读取工程：${projectPath}`);
  }
  const candidates = [
    ...(parsed.source.relativePath
      ? [resolve(dirname(projectPath), parsed.source.relativePath)]
      : []),
    ...(parsed.source.absolutePath
      ? [isAbsolute(parsed.source.absolutePath)
          ? parsed.source.absolutePath
          : resolve(parsed.source.absolutePath)]
      : []),
  ];
  let sourcePath: string | undefined;
  let foundCandidate = false;
  for (const candidate of candidates) {
    if (await exists(candidate)) {
      foundCandidate = true;
      try {
        const digest = createHash("sha256").update(await readFile(candidate)).digest("hex");
        if (digest === parsed.source.sha256) {
          sourcePath = candidate;
          break;
        }
      } catch {
        // Continue to the next recorded source path.
      }
    }
  }
  if (!sourcePath) {
    if (foundCandidate) {
      throw new CliUsageError("工程候选 PDF 的 SHA-256 均不匹配，已停止导出。");
    }
    throw new CliUsageError("工程引用的 PDF 不存在；请修正 relativePath 或 absolutePath。");
  }
  const guides = parsed.guides;
  return {
    sourcePath,
    sha256: parsed.source.sha256,
    pageCount: parsed.source.pageCount,
    pageSizePt: parsed.source.pageSizePt,
    layout: parsed.layout,
    guideMode: guides.mode,
    seams: {
      ...(guides.seamLeft !== undefined ? { left: guides.seamLeft } : {}),
      ...(guides.seamRight !== undefined ? { right: guides.seamRight } : {}),
      ...(guides.seamTop !== undefined ? { top: guides.seamTop } : {}),
      ...(guides.seamBottom !== undefined ? { bottom: guides.seamBottom } : {}),
      outerLeft: guides.outerLeft,
      ...(guides.outerRight !== undefined ? { outerRight: guides.outerRight } : {}),
      outerTop: guides.outerTop,
      ...(guides.outerBottom !== undefined ? { outerBottom: guides.outerBottom } : {}),
    },
    detection: guides.detection,
    keepGuides: parsed.output.keepGuides,
    keepBackground: parsed.output.keepBackground,
    allowUnusedPages: parsed.output.allowUnusedPages,
  };
}

function makeAutomaticLayout(
  pageCount: number,
  rows: number,
  columns: number | undefined,
  order: PageOrder,
): LayoutGrid {
  const resolvedColumns = columns ?? Math.ceil(pageCount / rows);
  if (rows * resolvedColumns < pageCount) {
    throw new CliUsageError("--columns 与 --pages-per-column 无法容纳全部 PDF 页面。");
  }
  if (order === "column-major") {
    const layout = createAutomaticLayout(pageCount, rows);
    if (resolvedColumns === layout.columns) return layout;
    return {
      ...layout,
      columns: resolvedColumns,
      cells: layout.cells.map((row) => [
        ...row,
        ...Array<LayoutCell>(resolvedColumns - layout.columns).fill(null),
      ]),
    };
  }
  return {
    rows,
    columns: resolvedColumns,
    traversal: "column-major",
    cells: Array.from({ length: rows }, (_, row) =>
      Array.from({ length: resolvedColumns }, (_, column) => {
        const pageNumber = row * resolvedColumns + column + 1;
        return pageNumber <= pageCount ? { kind: "page" as const, pageNumber } : null;
      }),
    ),
  };
}

function parsePermutation(value: string, expected: number, label: string): number[] {
  const numbers = value.split(",").map((part) => Number(part.trim()));
  const wanted = Array.from({ length: expected }, (_, index) => index + 1);
  if (numbers.some((number) => !Number.isInteger(number)) || [...numbers].sort((a, b) => a - b).some((n, i) => n !== wanted[i])) {
    throw new CliUsageError(`${label} 必须恰好包含：${wanted.join(",")}`);
  }
  return numbers.map((number) => number - 1);
}

function reorderLayout(layout: LayoutGrid, columnOrder?: string, rowOrder?: string): LayoutGrid {
  const columns = columnOrder
    ? parsePermutation(columnOrder, layout.columns, "--column-order")
    : Array.from({ length: layout.columns }, (_, index) => index);
  const rows = rowOrder
    ? parsePermutation(rowOrder, layout.rows, "--row-order")
    : Array.from({ length: layout.rows }, (_, index) => index);
  return {
    ...layout,
    cells: rows.map((sourceRow) => columns.map((sourceColumn) => layout.cells[sourceRow]?.[sourceColumn] ?? null)),
  };
}

function validateLayoutPages(layout: LayoutGrid, pageCount: number, allowUnused: boolean) {
  const pages = flattenLayout(layout)
    .filter((cell) => cell?.kind === "page")
    .map((cell) => cell?.kind === "page" ? cell.pageNumber : 0);
  const seen = new Set<number>();
  for (const page of pages) {
    if (page < 1 || page > pageCount) throw new CliUsageError(`工程页码 ${page} 超出 1..${pageCount}。`);
    if (seen.has(page)) throw new CliUsageError(`工程页码 ${page} 重复。`);
    seen.add(page);
  }
  const missing = getUnusedLayoutPages(layout, pageCount);
  if (missing.length > 0 && !allowUnused) {
    throw new CliUsageError(`布局遗漏 PDF 页码：${missing.join(",")}。`);
  }
}

function defaultOutputPath(inputPath: string, projectPath?: string): string {
  const source = projectPath ?? inputPath;
  if (source.endsWith(".pattern-layout.json")) return source.slice(0, -".pattern-layout.json".length) + ".svg";
  return source.replace(/\.pdf$/i, "") + ".svg";
}

export async function runCli(options: CliOptions, output: CliOutput): Promise<number> {
  for (const warning of options.warnings) output.warn(`警告：${warning}`);
  const projectPath = options.project ? resolve(options.project) : undefined;
  const project = projectPath ? await readProject(projectPath) : undefined;
  const inputPath = project?.sourcePath ?? resolve(options.input ?? "");
  if (!(await exists(inputPath))) throw new CliUsageError(`输入文件不存在：${inputPath}`);
  const pdfBytes = new Uint8Array(await readFile(inputPath));
  if (project) {
    const sha256 = createHash("sha256").update(pdfBytes).digest("hex");
    if (sha256 !== project.sha256) {
      throw new CliUsageError("工程记录的 SHA-256 与当前 PDF 不一致，已停止导出。");
    }
  }
  const document = await openMuPdfDocument(mupdf, pdfBytes);
  try {
    if (project?.pageCount !== undefined && project.pageCount !== document.info.pageCount) {
      throw new CliUsageError(`工程记录 ${project.pageCount} 页，但当前 PDF 有 ${document.info.pageCount} 页。`);
    }
    if (project?.pageSizePt && (
      Math.abs(project.pageSizePt.width - document.info.pageSizePt.width) > 0.02 ||
      Math.abs(project.pageSizePt.height - document.info.pageSizePt.height) > 0.02
    )) {
      throw new CliUsageError("工程记录的页面尺寸与当前 PDF 不一致。");
    }
    let layout = project?.layout ?? (
      options.pageLayout
        ? parsePageLayout(options.pageLayout, document.info.pageCount, options.allowUnusedPages)
        : makeAutomaticLayout(
            document.info.pageCount,
            options.pagesPerColumn ?? 1,
            options.columns,
            options.order,
          )
    );
    if (!project) layout = reorderLayout(layout, options.columnOrder, options.rowOrder);
    const allowUnused = options.allowUnusedPages || project?.allowUnusedPages === true;
    validateLayoutPages(layout, document.info.pageCount, allowUnused);

    const mode = project?.guideMode ?? options.guideMode;
    const detectionOptions = { ...options.detection, ...project?.detection };
    const detection = mode === "auto" ? document.detectGuides(detectionOptions) : undefined;
    const detected = Object.fromEntries(
      ["left", "right", "top", "bottom"].map((direction) => [
        direction,
        detection?.lines[direction as keyof typeof detection.lines]?.coordinatePt,
      ]),
    );
    const explicit: Partial<GuideCoordinates> = {
      ...project?.seams,
      ...(options.seamLeft !== undefined ? { left: options.seamLeft } : {}),
      ...(options.seamRight !== undefined ? { right: options.seamRight } : {}),
      ...(options.seamTop !== undefined ? { top: options.seamTop } : {}),
      ...(options.seamBottom !== undefined ? { bottom: options.seamBottom } : {}),
      outerLeft: project ? (project.seams.outerLeft ?? 0) : options.outerLeft,
      outerTop: project ? (project.seams.outerTop ?? 0) : options.outerTop,
      ...(options.outerRight !== undefined ? { outerRight: options.outerRight } : {}),
      ...(options.outerBottom !== undefined ? { outerBottom: options.outerBottom } : {}),
    };
    const guides = resolveGuideGeometry(
      {
        mode,
        ...(explicit.left !== undefined ? { seamLeft: explicit.left } : {}),
        ...(explicit.right !== undefined ? { seamRight: explicit.right } : {}),
        ...(explicit.top !== undefined ? { seamTop: explicit.top } : {}),
        ...(explicit.bottom !== undefined ? { seamBottom: explicit.bottom } : {}),
        outerLeft: explicit.outerLeft ?? 0,
        ...(explicit.outerRight !== undefined ? { outerRight: explicit.outerRight } : {}),
        outerTop: explicit.outerTop ?? 0,
        ...(explicit.outerBottom !== undefined ? { outerBottom: explicit.outerBottom } : {}),
      },
      detected,
      document.info.pageSizePt,
      layout,
    ).coordinates;
    output.log(`页面：${document.info.pageCount}；网格：${layout.columns} 列 × ${layout.rows} 行`);
    output.log(`单页：${document.info.pageSizePt.width.toFixed(3)} × ${document.info.pageSizePt.height.toFixed(3)} pt`);
    if (detection) {
      const found = Object.entries(detection.lines)
        .map(([name, line]) => `${name}=${line.coordinatePt.toFixed(3)}`)
        .join(", ");
      output.log(`自动红线：${found || "未检测到"}`);
    }
    output.log(`使用拼接线：left=${guides.left.toFixed(3)}, right=${guides.right.toFixed(3)}, top=${guides.top.toFixed(3)}, bottom=${guides.bottom.toFixed(3)} pt`);
    if (options.detectOnly) return 0;

    const outputPath = resolve(options.output ?? defaultOutputPath(inputPath, projectPath));
    if (await exists(outputPath) && !options.overwrite) {
      throw new CliUsageError(`输出文件已存在：${outputPath}；如需覆盖请添加 --overwrite。`);
    }
    const pageNumbers = [...new Set(
      flattenLayout(layout)
        .filter((cell) => cell?.kind === "page")
        .map((cell) => cell?.kind === "page" ? cell.pageNumber : 0),
    )].filter(Boolean);
    const pages = pageNumbers.map((pageNumber) => ({
      pageNumber,
      svg: document.renderSvgPage(pageNumber),
    }));
    const result = buildCombinedSvg(
      pages,
      layout,
      document.info.pageSizePt,
      guides,
      {
        removeGuides: !(options.keepGuides || project?.keepGuides),
        removeBackground: !(options.keepBackground || project?.keepBackground),
      },
    );
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, result.svg);
    output.log(`输出：${outputPath}`);
    output.log(`成品尺寸：${((result.widthPt * 25.4) / 72).toFixed(3)} × ${((result.heightPt * 25.4) / 72).toFixed(3)} mm`);
    output.log(`结构：svg=1, objects=${result.visibleObjects}, pages=${result.pageInstances}`);
    return 0;
  } finally {
    document.close();
  }
}
