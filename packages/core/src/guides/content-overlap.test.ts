import { describe, expect, it } from "vitest";

import {
  applyContentOverlapFallback,
  applyGuideStitchingMode,
  contentOverlapDpiCandidates,
  detectContentOverlap,
  runContentOverlapDpiFallback,
  runContentOverlapDpiFallbackAsync,
} from "./content-overlap";
import {
  DEFAULT_GUIDE_DETECTION_OPTIONS,
  type GuideDetectionResult,
  type GuidePixelPage,
} from "./detection";

const PAGE_WIDTH = 60;
const PAGE_HEIGHT = 80;
const OVERLAP = 10;

function paintPixel(
  pixels: GuidePixelPage["pixels"],
  width: number,
  x: number,
  y: number,
) {
  if (x < 0 || y < 0 || x >= width || y >= pixels.length / width / 3) return;
  const offset = (y * width + x) * 3;
  pixels[offset] = 0;
  pixels[offset + 1] = 0;
  pixels[offset + 2] = 0;
}

function syntheticPages(): GuidePixelPage[] {
  const rows = 5;
  const columns = 5;
  const stepX = PAGE_WIDTH - OVERLAP;
  const stepY = PAGE_HEIGHT - OVERLAP;
  const width = stepX * (columns - 1) + PAGE_WIDTH;
  const height = stepY * (rows - 1) + PAGE_HEIGHT;
  const master = new Uint8Array(width * height * 3).fill(255);

  // Deterministic sparse vector-like marks. Adjacent tiles share identical edge content,
  // while unrelated edges have different signatures.
  for (let x = 0; x < width; x += 1) {
    paintPixel(master, width, x, (x * 17 + 23) % height);
    paintPixel(master, width, x, (x * 7 + 101) % height);
  }
  for (let y = 0; y < height; y += 1) {
    paintPixel(master, width, (y * 13 + 19) % width, y);
    paintPixel(master, width, (y * 5 + 73) % width, y);
    for (let x = 0; x < width; x += 1) {
      if ((x * 31 + y * 17 + x * y * 7) % 29 === 0) {
        paintPixel(master, width, x, y);
      }
    }
  }

  const occupied = [
    [0, 0], [0, 1], [0, 2], [0, 3], [0, 4],
    [1, 0], [1, 1], [1, 2], [1, 3], [1, 4],
    [2, 0], [2, 1], [2, 2], [2, 3], [2, 4],
    [3, 1], [3, 2], [3, 3], [3, 4],
    [4, 1], [4, 2], [4, 3], [4, 4],
  ];
  return occupied.map(([column = 0, row = 0], index) => {
    const pixels = new Uint8Array(PAGE_WIDTH * PAGE_HEIGHT * 3).fill(255);
    for (let y = 0; y < PAGE_HEIGHT; y += 1) {
      const sourceStart = ((row * stepY + y) * width + column * stepX) * 3;
      pixels.set(master.subarray(sourceStart, sourceStart + PAGE_WIDTH * 3), y * PAGE_WIDTH * 3);
    }
    return {
      pageNumber: index + 1,
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
      stride: PAGE_WIDTH * 3,
      components: 3,
      pixels,
    };
  });
}

function blankSyntheticPages(count: number): GuidePixelPage[] {
  return Array.from({ length: count }, (_, index) => ({
    pageNumber: index + 1,
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
    stride: PAGE_WIDTH * 3,
    components: 3,
    pixels: new Uint8Array(PAGE_WIDTH * PAGE_HEIGHT * 3).fill(255),
  }));
}

function paintVerticalSeam(
  first: GuidePixelPage,
  second: GuidePixelPage,
  seed: number,
  matchingPoints: number,
) {
  for (let index = 0; index < 24; index += 1) {
    const distance = 1 + ((index * 5 + seed) % 8);
    const sourceX = 14 + ((index * 11 + seed * 7) % 17);
    const targetX = index < matchingPoints
      ? sourceX
      : 35 + ((index * 5 + seed) % 11);
    paintPixel(first.pixels, first.width, sourceX, first.height - 1 - distance);
    paintPixel(second.pixels, second.width, targetX, OVERLAP - 1 - distance);
  }
}

function paintHorizontalSeam(
  first: GuidePixelPage,
  second: GuidePixelPage,
  seed: number,
  matchingPoints: number,
) {
  for (let index = 0; index < 24; index += 1) {
    const distance = 1 + ((index * 5 + seed) % 8);
    const sourceY = 14 + ((index * 13 + seed * 7) % 23);
    const targetY = index < matchingPoints
      ? sourceY
      : 43 + ((index * 5 + seed) % 23);
    paintPixel(first.pixels, first.width, first.width - 1 - distance, sourceY);
    paintPixel(second.pixels, second.width, OVERLAP - 1 - distance, targetY);
  }
}

function syntheticFullGridWithWeakMiddleColumn(): GuidePixelPage[] {
  const rows = 5;
  const columns = 4;
  const pages = blankSyntheticPages(rows * columns);

  for (let column = 0; column < columns; column += 1) {
    for (let row = 0; row < rows - 1; row += 1) {
      const firstIndex = column * rows + row;
      paintVerticalSeam(
        pages[firstIndex]!,
        pages[firstIndex + 1]!,
        column * rows + row,
        column === 2 ? 17 : 24,
      );
    }
  }

  for (let column = 0; column < columns - 1; column += 1) {
    for (let row = 0; row < rows; row += 1) {
      const firstIndex = column * rows + row;
      const secondIndex = firstIndex + rows;
      paintHorizontalSeam(
        pages[firstIndex]!,
        pages[secondIndex]!,
        column * rows + row + 50,
        column === 0 ? 24 : column === 1 ? 15 : row === 0 ? 12 : 24,
      );
    }
  }

  return pages;
}

function missingRedResult(): GuideDetectionResult {
  return {
    lines: {},
    missing: ["left", "right", "top", "bottom"],
    options: { ...DEFAULT_GUIDE_DETECTION_OPTIONS },
  };
}

describe("content overlap detection", () => {
  it("retries alternate raster DPIs until content matching succeeds", async () => {
    expect(contentOverlapDpiCandidates(72)).toEqual([72, 120, 48]);
    expect(contentOverlapDpiCandidates(48)).toEqual([48, 120]);
    expect(contentOverlapDpiCandidates(72, "speed-first")).toEqual([48, 72, 120]);
    expect(contentOverlapDpiCandidates(120, "speed-first")).toEqual([48, 120]);

    const attempts: number[] = [];
    const result = runContentOverlapDpiFallback(72, (dpi) => {
      attempts.push(dpi);
      return {
        ...missingRedResult(),
        contentOverlap: { applied: dpi === 120, confidence: dpi === 120 ? 0.93 : 0 },
      };
    });
    expect(attempts).toEqual([72, 120]);
    expect(result.contentOverlap).toMatchObject({ applied: true, rasterDpi: 120 });

    const asyncAttempts: number[] = [];
    const asyncResult = await runContentOverlapDpiFallbackAsync(120, async (dpi) => {
      asyncAttempts.push(dpi);
      return {
        ...missingRedResult(),
        contentOverlap: { applied: dpi === 48, confidence: dpi === 48 ? 0.93 : 0 },
      };
    });
    expect(asyncAttempts).toEqual([120, 48]);
    expect(asyncResult.contentOverlap).toMatchObject({ applied: true, rasterDpi: 48 });

    const fastAttempts: number[] = [];
    const fastResult = runContentOverlapDpiFallback(
      72,
      (dpi) => {
        fastAttempts.push(dpi);
        return {
          ...missingRedResult(),
          contentOverlap: { applied: dpi === 48, confidence: dpi === 48 ? 0.93 : 0 },
        };
      },
      "speed-first",
    );
    expect(fastAttempts).toEqual([48]);
    expect(fastResult.contentOverlap).toMatchObject({ applied: true, rasterDpi: 48 });

    const fastAsyncAttempts: number[] = [];
    const fastAsyncResult = await runContentOverlapDpiFallbackAsync(
      72,
      async (dpi) => {
        fastAsyncAttempts.push(dpi);
        return {
          ...missingRedResult(),
          contentOverlap: { applied: dpi === 48, confidence: dpi === 48 ? 0.93 : 0 },
        };
      },
      "speed-first",
    );
    expect(fastAsyncAttempts).toEqual([48]);
    expect(fastAsyncResult.contentOverlap).toMatchObject({
      applied: true,
      rasterDpi: 48,
    });
  });

  it("recovers a column-major layout with top padding and shared overlap", () => {
    const result = detectContentOverlap(
      syntheticPages(),
      { width: PAGE_WIDTH, height: PAGE_HEIGHT },
      { minimumOverlapPt: 6, maximumOverlapPt: 14 },
    );
    expect(result.applied).toBe(true);
    expect(result.horizontalOverlapPt).toBeCloseTo(OVERLAP, 0);
    expect(result.verticalOverlapPt).toBeCloseTo(OVERLAP, 0);
    expect(result.inferredLayout).toEqual({
      pagesPerColumn: 5,
      columns: [
        [1, 2, 3, 4, 5],
        [6, 7, 8, 9, 10],
        [11, 12, 13, 14, 15],
        [null, 16, 17, 18, 19],
        [null, 20, 21, 22, 23],
      ],
    });
    expect(result.lines).toMatchObject({
      left: { coordinatePt: 5, source: "auto" },
      right: { coordinatePt: 55, source: "auto" },
      top: { coordinatePt: 5, source: "auto" },
      bottom: { coordinatePt: 75, source: "auto" },
    });
  });

  it("does not invent blank cells to avoid weak matches inside a full grid", () => {
    const result = detectContentOverlap(
      syntheticFullGridWithWeakMiddleColumn(),
      { width: PAGE_WIDTH, height: PAGE_HEIGHT },
      { minimumOverlapPt: 6, maximumOverlapPt: 14 },
    );

    expect(result.applied).toBe(true);
    expect(result.inferredLayout).toEqual({
      pagesPerColumn: 5,
      columns: [
        [1, 2, 3, 4, 5],
        [6, 7, 8, 9, 10],
        [11, 12, 13, 14, 15],
        [16, 17, 18, 19, 20],
      ],
    });
  });

  it("does not run the fallback when any red guide was detected", () => {
    const redResult: GuideDetectionResult = {
      ...missingRedResult(),
      lines: {
        left: { coordinatePt: 8, source: "auto", supportPages: 2, pixelWeight: 100 },
      },
      missing: ["right", "top", "bottom"],
    };

    expect(applyContentOverlapFallback(
      redResult,
      syntheticPages(),
      { width: PAGE_WIDTH, height: PAGE_HEIGHT },
    )).toBe(redResult);
  });

  it("honours an explicit red or content stitching mode", () => {
    const redResult: GuideDetectionResult = {
      ...missingRedResult(),
      lines: {
        left: { coordinatePt: 8, source: "auto", supportPages: 2, pixelWeight: 100 },
      },
      missing: ["right", "top", "bottom"],
    };
    const pages = syntheticPages();
    const pageSize = { width: PAGE_WIDTH, height: PAGE_HEIGHT };

    expect(applyGuideStitchingMode(
      "red-guides",
      redResult,
      pages,
      pageSize,
    )).toBe(redResult);

    const contentResult = applyGuideStitchingMode(
      "content-overlap",
      redResult,
      pages,
      pageSize,
      { minimumOverlapPt: 6, maximumOverlapPt: 14 },
    );
    expect(contentResult.contentOverlap?.applied).toBe(true);
    expect(contentResult.lines.left?.coordinatePt).toBeCloseTo(5, 0);
    expect(contentResult.lines.left?.coordinatePt).not.toBe(8);
  });

  it("keeps the red-line result when unrelated pages have no reliable overlap", () => {
    const pages = syntheticPages().slice(0, 3).map((page, index) => ({
      ...page,
      pixels: new Uint8Array(page.pixels.length).fill(index === 0 ? 255 : 240),
    }));
    const redResult = missingRedResult();
    const result = applyContentOverlapFallback(
      redResult,
      pages,
      { width: PAGE_WIDTH, height: PAGE_HEIGHT },
    );

    expect(result.lines).toEqual({});
    expect(result.missing).toEqual(["left", "right", "top", "bottom"]);
    expect(result.contentOverlap).toMatchObject({ applied: false, confidence: 0 });
  });
});
