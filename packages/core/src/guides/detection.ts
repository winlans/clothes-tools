import type { PageSizePt } from "../pdf/document";
import { Pdf2PltError } from "../pdf/errors";

export const GUIDE_DIRECTIONS = ["left", "right", "top", "bottom"] as const;

export type GuideDirection = (typeof GUIDE_DIRECTIONS)[number];
export type GuideSource = "auto" | "manual";

export interface GuideDetectionOptions {
  dpi: number;
  redMin: number;
  otherMax: number;
  redDelta: number;
  minimumFraction: number;
}

export const DEFAULT_GUIDE_DETECTION_OPTIONS: Readonly<GuideDetectionOptions> = {
  dpi: 72,
  redMin: 200,
  otherMax: 120,
  redDelta: 80,
  minimumFraction: 0.03,
};

export interface GuidePixelPage {
  pageNumber: number;
  width: number;
  height: number;
  stride: number;
  components: number;
  pixels: Uint8Array<ArrayBufferLike> | Uint8ClampedArray<ArrayBufferLike>;
}

export interface GuideSample {
  pageNumber: number;
  positionPt: number;
  pixelWeight: number;
}

export interface GuideLine {
  coordinatePt: number;
  source: GuideSource;
  supportPages: number;
  pixelWeight: number;
}

export interface GuideDetectionResult {
  lines: Partial<Record<GuideDirection, GuideLine>>;
  missing: GuideDirection[];
  options: GuideDetectionOptions;
  inferredPagesPerColumn?: number;
}

export type PageGuideSamples = Partial<Record<GuideDirection, GuideSample>>;

export function resolveGuideDetectionOptions(
  overrides: Partial<GuideDetectionOptions> = {},
): GuideDetectionOptions {
  const options = { ...DEFAULT_GUIDE_DETECTION_OPTIONS, ...overrides };
  if (!Number.isFinite(options.dpi) || options.dpi <= 0) {
    throw new Pdf2PltError("invalid-guide-options", "红线检测 DPI 必须大于 0。");
  }
  for (const name of ["redMin", "otherMax", "redDelta"] as const) {
    const value = options[name];
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      throw new Pdf2PltError(
        "invalid-guide-options",
        `${name} 必须是 0..255 之间的整数。`,
      );
    }
  }
  if (
    !Number.isFinite(options.minimumFraction) ||
    options.minimumFraction <= 0 ||
    options.minimumFraction > 1
  ) {
    throw new Pdf2PltError(
      "invalid-guide-options",
      "红线最小跨度比例必须大于 0 且不超过 1。",
    );
  }
  return options;
}

function strongest(
  samples: GuideSample[],
  next: GuideSample,
): GuideSample[] {
  const current = samples[0];
  return !current || next.pixelWeight > current.pixelWeight ? [next] : samples;
}

export function detectPageGuideSamples(
  page: GuidePixelPage,
  pageSize: PageSizePt,
  options: GuideDetectionOptions,
): Partial<Record<GuideDirection, GuideSample>> {
  if (page.width <= 0 || page.height <= 0 || page.components < 3) {
    throw new Pdf2PltError("invalid-guide-pixels", "红线检测像素尺寸或通道数无效。");
  }
  if (page.stride < page.width * page.components) {
    throw new Pdf2PltError("invalid-guide-pixels", "红线检测像素步长无效。");
  }

  const xCounts = new Uint32Array(page.width);
  const yCounts = new Uint32Array(page.height);
  for (let y = 0; y < page.height; y += 1) {
    const rowOffset = y * page.stride;
    for (let x = 0; x < page.width; x += 1) {
      const offset = rowOffset + x * page.components;
      const red = page.pixels[offset];
      const green = page.pixels[offset + 1];
      const blue = page.pixels[offset + 2];
      if (red === undefined || green === undefined || blue === undefined) {
        throw new Pdf2PltError("invalid-guide-pixels", "红线检测像素缓冲区长度不足。");
      }
      if (
        red >= options.redMin &&
        green <= options.otherMax &&
        blue <= options.otherMax &&
        red - Math.max(green, blue) >= options.redDelta
      ) {
        xCounts[x] = (xCounts[x] ?? 0) + 1;
        yCounts[y] = (yCounts[y] ?? 0) + 1;
      }
    }
  }

  const xThreshold = Math.max(10, Math.round(page.height * options.minimumFraction));
  const yThreshold = Math.max(10, Math.round(page.width * options.minimumFraction));
  const scaleX = pageSize.width / page.width;
  const scaleY = pageSize.height / page.height;
  const buckets: Record<GuideDirection, GuideSample[]> = {
    left: [],
    right: [],
    top: [],
    bottom: [],
  };

  for (let x = 0; x < page.width; x += 1) {
    const count = xCounts[x] ?? 0;
    if (count < xThreshold) continue;
    const sample = { pageNumber: page.pageNumber, positionPt: x * scaleX, pixelWeight: count };
    if (x < page.width * 0.45) buckets.left = strongest(buckets.left, sample);
    if (x > page.width * 0.55) buckets.right = strongest(buckets.right, sample);
  }
  for (let y = 0; y < page.height; y += 1) {
    const count = yCounts[y] ?? 0;
    if (count < yThreshold) continue;
    const sample = { pageNumber: page.pageNumber, positionPt: y * scaleY, pixelWeight: count };
    if (y < page.height * 0.45) buckets.top = strongest(buckets.top, sample);
    if (y > page.height * 0.55) buckets.bottom = strongest(buckets.bottom, sample);
  }

  const result: Partial<Record<GuideDirection, GuideSample>> = {};
  for (const direction of GUIDE_DIRECTIONS) {
    const sample = buckets[direction][0];
    if (sample) result[direction] = sample;
  }
  return result;
}

function weightedMedian(samples: readonly GuideSample[]): number {
  const weights = samples.map((sample) => Math.max(1, Math.min(sample.pixelWeight, 100)));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const valuesAt = (wanted: number): number => {
    let accumulated = 0;
    for (let index = 0; index < samples.length; index += 1) {
      accumulated += weights[index] ?? 0;
      if (wanted < accumulated) return samples[index]?.positionPt ?? 0;
    }
    return samples.at(-1)?.positionPt ?? 0;
  };
  const upper = valuesAt(Math.floor(total / 2));
  return total % 2 === 1 ? upper : (valuesAt(total / 2 - 1) + upper) / 2;
}

export function clusterGuideSamples(
  samples: readonly GuideSample[],
  tolerancePt: number,
): GuideLine | undefined {
  if (samples.length === 0) return undefined;
  const sorted = [...samples].sort((a, b) => a.positionPt - b.positionPt);
  const clusters: GuideSample[][] = [];
  for (const sample of sorted) {
    const cluster = clusters.at(-1);
    const previous = cluster?.at(-1);
    if (!cluster || !previous || sample.positionPt - previous.positionPt > tolerancePt) {
      clusters.push([sample]);
    } else {
      cluster.push(sample);
    }
  }

  let best = clusters[0] ?? [];
  for (const cluster of clusters.slice(1)) {
    const bestWeight = best.reduce((sum, sample) => sum + sample.pixelWeight, 0);
    const clusterWeight = cluster.reduce((sum, sample) => sum + sample.pixelWeight, 0);
    if (
      cluster.length > best.length ||
      (cluster.length === best.length && clusterWeight > bestWeight)
    ) {
      best = cluster;
    }
  }
  return {
    coordinatePt: weightedMedian(best),
    source: "auto",
    supportPages: best.length,
    pixelWeight: best.reduce((sum, sample) => sum + sample.pixelWeight, 0),
  };
}

export function detectRedGuides(
  pages: readonly GuidePixelPage[],
  pageSize: PageSizePt,
  overrides: Partial<GuideDetectionOptions> = {},
): GuideDetectionResult {
  const options = resolveGuideDetectionOptions(overrides);
  const pageSamples = pages.map((page) => detectPageGuideSamples(page, pageSize, options));
  return buildGuideDetectionResult(pageSamples, pageSize, options);
}

export function inferPagesPerColumnFromGuideSamples(
  pageSamples: readonly PageGuideSamples[],
): number | undefined {
  const firstLeftIndex = pageSamples.findIndex(
    (samples, index) => index > 0 && Boolean(samples.left),
  );
  if (firstLeftIndex < 2) return undefined;

  const pagesPerColumn = firstLeftIndex;
  const firstColumn = pageSamples.slice(0, pagesPerColumn);
  const laterColumns = pageSamples.slice(pagesPerColumn);
  if (
    firstColumn.some((samples) => samples.left || !samples.right) ||
    laterColumns.length === 0 ||
    laterColumns.some((samples) => !samples.left)
  ) {
    return undefined;
  }

  for (let index = 0; index < pageSamples.length; index += 1) {
    const samples = pageSamples[index];
    if (!samples) return undefined;
    const row = index % pagesPerColumn;
    if (row === pagesPerColumn - 1) {
      if (!samples.top || samples.bottom) return undefined;
    } else if (!samples.bottom) {
      return undefined;
    }
  }
  return pagesPerColumn;
}

export function buildGuideDetectionResult(
  pageSamples: readonly PageGuideSamples[],
  pageSize: PageSizePt,
  options: GuideDetectionOptions,
): GuideDetectionResult {
  const samples: Record<GuideDirection, GuideSample[]> = {
    left: [],
    right: [],
    top: [],
    bottom: [],
  };
  for (const detected of pageSamples) {
    for (const direction of GUIDE_DIRECTIONS) {
      const sample = detected[direction];
      if (sample) samples[direction].push(sample);
    }
  }

  const lines: Partial<Record<GuideDirection, GuideLine>> = {};
  const tolerance = {
    left: Math.max(0.5, pageSize.width * 0.003),
    right: Math.max(0.5, pageSize.width * 0.003),
    top: Math.max(0.5, pageSize.height * 0.003),
    bottom: Math.max(0.5, pageSize.height * 0.003),
  };
  for (const direction of GUIDE_DIRECTIONS) {
    const line = clusterGuideSamples(samples[direction], tolerance[direction]);
    if (line) lines[direction] = line;
  }
  const inferredPagesPerColumn = inferPagesPerColumnFromGuideSamples(pageSamples);
  return {
    lines,
    missing: GUIDE_DIRECTIONS.filter((direction) => !lines[direction]),
    options,
    ...(inferredPagesPerColumn !== undefined ? { inferredPagesPerColumn } : {}),
  };
}
