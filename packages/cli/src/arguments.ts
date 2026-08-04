import {
  DEFAULT_GUIDE_DETECTION_OPTIONS,
  type GuideDetectionOptions,
} from "@pdf2plt/core";

import { CliUsageError } from "./errors";

export type GuideMode = "auto" | "manual" | "none";
export type PageOrder = "column-major" | "row-major";

export interface CliOptions {
  input?: string;
  project?: string;
  output?: string;
  pagesPerColumn?: number;
  pageLayout?: string;
  columns?: number;
  order: PageOrder;
  columnOrder?: string;
  rowOrder?: string;
  guideMode: GuideMode;
  seamLeft?: number;
  seamRight?: number;
  seamTop?: number;
  seamBottom?: number;
  outerLeft: number;
  outerRight?: number;
  outerTop: number;
  outerBottom?: number;
  detection: GuideDetectionOptions;
  keepGuides: boolean;
  keepBackground: boolean;
  detectOnly: boolean;
  allowUnusedPages: boolean;
  overwrite: boolean;
  help: boolean;
  warnings: string[];
}

const VALUE_OPTIONS = new Set([
  "-i", "--input", "--project", "-o", "--output", "-c", "--pages-per-column",
  "-p", "--page-layout", "--layout", "--columns", "--order", "--column-order",
  "--row-order", "--guide-mode", "--seam-left", "--seam-right", "--seam-top",
  "--seam-bottom", "--outer-left", "--outer-right", "--outer-top", "--outer-bottom",
  "--guide-dpi", "--red-min", "--other-max", "--red-delta", "--guide-min-fraction",
  "--rsvg-convert", "--work-dir",
]);

function numeric(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new CliUsageError(`${option} 必须是有效数字。`);
  return parsed;
}

function integer(value: string, option: string): number {
  const parsed = numeric(value, option);
  if (!Number.isInteger(parsed)) throw new CliUsageError(`${option} 必须是整数。`);
  return parsed;
}

export function parseCliArguments(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    order: "column-major",
    guideMode: "auto",
    outerLeft: 0,
    outerTop: 0,
    detection: { ...DEFAULT_GUIDE_DETECTION_OPTIONS },
    keepGuides: false,
    keepBackground: false,
    detectOnly: false,
    allowUnusedPages: false,
    overwrite: false,
    help: false,
    warnings: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    let option = argv[index] ?? "";
    let inlineValue: string | undefined;
    if (option.startsWith("--") && option.includes("=")) {
      [option, inlineValue] = option.split(/=(.*)/s, 2) as [string, string];
    }
    if (option === "-h" || option === "--help") {
      options.help = true;
      continue;
    }
    if (["--keep-guides", "--keep-background", "--detect-only", "--allow-unused-pages", "--overwrite", "--no-flatten"].includes(option)) {
      if (inlineValue !== undefined) throw new CliUsageError(`${option} 不接受参数值。`);
      if (option === "--keep-guides") options.keepGuides = true;
      if (option === "--keep-background") options.keepBackground = true;
      if (option === "--detect-only") options.detectOnly = true;
      if (option === "--allow-unused-pages") options.allowUnusedPages = true;
      if (option === "--overwrite") options.overwrite = true;
      if (option === "--no-flatten") {
        options.warnings.push("--no-flatten 已弃用；新核心始终输出单根 SVG。");
      }
      continue;
    }
    if (!VALUE_OPTIONS.has(option)) throw new CliUsageError(`未知参数：${option}`);
    const value = inlineValue ?? argv[++index];
    if (value === undefined || value.startsWith("--")) {
      throw new CliUsageError(`${option} 缺少参数值。`);
    }
    switch (option) {
      case "-i": case "--input": options.input = value; break;
      case "--project": options.project = value; break;
      case "-o": case "--output": options.output = value; break;
      case "-c": case "--pages-per-column": options.pagesPerColumn = integer(value, option); break;
      case "-p": case "--page-layout": case "--layout": options.pageLayout = value; break;
      case "--columns": options.columns = integer(value, option); break;
      case "--order":
        if (value !== "column-major" && value !== "row-major") {
          throw new CliUsageError("--order 只能是 column-major 或 row-major。");
        }
        options.order = value;
        break;
      case "--column-order": options.columnOrder = value; break;
      case "--row-order": options.rowOrder = value; break;
      case "--guide-mode":
        if (value !== "auto" && value !== "manual" && value !== "none") {
          throw new CliUsageError("--guide-mode 只能是 auto、manual 或 none。");
        }
        options.guideMode = value;
        break;
      case "--seam-left": options.seamLeft = numeric(value, option); break;
      case "--seam-right": options.seamRight = numeric(value, option); break;
      case "--seam-top": options.seamTop = numeric(value, option); break;
      case "--seam-bottom": options.seamBottom = numeric(value, option); break;
      case "--outer-left": options.outerLeft = numeric(value, option); break;
      case "--outer-right": options.outerRight = numeric(value, option); break;
      case "--outer-top": options.outerTop = numeric(value, option); break;
      case "--outer-bottom": options.outerBottom = numeric(value, option); break;
      case "--guide-dpi": options.detection.dpi = integer(value, option); break;
      case "--red-min": options.detection.redMin = integer(value, option); break;
      case "--other-max": options.detection.otherMax = integer(value, option); break;
      case "--red-delta": options.detection.redDelta = integer(value, option); break;
      case "--guide-min-fraction": options.detection.minimumFraction = numeric(value, option); break;
      case "--rsvg-convert":
        options.warnings.push("--rsvg-convert 已弃用；MuPDF 核心不再调用外部扁平化工具。");
        break;
      case "--work-dir":
        options.warnings.push("--work-dir 已忽略；新核心不会生成中间文件。");
        break;
    }
  }

  if (options.help) return options;
  if (options.input && options.project) throw new CliUsageError("--input 与 --project 不能同时使用。");
  if (!options.input && !options.project) throw new CliUsageError("必须提供 -i/--input 或 --project。");
  if (options.project) {
    if (options.pagesPerColumn !== undefined || options.pageLayout !== undefined) {
      throw new CliUsageError("--project 已包含布局，不能同时使用 -c 或 -p。");
    }
  } else if ((options.pagesPerColumn === undefined) === (options.pageLayout === undefined)) {
    throw new CliUsageError("-c/--pages-per-column 与 -p/--page-layout 必须且只能提供一个。");
  }
  if (options.pagesPerColumn !== undefined && options.pagesPerColumn < 1) {
    throw new CliUsageError("--pages-per-column 必须大于 0。");
  }
  if (options.columns !== undefined && options.columns < 1) {
    throw new CliUsageError("--columns 必须大于 0。");
  }
  if (options.pageLayout && (options.columns || options.order !== "column-major" || options.columnOrder || options.rowOrder)) {
    throw new CliUsageError("手动布局已确定行列和顺序，不能同时使用 --columns/--order/行列顺序参数。");
  }
  if (options.allowUnusedPages && !options.pageLayout && !options.project) {
    throw new CliUsageError("--allow-unused-pages 只能与手动布局或工程文件一起使用。");
  }
  return options;
}

export const HELP_TEXT = `用法：pdf-pattern-svg -i input.pdf (-c 3 | -p '1-3|4-6') [选项]
       pdf-pattern-svg --project layout.pattern-layout.json [-o output.svg]

布局：
  -c, --pages-per-column N   每列页数
  -p, --page-layout EXPR     手动列布局，支持 1-5、5-1 和空白 -
  --columns N                自动布局列数
  --order ORDER              column-major 或 row-major

接缝：
  --guide-mode MODE          auto、manual 或 none
  --seam-left/right/top/bottom PT
  --outer-left/right/top/bottom PT
  --guide-dpi N --red-min N --other-max N --red-delta N

输出：
  -o, --output FILE          默认使用输入 PDF 同名 .svg
  --keep-guides --keep-background --overwrite --detect-only
  --allow-unused-pages
`;
