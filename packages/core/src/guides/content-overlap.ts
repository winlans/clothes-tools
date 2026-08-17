import type { PageSizePt } from "../pdf/document";
import {
  GUIDE_DIRECTIONS,
  type ContentOverlapMetadata,
  type GuideDetectionResult,
  type GuideDirection,
  type GuideLine,
  type GuidePixelPage,
  type GuideStitchingMode,
  type InferredColumnLayout,
} from "./detection";

export interface ContentOverlapOptions {
  minimumOverlapPt?: number;
  maximumOverlapPt?: number;
  minimumSimilarity?: number;
  minimumConfidence?: number;
  maximumRows?: number;
  orthogonalShiftPx?: number;
}

export interface ContentOverlapDetectionResult extends ContentOverlapMetadata {
  lines: Partial<Record<GuideDirection, GuideLine>>;
  inferredLayout?: InferredColumnLayout;
}

interface EdgePoint {
  distance: number;
  orthogonal: number;
}

interface EdgeDescriptor {
  band: number;
  points: EdgePoint[];
  pointSet: Set<number>;
  prefixCounts: Uint32Array;
}

interface PageEdges {
  left: EdgeDescriptor;
  right: EdgeDescriptor;
  top: EdgeDescriptor;
  bottom: EdgeDescriptor;
}

interface EdgeMatch {
  similarity: number;
  evidence: number;
  overlapPx: number;
}

interface ColumnChoice {
  start: number;
  length: number;
  top: number;
}

interface LayoutCandidate {
  rows: number;
  columns: ColumnChoice[];
  score: number;
}

const DEFAULT_OPTIONS = {
  minimumOverlapPt: 8,
  maximumOverlapPt: 72,
  minimumSimilarity: 0.68,
  minimumConfidence: 0.8,
  maximumRows: 20,
  orthogonalShiftPx: 2,
} satisfies Required<ContentOverlapOptions>;

const INFERRED_BLANK_CELL_PENALTY = 0.3;

export const CONTENT_OVERLAP_FALLBACK_DPIS = [120, 48] as const;
export type ContentOverlapDpiStrategy = "quality-first" | "speed-first";

export function contentOverlapDpiCandidates(
  requestedDpi: number,
  strategy: ContentOverlapDpiStrategy = "quality-first",
): number[] {
  const candidates = strategy === "speed-first"
    ? [Math.min(requestedDpi, 48), requestedDpi, ...CONTENT_OVERLAP_FALLBACK_DPIS]
    : [requestedDpi, ...CONTENT_OVERLAP_FALLBACK_DPIS];
  return candidates.filter(
    (dpi, index, values) => values.indexOf(dpi) === index,
  );
}

function withRasterDpi(
  result: GuideDetectionResult,
  rasterDpi: number,
): GuideDetectionResult {
  return result.contentOverlap
    ? {
        ...result,
        contentOverlap: { ...result.contentOverlap, rasterDpi },
      }
    : result;
}

export function runContentOverlapDpiFallback(
  requestedDpi: number,
  attempt: (dpi: number, attemptIndex: number, attemptCount: number) => GuideDetectionResult,
  strategy: ContentOverlapDpiStrategy = "quality-first",
): GuideDetectionResult {
  const candidates = contentOverlapDpiCandidates(requestedDpi, strategy);
  let latest: GuideDetectionResult | undefined;
  for (const [index, dpi] of candidates.entries()) {
    latest = withRasterDpi(attempt(dpi, index, candidates.length), dpi);
    if (latest.contentOverlap?.applied) return latest;
  }
  return latest!;
}

export async function runContentOverlapDpiFallbackAsync(
  requestedDpi: number,
  attempt: (
    dpi: number,
    attemptIndex: number,
    attemptCount: number,
  ) => Promise<GuideDetectionResult>,
  strategy: ContentOverlapDpiStrategy = "quality-first",
): Promise<GuideDetectionResult> {
  const candidates = contentOverlapDpiCandidates(requestedDpi, strategy);
  let latest: GuideDetectionResult | undefined;
  for (const [index, dpi] of candidates.entries()) {
    latest = withRasterDpi(await attempt(dpi, index, candidates.length), dpi);
    if (latest.contentOverlap?.applied) return latest;
  }
  return latest!;
}

function resolvedOptions(
  overrides: ContentOverlapOptions,
): Required<ContentOverlapOptions> {
  return { ...DEFAULT_OPTIONS, ...overrides };
}

function isInk(page: GuidePixelPage, x: number, y: number): boolean {
  const offset = y * page.stride + x * page.components;
  const red = page.pixels[offset] ?? 255;
  const green = page.pixels[offset + 1] ?? 255;
  const blue = page.pixels[offset + 2] ?? 255;
  return Math.min(red, green, blue) < 220;
}

function buildDescriptor(
  points: EdgePoint[],
  band: number,
): EdgeDescriptor {
  const pointSet = new Set<number>();
  const counts = new Uint32Array(band);
  for (const point of points) {
    pointSet.add(point.orthogonal * band + point.distance);
    counts[point.distance] = (counts[point.distance] ?? 0) + 1;
  }
  const prefixCounts = new Uint32Array(band + 1);
  for (let distance = 0; distance < band; distance += 1) {
    prefixCounts[distance + 1] =
      (prefixCounts[distance] ?? 0) + (counts[distance] ?? 0);
  }
  return { band, points, pointSet, prefixCounts };
}

function extractPageEdges(
  page: GuidePixelPage,
  horizontalBand: number,
  verticalBand: number,
): PageEdges {
  const points: Record<GuideDirection, EdgePoint[]> = {
    left: [],
    right: [],
    top: [],
    bottom: [],
  };
  for (let y = 0; y < page.height; y += 1) {
    for (let x = 0; x < page.width; x += 1) {
      if (!isInk(page, x, y)) continue;
      const rightDistance = page.width - 1 - x;
      const bottomDistance = page.height - 1 - y;
      if (x < horizontalBand) points.left.push({ distance: x, orthogonal: y });
      if (rightDistance < horizontalBand) {
        points.right.push({ distance: rightDistance, orthogonal: y });
      }
      if (y < verticalBand) points.top.push({ distance: y, orthogonal: x });
      if (bottomDistance < verticalBand) {
        points.bottom.push({ distance: bottomDistance, orthogonal: x });
      }
    }
  }
  return {
    left: buildDescriptor(points.left, horizontalBand),
    right: buildDescriptor(points.right, horizontalBand),
    top: buildDescriptor(points.top, verticalBand),
    bottom: buildDescriptor(points.bottom, verticalBand),
  };
}

function countWithin(descriptor: EdgeDescriptor, overlap: number): number {
  return descriptor.prefixCounts[Math.min(overlap, descriptor.band)] ?? 0;
}

function bestEdgeMatch(
  source: EdgeDescriptor,
  target: EdgeDescriptor,
  minimumOverlap: number,
  maximumOverlap: number,
  minimumEvidence: number,
  orthogonalShift: number,
): EdgeMatch | undefined {
  let best: EdgeMatch | undefined;
  for (let overlap = minimumOverlap; overlap <= maximumOverlap; overlap += 1) {
    const sourceCount = countWithin(source, overlap);
    const targetCount = countWithin(target, overlap);
    if (sourceCount + targetCount < minimumEvidence) continue;
    for (let shift = -orthogonalShift; shift <= orthogonalShift; shift += 1) {
      let intersection = 0;
      for (const point of source.points) {
        if (point.distance >= overlap) continue;
        const targetDistance = overlap - 1 - point.distance;
        const targetOrthogonal = point.orthogonal + shift;
        if (targetOrthogonal < 0) continue;
        if (target.pointSet.has(targetOrthogonal * target.band + targetDistance)) {
          intersection += 1;
        }
      }
      const union = sourceCount + targetCount - intersection;
      if (union < minimumEvidence) continue;
      const similarity = intersection / union;
      if (
        !best ||
        similarity > best.similarity ||
        (similarity === best.similarity && union > best.evidence)
      ) {
        best = { similarity, evidence: union, overlapPx: overlap };
      }
    }
  }
  return best;
}

function matchKey(first: number, second: number): string {
  return `${first}:${second}`;
}

function expectedMatchScore(
  match: EdgeMatch | undefined,
  minimumSimilarity: number,
): number {
  if (!match) return -0.03;
  if (match.similarity >= minimumSimilarity) {
    return 0.5 + (match.similarity - minimumSimilarity) / (1 - minimumSimilarity);
  }
  return -0.45 * (minimumSimilarity - match.similarity) / minimumSimilarity;
}

function isStrong(match: EdgeMatch | undefined, minimumSimilarity: number): match is EdgeMatch {
  return Boolean(match && match.similarity >= minimumSimilarity);
}

function columnPages(choice: ColumnChoice): Array<number | undefined> {
  return Array.from({ length: choice.top + choice.length }, (_, row) => {
    if (row < choice.top) return undefined;
    return choice.start + row - choice.top;
  });
}

function transitionScore(
  previous: ColumnChoice,
  next: ColumnChoice,
  horizontalMatches: Map<string, EdgeMatch>,
  verticalMatches: Map<string, EdgeMatch>,
  minimumSimilarity: number,
): number {
  let score = 0;
  const previousPages = columnPages(previous);
  const nextPages = columnPages(next);
  const rows = Math.max(previousPages.length, nextPages.length);
  for (let row = 0; row < rows; row += 1) {
    const first = previousPages[row];
    const second = nextPages[row];
    if (first === undefined || second === undefined) continue;
    score += expectedMatchScore(
      horizontalMatches.get(matchKey(first, second)),
      minimumSimilarity,
    );
  }
  const boundary = verticalMatches.get(matchKey(next.start - 1, next.start));
  if (isStrong(boundary, minimumSimilarity)) score -= 1.25 * boundary.similarity;
  return score;
}

function internalColumnScore(
  choice: ColumnChoice,
  rows: number,
  verticalMatches: Map<string, EdgeMatch>,
  minimumSimilarity: number,
): number {
  let score = -INFERRED_BLANK_CELL_PENALTY * (rows - choice.length);
  for (let page = choice.start; page < choice.start + choice.length - 1; page += 1) {
    score += expectedMatchScore(
      verticalMatches.get(matchKey(page, page + 1)),
      minimumSimilarity,
    );
  }
  return score;
}

function inferLayout(
  pageCount: number,
  verticalMatches: Map<string, EdgeMatch>,
  horizontalMatches: Map<string, EdgeMatch>,
  options: Required<ContentOverlapOptions>,
): LayoutCandidate[] {
  const results: LayoutCandidate[] = [];
  let longestRun = 1;
  let currentRun = 1;
  for (let page = 1; page < pageCount; page += 1) {
    if (isStrong(verticalMatches.get(matchKey(page, page + 1)), options.minimumSimilarity)) {
      currentRun += 1;
      longestRun = Math.max(longestRun, currentRun);
    } else {
      currentRun = 1;
    }
  }
  const rows = Math.min(longestRun, options.maximumRows);
  if (rows < 2 || rows > pageCount) return results;

  {
    type State = { score: number; columns: ColumnChoice[]; current: ColumnChoice };
    const states = new Map<string, State[]>();
    const first = { start: 1, length: rows, top: 0 };
    states.set(`${rows}`, [{
      score: internalColumnScore(first, rows, verticalMatches, options.minimumSimilarity),
      columns: [first],
      current: first,
    }]);

    for (let consumed = rows; consumed < pageCount; consumed += 1) {
      const currentStates = states.get(`${consumed}`) ?? [];
      if (currentStates.length === 0) continue;
      for (const state of currentStates) {
        const remaining = pageCount - consumed;
        for (let length = 1; length <= Math.min(rows, remaining); length += 1) {
          for (let top = 0; top <= rows - length; top += 1) {
            const next = { start: consumed + 1, length, top };
            const score = state.score +
              internalColumnScore(next, rows, verticalMatches, options.minimumSimilarity) +
              transitionScore(
                state.current,
                next,
                horizontalMatches,
                verticalMatches,
                options.minimumSimilarity,
              );
            const key = `${consumed + length}`;
            const candidates = states.get(key) ?? [];
            candidates.push({ score, columns: [...state.columns, next], current: next });
            candidates.sort((first, second) => second.score - first.score);
            if (candidates.length > 80) candidates.length = 80;
            states.set(key, candidates);
          }
        }
      }
    }
    for (const state of (states.get(`${pageCount}`) ?? []).slice(0, 3)) {
      results.push({ rows, columns: state.columns, score: state.score - rows * 0.01 });
    }
  }
  return results.sort((first, second) => second.score - first.score);
}

function usedMatches(
  candidate: LayoutCandidate,
  verticalMatches: Map<string, EdgeMatch>,
  horizontalMatches: Map<string, EdgeMatch>,
  minimumSimilarity: number,
): { vertical: EdgeMatch[]; horizontal: EdgeMatch[] } {
  const vertical: EdgeMatch[] = [];
  const horizontal: EdgeMatch[] = [];
  for (const column of candidate.columns) {
    for (let page = column.start; page < column.start + column.length - 1; page += 1) {
      const match = verticalMatches.get(matchKey(page, page + 1));
      if (isStrong(match, minimumSimilarity)) vertical.push(match);
    }
  }
  for (let index = 0; index < candidate.columns.length - 1; index += 1) {
    const first = columnPages(candidate.columns[index]!);
    const second = columnPages(candidate.columns[index + 1]!);
    for (let row = 0; row < candidate.rows; row += 1) {
      const firstPage = first[row];
      const secondPage = second[row];
      if (firstPage === undefined || secondPage === undefined) continue;
      const match = horizontalMatches.get(matchKey(firstPage, secondPage));
      if (isStrong(match, minimumSimilarity)) horizontal.push(match);
    }
  }
  return { vertical, horizontal };
}

function weightedMedianOverlap(matches: EdgeMatch[]): number | undefined {
  if (matches.length === 0) return undefined;
  const sorted = [...matches].sort((first, second) => first.overlapPx - second.overlapPx);
  const total = sorted.reduce((sum, match) => sum + match.evidence, 0);
  let accumulated = 0;
  for (const match of sorted) {
    accumulated += match.evidence;
    if (accumulated >= total / 2) return match.overlapPx;
  }
  return sorted.at(-1)?.overlapPx;
}

function toInferredLayout(candidate: LayoutCandidate): InferredColumnLayout {
  return {
    pagesPerColumn: candidate.rows,
    columns: candidate.columns.map((column) =>
      Array.from({ length: candidate.rows }, (_, row) =>
        row >= column.top && row < column.top + column.length
          ? column.start + row - column.top
          : null,
      )
    ),
  };
}

function automaticLine(coordinatePt: number, matches: EdgeMatch[]): GuideLine {
  return {
    coordinatePt,
    source: "auto",
    supportPages: matches.length,
    pixelWeight: matches.reduce((sum, match) => sum + match.evidence, 0),
  };
}

export function detectContentOverlap(
  pages: readonly GuidePixelPage[],
  pageSize: PageSizePt,
  overrides: ContentOverlapOptions = {},
): ContentOverlapDetectionResult {
  const options = resolvedOptions(overrides);
  const first = pages[0];
  if (!first || pages.length < 2 || first.components < 3) {
    return { applied: false, confidence: 0, lines: {} };
  }
  if (pages.some((page) =>
    page.width !== first.width ||
    page.height !== first.height ||
    page.components < 3
  )) {
    return { applied: false, confidence: 0, lines: {} };
  }

  const horizontalScale = first.width / pageSize.width;
  const verticalScale = first.height / pageSize.height;
  const minimumHorizontal = Math.max(2, Math.round(options.minimumOverlapPt * horizontalScale));
  const maximumHorizontal = Math.min(
    Math.floor(first.width * 0.25),
    Math.max(minimumHorizontal, Math.round(options.maximumOverlapPt * horizontalScale)),
  );
  const minimumVertical = Math.max(2, Math.round(options.minimumOverlapPt * verticalScale));
  const maximumVertical = Math.min(
    Math.floor(first.height * 0.25),
    Math.max(minimumVertical, Math.round(options.maximumOverlapPt * verticalScale)),
  );
  const minimumEvidence = Math.max(12, Math.round(Math.min(first.width, first.height) * 0.04));
  const edges = pages.map((page) =>
    extractPageEdges(page, maximumHorizontal, maximumVertical)
  );
  const verticalMatches = new Map<string, EdgeMatch>();
  for (let index = 0; index < pages.length - 1; index += 1) {
    const match = bestEdgeMatch(
      edges[index]!.bottom,
      edges[index + 1]!.top,
      minimumVertical,
      maximumVertical,
      minimumEvidence,
      options.orthogonalShiftPx,
    );
    if (match) verticalMatches.set(matchKey(index + 1, index + 2), match);
  }
  const horizontalMatches = new Map<string, EdgeMatch>();
  for (let firstIndex = 0; firstIndex < pages.length - 1; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < pages.length; secondIndex += 1) {
      const match = bestEdgeMatch(
        edges[firstIndex]!.right,
        edges[secondIndex]!.left,
        minimumHorizontal,
        maximumHorizontal,
        minimumEvidence,
        options.orthogonalShiftPx,
      );
      if (match) horizontalMatches.set(matchKey(firstIndex + 1, secondIndex + 1), match);
    }
  }

  const candidates = inferLayout(
    pages.length,
    verticalMatches,
    horizontalMatches,
    options,
  );
  const best = candidates[0];
  if (!best) return { applied: false, confidence: 0, lines: {} };
  const matches = usedMatches(
    best,
    verticalMatches,
    horizontalMatches,
    options.minimumSimilarity,
  );
  const used = [...matches.vertical, ...matches.horizontal];
  if (matches.vertical.length < 2 || matches.horizontal.length < 2) {
    return { applied: false, confidence: 0, lines: {} };
  }
  const meanSimilarity = used.reduce((sum, match) => sum + match.similarity, 0) / used.length;
  const runnerUp = candidates.find((candidate) =>
    JSON.stringify(toInferredLayout(candidate)) !== JSON.stringify(toInferredLayout(best))
  );
  const margin = runnerUp ? Math.max(0, best.score - runnerUp.score) : 1;
  const support = Math.min(1, used.length / Math.max(4, Math.ceil(pages.length / 3)));
  const confidence = Math.min(
    1,
    meanSimilarity * 0.8 + support * 0.15 + Math.min(1, margin / 0.5) * 0.05,
  );
  const horizontalOverlapPx = weightedMedianOverlap(matches.horizontal);
  const verticalOverlapPx = weightedMedianOverlap(matches.vertical);
  if (
    confidence < options.minimumConfidence ||
    horizontalOverlapPx === undefined ||
    verticalOverlapPx === undefined
  ) {
    return { applied: false, confidence, lines: {} };
  }

  const horizontalOverlapPt = horizontalOverlapPx / horizontalScale;
  const verticalOverlapPt = verticalOverlapPx / verticalScale;
  const halfHorizontal = horizontalOverlapPt / 2;
  const halfVertical = verticalOverlapPt / 2;
  const lines: Record<GuideDirection, GuideLine> = {
    left: automaticLine(halfHorizontal, matches.horizontal),
    right: automaticLine(pageSize.width - halfHorizontal, matches.horizontal),
    top: automaticLine(halfVertical, matches.vertical),
    bottom: automaticLine(pageSize.height - halfVertical, matches.vertical),
  };
  return {
    applied: true,
    confidence,
    horizontalOverlapPt,
    verticalOverlapPt,
    lines,
    inferredLayout: toInferredLayout(best),
  };
}

export function applyContentOverlapDetection(
  redResult: GuideDetectionResult,
  pages: readonly GuidePixelPage[],
  pageSize: PageSizePt,
  options: ContentOverlapOptions = {},
): GuideDetectionResult {
  const overlap = detectContentOverlap(pages, pageSize, options);
  const contentOverlap: ContentOverlapMetadata = {
    applied: overlap.applied,
    confidence: overlap.confidence,
    ...(overlap.horizontalOverlapPt !== undefined
      ? { horizontalOverlapPt: overlap.horizontalOverlapPt }
      : {}),
    ...(overlap.verticalOverlapPt !== undefined
      ? { verticalOverlapPt: overlap.verticalOverlapPt }
      : {}),
  };
  if (!overlap.applied || !overlap.inferredLayout) {
    return {
      lines: {},
      missing: [...GUIDE_DIRECTIONS],
      options: redResult.options,
      contentOverlap,
    };
  }
  return {
    lines: overlap.lines,
    missing: GUIDE_DIRECTIONS.filter((direction) => !overlap.lines[direction]),
    options: redResult.options,
    inferredPagesPerColumn: overlap.inferredLayout.pagesPerColumn,
    inferredLayout: overlap.inferredLayout,
    contentOverlap,
  };
}

export function applyContentOverlapFallback(
  redResult: GuideDetectionResult,
  pages: readonly GuidePixelPage[],
  pageSize: PageSizePt,
  options: ContentOverlapOptions = {},
): GuideDetectionResult {
  if (GUIDE_DIRECTIONS.some((direction) => redResult.lines[direction])) return redResult;
  return applyContentOverlapDetection(redResult, pages, pageSize, options);
}

export function applyGuideStitchingMode(
  stitchingMode: GuideStitchingMode,
  redResult: GuideDetectionResult,
  pages: readonly GuidePixelPage[],
  pageSize: PageSizePt,
  options: ContentOverlapOptions = {},
): GuideDetectionResult {
  if (stitchingMode === "red-guides") return redResult;
  if (stitchingMode === "content-overlap") {
    return applyContentOverlapDetection(redResult, pages, pageSize, options);
  }
  return applyContentOverlapFallback(redResult, pages, pageSize, options);
}
